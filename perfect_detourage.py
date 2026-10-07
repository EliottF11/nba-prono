from PIL import Image

def clean_détourage(img_path):
    img = Image.open(img_path).convert("RGBA")
    width, height = img.size
    
    # 1. Slice from original sprite sheet if needed, or just work on current image.
    # Actually let's just work on the current image.
    pixels = img.load()
    
    visited = set()
    stack = [(0,0), (width-1, 0), (0, height-1), (width-1, height-1)]
    
    # Background threshold
    threshold = 100
    
    while stack:
        x, y = stack.pop()
        if (x, y) in visited:
            continue
        if x < 0 or x >= width or y < 0 or y >= height:
            continue
            
        r, g, b, a = pixels[x, y]
        
        # If it's bright enough, we consider it part of the outside background
        if r > threshold and g > threshold and b > threshold:
            visited.add((x, y))
            stack.extend([(x+1, y), (x-1, y), (x, y+1), (x, y-1), (x+1, y+1), (x-1, y-1), (x+1, y-1), (x-1, y+1)])

    # Now apply the alpha mapping ONLY to visited pixels
    for x in range(width):
        for y in range(height):
            if (x, y) in visited:
                r, g, b, a = pixels[x, y]
                # Average luminance
                lum = (r + g + b) // 3
                # We assume the pixel was black (0,0,0) blended with white (255,255,255)
                # So alpha is 255 - lum
                new_alpha = max(0, 255 - lum)
                # To prevent darkening too much, if lum > 250, just make it fully transparent
                if lum > 240:
                    pixels[x, y] = (0, 0, 0, 0)
                else:
                    pixels[x, y] = (0, 0, 0, new_alpha)

    img.save(img_path)

# Actually, the images were already messed up by the previous script (it hard-replaced white with transparent).
# I should re-extract from the original sources!
import shutil

# 1. Eye (Oracle) - re-extract from sprite sheet
sprite_path = r"C:\Users\eliot\.gemini\antigravity-ide\brain\32330f46-1481-4bb5-83d9-ea82a6e98563\.user_uploaded\media_1791134051729.png"
sprite = Image.open(sprite_path).convert("RGBA")
w, h = sprite.size[0] // 4, sprite.size[1] // 3
eye = sprite.crop((2 * w, 2 * h, 3 * w, 3 * h))
eye.save("static/icons/badges/badge_eye.png")

# 2. Rookie - re-copy from original JPG
rookie_src = r"C:\Users\eliot\.gemini\antigravity-ide\brain\32330f46-1481-4bb5-83d9-ea82a6e98563\.user_uploaded\media_1791130086668.jpg"
shutil.copy(rookie_src, "static/icons/badges/badge_rookie.png")

# Now apply the perfect détourage
clean_détourage("static/icons/badges/badge_eye.png")
clean_détourage("static/icons/badges/badge_rookie.png")

print("Perfect détourage done for Eye and Rookie!")
