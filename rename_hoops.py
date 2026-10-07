import os

files = ["static/index.html", "static/js/app.js"]

for file in files:
    if os.path.exists(file):
        with open(file, "r", encoding="utf-8") as f:
            content = f.read()
        
        content = content.replace("HOOPS WRAPPED", "PICK 'N' SWIPE WRAPPED")
        content = content.replace("HOOPS Wrapped", "Pick 'n' Swipe Wrapped")
        
        with open(file, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Updated {file}")
