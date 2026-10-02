import re
from starlette.testclient import TestClient
from main import app

client = TestClient(app)

def test_lucide_icons_and_styling():
    print("\n================== VÉRIFICATION ICÔNES LUCIDE & DA NÉO-BRUTALISTE ==================")
    
    # 1. Vérification HTML
    with open("static/index.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Onglet Matchs (Swipe) -> Lucide Layers
    assert 'data-tab="matches"' in html, "Onglet Matchs manquant"
    assert "12.83 2.18" in html, "Icône Lucide Layers manquante pour l'onglet Matchs"
    print("-> [OK] Onglet Matchs équipé de l'icône Lucide Layers (pile de cartes).")

    # Onglet Résultats -> Lucide Monitor
    assert 'data-tab="results"' in html, "Onglet Résultats manquant"
    assert '<rect width="20" height="14"' in html, "Icône Lucide Monitor manquante pour l'onglet Résultats"
    print("-> [OK] Onglet Résultats équipé de l'icône Lucide Monitor (Scoreboard TV US).")

    # Onglet Mes Ligues -> Lucide Users
    assert 'data-tab="leagues"' in html, "Onglet Mes Ligues manquant"
    assert "M16 21v-2a4 4 0 0 0-4-4H6" in html, "Icône Lucide Users manquante pour l'onglet Mes Ligues"
    print("-> [OK] Onglet Mes Ligues équipé de l'icône Lucide Users (groupe).")

    # Onglet Classement -> Lucide Trophy
    assert 'data-tab="leaderboard"' in html, "Onglet Classement manquant"
    assert 'd="M18 2H6v7a6 6 0 0 0 12 0V2Z"' in html, "Icône Lucide Trophy manquante pour l'onglet Classement"
    print("-> [OK] Onglet Classement équipé de l'icône Lucide Trophy (coupe).")

    # Onglet Profil -> Lucide User
    assert 'data-tab="profile"' in html, "Onglet Profil manquant"
    assert "M19 21v-2a4 4 0 0 0-4-4H9" in html, "Icône Lucide User manquante pour l'onglet Profil"
    print("-> [OK] Onglet Profil équipé de l'icône Lucide User (silhouette).")

    # Streak dans le header -> Lucide Flame
    assert 'class="streak-flame-icon' in html, "Icône Lucide Flame manquante dans le header streak"
    assert "M8.5 14.5A2.5 2.5 0 0 0 11 12" in html, "Chemin SVG Lucide Flame manquant"
    assert "🔥" in html, "Caractère de compatibilité flamme présent"
    print("-> [OK] Header Streak équipé de l'icône Lucide Flame.")

    # 2. Vérification CSS
    with open("static/css/style.css", "r", encoding="utf-8") as f:
        css = f.read()

    # Stroke-width 2.5 (Bold Arcade)
    assert "stroke-width: 2.5" in css, "stroke-width: 2.5 manquant dans style.css"
    
    # Inactif : #F4F4F0 60% opacity, fill: none
    assert "rgba(244, 244, 240, 0.6)" in css, "Couleur inactive #F4F4F0 (60% opacité) manquante"
    assert ".tab-btn:not(.active) svg" in css, "Sélecteur inactif .tab-btn:not(.active) svg manquant"
    
    # Actif : #D95D39 stroke & fill, drop-shadow(2px 2px 0px #000), transform: scale(1.1)
    assert "#D95D39" in css, "Orange vif #D95D39 manquant"
    assert "drop-shadow(2px 2px 0px" in css, "Ombre nette drop-shadow(2px 2px 0px #000) manquante"
    assert "scale(1.1)" in css, "Effet pop scale(1.1) manquant"
    
    # Animation de rebond
    assert "tabIconBounce" in css or "tabBounceAnimation" in css, "Animation de rebond d'icône manquante"
    assert "transition: transform 0.2s ease-in-out" in css, "Transition rebond transform 0.2s manquante"
    print("-> [OK] Styles CSS Neo-Brutalistes (trait 2.5, inactif 60%, actif #D95D39, drop-shadow, rebond scale 1.1) validés.")

    # 3. Vérification JavaScript
    with open("static/js/app.js", "r", encoding="utf-8") as f:
        js = f.read()

    assert "classList.toggle('active', isCurrent)" in js, "Gestion dynamique de la classe .active dans selectTab manquante"
    assert "tab-rebound" in js, "Déclenchement du rebond tactile tab-rebound manquant dans selectTab"
    print("-> [OK] Logique JavaScript de transition d'onglets et animation rebond validée.")

    print("====================================================================================")
    print("TOUTES LES EXIGENCES DE REMPLACEMENT DES ICÔNES PAR LUCIDE SONT VALIDÉES À 100% !")
    print("====================================================================================")

if __name__ == "__main__":
    test_lucide_icons_and_styling()
