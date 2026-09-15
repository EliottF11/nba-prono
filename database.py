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

# Migration légère pour bases de données SQLite / PostgreSQL existantes
def run_migrations():
    from sqlalchemy import text
    is_postgres = "postgresql" in str(engine.url)

    if is_postgres:
        statements = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(120)",
            "ALTER TABLE matches ADD COLUMN IF NOT EXISTS week_number INTEGER DEFAULT 1",
            "ALTER TABLE predictions ADD COLUMN IF NOT EXISTS is_boosted BOOLEAN DEFAULT FALSE",
        ]
        for stmt in statements:
            try:
                with engine.connect() as conn:
                    conn.execute(text(stmt))
                    conn.commit()
            except Exception as e:
                print(f"[MIGRATION PG NOTICE] {stmt}: {e}")
    else:
        # SQLite
        migrations = [
            ("users", "email", "ALTER TABLE users ADD COLUMN email VARCHAR(120)"),
            ("matches", "week_number", "ALTER TABLE matches ADD COLUMN week_number INTEGER DEFAULT 1"),
            ("predictions", "is_boosted", "ALTER TABLE predictions ADD COLUMN is_boosted BOOLEAN DEFAULT 0"),
        ]
        for table, col, stmt in migrations:
            try:
                with engine.connect() as conn:
                    res = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
                    existing_cols = [r[1] for r in res]
                    if col not in existing_cols:
                        conn.execute(text(stmt))
                        conn.commit()
            except Exception:
                pass

