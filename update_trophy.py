with open('static/js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace badge_trophy.png with icon_trophy.png in app.js
content = content.replace("badge_trophy.png", "icon_trophy.png")

with open('static/js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Replaced trophy icon in app.js")
