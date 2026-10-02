import os
import httpx
from starlette.testclient import TestClient
from main import app
from routers.auth_router import AVAILABLE_AVATARS

client = TestClient(app)

def test_avatars_and_static_files():
    print("-> 1. Vérification de la liste des avatars (/api/auth/avatars)...")
    res = client.get("/api/auth/avatars")
    assert res.status_code == 200
    avatars = res.json()
    
    assert len(avatars) == 25, f"Attendu 25 avatars, reçu {len(avatars)}"
    
    old_ids = {"westbrook_confused", "emo_jimmy", "shaq_peace", "lebron_grin", "young_lebron", "alonzo_acceptance", "harden_side_eye"}
    for a in avatars:
        assert a["id"] not in old_ids, f"Un ancien avatar indésirable est présent : {a['id']}"
        # Vérification de l'existence physique de l'image
        rel_path = a["url"].lstrip("/")
        assert os.path.exists(rel_path), f"Fichier d'avatar manquant sur le disque : {rel_path}"
        # Vérification du service HTTP statique
        img_res = client.get(a["url"])
        assert img_res.status_code == 200, f"Erreur HTTP pour l'image : {a['url']}"
    print(f"   [OK] Les {len(avatars)} avatars sont tous valides, les anciens sont éliminés et tous les fichiers sont servis !")

def test_html_splash_and_onboarding():
    print("-> 2. Vérification du code HTML (Splash Screen & Portail d'accueil)...")
    res = client.get("/")
    assert res.status_code == 200
    html = res.text
    
    # Splash Screen
    assert 'id="app-splash-screen"' in html, "Écran d'animation de lancement (Splash Screen) manquant dans le HTML"
    assert 'splash-ball-wrapper' in html, "Animation du ballon de basket manquante"
    assert 'splash-progress-track' in html, "Barre de progression du splash manquante"
    assert 'dismissSplashScreen()' in html, "Fonction de fermeture du splash manquante"
    
    # Portail Accueil & Auth
    assert 'id="auth-modal"' in html, "Modale d'authentification manquante"
    assert 'id="auth-view-welcome"' in html, "Vue d'accueil (Welcome Portal) manquante"
    assert 'id="auth-view-register"' in html, "Vue d'inscription avec choix d'avatar manquante"
    assert 'id="auth-view-login"' in html, "Vue de connexion manquante"
    assert 'id="welcome-avatars-track"' in html, "Bandeau défilant des avatars stars manquant"
    assert 'id="reg-avatars-picker"' in html, "Sélecteur d'avatar pour l'inscription manquant"
    print("   [OK] Splash screen et portail d'onboarding professionnel validés dans le HTML !")

def test_registration_with_avatar():
    print("-> 3. Test de création de compte avec choix direct d'avatar NBA...")
    import uuid
    uid = f"pro_nba_{uuid.uuid4().hex[:6]}"
    chosen_avatar = "/static/avatars/wembanyama_spurs.jpg"
    
    reg_res = client.post("/api/auth/register", json={
        "username": uid,
        "email": f"{uid}@example.com",
        "password": "Password123!",
        "avatar_url": chosen_avatar
    })
    assert reg_res.status_code == 201, f"Échec de l'inscription : {reg_res.text}"
    data = reg_res.json()
    assert data["user"]["avatar_url"] == chosen_avatar, f"Avatar mal enregistré : {data['user']['avatar_url']}"
    token = data["access_token"]
    
    # Test /api/auth/me
    headers = {"Authorization": f"Bearer {token}"}
    me_res = client.get("/api/auth/me", headers=headers)
    assert me_res.status_code == 200
    assert me_res.json()["avatar_url"] == chosen_avatar
    
    # Test changement d'avatar vers Curry
    new_avatar = "/static/avatars/curry_warriors.jpg"
    up_res = client.put("/api/auth/avatar", json={"avatar_url": new_avatar}, headers=headers)
    assert up_res.status_code == 200
    assert up_res.json()["avatar_url"] == new_avatar
    
    print(f"   [OK] Inscription avec avatar {chosen_avatar} et mise à jour vers {new_avatar} validées avec succès !")

if __name__ == "__main__":
    print("================== VÉRIFICATION COMPLÈTE DU NOUVEAU SYSTÈME ==================")
    test_avatars_and_static_files()
    test_html_splash_and_onboarding()
    test_registration_with_avatar()
    print("==============================================================================")
    print("TOUTES LES FONCTIONNALITÉS DEMANDÉES SONT VALIDÉES ET OPÉRATIONNELLES !")
    print("==============================================================================")
