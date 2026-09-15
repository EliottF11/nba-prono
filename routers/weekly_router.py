"""
Routeur FastAPI pour les Pronostics Hebdomadaires (Chantier 4) :
- Joueur de la semaine - Conférence Est
- Joueur de la semaine - Conférence Ouest
Obligatoires à chaque nouvelle Semaine NBA avant de valider ses pronostics de matchs.
"""
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import Match, WeeklyPlayerPrediction, User
from schemas import WeeklyPlayerPredictionCreate, WeeklyPlayerPredictionResponse
from auth import get_current_user

router = APIRouter(prefix="/api/weekly-players", tags=["Pronostics Hebdomadaires (Joueurs de la Semaine)"])

EAST_PLAYERS = [
    "Jayson Tatum (Celtics)",
    "Jaylen Brown (Celtics)",
    "Giannis Antetokounmpo (Bucks)",
    "Damian Lillard (Bucks)",
    "Joel Embiid (76ers)",
    "Tyrese Maxey (76ers)",
    "Jalen Brunson (Knicks)",
    "Karl-Anthony Towns (Knicks)",
    "Donovan Mitchell (Cavaliers)",
    "Trae Young (Hawks)",
    "Bam Adebayo (Heat)",
    "Jimmy Butler (Heat)",
    "Tyrese Haliburton (Pacers)",
    "Pascal Siakam (Pacers)",
    "Paolo Banchero (Magic)",
    "Franz Wagner (Magic)",
    "Cade Cunningham (Pistons)",
    "Scottie Barnes (Raptors)",
    "LaMelo Ball (Hornets)",
    "Cam Thomas (Nets)"
]

WEST_PLAYERS = [
    "Nikola Jokic (Nuggets)",
    "Jamal Murray (Nuggets)",
    "Luka Doncic (Mavericks)",
    "Kyrie Irving (Mavericks)",
    "Shai Gilgeous-Alexander (Thunder)",
    "Chet Holmgren (Thunder)",
    "Anthony Edwards (Timberwolves)",
    "Stephen Curry (Warriors)",
    "LeBron James (Lakers)",
    "Anthony Davis (Lakers)",
    "Kevin Durant (Suns)",
    "Devin Booker (Suns)",
    "Victor Wembanyama (Spurs)",
    "Ja Morant (Grizzlies)",
    "De'Aaron Fox (Kings)",
    "Domantas Sabonis (Kings)",
    "Zion Williamson (Pelicans)",
    "James Harden (Clippers)",
    "Alperen Sengun (Rockets)",
    "Lauri Markkanen (Jazz)"
]


def get_week_lock_status(db: Session, week_number: int):
    """
    Détermine si une semaine donnée est verrouillée en consultant le coup d'envoi de son 1er match.
    """
    first_match = (
        db.query(Match)
        .filter(Match.week_number == week_number)
        .order_by(Match.deadline.asc(), Match.id.asc())
        .first()
    )
    if not first_match:
        return False, None

    now = datetime.now(timezone.utc)
    deadline = first_match.deadline
    if deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=timezone.utc)

    is_locked = (now >= deadline) or (first_match.status != "upcoming")
    return is_locked, deadline


@router.get("/candidates")
def get_weekly_candidates():
    """
    Retourne la liste officielle des candidats aux trophées de Joueur de la Semaine (Est et Ouest).
    """
    return {
        "east": EAST_PLAYERS,
        "west": WEST_PLAYERS
    }


@router.get("/{week_number}", response_model=WeeklyPlayerPredictionResponse)
def get_my_weekly_players(
    week_number: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Retourne les 2 joueurs de la semaine choisis par l'utilisateur pour une semaine donnée,
    ainsi que le statut de verrouillage et la deadline.
    """
    is_locked, deadline = get_week_lock_status(db, week_number)
    pred = (
        db.query(WeeklyPlayerPrediction)
        .filter(
            WeeklyPlayerPrediction.user_id == current_user.id,
            WeeklyPlayerPrediction.week_number == week_number
        )
        .first()
    )

    if not pred:
        return WeeklyPlayerPredictionResponse(
            id=None,
            user_id=current_user.id,
            week_number=week_number,
            east_player=None,
            west_player=None,
            is_locked=is_locked,
            deadline=deadline,
            updated_at=None
        )

    return WeeklyPlayerPredictionResponse(
        id=pred.id,
        user_id=pred.user_id,
        week_number=pred.week_number,
        east_player=pred.east_player,
        west_player=pred.west_player,
        is_locked=is_locked,
        deadline=deadline,
        updated_at=pred.updated_at
    )


@router.post("", response_model=WeeklyPlayerPredictionResponse)
def save_weekly_players(
    data: WeeklyPlayerPredictionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Enregistre ou met à jour les 2 Joueurs de la Semaine (Est & Ouest) pour la semaine spécifiée.
    Vérifie que la semaine n'a pas encore débuté (coup d'envoi du 1er match).
    """
    is_locked, deadline = get_week_lock_status(db, data.week_number)
    if is_locked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Les pronostics des Joueurs de la Semaine {data.week_number} sont verrouillés car les matchs ont débuté !"
        )

    east_clean = data.east_player.strip()
    west_clean = data.west_player.strip()

    pred = (
        db.query(WeeklyPlayerPrediction)
        .filter(
            WeeklyPlayerPrediction.user_id == current_user.id,
            WeeklyPlayerPrediction.week_number == data.week_number
        )
        .first()
    )

    if pred:
        pred.east_player = east_clean
        pred.west_player = west_clean
        pred.updated_at = datetime.now(timezone.utc)
    else:
        pred = WeeklyPlayerPrediction(
            user_id=current_user.id,
            week_number=data.week_number,
            east_player=east_clean,
            west_player=west_clean
        )
        db.add(pred)

    db.commit()
    db.refresh(pred)

    return WeeklyPlayerPredictionResponse(
        id=pred.id,
        user_id=pred.user_id,
        week_number=pred.week_number,
        east_player=pred.east_player,
        west_player=pred.west_player,
        is_locked=is_locked,
        deadline=deadline,
        updated_at=pred.updated_at
    )
