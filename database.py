from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Base de données SQLite locale
SQLALCHEMY_DATABASE_URL = "sqlite:///./nba_prono.db"

# Pour SQLite en multithreading (requis avec FastAPI/Uvicorn)
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# Fabrique de sessions de base de données
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Classe de base pour les modèles ORM
Base = declarative_base()

def get_db():
    """Dépendance FastAPI pour obtenir une session de base de données et la clore proprement."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
