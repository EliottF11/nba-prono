from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import random

from database import get_db
import models
import schemas
from routers.auth_router import get_current_user

router = APIRouter(tags=["Bonuses"])

def get_current_iso_week():
    now = datetime.now(timezone.utc)
    # isocalendar returns (year, week, weekday)
    return now.isocalendar()

@router.get("/api/bonuses/current", response_model=schemas.WeeklyUserBonusResponse)
def get_current_bonus(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Cherche le WeeklyUserBonus de l'utilisateur pour la semaine et l'année en cours.
    Retourne le bonus (ou Null/404 via une gestion spécifique si souhaité, ici on retourne simplement si on le trouve).
    """
    iso_year, iso_week, _ = get_current_iso_week()
    bonus = db.query(models.WeeklyUserBonus).filter(
        models.WeeklyUserBonus.user_id == current_user.id,
        models.WeeklyUserBonus.week_number == iso_week,
        models.WeeklyUserBonus.year == iso_year
    ).first()
    
    if not bonus:
        raise HTTPException(status_code=404, detail="Aucun bonus actif pour cette semaine.")
    return bonus

@router.post("/api/bonuses/spin", response_model=schemas.WeeklyUserBonusResponse)
def spin_bonus_wheel(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Attribue un bonus aléatoire pour la semaine en cours si l'utilisateur n'en a pas déjà un.
    """
    iso_year, iso_week, _ = get_current_iso_week()
    
    existing_bonus = db.query(models.WeeklyUserBonus).filter(
        models.WeeklyUserBonus.user_id == current_user.id,
        models.WeeklyUserBonus.week_number == iso_week,
        models.WeeklyUserBonus.year == iso_year
    ).first()

    if existing_bonus:
        raise HTTPException(status_code=400, detail="Tu as déjà obtenu un bonus cette semaine !")

    # Attribution aléatoire : 40% DOUBLE, 30% SHIELD, 20% ALL_IN, 10% UPSET
    choices = ['DOUBLE', 'SHIELD', 'ALL_IN', 'UPSET']
    weights = [40, 30, 20, 10]
    assigned_type = random.choices(choices, weights=weights, k=1)[0]

    new_bonus = models.WeeklyUserBonus(
        user_id=current_user.id,
        week_number=iso_week,
        year=iso_year,
        bonus_type=assigned_type
    )
    db.add(new_bonus)
    db.commit()
    db.refresh(new_bonus)
    
    return new_bonus

@router.post("/api/predictions/{match_id}/apply-bonus", response_model=schemas.PredictionResponse)
def apply_bonus(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Applique le bonus de la semaine sur le pronostic existant de l'utilisateur pour le match donné.
    Si le bonus est 'UPSET', vérifie que l'équipe choisie a la plus grosse cote.
    Note : Le chemin est /api/bonuses/predictions/{match_id}/apply car le préfixe du router est /api/bonuses,
    ou si on veut l'intégrer au préfixe /api/predictions, il faut le définir en conséquence.
    Ici, le routeur a pour prefix /api/bonuses, l'URI sera donc /api/bonuses/predictions/{match_id}/apply.
    """
    iso_year, iso_week, _ = get_current_iso_week()
    
    # 1. Vérifier le bonus
    bonus = db.query(models.WeeklyUserBonus).filter(
        models.WeeklyUserBonus.user_id == current_user.id,
        models.WeeklyUserBonus.week_number == iso_week,
        models.WeeklyUserBonus.year == iso_year
    ).first()

    if not bonus:
        raise HTTPException(status_code=404, detail="Tu n'as aucun bonus actif pour cette semaine.")
    if bonus.is_used:
        raise HTTPException(status_code=400, detail="Ton bonus hebdomadaire a déjà été utilisé.")

    # 2. Vérifier le match et le pronostic
    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable.")

    prediction = db.query(models.Prediction).filter(
        models.Prediction.match_id == match_id,
        models.Prediction.user_id == current_user.id
    ).first()

    if not prediction:
        raise HTTPException(status_code=404, detail="Tu n'as pas encore pronostiqué ce match.")
    
    if prediction.applied_bonus is not None:
        raise HTTPException(status_code=400, detail="Un bonus est déjà appliqué sur ce pronostic.")

    # 3. Logique spécifique pour UPSET
    if bonus.bonus_type == 'UPSET':
        chosen_odds = match.home_odds if prediction.selected_team_id == match.home_team_id else match.away_odds
        other_odds = match.away_odds if prediction.selected_team_id == match.home_team_id else match.home_odds
        
        if chosen_odds <= other_odds:
            raise HTTPException(
                status_code=400, 
                detail="Le bonus UPSET ne peut être utilisé que si tu as pronostiqué l'outsider (l'équipe avec la plus grosse cote)."
            )

    # 4. Application du bonus
    prediction.applied_bonus = bonus.bonus_type
    bonus.is_used = True
    
    db.commit()
    db.refresh(prediction)
    db.refresh(bonus)
    
    return prediction

@router.post("/api/predictions/{match_id}/remove-bonus", response_model=schemas.PredictionResponse)
def remove_bonus(
    match_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Retire le bonus appliqué sur un pronostic (s'il existe et que le match n'a pas commencé),
    et rend le bonus à nouveau utilisable.
    """
    prediction = db.query(models.Prediction).filter(
        models.Prediction.match_id == match_id,
        models.Prediction.user_id == current_user.id
    ).first()

    if not prediction:
        raise HTTPException(status_code=404, detail="Tu n'as pas encore pronostiqué ce match.")
    
    if prediction.applied_bonus is None:
        raise HTTPException(status_code=400, detail="Aucun bonus n'est appliqué sur ce pronostic.")

    match = db.query(models.Match).filter(models.Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match introuvable.")
    
    # Empêcher le retrait si le match a commencé (deadline passée)
    now = datetime.now(timezone.utc)
    # Assumons que match.deadline est timezone-aware ou utc. Si pas le cas, adapter.
    # Dans la db SQLite, c'est une string ISO 8601, SQLAlchemy le convertit souvent en datetime.
    if match.deadline.tzinfo is None:
        deadline = match.deadline.replace(tzinfo=timezone.utc)
    else:
        deadline = match.deadline
        
    if now > deadline:
        raise HTTPException(status_code=400, detail="Le match a déjà commencé, tu ne peux plus retirer le bonus.")

    iso_year, iso_week, _ = get_current_iso_week()
    bonus = db.query(models.WeeklyUserBonus).filter(
        models.WeeklyUserBonus.user_id == current_user.id,
        models.WeeklyUserBonus.week_number == iso_week,
        models.WeeklyUserBonus.year == iso_year,
        models.WeeklyUserBonus.bonus_type == prediction.applied_bonus
    ).first()

    if not bonus:
        # Cas théoriquement impossible si les données sont cohérentes, mais au cas où :
        raise HTTPException(status_code=500, detail="Bonus introuvable dans ta semaine actuelle.")

    prediction.applied_bonus = None
    bonus.is_used = False
    
    db.commit()
    db.refresh(prediction)
    db.refresh(bonus)
    
    return prediction

