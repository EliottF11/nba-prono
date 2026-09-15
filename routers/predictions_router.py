"""
Routeur FastAPI pour les matchs, pronostics et classement en direct :
- GET /api/matches : Consultation de tous les matchs hebdomadaires avec cotes
- POST /api/predictions : Pronostic 1-clic avec vérification stricte de deadline
- GET /api/predictions/me : Liste des pronostics du joueur connecté
- GET /api/leaderboard : Classement général trié par points
- POST /api/matches/{match_id}/resolve : Résolution d'un match (score et calcul des points)
"""
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
from models import Match, Prediction, User, Team
from schemas import (
    MatchResponse, PredictionCreate, PredictionResponse, LeaderboardEntry,
    UserStatsResponse, BadgeResponse, BoostResponse
)
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Pronostics & Matchs"])

@router.get("/matches", response_model=List[MatchResponse])
def get_matches(
    status_filter: Optional[str] = None,
    week: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    Récupère la liste des matchs ordonnés par heure limite croissante.
    Permet un filtrage optionnel par statut (?status_filter=upcoming ou finished)
    et par semaine NBA (?week=1, 2, etc.).
    """
    query = db.query(Match)
    if status_filter:
        query = query.filter(Match.status == status_filter)
    if week is not None:
        query = query.filter(Match.week_number == week)
    matches = query.order_by(Match.deadline.asc()).all()
    return matches


@router.get("/weeks", tags=["Pronostics & Matchs"])
def get_weeks(db: Session = Depends(get_db)):
    """
    Retourne la liste des semaines NBA disponibles avec le nombre de matchs associés.
    """
    from sqlalchemy import func
    rows = (
        db.query(Match.week_number, func.count(Match.id))
        .group_by(Match.week_number)
        .order_by(Match.week_number.asc())
        .all()
    )
    weeks = [{"week": r[0], "match_count": r[1]} for r in rows]
    if not weeks:
        weeks = [{"week": 1, "match_count": 0}]
    return weeks


@router.post("/predictions", response_model=PredictionResponse)
def make_prediction(
    prediction_data: PredictionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enregistre ou met à jour le pronostic du joueur en 1-clic :
    - Vérifie l'existence du match
    - Vérifie que le match est bien 'upcoming'
    - Vérifie que la date limite (deadline) n'est pas dépassée
    - Vérifie que l'équipe sélectionnée participe bien à la rencontre
    - Met à jour le pronostic existant ou en insère un nouveau
    """
    match = db.query(Match).filter(Match.id == prediction_data.match_id).first()
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Match introuvable."
        )

    # Vérification du statut du match
    if match.status != "upcoming":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ce match est déjà commencé ou terminé. Pronostics fermés."
        )

    # Vérification stricte de la deadline
    now = datetime.now(timezone.utc)
    match_deadline = match.deadline
    if match_deadline.tzinfo is None:
        match_deadline = match_deadline.replace(tzinfo=timezone.utc)

    if now >= match_deadline:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La date limite pour pronostiquer sur ce match est dépassée."
        )

    # Vérification que l'équipe choisie fait bien partie du match
    if prediction_data.selected_team_id not in [match.home_team_id, match.away_team_id]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'équipe choisie ne dispute pas ce match."
        )

    # Recherche d'un éventuel pronostic déjà existant
    existing_pred = db.query(Prediction).filter(
        Prediction.user_id == current_user.id,
        Prediction.match_id == match.id
    ).first()

    if existing_pred:
        # Mise à jour 1-clic
        existing_pred.selected_team_id = prediction_data.selected_team_id
        db.commit()
        db.refresh(existing_pred)
        return existing_pred
    else:
        # Nouveau pronostic
        new_pred = Prediction(
            user_id=current_user.id,
            match_id=match.id,
            selected_team_id=prediction_data.selected_team_id,
            points_won=0.0
        )
        db.add(new_pred)
        db.commit()
        db.refresh(new_pred)
        return new_pred


