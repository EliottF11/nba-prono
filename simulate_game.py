"""
Script interactif ou automatique pour simuler la clôture d'un match NBA et voir le classement s'actualiser en direct.
Usage: python simulate_game.py
"""
import sys
import random
from database import SessionLocal
from models import Match, Team, User, Prediction

def simulate_first_upcoming_match():
    db = SessionLocal()
    try:
        match = db.query(Match).filter(Match.status == "upcoming").order_by(Match.deadline.asc()).first()
        if not match:
            print("Aucun match à venir disponible pour simulation.")
            return

        # Tirage d'un vainqueur aléatoire avec score réaliste
        winner_is_home = random.random() < 0.55
        winner_id = match.home_team_id if winner_is_home else match.away_team_id
        winner_team = match.home_team if winner_is_home else match.away_team
        
        home_pts = random.randint(102, 128)
        away_pts = random.randint(95, 125)
        if winner_is_home and home_pts <= away_pts:
            home_pts = away_pts + random.randint(1, 10)
        elif not winner_is_home and away_pts <= home_pts:
            away_pts = home_pts + random.randint(1, 10)

        # Enregistrement du résultat
        match.status = "finished"
        match.winner_team_id = winner_id
        match.home_score = home_pts
        match.away_score = away_pts

        winning_odds = match.home_odds if winner_is_home else match.away_odds

        # Attribution des points aux pronostiqueurs
        predictions = db.query(Prediction).filter(Prediction.match_id == match.id).all()
        affected_users = set()

        for pred in predictions:
            if pred.selected_team_id == winner_id:
                pred.points_won = round(winning_odds, 2)
            else:
                pred.points_won = 0.0
            affected_users.add(pred.user_id)

        db.flush()

        for uid in affected_users:
            u = db.query(User).filter(User.id == uid).first()
            if u:
                u.total_points = round(sum(p.points_won for p in u.predictions), 2)

        db.commit()

        print("================ SIMULATION DE MATCH NBA ================")
        print(f"Match #{match.id} : {match.home_team.city} ({home_pts}) vs {match.away_team.city} ({away_pts})")
        print(f"Vainqueur : {winner_team.city} (Cote gagnante : {winning_odds:.2f})")
        print(f"Pronostics mis à jour : {len(predictions)}")
        print("Le classement en direct a été mis à jour !")
        print("=========================================================")

    finally:
        db.close()

if __name__ == "__main__":
    simulate_first_upcoming_match()
