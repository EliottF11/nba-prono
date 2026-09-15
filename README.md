# 🏀 NBA Prono - Application MVP de Pronostics NBA (Style Mon Petit Prono)

Application web de pronostics NBA simple, ultra fluide et "mobile-first", conçue avec Python (FastAPI), SQLite et Tailwind CSS.

---

## ⚡ Caractéristiques principales

- **Authentification instantanée** : Création de compte et connexion simples (pseudo + mot de passe sécurisé via PBKDF2-HMAC).
- **Écran de pronostics 1-clic** : Affichage des 15 rencontres hebdomadaires couvrant les **30 équipes NBA**, avec cotes décimales fictives et deadlines en temps réel.
- **Zéro logo officiel** : Conforme aux règles de droits, identification par nom de ville (ex: *"Minnesota"*, *"Golden State"*, *"Boston"*) et couleur unie officielle de la franchise.
- **Classement en direct (Leaderboard)** : Tableau des joueurs en temps réel, trié par points totaux cumulés selon les cotes remportées.
- **Simulation de matchs** : Script pour clôturer des matchs et voir les points s'actualiser en live.

---

## 🚀 Démarrage rapide

### 1. Installation des dépendances
```powershell
pip install -r requirements.txt
```

### 2. Réinitialisation et injection des données (30 équipes et 15 matchs)
```powershell
python seed.py
```

### 3. Lancement du serveur Web
```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
# ou simplement :
python main.py
```
- **Application Web Mobile-First** : [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Documentation OpenAPI (Swagger)** : [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## 🧪 Tests de validation automatisés

Chaque étape dispose d'un script de test unitaire et d'intégration dédié :

```powershell
# 1. Vérification de la base de données SQLite
python verify_db.py

# 2. Test du module d'authentification (hachage, tokens, routes register/login/me)
python test_auth.py

# 3. Test des pronostics 1-clic et du calcul des points du classement
python test_predictions.py

# 4. Test du service des assets front-end
python test_frontend.py
```

## 🔄 Synchronisation automatique avec API-Sports

L'application est connectée en direct à l'API officielle **API-Basketball** via votre clé configurée dans le fichier `.env` :

```powershell
# Vérifier le quota restant et synchroniser les scores :
python sync_nba.py

# Ou synchroniser une date précise (ex: 2026-10-20) :
python sync_nba.py 2026-10-20
```
> Le serveur vérifie le quota restant (ex: 97/100 requêtes disponibles), extrait les scores de la nuit, clôture les rencontres et crédite les points aux joueurs sur le classement en direct.

---

## 🎮 Simulation manuelle d'un match (hors-saison / démo)

Pendant que l'application tourne dans votre navigateur, lancez cette commande dans un terminal pour clôturer un match et attribuer les points instantanément :
```powershell
python simulate_game.py
```

---

## 📁 Architecture du projet

```text
nba_prono/
├── database.py                 # Configuration de la base SQLite et sessions SQLAlchemy
├── models.py                   # Modèles de données (Team, User, Match, Prediction)
├── schemas.py                  # Schémas Pydantic pour validation et sérialisation
├── auth.py                     # Sécurité, hachage PBKDF2 et jetons signés
├── main.py                     # Point d'entrée FastAPI et montage statique
├── routers/
│   ├── auth_router.py          # Routes /api/auth (register, login, me)
│   └── predictions_router.py   # Routes /api (matches, predictions, leaderboard, resolve)
├── static/
│   ├── index.html              # Vue mobile-first Tailwind CSS
│   ├── css/style.css           # Thème sombre personnalisé NBA
│   └── js/
│       ├── api.js              # Client API avec gestion du token
│       └── app.js              # Logique d'interface et vote 1-clic
├── seed.py                     # Injection des 30 équipes et 15 matchs
├── verify_db.py                # Contrôle du contenu de la base
├── simulate_game.py            # Simulation de résultat de match
├── test_auth.py                # Tests d'authentification
├── test_predictions.py         # Tests des pronostics et du classement
├── test_frontend.py            # Tests des routes front-end
└── requirements.txt            # Dépendances du projet
```
