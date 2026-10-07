from PIL import Image

sprite_path = r"C:\Users\eliot\.gemini\antigravity-ide\brain\32330f46-1481-4bb5-83d9-ea82a6e98563\.user_uploaded\media_1791134051729.png"
img = Image.open(sprite_path).convert("RGBA")

width, height = img.size
cols = 4
rows = 3
w = width // cols
h = height // rows

# Trophy: Row 0, Col 2 (0-indexed)
trophy = img.crop((2 * w, 0 * h, 3 * w, 1 * h))
# Eye: Row 2, Col 2
eye = img.crop((2 * w, 2 * h, 3 * w, 3 * h))

trophy.save("static/icons/badges/icon_trophy.png")
eye.save("static/icons/badges/badge_oracle.png")

import shutil
# macon -> media_1791130045749.png
shutil.copy(r"C:\Users\eliot\.gemini\antigravity-ide\brain\32330f46-1481-4bb5-83d9-ea82a6e98563\.user_uploaded\media_1791130045749.png", "static/icons/badges/badge_macon.png")
# sniper -> media_1791130120492.png
shutil.copy(r"C:\Users\eliot\.gemini\antigravity-ide\brain\32330f46-1481-4bb5-83d9-ea82a6e98563\.user_uploaded\media_1791130120492.png", "static/icons/badges/badge_sniper.png")

print("Icons sliced and copied!")
