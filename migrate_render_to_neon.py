"""
Script de migration de base de données PostgreSQL vers Neon.
"""
import os
import sys
from sqlalchemy import create_engine, MetaData, Table, select, text

def fix_url(url: str) -> str:
    url = url.strip().strip('"').strip("'")
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url

def run(render_url: str = None, neon_url: str = None):
    if not render_url:
        render_url = input("URL Render : ").strip()
    if not neon_url:
        neon_url = input("URL Neon : ").strip()

    render_url = fix_url(render_url)
    neon_url = fix_url(neon_url)

    print("Connexion en cours...")
    engine_render = create_engine(render_url)
    engine_neon = create_engine(neon_url)

    from database import Base
    import models
    print("Initialisation du schéma...")
    Base.metadata.create_all(bind=engine_neon)

    table_order = [
        "teams",
        "users",
        "matches",
        "predictions",
        "season_predictions",
        "weekly_player_predictions",
        "leagues",
        "league_members",
        "league_messages"
    ]

    metadata_render = MetaData()
    metadata_neon = MetaData()

    print("Migration des tables...")
    with engine_render.connect() as conn_render, engine_neon.begin() as conn_neon:
        for table_name in table_order:
            try:
                t_render = Table(table_name, metadata_render, autoload_with=engine_render)
                t_neon = Table(table_name, metadata_neon, autoload_with=engine_neon)
            except Exception:
                continue

            rows = conn_render.execute(select(t_render)).mappings().all()
            if not rows:
                continue

            conn_neon.execute(t_neon.delete())
            conn_neon.execute(t_neon.insert(), [dict(r) for r in rows])
            print(f" -> {table_name}: {len(rows)} lignes transférées.")

            try:
                conn_neon.execute(text(f"""
                    SELECT setval(
                        pg_get_serial_sequence('{table_name}', 'id'),
                        COALESCE((SELECT MAX(id) FROM {table_name}), 1)
                    );
                """))
            except Exception:
                pass

    print("Migration terminée avec succès.")

if __name__ == "__main__":
    r_url = sys.argv[1] if len(sys.argv) > 1 else None
    n_url = sys.argv[2] if len(sys.argv) > 2 else None
    run(r_url, n_url)
