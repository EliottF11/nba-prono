"""
Script de test automatisé pour le Chantier 3 :
1. Consultation des candidats et franchises NBA (/api/season/candidates).
2. Pronostics d'avant-saison : 5 choix clés (Champion, NBA Cup, MVP, DPOY, ROY).
3. Sauvegarde et modification des pronostics avant le début de la saison.
4. Règle absolue de verrouillage : coup d'envoi du tout premier match (rejet HTTP 400).
5. Intégration UI (bannière dynamique, modale et affichage dans le profil).
"""
import time
from datetime import datetime, timezone, timedelta
from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import Match, SeasonPrediction, User

client = TestClient(app)

def test_chantier3_season_predictions():
    print("================== TEST CHANTIER 3 : PRONOSTICS DE SAISON ==================")

    # 1. Vérification des candidats officiels
    res_cand = client.get("/api/season/candidates")
    assert res_cand.status_code == 200, f"Erreur /api/season/candidates: {res_cand.text}"
    cand_data = res_cand.json()
    assert "teams" in cand_data and len(cand_data["teams"]) > 0, "Doit lister les équipes NBA."
    assert "mvp" in cand_data and len(cand_data["mvp"]) > 0, "Doit lister les candidats MVP."
    assert "dpoy" in cand_data and len(cand_data["dpoy"]) > 0, "Doit lister les candidats DPOY."
    assert "roy" in cand_data and len(cand_data["roy"]) > 0, "Doit lister les candidats ROY."
    print(f"-> [OK] Candidats chargés ({len(cand_data['teams'])} équipes, {len(cand_data['mvp'])} MVP, {len(cand_data['dpoy'])} DPOY, {len(cand_data['roy'])} ROY).")

    # 2. Sécurité : accès protégé sans token
    res_unauth_get = client.get("/api/season/predictions")
    assert res_unauth_get.status_code == 401, "GET sans token doit renvoyer HTTP 401."
    res_unauth_post = client.post("/api/season/predictions", json={})
    assert res_unauth_post.status_code == 401, "POST sans token doit renvoyer HTTP 401."
    print("-> [OK] Protection d'authentification vérifiée (HTTP 401).")

    # 3. Création d'un utilisateur test
    uid = int(time.time() * 1000)
    username = f"season_guru_{uid}"
    email = f"guru_{uid}@nbaprono.com"
    pwd = "password_secure_2026"

    res_reg = client.post("/api/auth/register", json={
        "username": username,
        "email": email,
        "password": pwd
    })
    assert res_reg.status_code == 201
    token = res_reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 4. État initial : aucun choix fait
    res_init = client.get("/api/season/predictions", headers=headers)
    assert res_init.status_code == 200
    init_data = res_init.json()
    assert init_data["nba_champion"] is None
    assert init_data["mvp"] is None
    print("-> [OK] Consultation initiale : aucun pronostic enregistré.")

    # 5. Validation des données : payload incomplet (doit échouer avec 422)
    res_incomplete = client.post("/api/season/predictions", json={
        "nba_champion": "Boston",
        "cup_winner": "Denver"
        # Manque mvp, dpoy, roy
    }, headers=headers)
    assert res_incomplete.status_code == 422, "Doit refuser un formulaire incomplet."
    print("-> [OK] Validation stricte des 5 choix obligatoires (HTTP 422).")

    # 6. Enregistrement des 5 pronostics valides avant le début de la saison
    payload_1 = {
        "nba_champion": "Boston",
        "cup_winner": "New York",
        "mvp": "Luka Doncic (Mavericks)",
        "dpoy": "Victor Wembanyama (Spurs)",
        "roy": "Cooper Flagg"
    }
    res_save = client.post("/api/season/predictions", json=payload_1, headers=headers)
    assert res_save.status_code == 200, f"Erreur sauvegarde: {res_save.text}"
    saved_data = res_save.json()
    assert saved_data["nba_champion"] == "Boston"
    assert saved_data["cup_winner"] == "New York"
    assert saved_data["mvp"] == "Luka Doncic (Mavericks)"
    assert saved_data["dpoy"] == "Victor Wembanyama (Spurs)"
    assert saved_data["roy"] == "Cooper Flagg"
    assert saved_data["is_locked"] is False
    print("-> [OK] Enregistrement des 5 choix d'avant-saison validé.")

    # 7. Modification autorisée tant que la saison n'a pas commencé
    payload_2 = {
        "nba_champion": "Oklahoma City",
        "cup_winner": "Los Angeles (LAL)",
        "mvp": "Shai Gilgeous-Alexander (Thunder)",
        "dpoy": "Rudy Gobert (Timberwolves)",
        "roy": "Stephon Castle"
    }
    res_update = client.post("/api/season/predictions", json=payload_2, headers=headers)
    assert res_update.status_code == 200
    updated_data = res_update.json()
    assert updated_data["nba_champion"] == "Oklahoma City"
    assert updated_data["mvp"] == "Shai Gilgeous-Alexander (Thunder)"
    print("-> [OK] Modification des 5 choix autorisée avant le coup d'envoi.")

    # 8. Test de la règle absolue : VERROUILLAGE au coup d'envoi du tout premier match
    db = SessionLocal()
    first_match = db.query(Match).order_by(Match.deadline.asc(), Match.id.asc()).first()
    original_deadline = first_match.deadline
    original_status = first_match.status

    try:
        # On simule que la saison a commencé : deadline passée de 2 heures
        first_match.deadline = datetime.now(timezone.utc) - timedelta(hours=2)
        db.commit()

        # Vérification du statut de verrouillage via GET
        res_locked_check = client.get("/api/season/predictions", headers=headers)
        assert res_locked_check.status_code == 200
        assert res_locked_check.json()["is_locked"] is True, "Le statut doit être is_locked = True."

        # Tentative d'enregistrement après deadline : DOIT ÊTRE REJETÉE avec HTTP 400
        res_locked_post = client.post("/api/season/predictions", json={
            "nba_champion": "Denver",
            "cup_winner": "Boston",
            "mvp": "Nikola Jokic (Nuggets)",
            "dpoy": "Bam Adebayo (Heat)",
            "roy": "Alex Sarr"
        }, headers=headers)

        assert res_locked_post.status_code == 400, f"Attendu HTTP 400 (verrouillé), reçu: {res_locked_post.status_code}"
        assert "verrouill" in res_locked_post.json()["detail"].lower()
        print("-> [OK] Règle stricte respectée : rejet HTTP 400 lors de tentative de modification après le coup d'envoi.")

        # Les anciens choix n'ont pas été altérés
        db.refresh(first_match)
        res_verify_unaltered = client.get("/api/season/predictions", headers=headers)
        assert res_verify_unaltered.json()["nba_champion"] == "Oklahoma City"
        print("-> [OK] Intégrité préservée : les choix enregistrés avant le verrouillage restent intacts.")

    finally:
        # Restauration de l'état d'origine de la base de données
        first_match.deadline = original_deadline
        first_match.status = original_status
        db.commit()
        db.close()

    # 9. Vérification des composants UI dans index.html et app.js
    res_index = client.get("/")
    assert "season-banner-container" in res_index.text, "index.html doit contenir le conteneur de bannière d'avant-saison."
    assert "season-modal" in res_index.text, "index.html doit contenir la modale d'avant-saison."
    assert "season-champion" in res_index.text, "index.html doit contenir le champ de sélection du Champion NBA."
    assert "season-cup" in res_index.text, "index.html doit contenir le champ In-Season Tournament."
    assert "season-mvp" in res_index.text, "index.html doit contenir le champ MVP."
    assert "season-dpoy" in res_index.text, "index.html doit contenir le champ DPOY."
    assert "season-roy" in res_index.text, "index.html doit contenir le champ ROY."

    res_js = client.get("/static/js/app.js")
    assert "renderSeasonBanner" in res_js.text, "app.js doit contenir la fonction renderSeasonBanner."
    assert "openSeasonModal" in res_js.text, "app.js doit exposer openSeasonModal."
    assert "handleSeasonSubmit" in res_js.text, "app.js doit gérer la soumission des pronostics."
    assert "Pronostics de Saison" in res_js.text, "app.js doit afficher la carte de saison dans le Profil."
    print("-> [OK] Éléments UI (bannière dynamique, modale 5 choix, affichage profil) vérifiés.")

    print("===========================================================================")
    print("TOUS LES TESTS DU CHANTIER 3 (PRONOSTICS DE SAISON) ONT RÉUSSI SANS ERREUR !")
    print("===========================================================================")

if __name__ == "__main__":
    test_chantier3_season_predictions()
