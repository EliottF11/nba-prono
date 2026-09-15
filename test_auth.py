"""
Script de test unitaire et d'intégration pour le module d'authentification.
Valide le hachage sécurisé, la création/décodage de tokens, et les endpoints API :
- Inscription (succès & rejet des doublons)
- Connexion (mot de passe valide & mauvais mot de passe)
- Consultation du profil /me avec et sans token Bearer
"""
import sys
from starlette.testclient import TestClient
from main import app
from auth import hash_password, verify_password, create_access_token, decode_access_token

client = TestClient(app)

def test_unit_security():
    print("-> Test unitaire de sécurité (hachage et tokens)...")
    pwd = "MonSuperMotDePasse2026!"
    hashed = hash_password(pwd)
    
    assert hashed != pwd, "Le mot de passe doit être haché."
    assert verify_password(pwd, hashed) is True, "Le bon mot de passe doit être validé."
    assert verify_password("MauvaisMotDePasse", hashed) is False, "Un faux mot de passe doit être rejeté."
    
    # Test token
    token = create_access_token(user_id=42, username="lebron")
    decoded = decode_access_token(token)
    assert decoded is not None, "Le token doit être valide."
    assert decoded["user_id"] == 42, "L'user_id doit correspondre."
    assert decoded["username"] == "lebron", "Le username doit correspondre."
    print("   [OK] Hachage et signature de tokens validés.")

def test_api_auth():
    print("-> Test des routes API d'authentification (/api/auth)...")
    
    import time
    uid = int(time.time())
    test_user = f"curry_{uid}"
    test_email = f"curry_{uid}@warriors.com"
    test_pwd = "golden_state_champ"

    # 1. Inscription
    res_reg = client.post("/api/auth/register", json={"username": test_user, "email": test_email, "password": test_pwd})
    assert res_reg.status_code == 201, f"Erreur inscription: {res_reg.text}"
    data = res_reg.json()
    assert "access_token" in data, "Le token doit être renvoyé à l'inscription."
    assert data["user"]["username"] == test_user
    assert data["user"]["email"] == test_email
    print(f"   [OK] Inscription réussie pour '{test_user}' avec email '{test_email}'.")

    # 2. Rejet doublon email ou pseudo
    res_dup = client.post("/api/auth/register", json={"username": test_user, "email": "autre@warriors.com", "password": "any_password"})
    assert res_dup.status_code == 400, "Le doublon de pseudo doit renvoyer HTTP 400."
    print("   [OK] Rejet correct d'un pseudo déjà existant (HTTP 400).")

    # 3. Connexion faux mot de passe
    res_fail = client.post("/api/auth/login", json={"username": test_user, "password": "wrong_password"})
    assert res_fail.status_code == 401, "Mauvais mot de passe doit renvoyer HTTP 401."
    print("   [OK] Rejet correct d'un mot de passe erroné (HTTP 401).")

    # 4. Connexion par pseudo
    res_login_pseudo = client.post("/api/auth/login", json={"username": test_user, "password": test_pwd})
    assert res_login_pseudo.status_code == 200, f"Erreur login pseudo: {res_login_pseudo.text}"
    token = res_login_pseudo.json()["access_token"]
    print("   [OK] Connexion réussie via PSEUDO (HTTP 200).")

    # 5. Connexion par EMAIL
    res_login_email = client.post("/api/auth/login", json={"username": test_email, "password": test_pwd})
    assert res_login_email.status_code == 200, f"Erreur login email: {res_login_email.text}"
    print("   [OK] Connexion réussie via ADRESSE EMAIL (HTTP 200).")

    # 5. Route protégée /me avec token
    headers = {"Authorization": f"Bearer {token}"}
    res_me = client.get("/api/auth/me", headers=headers)
    assert res_me.status_code == 200, f"Erreur /me: {res_me.text}"
    assert res_me.json()["username"] == test_user
    print(f"   [OK] Accès autorisé à /me pour {res_me.json()['username']} (HTTP 200).")

    # 6. Route protégée /me sans token
    res_me_anon = client.get("/api/auth/me")
    assert res_me_anon.status_code == 401, "Accès anonyme à /me doit être rejeté (HTTP 401)."
    print("   [OK] Rejet correct de la route protégée sans token (HTTP 401).")

if __name__ == "__main__":
    test_unit_security()
    test_api_auth()
    print("\n==========================================")
    print("TOUS LES TESTS D'AUTHENTIFICATION ONT REUSSI !")
    print("==========================================")
