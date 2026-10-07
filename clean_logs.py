import os
import re

files_to_clean = [
    'static/js/app.js',
    'static/js/api.js',
    'static/preview.html',
    'main.py',
    'routers/auth_router.py',
    'routers/predictions_router.py',
    'routers/weekly_router.py',
    'test_profile.py',
    'test_chantier5.py'
]

def remove_consoles_and_prints():
    for filepath in files_to_clean:
        if not os.path.exists(filepath):
            continue
        with open(filepath, 'r', encoding='utf-8') as f:
            lines = f.readlines()
        
        new_lines = []
        for line in lines:
            if 'console.log' in line or 'console.error' in line or 'console.warn' in line:
                # Basic line stripping if it's just a console command
                if line.strip().startswith('console.'):
                    continue
                else:
                    # Try to regex it out if it's inline
                    line = re.sub(r'console\.(log|error|warn)\([^;]*\);?', '', line)
            
            # For python prints that are debugging
            if filepath.endswith('.py') and 'print(' in line and not filepath.startswith('test_'):
                if line.strip().startswith('print('):
                    continue
            
            new_lines.append(line)
            
        with open(filepath, 'w', encoding='utf-8') as f:
            f.writelines(new_lines)

remove_consoles_and_prints()
print("Cleaned console logs and prints")
