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
from schemas import MatchResponse, PredictionCreate, PredictionResponse, LeaderboardEntry
from auth import get_current_user

router = APIRouter(prefix="/api", tags=["Pronostics & Matchs"])

@router.get("/matches", response_model=List[MatchResponse])
def get_matches(status_filter: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Récupère la liste des matchs hebdomadaires ordonnés par heure limite croissante.
    Permet un filtrage optionnel par statut (?status_filter=upcoming ou finished).
    """
    query = db.query(Match)
    if status_filter:
        query = query.filter(Match.status == status_filter)
    matches = query.order_by(Match.deadline.asc()).all()
    return matches


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


@router.get("/leaderboard", response_model=List[LeaderboardEntry])
def get_leaderboard(db: Session = Depends(get_db)):
    """
    Renvoie le classement en direct de tous les joueurs inscrits,
    triés par leur total de points décroissant, avec leur rang et statistiques.
    """
    users = db.query(User).order_by(User.total_points.desc(), User.username.asc()).all()

    leaderboard = []
    for rank, u in enumerate(users, start=1):
        preds = db.query(Prediction).filter(Prediction.user_id == u.id).all()
        won_count = sum(1 for p in preds if p.points_won > 0)
        
        leaderboard.append(LeaderboardEntry(
            rank=rank,
            user_id=u.id,
            username=u.username,
            total_points=round(u.total_points, 2),
            predictions_count=len(preds),
            won_count=won_count
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
    - Attribue les points (cote exacte du vainqueur) aux joueurs ayant vu juste
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
            pred.points_won = round(winning_odds, 2)
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

