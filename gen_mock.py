from datetime import datetime, timezone, timedelta
import random

teams = ['Boston', 'New York', 'Philadelphia', 'Brooklyn', 'Toronto', 'Chicago', 'Cleveland', 'Milwaukee', 'Indiana', 'Detroit', 'Atlanta', 'Miami', 'Orlando', 'Charlotte', 'Washington', 'Denver', 'Minnesota', 'Oklahoma City', 'Utah', 'Portland', 'Golden State', 'Los Angeles (LAC)', 'Los Angeles (LAL)', 'Phoenix', 'Sacramento', 'Dallas', 'Houston', 'Memphis', 'New Orleans', 'San Antonio']

start_date = datetime(2026, 10, 9, 23, 0, tzinfo=timezone.utc)
end_date = datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc)

current_date = start_date
with open("mock_preseason.txt", "w") as f:
    while current_date <= end_date:
        for _ in range(2):
            t1, t2 = random.sample(teams, 2)
            odds1 = round(random.uniform(1.2, 2.5), 2)
            odds2 = round(random.uniform(1.2, 2.5), 2)
            f.write(f'''            {{
                "home": "{t1}",
                "away": "{t2}",
                "home_odds": {odds1},
                "away_odds": {odds2},
                "deadline": datetime({current_date.year}, {current_date.month}, {current_date.day}, {current_date.hour}, {current_date.minute}, tzinfo=timezone.utc),
                "season_stage": "preseason",
                "week_number": 0
            }},\n''')
        current_date += timedelta(days=1)
