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

# 1. Création automatique de toutes les tables si non existantes
Base.metadata.create_all(bind=engine)

# 2. Exécution des migrations légères pour les colonnes récemment ajoutées
run_migrations()

def daily_morning_sync():
    """Tâche automatique quotidienne exécutée chaque matin à 07:00."""
    print("⏰ [SCHEDULER] Exécution de la synchronisation automatique des scores de la nuit...")
    db = SessionLocal()
    try:
        from services.nba_service import sync_scores_for_date
        today_str = datetime.now().strftime("%Y-%m-%d")
        result = sync_scores_for_date(db, today_str)
        print(f"⏰ [SCHEDULER] Synchronisation réussie : {result}")
    except Exception as e:
        print(f"⏰ [SCHEDULER] Erreur synchronisation : {e}")
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
        print(f"⚠️ [STARTUP] Erreur initialisation automatique : {e}")

    # Enregistrement de la tâche quotidienne à 07h00
    scheduler.add_job(daily_morning_sync, CronTrigger(hour=7, minute=0))
    scheduler.start()
    print("🚀 [STARTUP] Planificateur automatique démarré (synchronisation quotidienne des scores à 07h00).")
    yield
    scheduler.shutdown()
    print("🛑 [SHUTDOWN] Planificateur arrêté.")

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

# Montage des fichiers statiques
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", include_in_schema=False)
def serve_frontend():
    """Sert l'application Web mobile-first à la racine."""
    return FileResponse("static/index.html")

@app.get("/api/health", tags=["Système"])
def health_check():
    return {"status": "ok", "app": "NBA Prono MVP"}

@app.get("/api/seed", tags=["Système"])
def trigger_seed():
    """Initialise ou réinjecte les 30 équipes et les matchs officiels NBA 2026/2027."""
    from seed import seed_all_teams_and_matches
    seed_all_teams_and_matches()
    return {"status": "ok", "message": "Les 30 équipes et les matchs officiels 2026/2027 sont injectés avec succès !"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
