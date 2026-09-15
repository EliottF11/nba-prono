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
    # Boston Celtics
    "Jayson Tatum (Celtics)",
    "Jaylen Brown (Celtics)",
    "Derrick White (Celtics)",
    "Jrue Holiday (Celtics)",
    # Milwaukee Bucks
    "Giannis Antetokounmpo (Bucks)",
    "Damian Lillard (Bucks)",
    "Khris Middleton (Bucks)",
    # Philadelphia 76ers
    "Joel Embiid (76ers)",
    "Tyrese Maxey (76ers)",
    "Paul George (76ers)",
    # New York Knicks
    "Jalen Brunson (Knicks)",
    "Karl-Anthony Towns (Knicks)",
    "Mikal Bridges (Knicks)",
    "OG Anunoby (Knicks)",
    "Josh Hart (Knicks)",
    # Cleveland Cavaliers
    "Donovan Mitchell (Cavaliers)",
    "Darius Garland (Cavaliers)",
    "Evan Mobley (Cavaliers)",
    "Jarrett Allen (Cavaliers)",
    # Indiana Pacers
    "Tyrese Haliburton (Pacers)",
    "Pascal Siakam (Pacers)",
    "Myles Turner (Pacers)",
    # Orlando Magic
    "Paolo Banchero (Magic)",
    "Franz Wagner (Magic)",
    "Kentavious Caldwell-Pope (Magic)",
    "Jalen Suggs (Magic)",
    # Miami Heat
    "Bam Adebayo (Heat)",
    "Jimmy Butler (Heat)",
    "Tyler Herro (Heat)",
    # Atlanta Hawks
    "Trae Young (Hawks)",
    "Zaccharie Risacher (Hawks)",
    "Jalen Johnson (Hawks)",
    # Detroit Pistons
    "Cade Cunningham (Pistons)",
    "Jaden Ivey (Pistons)",
    "Tobias Harris (Pistons)",
    # Toronto Raptors
    "Scottie Barnes (Raptors)",
    "Immanuel Quickley (Raptors)",
    "RJ Barrett (Raptors)",
    # Charlotte Hornets
    "LaMelo Ball (Hornets)",
    "Brandon Miller (Hornets)",
    "Miles Bridges (Hornets)",
    # Brooklyn Nets
    "Cam Thomas (Nets)",
    "Nic Claxton (Nets)",
    # Chicago Bulls
    "Josh Giddey (Bulls)",
    "Coby White (Bulls)",
    "Zach LaVine (Bulls)",
    "Nikola Vucevic (Bulls)",
    # Washington Wizards
    "Alex Sarr (Wizards)",
    "Jordan Poole (Wizards)",
    "Kyle Kuzma (Wizards)",
    "Jonas Valanciunas (Wizards)"
]

