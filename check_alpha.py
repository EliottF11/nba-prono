from PIL import Image

img = Image.open(r"C:\Users\eliot\.gemini\antigravity-ide\brain\32330f46-1481-4bb5-83d9-ea82a6e98563\.user_uploaded\media_1791134051729.png")
print("Mode:", img.mode)
if img.mode == 'RGBA':
    # Check if any pixel has alpha < 255
    alphas = [p[3] for p in img.getdata()]
    print("Min alpha:", min(alphas))
