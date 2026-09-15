"""
Service de synchronisation des joueurs et effectifs NBA via API-Sports (API-Basketball).
Récupère les effectifs complets et à jour des 30 franchises NBA officielles,
les formate au format 'Prénom Nom (Équipe)' et les classe par Conférence Est et Ouest.
"""

import os
import json
import time
import httpx
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("API_SPORTS_KEY")
BASE_URL = "https://v1.basketball.api-sports.io"
DATA_FILE = Path(__file__).parent.parent / "data" / "nba_players_2026.json"

# Les 30 franchises NBA officielles avec leurs conférences et noms usuels
NBA_TEAMS_CONFIG = [
    # Conférence Est (15 équipes)
    {"id": 132, "name": "Atlanta Hawks", "short": "Hawks", "conf": "East"},
    {"id": 133, "name": "Boston Celtics", "short": "Celtics", "conf": "East"},
    {"id": 134, "name": "Brooklyn Nets", "short": "Nets", "conf": "East"},
    {"id": 135, "name": "Charlotte Hornets", "short": "Hornets", "conf": "East"},
    {"id": 136, "name": "Chicago Bulls", "short": "Bulls", "conf": "East"},
    {"id": 137, "name": "Cleveland Cavaliers", "short": "Cavaliers", "conf": "East"},
    {"id": 140, "name": "Detroit Pistons", "short": "Pistons", "conf": "East"},
    {"id": 143, "name": "Indiana Pacers", "short": "Pacers", "conf": "East"},
    {"id": 147, "name": "Miami Heat", "short": "Heat", "conf": "East"},
    {"id": 148, "name": "Milwaukee Bucks", "short": "Bucks", "conf": "East"},
    {"id": 151, "name": "New York Knicks", "short": "Knicks", "conf": "East"},
    {"id": 153, "name": "Orlando Magic", "short": "Magic", "conf": "East"},
    {"id": 154, "name": "Philadelphia 76ers", "short": "76ers", "conf": "East"},
    {"id": 159, "name": "Toronto Raptors", "short": "Raptors", "conf": "East"},
    {"id": 161, "name": "Washington Wizards", "short": "Wizards", "conf": "East"},

    # Conférence Ouest (15 équipes)
    {"id": 138, "name": "Dallas Mavericks", "short": "Mavericks", "conf": "West"},
    {"id": 139, "name": "Denver Nuggets", "short": "Nuggets", "conf": "West"},
    {"id": 141, "name": "Golden State Warriors", "short": "Warriors", "conf": "West"},
    {"id": 142, "name": "Houston Rockets", "short": "Rockets", "conf": "West"},
    {"id": 144, "name": "Los Angeles Clippers", "short": "Clippers", "conf": "West"},
    {"id": 145, "name": "Los Angeles Lakers", "short": "Lakers", "conf": "West"},
    {"id": 146, "name": "Memphis Grizzlies", "short": "Grizzlies", "conf": "West"},
    {"id": 149, "name": "Minnesota Timberwolves", "short": "Timberwolves", "conf": "West"},
    {"id": 150, "name": "New Orleans Pelicans", "short": "Pelicans", "conf": "West"},
    {"id": 152, "name": "Oklahoma City Thunder", "short": "Thunder", "conf": "West"},
    {"id": 155, "name": "Phoenix Suns", "short": "Suns", "conf": "West"},
    {"id": 156, "name": "Portland Trail Blazers", "short": "Trail Blazers", "conf": "West"},
    {"id": 157, "name": "Sacramento Kings", "short": "Kings", "conf": "West"},
    {"id": 158, "name": "San Antonio Spurs", "short": "Spurs", "conf": "West"},
    {"id": 160, "name": "Utah Jazz", "short": "Jazz", "conf": "West"},
]


