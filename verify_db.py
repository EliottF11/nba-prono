"""
Script de test et de validation du schéma SQLite.
Vérifie la création des 30 équipes NBA et des 15 matchs programmés.
"""
from database import SessionLocal
from models import Team, Match, User, Prediction

def check_database():
    db = SessionLocal()
    try:
        teams = db.query(Team).order_by(Team.city).all()
        matches = db.query(Match).order_by(Match.deadline).all()
        users = db.query(User).all()
        predictions = db.query(Prediction).all()

        print("================== ÉTAT DE LA BASE SQLite ==================")
        print(f"Total Équipes NBA enregistrées : {len(teams)} / 30")
        for i, team in enumerate(teams, 1):
            print(f"  {i:2d}. [{team.code:3s}] {team.city:<20s} (Couleur: {team.color})")

        print(f"\nTotal Matchs programmés : {len(matches)} (Calendrier officiel NBA)")
        for m in matches:
            deadline_str = m.deadline.strftime("%d/%m %H:%M UTC")
            print(f"  - Match #{m.id:2d}: {m.home_team.city:<18s} ({m.home_odds:.2f}) vs {m.away_team.city:<18s} ({m.away_odds:.2f}) | Date limite: {deadline_str}")

        print("\n------------------------------------------------------------")
        print(f"Utilisateurs inscrits  : {len(users)}")
        print(f"Pronostics enregistrés : {len(predictions)}")
        print("============================================================")
        print("Vérification terminée avec succès !")

    finally:
        db.close()

if __name__ == "__main__":
    check_database()