@router.get("/predictions/me", response_model=List[PredictionResponse])
def get_my_predictions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Renvoie l'ensemble des pronostics enregistrés par le joueur connecté.
    """
    predictions = db.query(Prediction).filter(
        Prediction.user_id == current_user.id
    ).all()
    return predictions


@router.post("/predictions/{match_id}/boost", response_model=BoostResponse, tags=["Pronostics & Matchs"])
def toggle_prediction_boost(
    match_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Active ou désactive le Bonus x2 sur un match pour la semaine NBA correspondante.
    Règle absolue : 1 seul match boosté x2 par semaine par joueur.
    Activer le bonus sur un autre match de la même semaine transfère automatiquement le bonus.
    """
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable.")

    if match.status != "upcoming":
        raise HTTPException(
            status_code=400,
            detail="Le match est déjà commencé ou terminé. Impossible de modifier le Bonus x2."
        )

    now = datetime.now(timezone.utc)
    match_deadline = match.deadline
    if match_deadline.tzinfo is None:
        match_deadline = match_deadline.replace(tzinfo=timezone.utc)

    if now >= match_deadline:
        raise HTTPException(
            status_code=400,
            detail="La date limite de ce match est dépassée. Impossible de modifier le Bonus x2."
        )

    # Récupération du pronostic du joueur sur ce match
    pred = db.query(Prediction).filter(
        Prediction.user_id == current_user.id,
        Prediction.match_id == match.id
    ).first()

    if not pred:
        raise HTTPException(
            status_code=400,
            detail="Sélectionne d'abord ton vainqueur sur ce match avant d'activer le Bonus x2 !"
        )

    target_week = match.week_number

    if pred.is_boosted:
        # Désactivation du bonus
        pred.is_boosted = False
        db.commit()
        return {
            "match_id": match.id,
            "is_boosted": False,
            "week_number": target_week,
            "message": "Bonus x2 désactivé sur ce match."
        }
    else:
        # 1 seul bonus x2 par semaine : réinitialiser tous les autres matchs de cette même semaine
        week_match_ids = [
            m.id for m in db.query(Match.id).filter(Match.week_number == target_week).all()
        ]
        db.query(Prediction).filter(
            Prediction.user_id == current_user.id,
            Prediction.match_id.in_(week_match_ids)
        ).update({"is_boosted": False}, synchronize_session=False)

        pred.is_boosted = True
        db.commit()
        return {
            "match_id": match.id,
            "is_boosted": True,
            "week_number": target_week,
            "message": f"Bonus x2 activé pour la Semaine {target_week} ! Les points seront doublés en cas de victoire."
        }


@router.get("/leaderboard", response_model=List[LeaderboardEntry])
def get_leaderboard(db: Session = Depends(get_db)):
    """
    Renvoie le classement général des joueurs trié par points décroissants.
    """
    users = db.query(User).order_by(User.total_points.desc(), User.id.asc()).all()
    leaderboard = []

    for rank, user in enumerate(users, start=1):
        preds = user.predictions
        won = sum(1 for p in preds if p.points_won > 0)
        leaderboard.append(LeaderboardEntry(
            rank=rank,
            user_id=user.id,
            username=user.username,
            total_points=user.total_points,
            predictions_count=len(preds),
            won_count=won
        ))

    return leaderboard


@router.post("/matches/{match_id}/resolve")
def resolve_match(
    match_id: int,
    winner_team_id: int,
    home_score: int,
    away_score: int,
    db: Session = Depends(get_db)
):
    """
    Clôture un match, enregistre le score final et calcule les gains :
    - Attribue les points (cote exacte x2 si Bonus x2 activé) aux joueurs ayant vu juste
    - Met à jour le total_points de chaque joueur pour le classement en direct
    """
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable")

    if winner_team_id not in [match.home_team_id, match.away_team_id]:
        raise HTTPException(status_code=400, detail="L'équipe gagnante doit être l'équipe domicile ou extérieure")

    # Mise à jour du match
    match.status = "finished"
    match.winner_team_id = winner_team_id
    match.home_score = home_score
    match.away_score = away_score

    # Déterminer la cote gagnante
    winning_odds = match.home_odds if winner_team_id == match.home_team_id else match.away_odds

    # Traitement des pronostics
    predictions = db.query(Prediction).filter(Prediction.match_id == match.id).all()
    affected_user_ids = set()

    for pred in predictions:
        if pred.selected_team_id == winner_team_id:
            multiplier = 2.0 if pred.is_boosted else 1.0
            pred.points_won = round(winning_odds * multiplier, 2)
        else:
            pred.points_won = 0.0
        affected_user_ids.add(pred.user_id)

    db.flush()

    # Recalcul des points totaux pour les utilisateurs impactés
    for uid in affected_user_ids:
        user = db.query(User).filter(User.id == uid).first()
        if user:
            total = sum(p.points_won for p in user.predictions)
            user.total_points = round(total, 2)

    db.commit()
    return {
        "message": f"Match #{match_id} clôturé.",
        "winner_team_id": winner_team_id,
        "score": f"{home_score} - {away_score}",
        "predictions_updated": len(predictions)
    }


