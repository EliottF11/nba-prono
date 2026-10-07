import re
from datetime import datetime, timezone, timedelta
import random

raw_text = """Friday, October 9 (Preseason)
2 Games
2:00 PM CET
Houston Rockets
Dallas Mavericks
2:00 AM CET (Saturday)
Memphis Grizzlies
Chicago Bulls
Saturday, October 10 (Preseason)
7 Games
12:30 AM CET (Sunday)
LA Clippers
Toronto Raptors
1:00 AM CET (Sunday)
Atlanta Hawks
Indiana Pacers
1:00 AM CET (Sunday)
Detroit Pistons
Washington Wizards
2:00 AM CET (Sunday)
Minnesota Timberwolves
Miami Heat
2:00 AM CET (Sunday)
Philadelphia 76ers
Boston Celtics
2:30 AM CET (Sunday)
Sacramento Kings
Golden State Warriors
4:30 AM CET (Sunday)
San Antonio Spurs
Phoenix Suns
Sunday, October 11 (Preseason)
4 Games
12:00 PM CET
Dallas Mavericks
Houston Rockets
12:30 AM CET (Monday)
Orlando Magic
Cleveland Cavaliers
1:00 AM CET (Monday)
Milwaukee Bucks
Charlotte Hornets
3:00 AM CET (Monday)
Chicago Bulls
Denver Nuggets
Monday, October 12 (Preseason)
5 Games
10:00 PM CET
London Lions
Portland Trail Blazers
1:00 AM CET (Tuesday)
Oklahoma City Thunder
Atlanta Hawks
1:00 AM CET (Tuesday)
Brooklyn Nets
Washington Wizards
1:30 AM CET (Tuesday)
Minnesota Timberwolves
New York Knicks
3:00 AM CET (Tuesday)
San Antonio Spurs
Utah Jazz
Tuesday, October 13 (Preseason)
5 Games
1:00 AM CET (Wednesday)
Cleveland Cavaliers
Orlando Magic
1:00 AM CET (Wednesday)
New York Knicks
Toronto Raptors
2:00 AM CET (Wednesday)
Indiana Pacers
Oklahoma City Thunder
4:00 AM CET (Wednesday)
Golden State Warriors
Los Angeles Lakers
4:00 AM CET (Wednesday)
Portland Trail Blazers
Sacramento Kings
Wednesday, October 14 (Preseason)
7 Games
1:30 AM CET (Thursday)
Brooklyn Nets
Miami Heat
1:30 AM CET (Thursday)
Charlotte Hornets
Boston Celtics
2:00 AM CET (Thursday)
New Orleans Pelicans
Dallas Mavericks
2:00 AM CET (Thursday)
Chicago Bulls
Milwaukee Bucks
2:00 AM CET (Thursday)
Detroit Pistons
Minnesota Timberwolves
2:00 AM CET (Thursday)
Phoenix Suns
San Antonio Spurs
4:30 AM CET (Thursday)
Denver Nuggets
LA Clippers
Thursday, October 15 (Preseason)
2 Games
1:30 AM CET (Friday)
Toronto Raptors
New York Knicks
2:30 AM CET (Friday)
Oklahoma City Thunder
Houston Rockets
Friday, October 16 (Preseason)
12 Games
1:00 AM CET (Saturday)
Boston Celtics
Philadelphia 76ers
1:00 AM CET (Saturday)
Miami Heat
Orlando Magic
1:00 AM CET (Saturday)
Toronto Raptors
Detroit Pistons
1:00 AM CET (Saturday)
Milwaukee Bucks
Indiana Pacers
2:00 AM CET (Saturday)
Atlanta Hawks
Dallas Mavericks
2:00 AM CET (Saturday)
Minnesota Timberwolves
Chicago Bulls
2:00 AM CET (Saturday)
Charlotte Hornets
Memphis Grizzlies
2:00 AM CET (Saturday)
Washington Wizards
New Orleans Pelicans
2:00 AM CET (Saturday)
Sacramento Kings
San Antonio Spurs
4:00 AM CET (Saturday)
Portland Trail Blazers
Golden State Warriors
4:00 AM CET (Saturday)
Utah Jazz
Phoenix Suns
4:30 AM CET (Saturday)
Denver Nuggets
Los Angeles Lakers"""

