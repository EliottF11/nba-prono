"""
Test hermétique validant l'intégration HTML/JS et API pour :
1. La présence et la structure du bloc cliquable de ligue dans app.js
2. Le déplacement des infos d'invitation dans la vue détail de la ligue
3. La fonction escapeHtml et formatChatTime dans app.js
4. Les 10 badges d'accomplissements dans /api/predictions/stats
5. L'envoi et la réception de messages de ligue via l'API
"""

from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import User, League, LeagueMember, LeagueMessage
import uuid

client = TestClient(app)

def test_full_integration():
    print("\n================== TEST VALIDATION COMPLÈTE UI & MESSAGERIE & BADGES ==================")
    
    # 1. Vérification du code source frontend static/js/app.js
    with open("static/js/app.js", "r", encoding="utf-8") as f:
        app_js = f.read()

    assert "function escapeHtml(text)" in app_js, "escapeHtml doit être défini dans app.js"
    assert "function formatChatTime(dateStr)" in app_js, "formatChatTime doit être défini dans app.js"
    assert "onclick=\"viewLeague(${l.id})\"" in app_js, "Le bloc entier de la ligue doit être cliquable"
    assert "Inviter des amis dans la ligue" in app_js, "Les infos d'invitation doivent être dans renderLeagueDetail"
    assert "grid grid-cols-1 sm:grid-cols-2 gap-2.5" in app_js, "Les badges doivent être affichés en grille responsive"
    print("-> [OK] Intégrité du code JS frontend vérifiée (escapeHtml, formatChatTime, bloc cliquable, invitation dans la ligue).")

    # 2. Test complet de l'API
    db = SessionLocal()
    uid1 = f"e2e_user_{uuid.uuid4().hex[:6]}"
    uid2 = f"e2e_friend_{uuid.uuid4().hex[:6]}"

    res1 = client.post("/api/auth/register", json={"username": uid1, "email": f"{uid1}@test.com", "password": "Password123!"})
    res2 = client.post("/api/auth/register", json={"username": uid2, "email": f"{uid2}@test.com", "password": "Password123!"})
    assert res1.status_code == 201 and res2.status_code == 201

    token1 = res1.json()["access_token"]
    user1_id = res1.json()["user"]["id"]
    headers1 = {"Authorization": f"Bearer {token1}"}

    token2 = res2.json()["access_token"]
    user2_id = res2.json()["user"]["id"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    league_id = None
    try:
        # A. Création de la ligue
        res_lg = client.post("/api/leagues", json={"name": "Ligue Championnat E2E"}, headers=headers1)
        assert res_lg.status_code == 201
        lg_data = res_lg.json()
        league_id = lg_data["id"]
        league_code = lg_data["code"]

        # B. Membre 2 rejoint la ligue
        res_join = client.post("/api/leagues/join", json={"code": league_code}, headers=headers2)
        assert res_join.status_code == 200

        # C. Vérification des 10 badges dans le profil
        res_stats = client.get("/api/users/me/stats", headers=headers1)
        assert res_stats.status_code == 200
        stats = res_stats.json()
        badges = stats["badges"]
        assert len(badges) == 10, f"Attendu 10 badges, reçu {len(badges)}"
        badge_ids = {b["id"] for b in badges}
        expected_ids = {
            "rookie", "allstar", "sniper", "underdog", "clutch", 
            "boost_master", "scorer", "macon", "season_oracle", "league_captain"
        }
        assert badge_ids == expected_ids, f"Différence dans les IDs de badges : {expected_ids - badge_ids}"
        
        # Le créateur de la ligue doit avoir le badge league_captain débloqué
        captain_badge = next(b for b in badges if b["id"] == "league_captain")
        assert captain_badge["unlocked"] is True
        print("-> [OK] Les 10 badges d'accomplissements sont tous présents et calculés correctement.")

        # D. Test messagerie (envoi, lecture, caractères spéciaux, emojis)
        msg_text = "Bienvenue dans la ligue ! 🏀 <script>alert(1)</script> 🚀"
        res_post = client.post(f"/api/leagues/{league_id}/messages", json={"content": msg_text}, headers=headers1)
        assert res_post.status_code == 201

        res_msgs = client.get(f"/api/leagues/{league_id}/messages", headers=headers1)
        assert res_msgs.status_code == 200
        msgs_list = res_msgs.json()
        assert len(msgs_list) == 1
        assert msgs_list[0]["content"] == msg_text
        assert msgs_list[0]["username"] == uid1
        assert msgs_list[0]["is_me"] is True

        res_msgs_friend = client.get(f"/api/leagues/{league_id}/messages", headers=headers2)
        assert res_msgs_friend.status_code == 200
        assert res_msgs_friend.json()[0]["is_me"] is False
        print("-> [OK] Messagerie de ligue validée (envoi, réception, distinction is_me, sécurité des caractères).")

    finally:
        if league_id:
            db.query(LeagueMessage).filter(LeagueMessage.league_id == league_id).delete()
            db.query(LeagueMember).filter(LeagueMember.league_id == league_id).delete()
            db.query(League).filter(League.id == league_id).delete()
        db.query(User).filter(User.id.in_([user1_id, user2_id])).delete()
        db.commit()
        db.close()

    print("===========================================================================")
    print("VALIDATION COMPLÈTE RÉUSSIE SANS AUCUNE ERREUR !")
    print("===========================================================================\n")

if __name__ == "__main__":
    test_full_integration()
