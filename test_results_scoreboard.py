import re
from starlette.testclient import TestClient
from main import app

client = TestClient(app)

def test_results_scoreboard_tv_and_neobrutalism():
    print("\n================== VÉRIFICATION ONGLET RÉSULTATS (SCORES TV US) ==================")

    # 1. Vérification HTML
    with open("static/index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Onglet dans la barre de navigation
    assert 'data-tab="results"' in html, "Onglet 'results' manquant dans la barre de navigation index.html"
    assert "Résultats" in html or "Scores" in html, "Texte de l'onglet manquant"
    print("-> [OK] Onglet de navigation 'Résultats' (Scores) présent dans index.html.")

    # Vue et conteneurs
    assert 'id="results-view"' in html, "Section results-view manquante dans index.html"
    assert 'id="results-scoreboard-list"' in html, "Conteneur results-scoreboard-list manquant"
    assert 'id="results-weeks-selector"' in html, "Sélecteur de semaines manquant dans results-view"
    assert 'id="match-result-modal"' in html, "Modale match-result-modal manquante dans index.html"
    assert 'id="match-result-modal-content"' in html, "Contenu de la modale manquant dans index.html"
    print("-> [OK] Vue 'results-view' et modale 'match-result-modal' présentes dans le HTML.")

    # 2. Vérification CSS
    with open("static/css/style.css", "r", encoding="utf-8") as f:
        css = f.read()

    # Bandeau de scoreboard horizontal
    assert ".tv-scoreboard-bar" in css, "Classe .tv-scoreboard-bar manquante dans style.css"
    assert "3px solid #000000" in css, "Bordure néo-brutaliste 3px manquante"
    assert "4px 4px 0px #000000" in css or "5px 5px 0px #000000" in css, "Ombre portée noire unie manquante"
    assert ".is-pressed" in css or ":active" in css, "Effet physique 'enfoncé' manquant dans style.css"

    # Blocs d'équipes & centre TV bug
    assert ".tv-team-block" in css, "Classe .tv-team-block manquante dans style.css"
    assert ".tv-team-code" in css, "Classe .tv-team-code manquante dans style.css"
    assert ".tv-team-score" in css, "Classe .tv-team-score manquante dans style.css"
    assert ".tv-center-bug" in css, "Classe .tv-center-bug manquante dans style.css"
    assert ".tv-logo-badge" in css, "Classe .tv-logo-badge manquante dans style.css"
    assert ".tv-logo-nba" in css, "Classe .tv-logo-nba manquante dans style.css"
    assert ".tv-logo-pro" in css, "Classe .tv-logo-pro manquante dans style.css"
    assert ".tv-status-final" in css, "Classe .tv-status-final manquante dans style.css"
    print("-> [OK] Design CSS TV US x Neo-Brutalisme (barres horizontales, bugs centraux, effet enfoncé) validé.")

    # 3. Vérification JavaScript
    with open("static/js/app.js", "r", encoding="utf-8") as f:
        js = f.read()

    assert "renderResultsView" in js, "Fonction renderResultsView manquante dans app.js"
    assert "getTeamSaturatedGradient" in js, "Fonction getTeamSaturatedGradient manquante dans app.js"
    assert "handleScoreboardClick" in js, "Fonction handleScoreboardClick manquante dans app.js"
    assert "openMatchResultDetails" in js, "Fonction openMatchResultDetails manquante dans app.js"
    assert "closeMatchResultDetails" in js, "Fonction closeMatchResultDetails manquante dans app.js"
    assert "resultsView.classList.toggle" in js, "Gestion d'affichage de results-view manquante dans selectTab"
    assert "tv-center-bug" in js, "Structure du bug central manquante dans app.js"
    assert "tv-team-block" in js, "Blocs d'équipes ext/dom manquants dans le template app.js"
    print("-> [OK] Logique JavaScript (dégradés saturés, clics physiques, détails du match) validée.")

    # 4. Vérification API des matchs terminés
    res = client.get("/api/matches?status_filter=finished")
    assert res.status_code == 200, f"Erreur API /matches?status_filter=finished: {res.text}"
    finished = res.json()
    assert len(finished) > 0, "Aucun match terminé retourné par l'API"
    
    # Vérification des scores et équipes
    for m in finished[:5]:
        assert m["status"] == "finished"
        assert m["away_score"] is not None, f"Score extérieur manquant pour match {m['id']}"
        assert m["home_score"] is not None, f"Score domicile manquant pour match {m['id']}"
        assert m["away_team"]["code"], "Acronyme extérieur manquant"
        assert m["home_team"]["code"], "Acronyme domicile manquant"
        assert m["away_team"]["color"], "Couleur extérieur manquante"
        assert m["home_team"]["color"], "Couleur domicile manquante"

    team_codes = {m["away_team"]["code"] for m in finished} | {m["home_team"]["code"] for m in finished}
    assert "HOU" in team_codes or "OKC" in team_codes, "Exemples HOU ou OKC absents des matchs terminés"
    print(f"-> [OK] API matches terminés active avec {len(finished)} matchs avec scores et acronymes (dont HOU/OKC).")

    print("=======================================================================")
    print("TOUS LES CRITÈRES DU SCOREBOARD TV NEO-BRUTALISME SONT VALIDÉS (100%) !")
    print("=======================================================================")

if __name__ == "__main__":
    test_results_scoreboard_tv_and_neobrutalism()