@router.post("/sync", tags=["Synchronisation"])
def trigger_sync(date_str: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Synchronise les scores et matchs avec l'API officielle API-Sports.
    Clôture automatiquement les matchs terminés et recalcule le classement en direct.
    """
    from services.nba_service import sync_scores_for_date, check_api_status
    target_date = date_str or datetime.now().strftime("%Y-%m-%d")
    try:
        quota = check_api_status()
        sync_info = sync_scores_for_date(db, target_date)
        return {
            "status": "success",
            "quota": quota,
            "sync": sync_info
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/me/stats", response_model=UserStatsResponse, tags=["Profil & Statistiques"])
def get_my_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retourne les statistiques détaillées et les badges du joueur connecté :
    - Winrate (% de réussite)
    - Cote moyenne trouvée
    - Plus grosse cote validée
    - Système de badges visuels : 'Rookie', 'Sniper', 'Maçon'
    """
    # 1. Calcul du rang général
    all_users = db.query(User).order_by(User.total_points.desc(), User.id.asc()).all()
    user_rank = None
    for idx, u in enumerate(all_users, start=1):
        if u.id == current_user.id:
            user_rank = idx
            break

    # 2. Récupération des pronostics du joueur avec leurs matchs associés
    predictions = (
        db.query(Prediction, Match)
        .join(Match, Prediction.match_id == Match.id)
        .filter(Prediction.user_id == current_user.id)
        .order_by(Match.deadline.asc(), Match.id.asc())
        .all()
    )

    total_preds = len(predictions)
    finished_preds = 0
    won_preds = 0
    lost_preds = 0
    won_odds_list = []
    
    max_loss_streak = 0
    current_loss_streak = 0
    sniper_count = 0  # cotes > 2.50 validées

    for pred, match in predictions:
        if match.status == "finished" and match.winner_team_id is not None:
            finished_preds += 1
            if pred.selected_team_id == match.winner_team_id:
                won_preds += 1
                current_loss_streak = 0
                
                odds = match.home_odds if pred.selected_team_id == match.home_team_id else match.away_odds
                won_odds_list.append(odds)
                
                if odds > 2.50:
                    sniper_count += 1
            else:
                lost_preds += 1
                current_loss_streak += 1
                if current_loss_streak > max_loss_streak:
                    max_loss_streak = current_loss_streak

    winrate = round((won_preds / finished_preds * 100), 1) if finished_preds > 0 else 0.0
    avg_odds = round(sum(won_odds_list) / len(won_odds_list), 2) if won_odds_list else 0.0
    max_odds = round(max(won_odds_list), 2) if won_odds_list else 0.0

    # 3. Badges visuels
    # Badge 1 : "Rookie" (5 bons pronos)
    rookie_target = 5
    rookie_unlocked = won_preds >= rookie_target
    
    # Badge 2 : "Sniper" (3 cotes > 2.50 validées)
    sniper_target = 3
    sniper_unlocked = sniper_count >= sniper_target
    
    # Badge 3 : "Maçon" (5 erreurs de suite)
    macon_target = 5
    macon_unlocked = max_loss_streak >= macon_target

    badges = [
        {
            "id": "rookie",
            "name": "Rookie",
            "description": "5 bons pronos validés",
            "icon": "🏀",
            "unlocked": rookie_unlocked,
            "current": min(won_preds, rookie_target),
            "target": rookie_target,
            "progress_pct": min(int((won_preds / rookie_target) * 100), 100)
        },
        {
            "id": "sniper",
            "name": "Sniper",
            "description": "3 cotes > 2.50 validées",
            "icon": "🎯",
            "unlocked": sniper_unlocked,
            "current": min(sniper_count, sniper_target),
            "target": sniper_target,
            "progress_pct": min(int((sniper_count / sniper_target) * 100), 100)
        },
        {
            "id": "macon",
            "name": "Maçon",
            "description": "5 erreurs de suite",
            "icon": "🧱",
            "unlocked": macon_unlocked,
            "current": min(max_loss_streak, macon_target),
            "target": macon_target,
            "progress_pct": min(int((max_loss_streak / macon_target) * 100), 100)
        }
    ]

    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "total_points": current_user.total_points,
        "rank": user_rank,
        "total_predictions": total_preds,
        "finished_predictions": finished_preds,
        "won_predictions": won_preds,
        "lost_predictions": lost_preds,
        "winrate": winrate,
        "avg_odds": avg_odds,
        "max_odds": max_odds,
        "badges": badges
    }

