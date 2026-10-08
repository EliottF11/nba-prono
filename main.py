import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from contextlib import asynccontextmanager
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from database import engine, Base, SessionLocal, run_migrations
import models  # Assure le chargement de toutes les tables ORM (dont SeasonPrediction)
from routers.auth_router import router as auth_router
from routers.predictions_router import router as predictions_router
from routers.season_router import router as season_router
from routers.weekly_router import router as weekly_router
from routers.leagues_router import router as leagues_router
from routers.props_router import router as props_router
from routers.bonuses_router import router as bonuses_router

# 1. Création automatique de toutes les tables si non existantes
Base.metadata.create_all(bind=engine)

# 2. Exécution des migrations légères pour les colonnes récemment ajoutées
run_migrations()

def daily_morning_sync():
    """Tâche automatique quotidienne exécutée chaque matin à 07:00."""
    db = SessionLocal()
    try:
        from services.nba_service import sync_scores_for_date
        today_str = datetime.now().strftime("%Y-%m-%d")
        result = sync_scores_for_date(db, today_str)
    except Exception as e:
        pass
    finally:
        db.close()

scheduler = BackgroundScheduler(daemon=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Injection automatique des données de départ si nécessaire (déploiement cloud Render)
    try:
        from seed import seed_all_teams_and_matches
        seed_all_teams_and_matches()
    except Exception as e:
        pass

    # Enregistrement de la tâche quotidienne à 07h00
    scheduler.add_job(daily_morning_sync, CronTrigger(hour=7, minute=0))
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(
    title="NBA Prono MVP API",
    description="API de pronostics NBA style Mon Petit Prono (FastAPI, SQLite, Mobile-First)",
    version="1.0.0",
    lifespan=lifespan
)

# Middleware CORS pour requêtes locales front-end
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inclusion des routeurs
app.include_router(auth_router)
app.include_router(predictions_router)
app.include_router(season_router)
app.include_router(weekly_router)
app.include_router(leagues_router)
app.include_router(props_router)
app.include_router(bonuses_router)

# Montage des fichiers statiques
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", include_in_schema=False)
def serve_frontend():
    """Sert l'application Web mobile-first à la racine."""
    return FileResponse("static/index.html")

@app.get("/ads.txt", include_in_schema=False)
def serve_ads_txt():
    """Sert le fichier ads.txt pour Google AdSense."""
    return FileResponse("static/ads.txt")

@app.get("/admin.html", include_in_schema=False)
def serve_admin():
    """Sert la page d'administration des pronos flash."""
    return FileResponse("static/admin.html")

@app.get("/preview", include_in_schema=False)
def serve_preview():
    """Sert le simulateur iPhone officiel avec rechargement automatique en direct."""
    return FileResponse("static/preview.html")

@app.get("/api/dev/version", include_in_schema=False)
def dev_version():
    """Renvoie l'horodatage de dernière modification des fichiers pour le Hot-Reload."""
    import os
    latest = 0
    for folder in ["static", "routers"]:
        if os.path.exists(folder):
            for root, _, files in os.walk(folder):
                for f in files:
                    if f.endswith((".js", ".css", ".html", ".py", ".json")):
                        try:
                            t = os.path.getmtime(os.path.join(root, f))
                            if t > latest:
                                latest = t
                        except OSError:
                            pass
    return {"v": latest}

@app.get("/api/health", tags=["Système"])
def health_check():
    return {"status": "ok", "app": "NBA Prono MVP"}

@app.get("/api/seed", tags=["Système"])
def trigger_seed():
    """Initialise ou réinjecte les 30 équipes et les matchs officiels NBA 2026/2027."""
    from seed import seed_all_teams_and_matches
    seed_all_teams_and_matches()
    return {"status": "ok", "message": "Les 30 équipes et les matchs officiels 2026/2027 sont injectés avec succès !"}

@app.get("/api/sync/{date_str}", tags=["Système"])
def trigger_sync(date_str: str):
    """Synchronise les matchs et scores pour une date donnée (YYYY-MM-DD)."""
    db = SessionLocal()
    try:
        from services.nba_service import sync_scores_for_date
        result = sync_scores_for_date(db, date_str)
        return {"status": "ok", "result": result}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        db.close()

@app.get("/api/mock-preseason", tags=["Système"])
def trigger_mock_preseason():
    """Injecte 2 faux matchs de présaison pour tester la Ligue Flash, car l'API gratuite bloque les dates de 2024."""
    db = SessionLocal()
    try:
        from models import Match, Team
        from datetime import datetime, timedelta, timezone
        
        # Prendre 2 équipes au hasard
        teams = db.query(Team).limit(4).all()
        if len(teams) < 4:
            return {"status": "error", "message": "Pas assez d'équipes en base. Lancer /api/seed d'abord."}
            
        deadline1 = datetime.now(timezone.utc) + timedelta(hours=2)
        deadline2 = datetime.now(timezone.utc) + timedelta(hours=4)
        
        m1 = Match(
            home_team_id=teams[0].id, away_team_id=teams[1].id,
            home_odds=1.85, away_odds=1.95,
            deadline=deadline1, week_number=1, status="upcoming", season_stage="preseason"
        )
        m2 = Match(
            home_team_id=teams[2].id, away_team_id=teams[3].id,
            home_odds=2.10, away_odds=1.75,
            deadline=deadline2, week_number=1, status="upcoming", season_stage="preseason"
        )
        db.add_all([m1, m2])
        db.commit()
        return {"status": "ok", "message": "2 matchs de présaison injectés ! Va sur l'app !"}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        db.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
