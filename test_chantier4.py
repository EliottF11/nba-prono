"""
Script de test automatisé pour le Chantier 4 :
1. Consultation des candidats Joueurs de la Semaine Est & Ouest (/api/weekly-players/candidates).
2. Vérification de l'obligation stricte : tentative de pronostiquer un match sans avoir choisi
   ses 2 Joueurs de la Semaine (Est & Ouest) -> Rejet HTTP 400.
3. Enregistrement des 2 Joueurs de la Semaine (/api/weekly-players) -> Succès HTTP 200.
4. Pronostic du match débloqué après validation des 2 joueurs.
5. Indépendance par semaine (Week 1 vs Week 2).
6. Modification des choix autorisée avant le coup d'envoi.
7. Règle de verrouillage : rejet HTTP 400 si les matchs de la semaine ont débuté.
8. Intégration UI (carte des 2 listes déroulantes, bouton dynamique, affichage profil).
"""
import time
from datetime import datetime, timezone, timedelta
from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import Match, WeeklyPlayerPrediction, Prediction, User

client = TestClient(app)

def test_chantier4_weekly_players():
    print("================== TEST CHANTIER 4 : JOUEURS DE LA SEMAINE ==================")

    # 1. Vérification des candidats officiels Est & Ouest
    res_cand = client.get("/api/weekly-players/candidates")
    assert res_cand.status_code == 200, f"Erreur /api/weekly-players/candidates: {res_cand.text}"
    cands = res_cand.json()
    assert "east" in cands and len(cands["east"]) >= 15, "Doit lister au moins 15 stars de l'Est."
    assert "west" in cands and len(cands["west"]) >= 15, "Doit lister au moins 15 stars de l'Ouest."
    print(f"-> [OK] Candidats chargés ({len(cands['east'])} Est, {len(cands['west'])} Ouest).")

    # 2. Protection d'authentification
    res_unauth = client.get("/api/weekly-players/1")
    assert res_unauth.status_code == 401, "GET sans token doit renvoyer HTTP 401."
    print("-> [OK] Protection d'authentification vérifiée (HTTP 401).")

    # 3. Création d'un joueur test
    uid = int(time.time() * 1000)
    username = f"clutch_king_{uid}"
    email = f"clutch_{uid}@nbaprono.com"
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

    # 4. Consultation initiale de la Week 1 (aucun choix fait)
    res_init = client.get("/api/weekly-players/1", headers=headers)
    assert res_init.status_code == 200
    init_data = res_init.json()
    assert init_data["week_number"] == 1
    assert init_data["east_player"] is None
    assert init_data["west_player"] is None
    print("-> [OK] Consultation initiale Week 1 : aucun joueur sélectionné.")

    # 5. RÈGLE STRICTE OBLIGATOIRE : Tentative de pronostiquer un match sans avoir choisi ses 2 joueurs
    # Récupérer un match de la Week 1
    res_matches_w1 = client.get("/api/matches?week=1")
    assert res_matches_w1.status_code == 200
    matches_w1 = res_matches_w1.json()
    assert len(matches_w1) > 0, "Doit contenir des matchs en Week 1."
    m1 = matches_w1[0]

    res_pred_blocked = client.post("/api/predictions", json={
        "match_id": m1["id"],
        "selected_team_id": m1["home_team"]["id"]
    }, headers=headers)

    assert res_pred_blocked.status_code == 400, f"Attendu HTTP 400 (bloqué), reçu {res_pred_blocked.status_code}"
    assert "obligatoirement" in res_pred_blocked.json()["detail"].lower() or "joueur" in res_pred_blocked.json()["detail"].lower()
    print("-> [OK] Règle stricte respectée : pronostic de match bloqué (HTTP 400) sans les 2 Joueurs de la Semaine.")

    # 6. Enregistrement des 2 Joueurs de la Semaine 1
    # Payload incomplet -> 422
    res_incomplete = client.post("/api/weekly-players", json={
        "week_number": 1,
        "east_player": "Jayson Tatum (Celtics)"
        # Manque west_player
    }, headers=headers)
    assert res_incomplete.status_code == 422
    print("-> [OK] Validation stricte des champs obligatoires (HTTP 422).")

    # Payload valide pour la Semaine 1
    res_save_w1 = client.post("/api/weekly-players", json={
        "week_number": 1,
        "east_player": "Jayson Tatum (Celtics)",
        "west_player": "Nikola Jokic (Nuggets)"
    }, headers=headers)
    assert res_save_w1.status_code == 200
    w1_saved = res_save_w1.json()
    assert w1_saved["east_player"] == "Jayson Tatum (Celtics)"
    assert w1_saved["west_player"] == "Nikola Jokic (Nuggets)"
    print("-> [OK] Enregistrement des 2 Joueurs de la Semaine 1 validé (Tatum & Jokic).")

    # 7. Le pronostic sur le match de la Week 1 est MAINTENANT AUTORISÉ
    res_pred_allowed = client.post("/api/predictions", json={
        "match_id": m1["id"],
        "selected_team_id": m1["home_team"]["id"]
    }, headers=headers)
    assert res_pred_allowed.status_code == 200, f"Pronostic doit réussir après sélection des joueurs: {res_pred_allowed.text}"
    print("-> [OK] Pronostic de match validé avec succès après avoir choisi ses joueurs hebdo.")

    # 8. Indépendance des semaines : la Week 2 doit aussi exiger ses propres joueurs !
    res_matches_w2 = client.get("/api/matches?week=2")
    assert res_matches_w2.status_code == 200
    matches_w2 = res_matches_w2.json()
    assert len(matches_w2) > 0, "Doit contenir des matchs en Week 2."
    m2 = matches_w2[0]

    # Pronostic sur Week 2 doit être bloqué tant que Week 2 n'est pas remplie
    res_pred_w2_blocked = client.post("/api/predictions", json={
        "match_id": m2["id"],
        "selected_team_id": m2["home_team"]["id"]
    }, headers=headers)
    assert res_pred_w2_blocked.status_code == 400
    print("-> [OK] Indépendance des semaines vérifiée : Week 2 exige ses propres Joueurs de la Semaine.")

    # Validation pour la Week 2
    res_save_w2 = client.post("/api/weekly-players", json={
        "week_number": 2,
        "east_player": "Giannis Antetokounmpo (Bucks)",
        "west_player": "Luka Doncic (Mavericks)"
    }, headers=headers)
    assert res_save_w2.status_code == 200

    # Maintenant le match de Week 2 fonctionne
    res_pred_w2_ok = client.post("/api/predictions", json={
        "match_id": m2["id"],
        "selected_team_id": m2["home_team"]["id"]
    }, headers=headers)
    assert res_pred_w2_ok.status_code == 200
    print("-> [OK] Pronostic Week 2 validé après sélection des joueurs de la Semaine 2 (Giannis & Luka).")

    # 9. Modification autorisée des choix avant le coup d'envoi
    res_update_w1 = client.post("/api/weekly-players", json={
        "week_number": 1,
        "east_player": "Jalen Brunson (Knicks)",
        "west_player": "Victor Wembanyama (Spurs)"
    }, headers=headers)
    assert res_update_w1.status_code == 200
    assert res_update_w1.json()["east_player"] == "Jalen Brunson (Knicks)"
    assert res_update_w1.json()["west_player"] == "Victor Wembanyama (Spurs)"
    print("-> [OK] Modification des choix hebdo autorisée avant le coup d'envoi.")

    # 10. Règle de verrouillage strict de la semaine
    db = SessionLocal()
    first_w1_match = db.query(Match).filter(Match.week_number == 1).order_by(Match.deadline.asc()).first()
    orig_deadline = first_w1_match.deadline
    orig_status = first_w1_match.status

    try:
        # Simulation : premier match de la Semaine 1 a débuté il y a 30 minutes
        first_w1_match.deadline = datetime.now(timezone.utc) - timedelta(minutes=30)
        db.commit()

        # Tentative de modification des Joueurs de la Semaine 1 -> Rejet HTTP 400
        res_locked_modify = client.post("/api/weekly-players", json={
            "week_number": 1,
            "east_player": "Joel Embiid (76ers)",
            "west_player": "Stephen Curry (Warriors)"
        }, headers=headers)
        assert res_locked_modify.status_code == 400
        assert "verrouill" in res_locked_modify.json()["detail"].lower()
        print("-> [OK] Règle stricte respectée : verrouillage au coup d'envoi de la semaine (HTTP 400).")

    finally:
        # Restauration de l'état initial
        first_w1_match.deadline = orig_deadline
        first_w1_match.status = orig_status
        db.commit()

        # Nettoyage des données de test
        db.query(Prediction).filter(Prediction.user_id == user_id).delete()
        db.query(WeeklyPlayerPrediction).filter(WeeklyPlayerPrediction.user_id == user_id).delete()
        db.query(User).filter(User.id == user_id).delete()
        db.commit()
        db.close()

    # 11. Vérification UI & Fichiers statiques
    res_index = client.get("/")
    assert "weekly-players-container" in res_index.text, "index.html doit contenir weekly-players-container."

    res_js = client.get("/static/js/app.js")
    assert "renderWeeklyPlayersCard" in res_js.text, "app.js doit contenir renderWeeklyPlayersCard."
    assert "saveWeeklyPlayers" in res_js.text, "app.js doit contenir saveWeeklyPlayers."
    assert "loadWeeklyPlayerCandidates" in res_js.text, "app.js doit charger les candidats."
    assert "Joueurs de la Semaine" in res_js.text, "app.js doit afficher les joueurs dans le Profil."

    res_api = client.get("/static/js/api.js")
    assert "getWeeklyCandidates" in res_api.text
    assert "saveWeeklyPlayerPrediction" in res_api.text
    print("-> [OK] Intégration UI complète (carte responsive, selects Est/Ouest, gestion dans Profil).")

    print("===========================================================================")
    print("TOUS LES TESTS DU CHANTIER 4 (JOUEURS DE LA SEMAINE) ONT RÉUSSI SANS ERREUR !")
    print("===========================================================================")

if __name__ == "__main__":
    test_chantier4_weekly_players()
