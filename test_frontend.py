"""
Test d'intégration du service front-end.
Vérifie que :
1. La page d'accueil (GET /) renvoie bien le fichier HTML mobile-first (200 OK)
2. Les fichiers statiques CSS (/static/css/style.css) et JS (/static/js/api.js, /static/js/app.js) sont bien servis
"""
from starlette.testclient import TestClient
from main import app

client = TestClient(app)

def test_frontend_serving():
    print("================== TEST DU SERVICE FRONT-END ==================")
    
    # 1. Page racine
    res_index = client.get("/")
    assert res_index.status_code == 200, f"Erreur GET /: {res_index.status_code}"
    assert "PRONO" in res_index.text, "Le titre HTML doit être présent."
    assert "matches-list" in res_index.text, "Le conteneur de matchs doit être présent."
    assert "leaderboard-view" in res_index.text, "Le conteneur de classement doit être présent."
    print("-> [OK] La page d'accueil HTML est servie à la racine avec succès (HTTP 200).")

    # 2. CSS
    res_css = client.get("/static/css/style.css")
    assert res_css.status_code == 200
    assert "--brand-orange" in res_css.text
    print("-> [OK] Feuille de style /static/css/style.css disponible (HTTP 200).")

    # 3. JS Client API
    res_api_js = client.get("/static/js/api.js")
    assert res_api_js.status_code == 200
    assert "makePrediction" in res_api_js.text
    print("-> [OK] Script /static/js/api.js disponible (HTTP 200).")

    # 4. JS Application
    res_app_js = client.get("/static/js/app.js")
    assert res_app_js.status_code == 200
    assert "voteForTeam" in res_app_js.text
    print("-> [OK] Script /static/js/app.js disponible (HTTP 200).")

    print("================================================================")
    print("TOUS LES ASSETS FRONT-END SONT PARFAITEMENT DÉPLOYÉS ET SERVIS !")
    print("================================================================")

if __name__ == "__main__":
    test_frontend_serving()
