from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

import os
from dotenv import load_dotenv

load_dotenv()

# Base de données : SQLite en local ou PostgreSQL sur le Cloud (Render/Railway)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nba_prono.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args
)

# Migration légère pour bases de données SQLite / PostgreSQL existantes
def run_migrations():
    from sqlalchemy import text
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE users ADD COLUMN email VARCHAR(120)",
            "ALTER TABLE matches ADD COLUMN week_number INTEGER DEFAULT 1",
            "ALTER TABLE predictions ADD COLUMN is_boosted BOOLEAN DEFAULT 0",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass

run_migrations()

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
