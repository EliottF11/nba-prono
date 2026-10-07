with open('static/css/style.css', 'r', encoding='utf-8') as f:
    css = f.read()

target = "transition: transform 0.08s ease, box-shadow 0.08s ease, background 0.15s ease;"
replacement = target + "\n    touch-action: manipulation;"

css = css.replace(target, replacement)

with open('static/css/style.css', 'w', encoding='utf-8') as f:
    f.write(css)

print("Added touch-action: manipulation to style.css")
