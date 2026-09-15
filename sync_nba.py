"""
Script en ligne de commande pour synchroniser les matchs et scores NBA avec API-Sports.
Usage:
    python sync_nba.py                   # Vérifie le quota et synchronise la date d'ouverture
    python sync_nba.py 2024-10-22        # Synchronise une date spécifique (YYYY-MM-DD)
"""
import sys
from datetime import datetime, timezone
from database import SessionLocal
from services.nba_service import check_api_status, sync_scores_for_date

def main():
    print("================== SYNCHRONISATION API-SPORTS (NBA) ==================")
    
    # 1. Vérification du quota et du compte
    try:
        status = check_api_status()
        print(f"Compte        : {status['account']} ({status['email']})")
        print(f"Abonnement    : {status['plan']}")
        print(f"Quota du jour : {status['requests_used']} / {status['requests_limit']} utilisées ({status['requests_remaining']} restantes)")
        print("----------------------------------------------------------------------")
    except Exception as e:
        print(f"Erreur de connexion API-Sports : {e}")
        return

    # 2. Date à synchroniser
    if len(sys.argv) > 1:
        target_date = sys.argv[1]
    else:
        # Date d'ouverture de la saison
        target_date = "2024-10-22"

    print(f"-> Recherche des résultats et scores pour la date : {target_date}...")
    db = SessionLocal()
    try:
        result = sync_scores_for_date(db, target_date)
        print(f"   Matchs trouvés sur l'API : {result['api_games_found']}")
        print(f"   Matchs locaux mis à jour : {result['matches_updated']}")
        print(f"   Matchs clôturés (scores) : {result['matches_resolved']}")
        print("----------------------------------------------------------------------")
        print("OK : Base de données et classement synchronisés avec succès !")
    except Exception as e:
        print(f"Erreur lors de la synchronisation : {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
