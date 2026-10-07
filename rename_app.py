import os
import re

files = [
    "static/index.html",
    "static/preview.html",
    "static/js/app.js"
]

for file in files:
    if os.path.exists(file):
        with open(file, "r", encoding="utf-8") as f:
            content = f.read()
        
        # Replace case insensitive but preserving case where possible or just straight up replace
        # We will do a straight replace of variations
        content = content.replace("HOOPS PRONO", "Pick 'n' Swipe")
        content = content.replace("HOOPS Prono", "Pick 'n' Swipe")
        content = content.replace("Hoops Prono", "Pick 'n' Swipe")
        
        with open(file, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated {file}")
