import sqlite3

conn = sqlite3.connect('nba_prono.db')
cursor = conn.cursor()

# Get all tables
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print("Tables:", tables)

# We want to clear: users, leagues, league_members, chat_messages, predictions, season_predictions
# We should KEEP: matches, teams, avatars, season_candidates etc.

tables_to_clear = [
    'users',
    'leagues',
    'league_members',
    'league_messages',
    'predictions',
    'season_predictions',
    'badges',
    'user_badges'
]

for table in tables_to_clear:
    # Check if table exists
    if any(t[0] == table for t in tables):
        cursor.execute(f"DELETE FROM {table};")
        print(f"Cleared table {table}")

conn.commit()
conn.close()
