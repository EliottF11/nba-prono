"""
Service ESPN NBA Scoreboard en direct (Temps Réel Illimité & Gratuit) :
- Interroge l'API publique ouverte d'ESPN sans clé ni quota journalier
- Détecte les matchs en direct (state == 'in'), met à jour les scores minute par minute
- Stocke le quart-temps et chrono (ex: '4:32 - 3rd', 'Mi-temps')
- Clôture automatiquement les matchs terminés (state == 'post') et calcule les gains
"""
import time
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from sqlalchemy.orm import Session
from models import Match, Team, Prediction, User

ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"

# Mapping pour normaliser les abréviations d'ESPN vers les codes de nos 30 équipes NBA
ESPN_TEAM_MAP = {
    "GS": "GSW",
    "NO": "NOP",
    "NY": "NYK",
    "SA": "SAS",
    "UTAH": "UTA",
    "WSH": "WAS",
}

def normalize_espn_code(code: str) -> str:
    """Normalise l'acronyme d'ESPN vers le code officiel NBA standard."""
    c = (code or "").upper().strip()
    return ESPN_TEAM_MAP.get(c, c)


_last_espn_sync_timestamp = 0

def sync_espn_live_scores(db: Session, target_date_str: Optional[str] = None) -> Dict[str, Any]:
    """
    Récupère le scoreboard ESPN en direct pour la date demandée (ou la date actuelle),
    met à jour les statuts 'live' et 'finished' et synchronise les scores instantanément.
    """
    url = ESPN_SCOREBOARD_URL
    if target_date_str:
        # Format attendu par ESPN : YYYYMMDD
        cleaned_date = target_date_str.replace("-", "").strip()
        url = f"{ESPN_SCOREBOARD_URL}?dates={cleaned_date}"

    try:
        with httpx.Client(timeout=8) as client:
            res = client.get(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            if res.status_code != 200:
                return {"status": "error", "code": res.status_code, "message": "ESPN indisponible"}
            data = res.json()
    except Exception as e:
        return {"status": "error", "message": f"Erreur de connexion ESPN: {str(e)}"}

    events = data.get("events", [])
    if not events:
        return {"status": "ok", "events_found": 0, "live_matches": 0, "resolved_matches": 0}

    # Pré-chargement des équipes pour lookup rapide
    teams_by_code = {t.code: t for t in db.query(Team).all()}

    live_count = 0
    resolved_count = 0
    affected_users = set()
    updates_summary = []

    for event in events:
        status_info = event.get("status", {})
        status_type = status_info.get("type", {})
        state = status_type.get("state")  # 'pre', 'in', 'post'
        completed = status_type.get("completed", False)
        short_detail = status_type.get("shortDetail") or status_type.get("detail", "")

        competitions = event.get("competitions", [])
        if not competitions:
            continue

        competitors = competitions[0].get("competitors", [])
        home_comp = next((c for c in competitors if c.get("homeAway") == "home"), None)
        away_comp = next((c for c in competitors if c.get("homeAway") == "away"), None)

        if not home_comp or not away_comp:
            continue

        home_code = normalize_espn_code(home_comp.get("team", {}).get("abbreviation", ""))
        away_code = normalize_espn_code(away_comp.get("team", {}).get("abbreviation", ""))

        home_team = teams_by_code.get(home_code)
        away_team = teams_by_code.get(away_code)

        if not home_team or not away_team:
            continue

        # Extraction des scores numériques
        raw_home_score = home_comp.get("score")
        raw_away_score = away_comp.get("score")
        home_score = int(raw_home_score) if (raw_home_score is not None and str(raw_home_score).isdigit()) else None
        away_score = int(raw_away_score) if (raw_away_score is not None and str(raw_away_score).isdigit()) else None

        # Recherche du match correspondant dans notre base de données
        # On priorise les matchs qui sont 'upcoming' ou 'live'
        match = (
            db.query(Match)
            .filter(
                Match.home_team_id == home_team.id,
                Match.away_team_id == away_team.id,
                Match.status.in_(["upcoming", "live"])
            )
            .order_by(Match.deadline.asc())
            .first()
        )

        # Si pas trouvé en cours ou à venir, chercher si c'est un match déjà fini qu'on veut rafraîchir
        if not match and state == "post":
            match = (
                db.query(Match)
                .filter(
                    Match.home_team_id == home_team.id,
                    Match.away_team_id == away_team.id,
                    Match.status == "finished"
                )
                .order_by(Match.deadline.desc())
                .first()
            )

        if not match:
            continue

        # 1. CAS MATCH EN DIRECT (state == 'in')
        if state == "in":
            match.status = "live"
            if home_score is not None and away_score is not None:
                match.home_score = home_score
                match.away_score = away_score
            
            # Formatage du chrono pour affichage propre (ex: 'Q3 04:12' ou 'Mi-temps')
            clock_text = short_detail
            if "halftime" in clock_text.lower():
                clock_text = "Mi-temps"
            match.live_clock = clock_text
            live_count += 1
            updates_summary.append({
                "id": match.id,
                "status": "live",
                "score": f"{away_code} {away_score} - {home_score} {home_code}",
                "clock": clock_text
            })

        # 2. CAS MATCH TERMINÉ (state == 'post' ou completed)
        elif state == "post" or completed:
            was_finished = (match.status == "finished")
            match.status = "finished"
            if home_score is not None and away_score is not None:
                match.home_score = home_score
                match.away_score = away_score
            match.live_clock = "Final"

            if home_score is not None and away_score is not None:
                winner_id = home_team.id if home_score > away_score else away_team.id
                match.winner_team_id = winner_id

                # Si le match n'était pas encore clôturé, on calcule et distribue les points
                if not was_finished:
                    winning_odds = match.home_odds if winner_id == match.home_team_id else match.away_odds
                    predictions = db.query(Prediction).filter(Prediction.match_id == match.id).all()
                    for pred in predictions:
                        if pred.selected_team_id == winner_id:
                            mult = 2.0 if pred.is_boosted else 1.0
                            pred.points_won = round((winning_odds * 10) * mult, 2)
                        else:
                            pred.points_won = 0.0
                        affected_users.add(pred.user_id)
                    resolved_count += 1
                    updates_summary.append({
                        "id": match.id,
                        "status": "finished",
                        "score": f"{away_code} {away_score} - {home_score} {home_code}",
                        "winner": home_code if winner_id == home_team.id else away_code
                    })

    if affected_users:
        db.flush()
        for uid in affected_users:
            u = db.query(User).filter(User.id == uid).first()
            if u:
                u.total_points = round(sum(p.points_won for p in u.predictions), 2)

    db.commit()

    return {
        "status": "ok",
        "events_checked": len(events),
        "live_count": live_count,
        "resolved_count": resolved_count,
        "updates": updates_summary
    }


def sync_espn_if_needed(db: Session, cooldown_seconds: int = 20) -> Dict[str, Any]:
    """Interroge ESPN avec un cooldown léger pour rafraîchir le direct sans spammer."""
    global _last_espn_sync_timestamp
    now = time.time()
    if now - _last_espn_sync_timestamp < cooldown_seconds:
        return {"status": "skipped", "reason": "cooldown_active"}

    _last_espn_sync_timestamp = now
    
    # On synchronise le live du jour
    res_today = sync_espn_live_scores(db)
    
    # Si on est le matin en France, les matchs NBA d'hier soir aux USA peuvent avoir la date de la veille en format EDT/EST
    # On synchronise aussi la date du jour au format YYYYMMDD
    now_utc = datetime.now(timezone.utc)
    date_str_today = now_utc.strftime("%Y%m%d")
    date_str_yesterday = (now_utc - timedelta(days=1)).strftime("%Y%m%d")
    
    sync_espn_live_scores(db, target_date_str=date_str_today)
    sync_espn_live_scores(db, target_date_str=date_str_yesterday)

    return res_today
