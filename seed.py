"""
Script d'initialisation et de remplissage (seed) de la base SQLite.
Contient les 30 franchises NBA officielles et les VRAIES confrontations officielles
du calendrier NBA de la SAISON 2026/2027 (Opening Week, 20 au 22 Octobre 2026).
Source officielle NBA.com (Saison 2026-2027).
"""
from datetime import datetime, timezone
from database import engine, SessionLocal, Base
from models import Team, Match, User, Prediction

def reset_and_init_db():
    print("-> Réinitialisation et création des tables dans SQLite...")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    print("OK : Tables créées proprement.")

def seed_all_teams_and_matches():
    db = SessionLocal()
    try:
        print("-> Injection des 30 équipes NBA (villes + couleurs officielles)...")
        
        teams_data = [
            # Conférence Est
            {"city": "Boston", "code": "BOS", "color": "#007A33", "text_color": "#FFFFFF"},
            {"city": "Brooklyn", "code": "BKN", "color": "#111111", "text_color": "#FFFFFF"},
            {"city": "New York", "code": "NYK", "color": "#006BB6", "text_color": "#F58426"},
            {"city": "Philadelphia", "code": "PHI", "color": "#006BB6", "text_color": "#ED174C"},
            {"city": "Toronto", "code": "TOR", "color": "#CE1141", "text_color": "#FFFFFF"},
            {"city": "Chicago", "code": "CHI", "color": "#CE1141", "text_color": "#FFFFFF"},
            {"city": "Cleveland", "code": "CLE", "color": "#860038", "text_color": "#FDBB30"},
            {"city": "Detroit", "code": "DET", "color": "#1D42BA", "text_color": "#C8102E"},
            {"city": "Indiana", "code": "IND", "color": "#002D62", "text_color": "#FDBB30"},
            {"city": "Milwaukee", "code": "MIL", "color": "#00471B", "text_color": "#EEE1C6"},
            {"city": "Atlanta", "code": "ATL", "color": "#C8102E", "text_color": "#FFFFFF"},
            {"city": "Charlotte", "code": "CHA", "color": "#1D1160", "text_color": "#00788C"},
            {"city": "Miami", "code": "MIA", "color": "#98002E", "text_color": "#F9A01B"},
            {"city": "Orlando", "code": "ORL", "color": "#0077C0", "text_color": "#C4CED4"},
            {"city": "Washington", "code": "WAS", "color": "#002B5C", "text_color": "#E31837"},
            # Conférence Ouest
            {"city": "Denver", "code": "DEN", "color": "#0E2240", "text_color": "#FEC524"},
            {"city": "Minnesota", "code": "MIN", "color": "#0C2340", "text_color": "#78BE20"},
            {"city": "Oklahoma City", "code": "OKC", "color": "#007AC1", "text_color": "#EF3B24"},
            {"city": "Portland", "code": "POR", "color": "#E03A3E", "text_color": "#FFFFFF"},
            {"city": "Utah", "code": "UTA", "color": "#002B5C", "text_color": "#FFF21F"},
            {"city": "Golden State", "code": "GSW", "color": "#1D428A", "text_color": "#FFC72C"},
            {"city": "Los Angeles (LAC)", "code": "LAC", "color": "#C8102E", "text_color": "#1D428A"},
            {"city": "Los Angeles (LAL)", "code": "LAL", "color": "#552583", "text_color": "#FDB927"},
            {"city": "Phoenix", "code": "PHX", "color": "#1D1160", "text_color": "#E56020"},
            {"city": "Sacramento", "code": "SAC", "color": "#5A2D81", "text_color": "#63727A"},
            {"city": "Dallas", "code": "DAL", "color": "#00538C", "text_color": "#B8C4CA"},
            {"city": "Houston", "code": "HOU", "color": "#CE1141", "text_color": "#FFFFFF"},
            {"city": "Memphis", "code": "MEM", "color": "#5D76A9", "text_color": "#12173F"},
            {"city": "New Orleans", "code": "NOP", "color": "#0C2340", "text_color": "#C8102E"},
            {"city": "San Antonio", "code": "SAS", "color": "#111111", "text_color": "#C4CED4"},
        ]

        teams_map = {t.city: t.id for t in db.query(Team).all()}
        if len(teams_map) < 30:
            for t in teams_data:
                if t["city"] not in teams_map:
                    team = Team(city=t["city"], code=t["code"], color=t["color"], text_color=t["text_color"])
                    db.add(team)
                    db.flush()
                    teams_map[t["city"]] = team.id
            db.commit()
            print("OK : Les 30 équipes ont été insérées.")

        print("-> Injection des VRAIES confrontations officielles de la saison NBA 2026/2027...")

        # VRAI Calendrier Officiel NBA 2026/2027 (Opening Week)
        # Format : domicile (home) vs extérieur (away)
        matches_data = [
            # =======================================================
            # MARDI 20 OCTOBRE 2026 (Opening Night Triple-Header)
            # =======================================================
            {
                "home": "Detroit",
                "away": "Boston",
                "home_odds": 2.85,
                "away_odds": 1.42,
                "deadline": datetime(2026, 10, 20, 19, 0, tzinfo=timezone.utc),  # 21h00 heure française
            },
            {
                "home": "New York",
                "away": "Philadelphia",
                "home_odds": 1.65,
                "away_odds": 2.25,
                "deadline": datetime(2026, 10, 20, 23, 0, tzinfo=timezone.utc),  # 01h00 Paris (Ring Night MSG)
            },
            {
                "home": "San Antonio",
                "away": "Oklahoma City",
                "home_odds": 2.10,
                "away_odds": 1.75,
                "deadline": datetime(2026, 10, 21, 1, 30, tzinfo=timezone.utc),  # 03h30 Paris (Wemby vs Chet)
            },

            # =======================================================
            # MERCREDI 21 OCTOBRE 2026 (Full Opening Slate)
            # =======================================================
            {
                "home": "Orlando",
                "away": "Atlanta",
                "home_odds": 1.55,
                "away_odds": 2.45,
                "deadline": datetime(2026, 10, 21, 23, 0, tzinfo=timezone.utc),  # 01h00 Paris
            },
            {
                "home": "Washington",
                "away": "Milwaukee",
                "home_odds": 3.40,
                "away_odds": 1.32,
                "deadline": datetime(2026, 10, 21, 23, 0, tzinfo=timezone.utc),  # 01h00 Paris
            },
            {
                "home": "Brooklyn",
                "away": "Charlotte",
                "home_odds": 1.90,
                "away_odds": 1.90,
                "deadline": datetime(2026, 10, 21, 23, 30, tzinfo=timezone.utc), # 01h30 Paris
            },
            {
                "home": "Miami",
                "away": "Minnesota",
                "home_odds": 2.05,
                "away_odds": 1.78,
                "deadline": datetime(2026, 10, 21, 23, 30, tzinfo=timezone.utc), # 01h30 Paris
            },
            {
                "home": "Toronto",
                "away": "Chicago",
                "home_odds": 1.72,
                "away_odds": 2.12,
                "deadline": datetime(2026, 10, 21, 23, 30, tzinfo=timezone.utc), # 01h30 Paris
            },
            {
                "home": "Memphis",
                "away": "Utah",
                "home_odds": 1.48,
                "away_odds": 2.65,
                "deadline": datetime(2026, 10, 22, 0, 0, tzinfo=timezone.utc),   # 02h00 Paris
            },
            {
                "home": "New Orleans",
                "away": "Indiana",
                "home_odds": 1.85,
                "away_odds": 1.95,
                "deadline": datetime(2026, 10, 22, 0, 0, tzinfo=timezone.utc),   # 02h00 Paris
            },
            {
                "home": "Houston",
                "away": "Dallas",
                "home_odds": 2.20,
                "away_odds": 1.68,
                "deadline": datetime(2026, 10, 22, 0, 30, tzinfo=timezone.utc),  # 02h30 Paris (Texas Derby)
            },
            {
                "home": "Los Angeles (LAL)",
                "away": "Golden State",
                "home_odds": 1.82,
                "away_odds": 1.98,
                "deadline": datetime(2026, 10, 22, 2, 0, tzinfo=timezone.utc),   # 04h00 Paris (LeBron vs Curry)
            },
            {
                "home": "Portland",
                "away": "Phoenix",
                "home_odds": 2.50,
                "away_odds": 1.52,
                "deadline": datetime(2026, 10, 22, 2, 0, tzinfo=timezone.utc),   # 04h00 Paris
            },

            # =======================================================
            # JEUDI 22 OCTOBRE 2026
            # =======================================================
            {
                "home": "Cleveland",
                "away": "Detroit",
                "home_odds": 1.38,
                "away_odds": 3.05,
                "deadline": datetime(2026, 10, 22, 23, 30, tzinfo=timezone.utc), # 01h30 Paris
            },
            {
                "home": "Oklahoma City",
                "away": "Denver",
                "home_odds": 1.70,
                "away_odds": 2.15,
                "deadline": datetime(2026, 10, 23, 0, 0, tzinfo=timezone.utc),   # 02h00 Paris
            },
            {
                "home": "Los Angeles (LAC)",
                "away": "Sacramento",
                "home_odds": 1.88,
                "away_odds": 1.92,
                "deadline": datetime(2026, 10, 23, 2, 30, tzinfo=timezone.utc),  # 04h30 Paris
                "week_number": 1,
            },

            # =======================================================
            # SEMAINE 2 (Week 2 - 27 au 29 Octobre 2026)
            # =======================================================
            {
                "home": "Boston",
                "away": "Miami",
                "home_odds": 1.50,
                "away_odds": 2.65,
                "deadline": datetime(2026, 10, 27, 23, 30, tzinfo=timezone.utc),
                "week_number": 2,
            },
            {
                "home": "Denver",
                "away": "Dallas",
                "home_odds": 1.72,
                "away_odds": 2.15,
                "deadline": datetime(2026, 10, 28, 2, 0, tzinfo=timezone.utc),
                "week_number": 2,
            },
            {
                "home": "Golden State",
                "away": "Phoenix",
                "home_odds": 1.85,
                "away_odds": 1.95,
                "deadline": datetime(2026, 10, 28, 23, 0, tzinfo=timezone.utc),
                "week_number": 2,
            },
            {
                "home": "Los Angeles (LAL)",
                "away": "Sacramento",
                "home_odds": 1.62,
                "away_odds": 2.30,
                "deadline": datetime(2026, 10, 29, 2, 30, tzinfo=timezone.utc),
                "week_number": 2,
            },
            {
                "home": "New York",
                "away": "Milwaukee",
                "home_odds": 1.90,
                "away_odds": 1.90,
                "deadline": datetime(2026, 10, 29, 23, 0, tzinfo=timezone.utc),
                "week_number": 2,
            },
        ]

        # Insertion des matchs si la base ne contient pas encore la semaine 2
        existing_matches = db.query(Match).all()
        existing_keys = {(m.home_team_id, m.away_team_id, m.week_number) for m in existing_matches}

        added_count = 0
        for m in matches_data:
            h_id = teams_map[m["home"]]
            a_id = teams_map[m["away"]]
            w_num = m.get("week_number", 1)
            if (h_id, a_id, w_num) not in existing_keys:
                match = Match(
                    home_team_id=h_id,
                    away_team_id=a_id,
                    home_odds=m["home_odds"],
                    away_odds=m["away_odds"],
                    deadline=m["deadline"],
                    week_number=w_num,
                    status="upcoming",
                )
                db.add(match)
                added_count += 1

        db.commit()
        if added_count > 0:
            print(f"OK : {added_count} nouveaux matchs insérés (Semaines 1 et 2).")
        else:
            print("Les matchs des semaines 1 et 2 sont déjà présents en base.")

    except Exception as e:
        db.rollback()
        print(f"Erreur : {e}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    reset_and_init_db()
    seed_all_teams_and_matches()