WEST_PLAYERS = [
    # Denver Nuggets
    "Nikola Jokic (Nuggets)",
    "Jamal Murray (Nuggets)",
    "Russell Westbrook (Nuggets)",
    "Michael Porter Jr. (Nuggets)",
    "Aaron Gordon (Nuggets)",
    # Dallas Mavericks
    "Luka Doncic (Mavericks)",
    "Kyrie Irving (Mavericks)",
    "Klay Thompson (Mavericks)",
    "Dereck Lively II (Mavericks)",
    "P.J. Washington (Mavericks)",
    # Oklahoma City Thunder
    "Shai Gilgeous-Alexander (Thunder)",
    "Chet Holmgren (Thunder)",
    "Jalen Williams (Thunder)",
    "Alex Caruso (Thunder)",
    "Isaiah Hartenstein (Thunder)",
    # Minnesota Timberwolves
    "Anthony Edwards (Timberwolves)",
    "Julius Randle (Timberwolves)",
    "Rudy Gobert (Timberwolves)",
    "Donte DiVincenzo (Timberwolves)",
    "Naz Reid (Timberwolves)",
    # Golden State Warriors
    "Stephen Curry (Warriors)",
    "Draymond Green (Warriors)",
    "Jonathan Kuminga (Warriors)",
    "Buddy Hield (Warriors)",
    "Andrew Wiggins (Warriors)",
    # Los Angeles Lakers
    "LeBron James (Lakers)",
    "Anthony Davis (Lakers)",
    "Austin Reaves (Lakers)",
    "D'Angelo Russell (Lakers)",
    "Dalton Knecht (Lakers)",
    # Phoenix Suns
    "Kevin Durant (Suns)",
    "Devin Booker (Suns)",
    "Bradley Beal (Suns)",
    "Tyus Jones (Suns)",
    "Jusuf Nurkic (Suns)",
    # San Antonio Spurs
    "Victor Wembanyama (Spurs)",
    "Chris Paul (Spurs)",
    "Stephon Castle (Spurs)",
    "Devin Vassell (Spurs)",
    "Harrison Barnes (Spurs)",
    # Memphis Grizzlies
    "Ja Morant (Grizzlies)",
    "Desmond Bane (Grizzlies)",
    "Jaren Jackson Jr. (Grizzlies)",
    "Zach Edey (Grizzlies)",
    "Marcus Smart (Grizzlies)",
    # Sacramento Kings
    "De'Aaron Fox (Kings)",
    "Domantas Sabonis (Kings)",
    "DeMar DeRozan (Kings)",
    "Keegan Murray (Kings)",
    "Malik Monk (Kings)",
    # New Orleans Pelicans
    "Zion Williamson (Pelicans)",
    "Dejounte Murray (Pelicans)",
    "CJ McCollum (Pelicans)",
    "Brandon Ingram (Pelicans)",
    "Herb Jones (Pelicans)",
    # Los Angeles Clippers
    "James Harden (Clippers)",
    "Kawhi Leonard (Clippers)",
    "Norman Powell (Clippers)",
    "Ivica Zubac (Clippers)",
    # Houston Rockets
    "Alperen Sengun (Rockets)",
    "Jalen Green (Rockets)",
    "Fred VanVleet (Rockets)",
    "Amen Thompson (Rockets)",
    "Reed Sheppard (Rockets)",
    "Jabari Smith Jr. (Rockets)",
    # Utah Jazz
    "Lauri Markkanen (Jazz)",
    "Collin Sexton (Jazz)",
    "Keyonte George (Jazz)",
    "Walker Kessler (Jazz)",
    # Portland Trail Blazers
    "Deni Avdija (Trail Blazers)",
    "Jerami Grant (Trail Blazers)",
    "Anfernee Simons (Trail Blazers)",
    "Scoot Henderson (Trail Blazers)",
    "Donovan Clingan (Trail Blazers)"
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
    Charge en priorité l'ensemble des effectifs synchronisés depuis l'API officielle API-Sports.
    """
    try:
        from services.sync_players_service import load_cached_rosters
        cached = load_cached_rosters()
        if cached and cached.get("east") and cached.get("west"):
            return {
                "east": cached["east"],
                "west": cached["west"],
                "total_players": len(cached["east"]) + len(cached["west"]),
                "source": "api-sports"
            }
    except Exception as e:
        print(f"[WARN] Impossible de charger les rosters synchronisés: {e}")

    return {
        "east": EAST_PLAYERS,
        "west": WEST_PLAYERS,
        "total_players": len(EAST_PLAYERS) + len(WEST_PLAYERS),
        "source": "static"
    }


@router.post("/sync-api")
def sync_players_api(current_user: User = Depends(get_current_user)):
    """
    Déclenche la synchronisation complète des effectifs depuis l'API-Sports.
    """
    from services.sync_players_service import fetch_all_players_from_api
    result = fetch_all_players_from_api()
    return {
        "status": "ok",
        "message": "Synchronisation API terminée avec succès.",
        "east_count": result["east_count"],
        "west_count": result["west_count"],
        "updated_at": result["updated_at"]
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
