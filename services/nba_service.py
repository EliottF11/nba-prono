"""
Service de synchronisation avec l'API officielle API-Sports (API-Basketball).
Gère la récupération des scores en direct et des matchs,
la clôture automatique des matchs terminés et le calcul des points des pronostics.
"""
import os
import httpx
from datetime import datetime, timezone
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from models import Match, Team, Prediction, User

load_dotenv()

API_KEY = os.getenv("API_SPORTS_KEY")
BASE_URL = "https://v1.basketball.api-sports.io"
NBA_LEAGUE_ID = 12

def get_headers():
    if not API_KEY or API_KEY == "votre_cle_api_sports_ici":
        raise ValueError("Clé API_SPORTS_KEY manquante ou non configurée dans le fichier .env")
    return {
        "x-apisports-key": API_KEY
    }

def check_api_status() -> dict:
    """Vérifie l'état du compte API-Sports et le quota restant (sur les 100 requêtes/jour)."""
    headers = get_headers()
    with httpx.Client(timeout=10) as client:
        res = client.get(f"{BASE_URL}/status", headers=headers)
        res.raise_for_status()
        data = res.json()
        response = data.get("response", {})
        account = response.get("account", {})
        requests = response.get("requests", {})
        return {
            "account": f"{account.get('firstname', '')} {account.get('lastname', '')}".strip(),
            "email": account.get("email"),
            "plan": response.get("subscription", {}).get("plan", "Free"),
            "requests_used": requests.get("current", 0),
            "requests_limit": requests.get("limit_day", 100),
            "requests_remaining": requests.get("limit_day", 100) - requests.get("current", 0)
        }

def match_team_id(db: Session, api_team_name: str) -> int | None:
    """Retrouve l'ID d'équipe locale correspondant au nom complet renvoyé par l'API."""
    teams = db.query(Team).all()
    api_lower = api_team_name.lower()
    
    # Cas spécifiques Los Angeles
    if "clippers" in api_lower:
        lac = db.query(Team).filter(Team.code == "LAC").first()
        return lac.id if lac else None
    if "lakers" in api_lower:
        lal = db.query(Team).filter(Team.code == "LAL").first()
        return lal.id if lal else None

    # Correspondance par nom de ville ou trigramme
    for t in teams:
        if t.city.lower() in api_lower or t.code.lower() in api_lower:
            return t.id
            
    return None

def sync_scores_for_date(db: Session, date_str: str) -> dict:
    """
    Interroge l'API pour une date donnée (YYYY-MM-DD),
    met à jour les scores des matchs et calcule les gains des pronostics terminés.
    """
    headers = get_headers()
    url = f"{BASE_URL}/games?league={NBA_LEAGUE_ID}&date={date_str}"

    with httpx.Client(timeout=15) as client:
        res = client.get(url, headers=headers)
        res.raise_for_status()
        data = res.json()

    api_games = data.get("response", [])
    updated_matches_count = 0
    resolved_count = 0

    for g in api_games:
        home_api_name = g.get("teams", {}).get("home", {}).get("name", "")
        away_api_name = g.get("teams", {}).get("away", {}).get("name", "")

        home_id = match_team_id(db, home_api_name)
        away_id = match_team_id(db, away_api_name)

        if not home_id or not away_id:
            continue

        # Recherche du match local
        match = db.query(Match).filter(
            Match.home_team_id == home_id,
            Match.away_team_id == away_id
        ).first()

        if not match:
            continue

        # Extraction des scores
        scores = g.get("scores", {})
        home_score = scores.get("home", {}).get("total")
        away_score = scores.get("away", {}).get("total")
        status_short = g.get("status", {}).get("short")

        if home_score is not None and away_score is not None:
            match.home_score = home_score
            match.away_score = away_score
            updated_matches_count += 1

            # Match terminé (FT = Full Time, AOT = After Overtime)
            if status_short in ["FT", "AOT"] and match.status != "finished":
                winner_id = home_id if home_score > away_score else away_id
                match.status = "finished"
                match.winner_team_id = winner_id
                resolved_count += 1

                # Calcul des points pour chaque pronostic
                winning_odds = match.home_odds if winner_id == home_id else match.away_odds
                predictions = db.query(Prediction).filter(Prediction.match_id == match.id).all()
                affected_users = set()

                for pred in predictions:
                    if pred.selected_team_id == winner_id:
                        pred.points_won = round(winning_odds, 2)
                    else:
                        pred.points_won = 0.0
                    affected_users.add(pred.user_id)

                db.flush()

                # Recalcul des points totaux des joueurs
                for uid in affected_users:
                    user = db.query(User).filter(User.id == uid).first()
                    if user:
                        user.total_points = round(sum(p.points_won for p in user.predictions), 2)

    db.commit()

    return {
        "date": date_str,
        "api_games_found": len(api_games),
        "matches_updated": updated_matches_count,
        "matches_resolved": resolved_count
    }
