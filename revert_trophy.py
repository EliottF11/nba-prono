with open('static/js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("icon_trophy.png", "badge_trophy.png")

with open('static/js/app.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("Reverted trophy icon in app.js")