def format_api_name(api_name: str) -> str:
    """Convertit le nom API 'Nom Prénom' en 'Prénom Nom' lisible."""
    parts = api_name.strip().split(" ")
    if len(parts) == 2:
        return f"{parts[1]} {parts[0]}"
    elif len(parts) == 3:
        if parts[1].lower() in ["jr.", "sr.", "ii", "iii", "iv"]:
            return f"{parts[2]} {parts[0]} {parts[1]}"
        else:
            return f"{parts[-1]} {' '.join(parts[:-1])}"
    elif len(parts) > 3:
        return f"{parts[-1]} {' '.join(parts[:-1])}"
    return api_name


def fetch_all_players_from_api(season: str = "2024-2025", force_all: bool = False) -> dict:
    """
    Interroge l'API-Sports pour récupérer les joueurs des 30 franchises officielles.
    Respecte le quota strict de 10 requêtes par minute (pause de 6.2s entre chaque appel)
    et réutilise les équipes déjà en cache pour économiser le quota journalier.
    """
    if not API_KEY or API_KEY == "votre_cle_api_sports_ici":
        raise ValueError("Clé API_SPORTS_KEY manquante.")

    headers = {"x-apisports-key": API_KEY}
    
    # Récupérer les données existantes en cache
    existing_cache = load_cached_rosters() or {}
    by_team = existing_cache.get("by_team", {}) if not force_all else {}

    with httpx.Client(timeout=15) as client:
        for team in NBA_TEAMS_CONFIG:
            team_id = team["id"]
            short_name = team["short"]

            # Si déjà en cache avec des joueurs, pas besoin de consommer une requête
            if not force_all and len(by_team.get(short_name, [])) > 0:
                print(f"-> [CACHE] Équipe {short_name} déjà en mémoire ({len(by_team[short_name])} joueurs).")
                continue

            print(f"-> [API CALL] Téléchargement effectif {short_name} (ID: {team_id})...")
            url = f"{BASE_URL}/players?team={team_id}&season={season}"
            
            try:
                res = client.get(url, headers=headers)
                if res.status_code == 429:
                    print("[API RATE LIMIT] Quota/minute atteint, pause de 60 secondes...")
                    time.sleep(60)
                    res = client.get(url, headers=headers)

                if res.status_code != 200:
                    print(f"[API WARN] Erreur team {short_name} ({res.status_code})")
                    continue

                data = res.json().get("response", [])
                team_player_names = []

                for p in data:
                    raw_name = p.get("name", "").strip()
                    if not raw_name or len(raw_name) < 3:
                        continue

                    formatted_name = format_api_name(raw_name)
                    full_display = f"{formatted_name} ({short_name})"
                    team_player_names.append(full_display)

                by_team[short_name] = team_player_names
                print(f"   -> OK : {len(team_player_names)} joueurs pour {short_name}")

                # Sauvegarde intermédiaire
                DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
                with open(DATA_FILE, "w", encoding="utf-8") as f:
                    json.dump({"by_team": by_team}, f, ensure_ascii=False, indent=2)

                # Pause de sécurité pour le rate limit de 10 req/min
                time.sleep(6.2)
            except Exception as e:
                print(f"[API ERROR] Erreur sur {short_name}: {e}")

    # Recompiler les listes Est et Ouest à partir des 30 équipes
    east_players = []
    west_players = []

    for team in NBA_TEAMS_CONFIG:
        short_name = team["short"]
        conf = team["conf"]
        players = by_team.get(short_name, [])
        if conf == "East":
            east_players.extend(players)
        else:
            west_players.extend(players)

    east_players = sorted(list(set(east_players)))
    west_players = sorted(list(set(west_players)))

    result = {
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "season": season,
        "east_count": len(east_players),
        "west_count": len(west_players),
        "east": east_players,
        "west": west_players,
        "by_team": by_team
    }

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"-> [SYNC TERMINÉ] {len(east_players)} joueurs Est et {len(west_players)} joueurs Ouest sauvegardés !")
    return result


def load_cached_rosters() -> dict:
    """Charge les effectifs depuis le fichier local mis en cache."""
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return None
