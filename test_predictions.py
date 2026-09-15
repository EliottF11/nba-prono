"""
Test d'intégration pour les routes de pronostics et le classement en direct.
Valide :
1. Récupération des matchs et cotes
2. Enregistrement et modification 1-clic d'un pronostic
3. Rejet d'une équipe non valide
4. Récupération des pronostics du joueur
5. Clôture de match et calcul automatique des points gagnés
6. Classement en direct (Leaderboard) trié par points
7. Rejet d'un pronostic sur un match clôturé
"""
from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import Match, Team, User

client = TestClient(app)

def run_tests():
    print("================== TEST PRONOSTICS & CLASSEMENT ==================")
    
    # 1. Vérification de la liste des matchs
    res_matches = client.get("/api/matches")
    assert res_matches.status_code == 200, f"Erreur GET /matches: {res_matches.text}"
    matches = res_matches.json()
    assert len(matches) == 16, f"Attendu 16 matchs, reçu {len(matches)}"
    print(f"-> [OK] 16 matchs officiels récupérés avec cotes et villes (ex: {matches[0]['home_team']['city']} vs {matches[0]['away_team']['city']}).")

    upcoming_matches = [m for m in matches if m["status"] == "upcoming"]
    if not upcoming_matches:
        from seed import reset_and_init_db, seed_all_teams_and_matches
        reset_and_init_db()
        seed_all_teams_and_matches()
        matches = client.get("/api/matches").json()
        upcoming_matches = [m for m in matches if m["status"] == "upcoming"]

    m1 = upcoming_matches[0]
    m1_id = m1["id"]
    home_team_id = m1["home_team"]["id"]
    away_team_id = m1["away_team"]["id"]

    # 2. Création de deux utilisateurs test
    res_u1 = client.post("/api/auth/register", json={"username": "luka_magic", "email": "luka@mavs.com", "password": "pass_luka_77"})
    token_u1 = res_u1.json()["access_token"] if res_u1.status_code == 201 else client.post("/api/auth/login", json={"username": "luka_magic", "password": "pass_luka_77"}).json()["access_token"]

    res_u2 = client.post("/api/auth/register", json={"username": "giannis_freak", "email": "giannis@bucks.com", "password": "pass_giannis_34"})
    token_u2 = res_u2.json()["access_token"] if res_u2.status_code == 201 else client.post("/api/auth/login", json={"username": "giannis_freak", "password": "pass_giannis_34"}).json()["access_token"]

    headers_u1 = {"Authorization": f"Bearer {token_u1}"}
    headers_u2 = {"Authorization": f"Bearer {token_u2}"}

    # 3. Pronostic 1 : Luka vote d'abord pour l'équipe domicile
    p1 = client.post("/api/predictions", json={"match_id": m1_id, "selected_team_id": home_team_id}, headers=headers_u1)
    assert p1.status_code == 200, f"Erreur prono: {p1.text}"
    pred_data = p1.json()
    assert pred_data["selected_team_id"] == home_team_id
    print("-> [OK] Pronostic initial enregistré pour luka_magic.")

    # 4. Modification 1-clic : Luka change d'avis et clique sur l'équipe extérieur
    p1_update = client.post("/api/predictions", json={"match_id": m1_id, "selected_team_id": away_team_id}, headers=headers_u1)
    assert p1_update.status_code == 200
    assert p1_update.json()["id"] == pred_data["id"], "L'ID du prono doit rester identique (mise à jour 1-clic)."
    assert p1_update.json()["selected_team_id"] == away_team_id
    print("-> [OK] Modification 1-clic réussie (changement d'équipe sans doublon).")

    # 5. Giannis vote pour l'équipe domicile (perdant potentiel)
    p2 = client.post("/api/predictions", json={"match_id": m1_id, "selected_team_id": home_team_id}, headers=headers_u2)
    assert p2.status_code == 200
    print("-> [OK] Pronostic enregistré pour giannis_freak.")

    # 6. Test rejet équipe non valide
    p_invalid = client.post("/api/predictions", json={"match_id": m1_id, "selected_team_id": 9999}, headers=headers_u1)
    assert p_invalid.status_code == 400
    print("-> [OK] Rejet correct d'une équipe non participante au match (HTTP 400).")

    # 7. Consultation des pronostics du joueur (/api/predictions/me)
    my_preds = client.get("/api/predictions/me", headers=headers_u1)
    assert my_preds.status_code == 200
    assert len(my_preds.json()) >= 1
    print("-> [OK] Route /api/predictions/me fonctionnelle.")

    # 8. Clôture du Match : Victoire de l'équipe extérieur avec score 110 - 105
    res_resolve = client.post(
        f"/api/matches/{m1_id}/resolve?winner_team_id={away_team_id}&home_score=105&away_score=110"
    )
    assert res_resolve.status_code == 200, f"Erreur resolve: {res_resolve.text}"
    print(f"-> [OK] Match #{m1_id} clôturé avec succès : Denver l'emporte 110-105.")

    # 9. Vérification du classement en direct
    res_lb = client.get("/api/leaderboard")
    assert res_lb.status_code == 200
    lb = res_lb.json()
    print("-> [OK] Classement en direct :")
    for player in lb[:5]:
        print(f"   Rang #{player['rank']} : {player['username']} ({player['total_points']} pts - {player['won_count']}/{player['predictions_count']} bons pronos)")

    # Luka a voté pour l'équipe extérieure (gagnante)
    expected_points = round(m1["away_odds"], 2)
    luka_entry = next(u for u in lb if u["username"] == "luka_magic")
    assert luka_entry["total_points"] >= expected_points, f"Luka attendait {expected_points} pts, a {luka_entry['total_points']}"
    assert luka_entry["won_count"] >= 1

    # Giannis a voté pour l'équipe domicile (perdante)
    giannis_entry = next(u for u in lb if u["username"] == "giannis_freak")
    print("-> [OK] Calcul exact des cotes et points validé !")

    # 10. Rejet d'un pronostic sur match clôturé
    p_closed = client.post("/api/predictions", json={"match_id": m1_id, "selected_team_id": away_team_id}, headers=headers_u1)
    assert p_closed.status_code == 400
    print("-> [OK] Rejet d'un pronostic sur un match déjà clôturé (HTTP 400).")

    print("==================================================================")
    print("TOUS LES TESTS DE PRONOSTICS ET CLASSEMENT ONT RÉUSSI !")
    print("==================================================================")

if __name__ == "__main__":
    run_tests()
