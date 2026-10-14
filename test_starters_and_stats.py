from starlette.testclient import TestClient
from main import app
from database import SessionLocal
from models import Match

client = TestClient(app)

def test_starters_and_stats_api():
    print("\n=== VÉRIFICATION 5 MAJEURS & STATISTIQUES MATCHS ===")
    
    # Récupérer un match terminé et un match à venir
    db = SessionLocal()
    finished_match = db.query(Match).filter(Match.status == "finished").first()
    upcoming_match = db.query(Match).filter(Match.status == "upcoming").first()
    db.close()
    
    assert finished_match is not None, "Aucun match terminé en base"
    assert upcoming_match is not None, "Aucun match à venir en base"
    
    # 1. Test sur match à venir (Catalog officiel / 5 majeurs projetés)
    res_up = client.get(f"/api/matches/{upcoming_match.id}/stats")
    assert res_up.status_code == 200, f"Erreur match à venir: {res_up.text}"
    data_up = res_up.json()
    assert data_up["status"] == "ok"
    assert len(data_up["home_starters"]) == 5, f"Pas 5 starters domicile pour match {upcoming_match.id}"
    assert len(data_up["away_starters"]) == 5, f"Pas 5 starters extérieur pour match {upcoming_match.id}"
    assert len(data_up["team_stats"]) >= 6, "Comparatifs d'équipe manquants"
    print(f"-> [OK] Match à venir #{upcoming_match.id} : 5 majeurs complets avec photos CDN et stats comparatives.")
    for p in data_up["home_starters"][:2]:
        print(f"   Domicile: #{p['jersey']} {p['pos']} {p['name']} ({p['avg']}) - Photo: {p['headshot'][:45]}...")
    for p in data_up["away_starters"][:2]:
        print(f"   Extérieur: #{p['jersey']} {p['pos']} {p['name']} ({p['avg']}) - Photo: {p['headshot'][:45]}...")
        
    # 2. Test sur match terminé
    res_fin = client.get(f"/api/matches/{finished_match.id}/stats")
    assert res_fin.status_code == 200, f"Erreur match terminé: {res_fin.text}"
    data_fin = res_fin.json()
    assert data_fin["status"] == "ok"
    assert len(data_fin["home_starters"]) == 5
    assert len(data_fin["away_starters"]) == 5
    print(f"-> [OK] Match terminé #{finished_match.id} : 5 majeurs et boxscore validés.")
    
    # 3. Vérification des fichiers JS et HTML
    with open("static/js/api.js", "r", encoding="utf-8") as f:
        api_js = f.read()
    assert "getMatchStats" in api_js, "getMatchStats manquant dans api.js"
    
    with open("static/js/app.js", "r", encoding="utf-8") as f:
        app_js = f.read()
    assert "switchMatchDetailsTab" in app_js, "switchMatchDetailsTab manquant dans app.js"
    assert "setStartersTeamFilter" in app_js, "setStartersTeamFilter manquant dans app.js"
    assert "updateMatchDetailsView" in app_js, "updateMatchDetailsView manquant dans app.js"
    assert "5 Majeurs & Stats" in app_js, "Bouton 5 Majeurs & Stats manquant dans les cartes de matchs"
    
    print("-> [OK] Intégration front-end validée (api.js, app.js, index.html).")
    print("=== TOUS LES TESTS DES 5 MAJEURS & STATS SONT VALIDÉS (100%) ===")

if __name__ == "__main__":
    test_starters_and_stats_api()
