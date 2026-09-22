"""
Test automatisé hermétique pour la messagerie des ligues (Mur de chambrage)
et les nouveaux badges d'accomplissements.
"""

import uuid
from starlette.testclient import TestClient

from main import app
from database import SessionLocal
from models import User, League, LeagueMember, LeagueMessage

client = TestClient(app)

def test_leagues_chat_and_accomplishments():
    print("\n================== TEST : MESSAGERIE DE LIGUE & ACCOMPLISSEMENTS ==================")
    db = SessionLocal()

    uid1 = f"chat_user1_{uuid.uuid4().hex[:6]}"
    uid2 = f"chat_user2_{uuid.uuid4().hex[:6]}"
    uid3 = f"chat_user3_{uuid.uuid4().hex[:6]}"

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

    league_id = None

    try:
        # 1. Créer une ligue
        res_create = client.post("/api/leagues", json={"name": "Test Chat League"}, headers=headers1)
        assert res_create.status_code == 201
        league_data = res_create.json()
        league_id = league_data["id"]
        league_code = league_data["code"]
        print(f"-> [OK] Ligue créée : id={league_id}, code={league_code}")

        # Membre 2 rejoint
        res_join = client.post("/api/leagues/join", json={"code": league_code}, headers=headers2)
        assert res_join.status_code == 200
        print("-> [OK] Membre 2 a rejoint la ligue.")

        # 2. Vérifier badge Capitaine de Ligue pour user1 et user2
        stats1 = client.get("/api/users/me/stats", headers=headers1).json()
        badges_map1 = {b["id"]: b for b in stats1["badges"]}
        assert badges_map1["league_captain"]["unlocked"] is True
        assert badges_map1["league_captain"]["current"] == 1
        print("-> [OK] Badge 'Capitaine de Ligue' DÉBLOQUÉ pour le créateur de ligue.")

        stats3 = client.get("/api/users/me/stats", headers=headers3).json()
        badges_map3 = {b["id"]: b for b in stats3["badges"]}
        assert badges_map3["league_captain"]["unlocked"] is False
        print("-> [OK] Badge 'Capitaine de Ligue' bien verrouillé pour un utilisateur sans ligue.")

        # 3. Récupération des messages initiale (vide)
        res_msgs_empty = client.get(f"/api/leagues/{league_id}/messages", headers=headers1)
        assert res_msgs_empty.status_code == 200
        assert len(res_msgs_empty.json()) == 0
        print("-> [OK] Historique des messages vide initialement.")

        # 4. Poster un message depuis user1
        msg1_text = "Préparez vos mouchoirs pour ce soir ! 🔥"
        res_post1 = client.post(f"/api/leagues/{league_id}/messages", json={"content": msg1_text}, headers=headers1)
        assert res_post1.status_code == 201
        data_p1 = res_post1.json()
        assert data_p1["content"] == msg1_text
        assert data_p1["username"] == uid1
        assert data_p1["is_me"] is True
        print(f"-> [OK] Message posté par {uid1} : '{msg1_text}'")

        # 5. Poster un message depuis user2
        msg2_text = "MDR tu vas encore faire 0/5 ce soir 🗑️"
        res_post2 = client.post(f"/api/leagues/{league_id}/messages", json={"content": msg2_text}, headers=headers2)
        assert res_post2.status_code == 201
        print(f"-> [OK] Réponse postée par {uid2} : '{msg2_text}'")

        # 6. Récupérer l'historique complet pour user1
        res_hist1 = client.get(f"/api/leagues/{league_id}/messages", headers=headers1)
        assert res_hist1.status_code == 200
        msgs = res_hist1.json()
        assert len(msgs) == 2
        assert msgs[0]["content"] == msg1_text
        assert msgs[0]["is_me"] is True
        assert msgs[1]["content"] == msg2_text
        assert msgs[1]["is_me"] is False
        print("-> [OK] Historique complet vérifié pour user1 (is_me correct pour chaque message).")

        # 7. Vérifier rejet si non membre (user3)
        res_outsider_get = client.get(f"/api/leagues/{league_id}/messages", headers=headers3)
        assert res_outsider_get.status_code == 403
        res_outsider_post = client.post(f"/api/leagues/{league_id}/messages", json={"content": "Hacker"}, headers=headers3)
        assert res_outsider_post.status_code == 403
        print("-> [OK] Sécurité confirmée : accès refusé (403) aux non-membres de la ligue.")

        # 8. Vérifier rejet de message vide
        res_empty_post = client.post(f"/api/leagues/{league_id}/messages", json={"content": "   "}, headers=headers1)
        assert res_empty_post.status_code in [400, 422]
        print("-> [OK] Validation confirmée : message vide rejeté.")

    finally:
        if league_id:
            db.query(LeagueMessage).filter(LeagueMessage.league_id == league_id).delete()
            db.query(LeagueMember).filter(LeagueMember.league_id == league_id).delete()
            db.query(League).filter(League.id == league_id).delete()
        db.query(User).filter(User.id.in_([user1_id, user2_id, user3_id])).delete()
        db.commit()
        db.close()

    print("===========================================================================")
    print("TOUS LES TESTS DE MESSAGERIE ET DE BADGES ONT RÉUSSI SANS ERREUR !")
    print("===========================================================================")
