"""
Script de test pour le Chantier 1 : Navigation et Profil (Winrate, Cotes, Badges).
Vérifie :
1. Le bon fonctionnement de la route GET /api/users/me/stats.
2. Le calcul exact du Winrate, de la cote moyenne et de la cote maximale.
3. Le statut des 3 badges ("Rookie", "Sniper", "Maçon").
4. La présence des 4 onglets ("Matchs", "Mes Ligues", "Classement Général", "Profil") et de leurs vues dans l'UI.
"""
import time
from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import User, Match, Prediction, Team
from datetime import datetime, timezone

client = TestClient(app)

def test_profile_and_navigation():
    print("================== TEST CHANTIER 1 : PROFIL & NAVIGATION ==================")
    
    # 1. Vérification HTML / UI (4 Onglets et Vues)
    res_html = client.get("/")
    assert res_html.status_code == 200
    assert 'data-tab="matches"' in res_html.text, "Onglet Matchs absent"
    assert 'data-tab="leagues"' in res_html.text, "Onglet Mes Ligues absent"
    assert 'data-tab="leaderboard"' in res_html.text, "Onglet Classement absent"
    assert 'data-tab="profile"' in res_html.text, "Onglet Profil absent"
    assert 'id="profile-view"' in res_html.text, "Vue Profil absente"
    assert 'id="leagues-view"' in res_html.text, "Vue Ligues absente"
    print("-> [OK] Les 4 onglets ('Matchs', 'Mes Ligues', 'Classement', 'Profil') et leurs vues sont présents dans l'interface.")

    # 2. Création d'un utilisateur pour tester les stats
    uid = int(time.time())
    username = f"pro_player_{uid}"
    email = f"pro_{uid}@test.com"
    password = "secret_password_123"

    res_reg = client.post("/api/auth/register", json={
        "username": username,
        "email": email,
        "password": password
    })
    assert res_reg.status_code == 201, f"Erreur inscription: {res_reg.text}"
    token = res_reg.json()["access_token"]
    user_id = res_reg.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    # 3. Appel de /api/users/me/stats sans aucun match terminé
    res_stats_empty = client.get("/api/users/me/stats", headers=headers)
    assert res_stats_empty.status_code == 200, f"Erreur stats: {res_stats_empty.text}"
    data_empty = res_stats_empty.json()
    assert data_empty["total_predictions"] == 0
    assert data_empty["winrate"] == 0.0
    assert data_empty["avg_odds"] == 0.0
    assert data_empty["max_odds"] == 0.0
    assert len(data_empty["badges"]) == 10
    print("-> [OK] Profil initialisé avec statistiques à zéro et 10 badges d'accomplissements verrouillés.")

    # 4. Simulation de pronostics et calcul des stats
    # Créons des matchs terminés pour tester les badges
    db = SessionLocal()
    try:
        teams = db.query(Team).limit(2).all()
        assert len(teams) >= 2, "Il faut au moins 2 équipes en base."
        t1, t2 = teams[0], teams[1]

        # Simuler 5 victoires dont 3 avec cote > 2.50
        # Match 1 : Cote 2.80 (Gagné)
        # Match 2 : Cote 2.60 (Gagné)
        # Match 3 : Cote 2.55 (Gagné)
        # Match 4 : Cote 1.50 (Gagné)
        # Match 5 : Cote 1.70 (Gagné)
        odds_list = [2.80, 2.60, 2.55, 1.50, 1.70]
        created_matches = []
        for i, o in enumerate(odds_list):
            m = Match(
                home_team_id=t1.id,
                away_team_id=t2.id,
                home_odds=o,
                away_odds=1.90,
                deadline=datetime.now(timezone.utc),
                status="finished",
                winner_team_id=t1.id,
                home_score=110,
                away_score=100
            )
            db.add(m)
            db.flush()
            created_matches.append(m)

            # Pronostic gagnant du joueur
            pred = Prediction(
                user_id=user_id,
                match_id=m.id,
                selected_team_id=t1.id,
                points_won=o
            )
            db.add(pred)

        # Mettre à jour les points du joueur
        user_obj = db.query(User).filter(User.id == user_id).first()
        user_obj.total_points = round(sum(odds_list), 2)
        db.commit()

        # 5. Appel de /api/users/me/stats avec 5 victoires et 3 cotes > 2.50
        res_stats_active = client.get("/api/users/me/stats", headers=headers)
        assert res_stats_active.status_code == 200
        stats = res_stats_active.json()

        assert stats["total_predictions"] == 5
        assert stats["won_predictions"] == 5
        assert stats["winrate"] == 100.0, f"Attendu 100.0%, reçu {stats['winrate']}"
        expected_avg = round(sum(odds_list) / 5, 2)
        assert stats["avg_odds"] == expected_avg, f"Attendu {expected_avg}, reçu {stats['avg_odds']}"
        assert stats["max_odds"] == 2.80, f"Attendu 2.80, reçu {stats['max_odds']}"
        print(f"-> [OK] Calculs vérifiés : Winrate={stats['winrate']}%, Cote moyenne={stats['avg_odds']}, Cote max={stats['max_odds']}.")

        # Vérification des Badges
        badges_map = {b["id"]: b for b in stats["badges"]}
        
        # Badge Rookie (5 bons pronos) -> Doit être débloqué !
        assert badges_map["rookie"]["unlocked"] is True, "Badge Rookie doit être débloqué avec 5 victoires."
        print("-> [OK] Badge 'Rookie' (5 bons pronos) DÉBLOQUÉ.")

        # Badge Sniper (3 cotes > 2.50) -> Doit être débloqué !
        assert badges_map["sniper"]["unlocked"] is True, "Badge Sniper doit être débloqué avec 3 cotes > 2.50."
        print("-> [OK] Badge 'Sniper' (3 cotes > 2.50 validées) DÉBLOQUÉ.")

        # Badge Maçon (5 erreurs de suite) -> Doit être verrouillé car 0 erreur
        assert badges_map["macon"]["unlocked"] is False, "Badge Maçon doit rester verrouillé."
        print("-> [OK] Badge 'Maçon' correctement VERROUILLÉ (0 erreur).")

        # 6. Test déblocage Badge Maçon : Ajouter 5 erreurs consécutives
        for j in range(5):
            m_loss = Match(
                home_team_id=t1.id,
                away_team_id=t2.id,
                home_odds=1.80,
                away_odds=2.00,
                deadline=datetime.now(timezone.utc),
                status="finished",
                winner_team_id=t1.id,
                home_score=105,
                away_score=95
            )
            db.add(m_loss)
            db.flush()
            created_matches.append(m_loss)

            # Le joueur vote pour t2 (l'équipe perdante)
            pred_loss = Prediction(
                user_id=user_id,
                match_id=m_loss.id,
                selected_team_id=t2.id,
                points_won=0.0
            )
            db.add(pred_loss)
        db.commit()

        # Re-vérifier les stats
        res_after_losses = client.get("/api/users/me/stats", headers=headers)
        stats_losses = res_after_losses.json()
        badges_after = {b["id"]: b for b in stats_losses["badges"]}

        assert stats_losses["total_predictions"] == 10
        assert stats_losses["won_predictions"] == 5
        assert stats_losses["lost_predictions"] == 5
        assert stats_losses["winrate"] == 50.0, f"Attendu 50.0%, reçu {stats_losses['winrate']}"
        assert badges_after["macon"]["unlocked"] is True, "Badge Maçon doit être débloqué après 5 erreurs consécutives."
        print("-> [OK] Badge 'Maçon' (5 erreurs de suite) DÉBLOQUÉ après série noire.")

    finally:
        for m in created_matches:
            db.query(Prediction).filter(Prediction.match_id == m.id).delete()
            db.delete(m)
        db.query(User).filter(User.id == user_id).delete()
        db.commit()
        db.close()

    print("===========================================================================")
    print("TOUS LES TESTS DU CHANTIER 1 (NAVIGATION & PROFIL) ONT RÉUSSI SANS ERREUR !")
    print("===========================================================================")

if __name__ == "__main__":
    test_profile_and_navigation()
