import sqlite3
conn = sqlite3.connect('nba_prono.db')
cursor = conn.cursor()
cursor.execute("DELETE FROM weekly_player_predictions;")
conn.commit()
conn.close()
print("Cleared weekly_player_predictions")
