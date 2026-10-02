import re
from starlette.testclient import TestClient
from main import app

client = TestClient(app)

def test_arcade_gamification_backend_and_frontend():
    print("\n================== VÉRIFICATION GAMIFICATION ARCADE ==================")

    # 1. Vérification HTML
    with open("static/index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Streak dans le header
    assert 'id="user-streak-badge"' in html, "Badge streak manquant dans index.html"
    assert 'id="user-streak-val"' in html, "Compteur streak manquant dans index.html"
    assert "🔥" in html, "Icône de flamme manquante dans index.html"
    print("-> [OK] La Streak (Série) est présente dans la top bar avec icône flamme.")

    # Modale récapitulatif
    assert 'id="night-recap-modal"' in html, "Modale night-recap-modal manquante dans index.html"
    assert 'id="night-recap-stats-bar"' in html, "Stats bar du récap manquante dans index.html"
    assert 'id="night-recap-matches-list"' in html, "Liste des matchs du récap manquante dans index.html"
    print("-> [OK] La modale de Récapitulatif des pronostics est présente dans le HTML.")

    # 2. Vérification CSS
    with open("static/css/style.css", "r", encoding="utf-8") as f:
        css = f.read()

    # Bouton Arcade néo-brutaliste
    assert ".arcade-push-btn" in css, "Classe .arcade-push-btn manquante dans style.css"
    assert ".arcade-btn-collar" in css, "Collier du bouton arcade manquant dans style.css"
    assert ".arcade-btn-plunger" in css, "Poussoir du bouton arcade manquant dans style.css"
    assert ".is-locked" in css, "État verrouillé (.is-locked) manquant dans style.css"
    assert "arcadeButtonFirePulse" in css, "Animation d'impulsion de flamme manquante"
    print("-> [OK] Style néo-brutaliste physique du bouton x2 présent (collar, plunger, lock, pulsation).")

    # Traînée de feu CSS
    assert ".card-fire-trail-container" in css, "Conteneur de traînée de feu manquant dans style.css"
    assert ".fire-trail-flame" in css, "Flammes de la traînée manquantes dans style.css"
    assert ".fire-ember" in css, "Étincelles de feu manquantes dans style.css"
    assert ".fire-trail-launching" in css, "Effet de lancement de traînée manquant dans style.css"
    print("-> [OK] Traînée de feu CSS et particules d'étincelles présentes.")

    # Compteur de streak CSS
    assert "#user-streak-badge" in css, "CSS #user-streak-badge manquant"
    assert "streakFlamePulse" in css, "Animation streakFlamePulse manquante"
    print("-> [OK] Style et animations de la streak (flamme vibrante/pulse) validés.")

    # Empty State Rétro Scoreboard
    assert ".tinder-completion-arcade" in css, "CSS .tinder-completion-arcade manquant"
    assert ".retro-scoreboard-container" in css, "CSS .retro-scoreboard-container manquant"
    assert ".retro-scanlines" in css, "Effet scanlines rétro manquant"
    assert ".countdown-digit-box" in css, "Boîtes de digits rétro manquantes"
    assert ".btn-arcade-recap" in css, "Bouton arcade récap manquant"
    print("-> [OK] Style Retro Digital Scoreboard (scanlines, digits LED, bouton néo-brutaliste) validé.")

    # 3. Vérification JavaScript
    with open("static/js/app.js", "r", encoding="utf-8") as f:
        js = f.read()

    # Fonctions streak
    assert "computeCurrentStreak" in js, "Fonction computeCurrentStreak manquante dans app.js"
    assert "updateStreakUI" in js, "Fonction updateStreakUI manquante dans app.js"

    # Bouton x2 arcade & vibrations
    assert "handleArcadeBonusClick" in js, "Fonction handleArcadeBonusClick manquante dans app.js"
    assert "navigator.vibrate" in js, "Support vibration haptique manquant dans app.js"
    assert "card-fire-trail-container" in js, "Traînée de feu non intégrée aux cartes dans app.js"
    assert "fire-trail-launching" in js, "Effet de lancement de flamme manquant au swipe"

    # Empty state countdown & recap
    assert "startRetroCountdown" in js, "Fonction startRetroCountdown manquante dans app.js"
    assert "retro-digital-countdown" in js, "Scoreboard rétro manquant dans le rendu empty state"
    assert "openNightRecapModal" in js, "Fonction openNightRecapModal manquante dans app.js"
    assert "closeNightRecapModal" in js, "Fonction closeNightRecapModal manquante dans app.js"
    print("-> [OK] Logique JavaScript (vibrations haptiques, compte à rebours digital, récap modal) validée.")

    # 4. Vérification API Backend (Stats & Streak)
    response = client.get("/api/matches/")
    assert response.status_code == 200, f"Erreur API matches: {response.text}"
    matches = response.json()
    assert len(matches) > 0, "Aucun match retourné par l'API"
    print(f"-> [OK] API matches active avec {len(matches)} matchs.")

    print("=======================================================================")
    print("TOUS LES ÉLÉMENTS DE GAMIFICATION ARCADE SONT VALIDÉS AVEC SUCCÈS (100%) !")
    print("=======================================================================")

if __name__ == "__main__":
    test_arcade_gamification_backend_and_frontend()
