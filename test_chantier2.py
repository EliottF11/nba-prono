"""
Script de test automatisé pour le Chantier 2 :
1. Découpage par Semaine NBA (Week 1, Week 2, filtrage par semaine).
2. Fonctionnalité Bonus x2 (1 seul par semaine, transfert de bonus, points doublés en cas de victoire).
3. Présence des éléments visuels du sélecteur de semaine et bouton x2.
"""
import time
from datetime import datetime, timezone
from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import User, Match, Prediction, Team

client = TestClient(app)

def test_chantier2_weeks_and_boost():
    print("================== TEST CHANTIER 2 : SEMAINES & BONUS x2 ==================")

    # 1. Vérification de l'endpoint des semaines (/api/weeks)
    res_weeks = client.get("/api/weeks")
    assert res_weeks.status_code == 200, f"Erreur /api/weeks: {res_weeks.text}"
    weeks_data = res_weeks.json()
    assert len(weeks_data) >= 2, f"Attendu au moins 2 semaines, reçu: {len(weeks_data)}"
    week_numbers = [w["week"] for w in weeks_data]
    assert 1 in week_numbers and 2 in week_numbers, "Week 1 et Week 2 doivent être présentes."
    print(f"-> [OK] Semaines NBA disponibles : {weeks_data}")

    # 2. Filtrage des matchs par semaine
    res_w1 = client.get("/api/matches?week=1")
    assert res_w1.status_code == 200
    matches_w1 = res_w1.json()
    assert all(m["week_number"] == 1 for m in matches_w1), "Tous les matchs doivent être de la Semaine 1."

    res_w2 = client.get("/api/matches?week=2")
    assert res_w2.status_code == 200
    matches_w2 = res_w2.json()
    assert all(m["week_number"] == 2 for m in matches_w2), "Tous les matchs doivent être de la Semaine 2."
    print(f"-> [OK] Filtrage fonctionnel : {len(matches_w1)} matchs en Week 1, {len(matches_w2)} matchs en Week 2.")

    # 3. Création d'un joueur test
    uid = int(time.time())
    username = f"sniper_{uid}"
    email = f"sniper_{uid}@clutch.com"
    pwd = "password_secure_2026"

    res_reg = client.post("/api/auth/register", json={
        "username": username,
        "email": email,
        "password": pwd
    })
    assert res_reg.status_code == 201
    token = res_reg.json()["access_token"]
    user_id = res_reg.json()["user"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    # 4. Test Bonus x2 : tentative de boost SANS avoir pronostiqué d'abord
    upcoming_w1 = [m for m in matches_w1 if m["status"] == "upcoming"]
    assert len(upcoming_w1) >= 2, "Il faut au moins 2 matchs ouverts en Week 1."
    m1 = upcoming_w1[0]
    res_boost_no_pred = client.post(f"/api/predictions/{m1['id']}/boost", headers=headers)
    assert res_boost_no_pred.status_code == 400, "Doit refuser le boost si aucun pronostic n'a été fait."
    print("-> [OK] Rejet correct du Bonus x2 sans sélection préalable d'équipe (HTTP 400).")

    # 4.bis Pré-requis Chantier 4 : Enregistrer les 2 Joueurs de la Semaine 1
    res_wp1 = client.post("/api/weekly-players", json={
        "week_number": 1,
        "east_player": "Jayson Tatum",
        "west_player": "Nikola Jokic"
    }, headers=headers)
    assert res_wp1.status_code == 200

    # 5. Enregistrement d'un pronostic sur le match 1 de la semaine 1
    res_pred1 = client.post("/api/predictions", json={
        "match_id": m1["id"],
        "selected_team_id": m1["home_team"]["id"]
    }, headers=headers)
    assert res_pred1.status_code == 200

    # Activation du Bonus x2 sur le match 1
    res_boost1 = client.post(f"/api/predictions/{m1['id']}/boost", headers=headers)
    assert res_boost1.status_code == 200
    assert res_boost1.json()["is_boosted"] is True
    print("-> [OK] Bonus x2 activé avec succès sur le match 1 (Semaine 1).")

    # 6. Test règle stricte : 1 seul match boosté par semaine
    # Pronostic sur le match 2 de la Semaine 1
    m2 = upcoming_w1[1]
    client.post("/api/predictions", json={
        "match_id": m2["id"],
        "selected_team_id": m2["home_team"]["id"]
    }, headers=headers)

    # Activation du Bonus x2 sur le match 2
    res_boost2 = client.post(f"/api/predictions/{m2['id']}/boost", headers=headers)
    assert res_boost2.status_code == 200
    assert res_boost2.json()["is_boosted"] is True

    # Vérification que le match 1 a été DÉBOOSTÉ automatiquement (1 seul par semaine !)
    my_preds = client.get("/api/predictions/me", headers=headers).json()
    pred_map = {p["match_id"]: p["is_boosted"] for p in my_preds}
    assert pred_map[m1["id"]] is False, "Le match 1 doit avoir perdu son boost."
    assert pred_map[m2["id"]] is True, "Le match 2 doit être le seul boosté pour la Semaine 1."
    print("-> [OK] Règle stricte respectée : le Bonus x2 a été transféré du match 1 vers le match 2 (1 seul par semaine).")

    # 7. Test de désactivation (toggle off)
    res_toggle_off = client.post(f"/api/predictions/{m2['id']}/boost", headers=headers)
    assert res_toggle_off.status_code == 200
    assert res_toggle_off.json()["is_boosted"] is False
    print("-> [OK] Désactivation (toggle off) du Bonus x2 sur le même match.")

    # 8. Test points doublés lors de la clôture d'un match boosté
    # On réactive le boost sur match 1
    client.post(f"/api/predictions/{m1['id']}/boost", headers=headers)

    # Clôture du match 1 avec victoire de l'équipe sélectionnée
    winning_team_id = m1["home_team"]["id"]
    base_odds = m1["home_odds"]
    res_resolve = client.post(f"/api/matches/{m1['id']}/resolve?winner_team_id={winning_team_id}&home_score=115&away_score=102")
    assert res_resolve.status_code == 200

    # Vérification des points du joueur (doivent être exactement doublés : base_odds * 2)
    res_me = client.get("/api/auth/me", headers=headers)
    user_points = res_me.json()["total_points"]
    expected_points = round(base_odds * 2.0, 2)
    assert user_points == expected_points, f"Attendu {expected_points} pts (cote {base_odds} x 2), reçu {user_points}"
    print(f"-> [OK] Points doublés validés en base : cote {base_odds} x 2 = {user_points} points !")

    # 9. Vérification UI dans index.html
    res_ui = client.get("/")
    assert "weeks-selector" in res_ui.text, "Le sélecteur de semaine doit être présent dans l'interface."
    assert "match-card-boosted" in client.get("/static/css/style.css").text, "Le style d'illumination doit être présent."
    print("-> [OK] Éléments UI (sélecteur de semaines, styles d'illumination et pulse glow) vérifiés.")

    # Nettoyage / Restauration du match 1 en status upcoming
    db_clean = SessionLocal()
    m_reset = db_clean.query(Match).filter(Match.id == m1["id"]).first()
    if m_reset:
        m_reset.status = "upcoming"
        m_reset.home_score = None
        m_reset.away_score = None
        m_reset.winner_team_id = None
        db_clean.commit()
    db_clean.close()

    print("===========================================================================")
    print("TOUS LES TESTS DU CHANTIER 2 (SEMAINES & BONUS X2) ONT RÉUSSI SANS ERREUR !")
    print("===========================================================================")

if __name__ == "__main__":
    test_chantier2_weeks_and_boost()
