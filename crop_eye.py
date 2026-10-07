from PIL import Image

eye_path = "static/icons/badges/badge_eye.png"
img = Image.open(eye_path)
# Crop the top 10 pixels to remove artifacts from the icon above
# Also crop 5 pixels from left, right, bottom just to be safe
width, height = img.size
cropped = img.crop((5, 12, width - 5, height - 5))
cropped.save(eye_path)
print("Cropped eye to remove top artifacts")
