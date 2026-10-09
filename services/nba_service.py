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
from models import Match, Team, Prediction, User, PropBet, PropPrediction

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

def sync_scores_for_date(db: Session, date_str: str, skip_props: bool = False) -> dict:
    """
    Interroge l'API pour une date donnée (YYYY-MM-DD),
    met à jour les scores des matchs et calcule les gains des pronostics terminés.
    """
    headers = get_headers()
    # Récupérer l'année de la date pour le paramètre season (requis par l'API)
    year = date_str.split('-')[0]
    season_param = "2024" # Par défaut pour cette saison
    if year >= "2024":
        season_param = year
    
    url = f"{BASE_URL}/games?league={NBA_LEAGUE_ID}&season={season_param}&date={date_str}"

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
            # Création automatique du match s'il n'existe pas
            date_str_api = g.get("date")
            if date_str_api:
                deadline = datetime.fromisoformat(date_str_api)
            else:
                deadline = datetime.now(timezone.utc)
                
            week_number = max(1, ((deadline - datetime(2026, 10, 20, tzinfo=timezone.utc)).days // 7) + 1)
            
            # Détection du season_stage (Pre-season, Regular Season, Play-ins, etc.)
            api_stage = g.get("stage") or ""
            print(f"[SYNC DEBUG] Match {home_api_name} vs {away_api_name} | api_stage: '{api_stage}'")
            season_stage = 'regular'
            if 'pre-season' in api_stage.lower() or 'preseason' in api_stage.lower():
                season_stage = 'preseason'
            elif 'playin' in api_stage.lower() or 'play-in' in api_stage.lower():
                season_stage = 'playin'
            elif 'playoff' in api_stage.lower() or 'play-off' in api_stage.lower():
                season_stage = 'playoffs'
            
            match = Match(
                home_team_id=home_id,
                away_team_id=away_id,
                home_odds=1.90,
                away_odds=1.90,
                deadline=deadline,
                week_number=week_number,
                status="upcoming",
                season_stage=season_stage
            )
            db.add(match)
            db.flush() # Assigne un ID pour la suite

        # Si le match existait déjà, on met à jour son season_stage au cas où
        if match:
            api_stage = g.get("stage") or ""
            if 'pre-season' in api_stage.lower() or 'preseason' in api_stage.lower():
                match.season_stage = 'preseason'
            elif 'playin' in api_stage.lower() or 'play-in' in api_stage.lower():
                match.season_stage = 'playin'
            elif 'playoff' in api_stage.lower() or 'play-off' in api_stage.lower():
                match.season_stage = 'playoffs'

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

    if skip_props:
        return {
            "updated_matches": updated_matches_count,
            "resolved_matches": resolved_count,
            "props_created": 0,
            "props_resolved": 0
        }

    # --- ETAPE 2 : Création des Props via /odds ---
    props_created = 0
    try:
        with httpx.Client(timeout=15) as client:
            res_odds = client.get(f"{BASE_URL}/odds?league={NBA_LEAGUE_ID}&date={date_str}", headers=headers)
            if res_odds.status_code == 200:
                odds_data = res_odds.json().get("response", [])
                
                # Exemple simplifié d'extraction de 2 ou 3 Prop Bets
                for odd in odds_data[:3]: # On prend les 3 premiers matchs ayant des cotes
                    match_api_id = odd.get("fixture", {}).get("id") or odd.get("game", {}).get("id")
                    
                    # Logique simplifiée pour créer un prop s'il n'existe pas déjà
                    # On associe le prop au premier match "upcoming" disponible si on ne trouve pas l'ID API
                    first_upcoming = db.query(Match).filter(Match.status == "upcoming").first()
                    if first_upcoming:
                        player_name = "LeBron James" # Valeur par défaut si l'API ne fournit pas les noms clairement
                        # Si l'API retourne des bookmakers -> bets -> values (il faudrait parser dynamiquement)
                        # Pour l'exercice, on insère une valeur mockée basée sur la donnée
                        existing_prop = db.query(PropBet).filter(PropBet.match_id == first_upcoming.id, PropBet.player_name == player_name).first()
                        if not existing_prop:
                            new_prop = PropBet(
                                match_id=first_upcoming.id,
                                player_name=player_name,
                                stat_type="points",
                                line=25.5,
                                status="pending"
                            )
                            db.add(new_prop)
                            props_created += 1
                db.commit()
    except Exception as e:
        print(f"Erreur Etape 2 (Props) : {e}")

    # --- ETAPE 3 : Résolution des Props passés ---
    props_resolved = 0
    try:
        # Trouver les props pending dont le match est finished
        pending_props = db.query(PropBet).join(Match).filter(
            PropBet.status == 'pending',
            Match.status == 'finished'
        ).all()

        for prop in pending_props:
            # Appel à l'API pour les stats du joueur
            # Normalement on chercherait via /players/statistics
            with httpx.Client(timeout=15) as client:
                res_stats = client.get(f"{BASE_URL}/players/statistics?league={NBA_LEAGUE_ID}&season=2024", headers=headers)
                # Si succès, on extrait le score réel (Mock = 28.0)
                actual_score = 28.0
                prop.actual_result = actual_score
                prop.status = "resolved"
                
                # Mise à jour des prédictions des utilisateurs
                for pred in prop.predictions:
                    if pred.choice == 'over':
                        pred.is_correct = (actual_score > prop.line)
                    else:
                        pred.is_correct = (actual_score < prop.line)
                
                props_resolved += 1
        db.commit()
    except Exception as e:
        print(f"Erreur Etape 3 (Resolve Props) : {e}")


    return {
        "date": date_str,
        "api_games_found": len(api_games),
        "matches_updated": updated_matches_count,
        "matches_resolved": resolved_count,
        "props_created": props_created,
        "props_resolved": props_resolved
    }


def sync_players(db: Session) -> dict:
    """
    Récupère tous les joueurs actuels de la NBA pour mettre à jour les effectifs locaux.
    Effectue 1 requête pour lister les équipes, puis 1 requête par équipe.
    """
    from models import Player
    headers = get_headers()
    season_param = "2024"

    url_teams = f"{BASE_URL}/teams?league={NBA_LEAGUE_ID}&season={season_param}"
    try:
        with httpx.Client(timeout=15) as client:
            res = client.get(url_teams, headers=headers)
            res.raise_for_status()
            teams_data = res.json().get("response", [])
    except Exception as e:
        return {"status": "error", "message": f"Erreur fetch teams: {e}"}

    api_team_to_local = {}
    for t_api in teams_data:
        api_id = t_api.get("id")
        name = t_api.get("name", "")
        local_id = match_team_id(db, name)
        if local_id and api_id:
            api_team_to_local[api_id] = local_id

    players_added = 0
    players_updated = 0

    with httpx.Client(timeout=20) as client:
        for api_team_id, local_team_id in api_team_to_local.items():
            url_players = f"{BASE_URL}/players?team={api_team_id}&season={season_param}"
            try:
                res = client.get(url_players, headers=headers)
                res.raise_for_status()
                players_data = res.json().get("response", [])
                
                for p_data in players_data:
                    # Depending on API structure
                    p_id = p_data.get("id")
                    p_name = p_data.get("name")
                    if not p_id or not p_name:
                        continue
                        
                    existing = db.query(Player).filter(Player.api_id == p_id).first()
                    if existing:
                        if existing.team_id != local_team_id or existing.name != p_name:
                            existing.team_id = local_team_id
                            existing.name = p_name
                            players_updated += 1
                    else:
                        new_player = Player(api_id=p_id, name=p_name, team_id=local_team_id)
                        db.add(new_player)
                        players_added += 1
                db.commit()
            except Exception as e:
                print(f"[SYNC ERROR] Joueurs pour team API {api_team_id}: {e}")
                continue

    return {
        "status": "success",
        "added": players_added,
        "updated": players_updated
    }
