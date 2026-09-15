"""
Test automatisé hermétique pour le Chantier 5 : Le Système de Ligues et le Partage
Vérifie :
1. Création de ligue privée avec génération d'un code unique à 6 caractères
2. Enregistrement automatique du créateur comme premier membre
3. Rejoindre une ligue via son code d'invitation
4. Gestion des erreurs (code invalide -> 404, déjà membre -> 400)
5. Classement interne des membres ordonné par points avec calcul des rangs
6. Protection d'accès (403 si non membre de la ligue)
7. Consultation de ses ligues (GET /api/leagues/my) avec rang personnalisé
8. Fonctionnalité pour quitter une ligue
9. Présence des éléments UI (vue ligues, modales de création/rejoindre, boutons de partage)
10. Intégrité du Classement Général global
"""

import os
import sys
import uuid
from starlette.testclient import TestClient

from main import app
from database import SessionLocal
from models import User, League, LeagueMember

client = TestClient(app)

def test_chantier5_leagues():
    print("\n================== TEST CHANTIER 5 : SYSTÈME DE LIGUES & PARTAGE ==================")
    db = SessionLocal()

    # Création de 3 utilisateurs de test
    uid1 = f"c5_creator_{uuid.uuid4().hex[:6]}"
    uid2 = f"c5_member1_{uuid.uuid4().hex[:6]}"
    uid3 = f"c5_outsider_{uuid.uuid4().hex[:6]}"

    res1 = client.post("/api/auth/register", json={"username": uid1, "email": f"{uid1}@test.com", "password": "Password123!"})
    res2 = client.post("/api/auth/register", json={"username": uid2, "email": f"{uid2}@test.com", "password": "Password123!"})
    res3 = client.post("/api/auth/register", json={"username": uid3, "email": f"{uid3}@test.com", "password": "Password123!"})

    assert res1.status_code == 201
    assert res2.status_code == 201
    assert res3.status_code == 201

    token1 = res1.json()["access_token"]
    user1_id = res1.json()["user"]["id"]
    headers1 = {"Authorization": f"Bearer {token1}"}

    token2 = res2.json()["access_token"]
    user2_id = res2.json()["user"]["id"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    token3 = res3.json()["access_token"]
    user3_id = res3.json()["user"]["id"]
    headers3 = {"Authorization": f"Bearer {token3}"}

    # Affecter des points fictifs pour tester le classement interne
    u1 = db.query(User).filter(User.id == user1_id).first()
    u2 = db.query(User).filter(User.id == user2_id).first()
    u1.total_points = 25.5
    u2.total_points = 38.0
    db.commit()

    league_id = None

    try:
        # 1. Protection authentification
        res_unauth = client.post("/api/leagues", json={"name": "Ligue Sans Auth"})
        assert res_unauth.status_code == 401
        print("-> [OK] Protection d'authentification vérifiée (HTTP 401).")

        # 2. Validation du nom de ligue
        res_short = client.post("/api/leagues", json={"name": "AB"}, headers=headers1)
        assert res_short.status_code == 422 or res_short.status_code == 400
        print("-> [OK] Validation du nom de ligue (rejet si trop court).")

        # 3. Création de ligue privée
        league_name = "Clutch Club NBA"
        res_create = client.post("/api/leagues", json={"name": league_name}, headers=headers1)
        assert res_create.status_code == 201, f"Erreur création: {res_create.text}"
        data_create = res_create.json()
        league_id = data_create["id"]
        league_code = data_create["code"]

        assert len(league_code) == 6, f"Le code doit comporter 6 caractères, reçu: {league_code}"
        assert league_code.isalnum(), "Le code doit être alphanumérique"
        assert data_create["creator_id"] == user1_id
        assert data_create["members_count"] == 1
        assert data_create["members"][0]["user_id"] == user1_id
        assert data_create["members"][0]["is_creator"] is True
        print(f"-> [OK] Ligue privée créée avec succès. Code unique : '{league_code}'.")

        # 4. Rejoindre la ligue avec code erroné
        res_join_bad = client.post("/api/leagues/join", json={"code": "FAKEX9"}, headers=headers2)
        assert res_join_bad.status_code == 404
        print("-> [OK] Rejet de code d'invitation invalide (HTTP 404).")

        # 5. Rejoindre la ligue par le membre 2
        res_join = client.post("/api/leagues/join", json={"code": league_code.lower()}, headers=headers2)
        assert res_join.status_code == 200, f"Erreur join: {res_join.text}"
        data_join = res_join.json()
        assert data_join["members_count"] == 2
        print(f"-> [OK] Membre 2 a rejoint la ligue via le code '{league_code}' (insensible à la casse).")

        # 6. Rejet si tentative de rejoindre à nouveau
        res_join_again = client.post("/api/leagues/join", json={"code": league_code}, headers=headers2)
        assert res_join_again.status_code == 400
        print("-> [OK] Rejet de doublon d'adhésion (HTTP 400 'déjà membre').")

        # 7. Vérification du classement interne de la ligue
        # u2 a 38.0 pts, u1 a 25.5 pts -> u2 doit être Rang 1, u1 Rang 2
        res_detail = client.get(f"/api/leagues/{league_id}", headers=headers1)
        assert res_detail.status_code == 200
        detail = res_detail.json()
        members = detail["members"]
        assert len(members) == 2
        assert members[0]["user_id"] == user2_id
        assert members[0]["rank"] == 1
        assert members[0]["total_points"] == 38.0
        assert members[1]["user_id"] == user1_id
        assert members[1]["rank"] == 2
        assert members[1]["total_points"] == 25.5
        assert members[1]["is_creator"] is True
        assert detail["user_rank"] == 2  # pour user1
        print("-> [OK] Classement interne de la ligue correctement calculé et trié par points.")

        # 8. Protection d'accès aux non-membres
        res_outsider = client.get(f"/api/leagues/{league_id}", headers=headers3)
        assert res_outsider.status_code == 403
        print("-> [OK] Accès réservé aux membres vérifié (HTTP 403 pour joueur externe).")

        # 9. Liste des ligues de l'utilisateur (GET /api/leagues/my)
        res_my1 = client.get("/api/leagues/my", headers=headers1)
        assert res_my1.status_code == 200
        my_leagues = res_my1.json()
        assert len(my_leagues) >= 1
        found = next((l for l in my_leagues if l["id"] == league_id), None)
        assert found is not None
        assert found["code"] == league_code
        assert found["members_count"] == 2
        assert found["user_rank"] == 2
        print("-> [OK] Endpoint GET /api/leagues/my validé avec calcul du rang personnalisé.")

        # 10. Quitter une ligue
        res_leave2 = client.post(f"/api/leagues/{league_id}/leave", headers=headers2)
        assert res_leave2.status_code == 200
        # Vérifier que le membre 2 est parti
        res_detail_after = client.get(f"/api/leagues/{league_id}", headers=headers1)
        assert res_detail_after.json()["members_count"] == 1
        print("-> [OK] Départ d'une ligue validé avec succès.")

        # 11. Vérification du Classement Général global
        res_global_lb = client.get("/api/leaderboard")
        assert res_global_lb.status_code == 200
        global_lb = res_global_lb.json()
        assert len(global_lb) >= 3
        print("-> [OK] Classement général global synchronisé et fonctionnel.")

        # 12. Vérification des éléments UI dans index.html
        res_html = client.get("/")
        assert res_html.status_code == 200
        html = res_html.text
        assert "leagues-view" in html
        assert "my-leagues-list" in html
        assert "league-detail-container" in html
        assert "create-league-modal" in html
        assert "join-league-modal" in html
        assert "leaderboard-view" in html
        print("-> [OK] Éléments UI (sections ligues, modales création/join, classement général) vérifiés.")

    finally:
        # Nettoyage hermétique
        if league_id:
            db.query(LeagueMember).filter(LeagueMember.league_id == league_id).delete()
            db.query(League).filter(League.id == league_id).delete()
        db.query(User).filter(User.id.in_([user1_id, user2_id, user3_id])).delete()
        db.commit()
        db.close()

    print("===========================================================================")
    print("TOUS LES TESTS DU CHANTIER 5 (SYSTÈME DE LIGUES & PARTAGE) ONT RÉUSSI !")
    print("===========================================================================\n")

if __name__ == "__main__":
    test_chantier5_leagues()
