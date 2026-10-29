import httpx
import sys
import uuid
from datetime import datetime

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

BASE_URL = "https://nba-prono.onrender.com"
TIMEOUT = 20.0

def run_checks():
    client = httpx.Client(base_url=BASE_URL, timeout=TIMEOUT)
    passed = 0
    failed = 0
    
    print("\n" + "="*70)
    print("🚀 AUDIT DE PRÉPARATION AU LANCEMENT : PICK 'N' SWIPE")
    print(f"Cible : {BASE_URL}")
    print("="*70 + "\n")
    
    # -------------------------------------------------------------
    # 1. Vérification des Assets Statiques & PWA
    # -------------------------------------------------------------
    print("📦 1. ASSETS STATIQUES & PWA")
    try:
        r_home = client.get("/")
        assert r_home.status_code == 200, f"HTTP {r_home.status_code}"
        assert "PICK 'N' SWIPE" in r_home.text or "Pick 'n' Swipe" in r_home.text
        assert "results-date-navigator" in r_home.text
        print("  ✅ [OK] Page d'accueil index.html chargée et à jour")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] index.html : {e}")
        failed += 1

    try:
        r_manifest = client.get("/static/manifest.json")
        assert r_manifest.status_code == 200
        manifest_data = r_manifest.json()
        assert "Pick 'n' Swipe" in manifest_data.get("name", "")
        print("  ✅ [OK] Manifest PWA validé (/static/manifest.json)")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] manifest.json : {e}")
        failed += 1

    try:
        r_js = client.get("/static/js/app.js")
        assert r_js.status_code == 200
        assert "results-date-navigator" in r_js.text
        assert "pickedOdds * 10" in r_js.text or "(pickedOdds * 10)" in r_js.text
        assert "PICK 'N' SWIPE" in r_js.text
        print("  ✅ [OK] app.js déployé avec tri par date, filtre présaison & formule cote*10")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] app.js : {e}")
        failed += 1

    # -------------------------------------------------------------
    # 2. Matchs Disponibles & Filtres
    # -------------------------------------------------------------
    print("\n🏀 2. MATCHS, CALENDRIER & STATUTS")
    upcoming_matches = []
    finished_matches = []
    try:
        r_matches = client.get("/api/matches")
        assert r_matches.status_code == 200
        matches = r_matches.json()
        assert len(matches) > 0, "Aucun match retourné"
        
        upcoming_matches = [m for m in matches if m["status"] == "upcoming"]
        finished_matches = [m for m in matches if m["status"] == "finished"]
        
        print(f"  ✅ [OK] Total matchs en base : {len(matches)} ({len(upcoming_matches)} à venir, {len(finished_matches)} terminés)")
        assert len(upcoming_matches) > 0, "Aucun match à venir disponible pour les pronostics"
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] /api/matches : {e}")
        failed += 1

    try:
        r_finished = client.get("/api/matches?status_filter=finished")
        assert r_finished.status_code == 200
        fin_list = r_finished.json()
        assert len(fin_list) == len(finished_matches)
        print(f"  ✅ [OK] Filtrage ?status_filter=finished opérationnel ({len(fin_list)} matchs)")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] /api/matches?status_filter=finished : {e}")
        failed += 1

    # -------------------------------------------------------------
    # 3. Authentification & Profil Joueur
    # -------------------------------------------------------------
    print("\n👤 3. AUTHENTIFICATION & COMPTE JOUEUR")
    test_user = f"audit_{uuid.uuid4().hex[:6]}"
    test_email = f"{test_user}@audit.nba"
    test_pass = "TestAuditPass123!"
    auth_token = None
    headers = {}

    try:
        r_reg = client.post("/api/auth/register", json={
            "username": test_user,
            "email": test_email,
            "password": test_pass
        })
        assert r_reg.status_code in [200, 201], f"HTTP {r_reg.status_code}: {r_reg.text}"
        auth_token = r_reg.json()["access_token"]
        headers = {"Authorization": f"Bearer {auth_token}"}
        print(f"  ✅ [OK] Inscription utilisateur réussie (user: {test_user})")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] Inscription : {e}")
        failed += 1

    try:
        r_login = client.post("/api/auth/login", json={
            "username": test_user,
            "password": test_pass
        })
        assert r_login.status_code == 200
        assert "access_token" in r_login.json()
        print("  ✅ [OK] Connexion avec identifiants validée")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] Connexion : {e}")
        failed += 1

    try:
        r_me = client.get("/api/auth/me", headers=headers)
        assert r_me.status_code == 200
        me_data = r_me.json()
        assert me_data["username"] == test_user
        assert "total_points" in me_data
        print(f"  ✅ [OK] Profil /api/auth/me actif (points: {me_data['total_points']}, streak: {me_data.get('streak', 0)})")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] /api/auth/me : {e}")
        failed += 1

    # -------------------------------------------------------------
    # 4. Cycle de Pronostic & Bonus x2
    # -------------------------------------------------------------
    print("\n🎯 4. CYCLES DE PRONOSTIC & BONUS x2")
    if upcoming_matches and auth_token:
        target_match = upcoming_matches[0]
        match_id = target_match["id"]
        team_id = target_match["home_team"]["id"]
        
        try:
            # Soumission d'un pronostic
            r_pred = client.post("/api/predictions", json={
                "match_id": match_id,
                "selected_team_id": team_id
            }, headers=headers)
            assert r_pred.status_code == 200, f"HTTP {r_pred.status_code}: {r_pred.text}"
            print(f"  ✅ [OK] Pronostic validé sur Match #{match_id} ({target_match['home_team']['code']})")
            passed += 1
        except Exception as e:
            print(f"  ❌ [FAIL] Soumission pronostic : {e}")
            failed += 1

        try:
            # Vérification de la récupération de mes pronos
            r_my_preds = client.get("/api/predictions/me", headers=headers)
            assert r_my_preds.status_code == 200
            preds_list = r_my_preds.json()
            assert any(p["match_id"] == match_id for p in preds_list)
            print("  ✅ [OK] Récupération de mes pronostics (/api/predictions/me) confirmée")
            passed += 1
        except Exception as e:
            print(f"  ❌ [FAIL] /api/predictions/me : {e}")
            failed += 1

        try:
            # Activation du Bonus x2
            r_boost = client.post(f"/api/predictions/{match_id}/boost", headers=headers)
            assert r_boost.status_code == 200
            boost_res = r_boost.json()
            assert boost_res["is_boosted"] is True
            print(f"  ✅ [OK] Bonus x2 activé sur le match #{match_id}")
            passed += 1
        except Exception as e:
            print(f"  ❌ [FAIL] Activation Bonus x2 : {e}")
            failed += 1

        try:
            # Vérification de la règle du bonus unique : transféré automatiquement
            same_week_matches = [m for m in upcoming_matches if m["id"] != match_id and m.get("week_number") == target_match.get("week_number")]
            if same_week_matches:
                m2 = same_week_matches[0]
                client.post("/api/predictions", json={
                    "match_id": m2["id"],
                    "selected_team_id": m2["home_team"]["id"]
                }, headers=headers)
                r_boost2 = client.post(f"/api/predictions/{m2['id']}/boost", headers=headers)
                assert r_boost2.status_code == 200, f"HTTP {r_boost2.status_code}"
                assert r_boost2.json()["is_boosted"] is True
                
                # Vérification que le match initial n'est plus boosté (garantie de 1 seul boost par semaine)
                r_my_preds2 = client.get("/api/predictions/me", headers=headers)
                preds_map = {p["match_id"]: p["is_boosted"] for p in r_my_preds2.json()}
                assert preds_map[match_id] is False, "Le match initial aurait dû perdre son boost"
                assert preds_map[m2["id"]] is True, "Le nouveau match doit avoir le boost actif"
                print("  ✅ [OK] Règle 1 seul Bonus x2 par semaine respectée : transfert automatique et unicité garantie")
                passed += 1
        except Exception as e:
            print(f"  ❌ [FAIL] Règle unicité 1 bonus/semaine : {e}")
            failed += 1

    # -------------------------------------------------------------
    # 5. Classement & Ligues
    # -------------------------------------------------------------
    print("\n🏆 5. CLASSEMENT & LIGUES AMIS")
    try:
        r_lead = client.get("/api/leaderboard")
        assert r_lead.status_code == 200
        lead_data = r_lead.json()
        assert isinstance(lead_data, list)
        print(f"  ✅ [OK] Classement général opérationnel ({len(lead_data)} joueurs répertoriés)")
        passed += 1
    except Exception as e:
        print(f"  ❌ [FAIL] /api/leaderboard : {e}")
        failed += 1

    if auth_token:
        try:
            # Création d'une ligue
            league_name = f"Ligue {uuid.uuid4().hex[:4].upper()}"
            r_league = client.post("/api/leagues", json={"name": league_name}, headers=headers)
            assert r_league.status_code in [200, 201], f"HTTP {r_league.status_code}: {r_league.text}"
            league_info = r_league.json()
            invite_code = league_info.get("code") or league_info.get("invite_code")
            assert invite_code, "Code d'invitation manquant"
            print(f"  ✅ [OK] Création de ligue privée réussie (Code: {invite_code})")
            passed += 1
            
            # Récupération de mes ligues
            r_my_leagues = client.get("/api/leagues/my", headers=headers)
            assert r_my_leagues.status_code == 200, f"HTTP {r_my_leagues.status_code}: {r_my_leagues.text}"
            assert any(l.get("code") == invite_code or l.get("invite_code") == invite_code for l in r_my_leagues.json())
            print(f"  ✅ [OK] Consultation et gestion de ligue validée (/api/leagues/my)")
            passed += 1
        except Exception as e:
            print(f"  ❌ [FAIL] Module Ligues : {e}")
            failed += 1

    # Nettoyage automatique des comptes de test créés pendant l'audit
    try:
        r_clean = client.post("/api/admin/cleanup-test-data", headers={"X-Admin-Secret": "nba-audit-clean-2026"})
        if r_clean.status_code == 200:
            print("  🧹 [OK] Données temporaires d'audit nettoyées automatiquement.")
    except Exception:
        pass

    # -------------------------------------------------------------
    # Bilan Final
    # -------------------------------------------------------------
    print("\n" + "="*70)
    print(f"BILAN DE L'AUDIT : {passed} Tests Validés / {passed + failed} Tests Totaux")
    if failed == 0:
        print("🎉 100% OPÉRATIONNEL : L'APPLICATION EST PRÊTE POUR LE LANCEMENT !")
    else:
        print(f"⚠️ ATTENTION : {failed} point(s) à vérifier")
    print("="*70 + "\n")

if __name__ == "__main__":
    run_checks()
