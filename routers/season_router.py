"""
Routeur FastAPI pour les pronostics d'Avant-Saison (Chantier 3) :
- GET /api/season/candidates : Liste des équipes et candidats officiels pour les menus déroulants
- GET /api/season/predictions : Consultation des 5 pronostics de l'utilisateur avec statut de verrouillage
- POST /api/season/predictions : Enregistrement/mise à jour verrouillé au coup d'envoi du 1er match
"""
from datetime import datetime, timezone
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Match, SeasonPrediction, User, Team
from schemas import SeasonPredictionCreate, SeasonPredictionResponse
from auth import get_current_user

router = APIRouter(prefix="/api/season", tags=["Pronostics d'Avant-Saison"])

MVP_CANDIDATES = [
    "Anthony Edwards (Timberwolves)",
    "Luka Doncic (Mavericks)",
    "Nikola Jokic (Nuggets)",
    "Shai Gilgeous-Alexander (Thunder)",
    "Giannis Antetokounmpo (Bucks)",
    "Jayson Tatum (Celtics)",
    "Victor Wembanyama (Spurs)",
    "Joel Embiid (76ers)",
    "Stephen Curry (Warriors)",
    "LeBron James (Lakers)"
]

DPOY_CANDIDATES = [
    "Victor Wembanyama (Spurs)",
    "Rudy Gobert (Timberwolves)",
    "Bam Adebayo (Heat)",
    "Anthony Davis (Lakers)",
    "Jaren Jackson Jr. (Grizzlies)",
    "OG Anunoby (Knicks)",
    "Chet Holmgren (Thunder)",
    "Herb Jones (Pelicans)"
]

ROY_CANDIDATES = [
    "Cooper Flagg",
    "Zaccharie Risacher",
    "Alex Sarr",
    "Reed Sheppard",
    "Stephon Castle",
    "Matas Buzelis",
    "Ron Holland",
    "Donovan Clingan",
    "Dalton Knecht"
]

def get_season_lock_status(db: Session):
    """
    Détermine si la saison a commencé en consultant la deadline du tout premier match (Semaine 1).
    Verrouille immédiatement dès que now >= 1er match ou si le 1er match n'est plus 'upcoming'.
    """
    first_match = db.query(Match).filter(Match.week_number == 1).order_by(Match.deadline.asc(), Match.id.asc()).first()
    if not first_match:
        return False, None

    now = datetime.now(timezone.utc)
    first_deadline = first_match.deadline
    if first_deadline.tzinfo is None:
        first_deadline = first_deadline.replace(tzinfo=timezone.utc)

    is_locked = (now >= first_deadline) or (first_match.status != "upcoming")
    return is_locked, first_deadline


@router.get("/candidates")
def get_candidates(db: Session = Depends(get_db)):
    """
    Retourne la liste des équipes NBA officielles et les candidats majeurs pour chaque catégorie.
    """
    teams = db.query(Team.city).order_by(Team.city.asc()).all()
    team_names = [t[0] for t in teams]
    if not team_names:
        team_names = [
            "Boston", "Denver", "Dallas", "Golden State", "Los Angeles (LAL)",
            "Milwaukee", "Minnesota", "New York", "Oklahoma City", "Philadelphia"
        ]

    return {
        "teams": team_names,
        "mvp": MVP_CANDIDATES,
        "dpoy": DPOY_CANDIDATES,
        "roy": ROY_CANDIDATES
    }


@router.get("/predictions", response_model=SeasonPredictionResponse)
def get_my_season_prediction(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retourne les choix d'avant-saison du joueur connecté, accompagnés de la deadline et du statut de verrouillage.
    """
    is_locked, deadline = get_season_lock_status(db)
    pred = db.query(SeasonPrediction).filter(SeasonPrediction.user_id == current_user.id).first()

    if not pred:
        return SeasonPredictionResponse(
            id=None,
            user_id=current_user.id,
            nba_champion=None,
            cup_winner=None,
            mvp=None,
            dpoy=None,
            roy=None,
            is_locked=is_locked,
            deadline=deadline,
            updated_at=None
        )

    return SeasonPredictionResponse(
        id=pred.id,
        user_id=pred.user_id,
        nba_champion=pred.nba_champion,
        cup_winner=pred.cup_winner,
        mvp=pred.mvp,
        dpoy=pred.dpoy,
        roy=pred.roy,
        is_locked=is_locked,
        deadline=deadline,
        updated_at=pred.updated_at
    )


@router.post("/predictions", response_model=SeasonPredictionResponse)
def save_season_prediction(
    data: SeasonPredictionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enregistre ou met à jour les 5 choix définitifs d'avant-saison :
    - Vérifie strictement que la saison n'a pas encore débuté (premier match non commencé)
    - Enregistre ou met à jour le choix de l'utilisateur
    """
    is_locked, deadline = get_season_lock_status(db)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Les pronostics d'avant-saison sont définitivement verrouillés car le premier match de la saison a débuté !"
        )

    pred = db.query(SeasonPrediction).filter(SeasonPrediction.user_id == current_user.id).first()
    if pred:
        pred.nba_champion = data.nba_champion.strip()
        pred.cup_winner = data.cup_winner.strip()
        pred.mvp = data.mvp.strip()
        pred.dpoy = data.dpoy.strip()
        pred.roy = data.roy.strip()
        pred.updated_at = datetime.now(timezone.utc)
    else:
        pred = SeasonPrediction(
            user_id=current_user.id,
            nba_champion=data.nba_champion.strip(),
            cup_winner=data.cup_winner.strip(),
            mvp=data.mvp.strip(),
            dpoy=data.dpoy.strip(),
            roy=data.roy.strip()
        )
        db.add(pred)

    db.commit()
    db.refresh(pred)

    return SeasonPredictionResponse(
        id=pred.id,
        user_id=pred.user_id,
        nba_champion=pred.nba_champion,
        cup_winner=pred.cup_winner,
        mvp=pred.mvp,
        dpoy=pred.dpoy,
        roy=pred.roy,
        is_locked=is_locked,
        deadline=deadline,
        updated_at=pred.updated_at
    )