team_map = {
    'Boston Celtics': 'Boston', 'New York Knicks': 'New York', 'Philadelphia 76ers': 'Philadelphia', 
    'Brooklyn Nets': 'Brooklyn', 'Toronto Raptors': 'Toronto', 'Chicago Bulls': 'Chicago', 
    'Cleveland Cavaliers': 'Cleveland', 'Milwaukee Bucks': 'Milwaukee', 'Indiana Pacers': 'Indiana', 
    'Detroit Pistons': 'Detroit', 'Atlanta Hawks': 'Atlanta', 'Miami Heat': 'Miami', 
    'Orlando Magic': 'Orlando', 'Charlotte Hornets': 'Charlotte', 'Washington Wizards': 'Washington', 
    'Denver Nuggets': 'Denver', 'Minnesota Timberwolves': 'Minnesota', 'Oklahoma City Thunder': 'Oklahoma City', 
    'Utah Jazz': 'Utah', 'Portland Trail Blazers': 'Portland', 'Golden State Warriors': 'Golden State', 
    'LA Clippers': 'Los Angeles (LAC)', 'Los Angeles Clippers': 'Los Angeles (LAC)', 
    'Los Angeles Lakers': 'Los Angeles (LAL)', 'LA Lakers': 'Los Angeles (LAL)', 
    'Phoenix Suns': 'Phoenix', 'Sacramento Kings': 'Sacramento', 'Dallas Mavericks': 'Dallas', 
    'Houston Rockets': 'Houston', 'Memphis Grizzlies': 'Memphis', 'New Orleans Pelicans': 'New Orleans', 
    'San Antonio Spurs': 'San Antonio'
}

lines = raw_text.split('\n')
i = 0
matches = []

current_date_base = None

while i < len(lines):
    line = lines[i].strip()
    
    # Check for date line e.g., "Friday, October 9 (Preseason)"
    date_match = re.match(r'^[A-Za-z]+, ([A-Za-z]+) (\d+) \(Preseason\)', line)
    if date_match:
        month_str = date_match.group(1)
        day = int(date_match.group(2))
        month = 10 if month_str == 'October' else 11
        current_date_base = datetime(2026, month, day, 0, 0, tzinfo=timezone.utc)
        i += 1
        continue
        
    if "Games" in line:
        i += 1
        continue
        
    # Check for time line e.g., "2:00 PM CET", "2:00 AM CET (Saturday)"
    time_match = re.match(r'^(\d+):(\d+)\s+(AM|PM)\s+CET', line)
    if time_match:
        hour = int(time_match.group(1))
        minute = int(time_match.group(2))
        ampm = time_match.group(3)
        
        if ampm == 'PM' and hour != 12:
            hour += 12
        elif ampm == 'AM' and hour == 12:
            hour = 0
            
        # If it says (Saturday) and base is Friday, it's the next day
        day_offset = 0
        if "(" in line and "Preseason" not in line:
            day_offset = 1
            
        match_time = current_date_base.replace(hour=hour, minute=minute) + timedelta(days=day_offset)
        # Convert CET to UTC (CET is UTC+1 in winter, but in Oct it's CEST UTC+2. Let's assume UTC+2)
        match_time_utc = match_time - timedelta(hours=2)
        
        i += 1
        if i < len(lines) and lines[i].strip() == "Preseason":
            i += 1
            
        # skip optional TV network line
        if "[beIN" in lines[i]:
            i += 1
            
        if lines[i].strip() == "Preseason":
            i += 1
            
        team1_str = lines[i].strip()
        if team1_str == 'London Lions':
            i += 3
            continue
        i += 1
        team2_str = lines[i].strip()
        i += 1
        
        t1 = team_map.get(team1_str, team1_str)
        t2 = team_map.get(team2_str, team2_str)
        
        odds1 = round(random.uniform(1.2, 2.5), 2)
        odds2 = round(random.uniform(1.2, 2.5), 2)
        
        matches.append(f'''            {{
                "home": "{t1}",
                "away": "{t2}",
                "home_odds": {odds1},
                "away_odds": {odds2},
                "deadline": datetime({match_time_utc.year}, {match_time_utc.month}, {match_time_utc.day}, {match_time_utc.hour}, {match_time_utc.minute}, tzinfo=timezone.utc),
                "season_stage": "preseason",
                "week_number": 0
            }},''')
        continue
        
    i += 1

with open('real_matches.txt', 'w') as f:
    f.write('\n'.join(matches))
