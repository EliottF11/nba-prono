from PIL import Image
import numpy as np

img_path = r"static/icons/badges/icon_key_clean.png"
img = Image.open(img_path).convert("RGBA")
data = np.array(img)

# Print a few pixels from the top left (background)
print("Top left pixels:", data[0, 0:5])
print("Middle pixel (inside key?):", data[data.shape[0]//2, data.shape[1]//2])

# Background colors are likely [255, 255, 255, 255] and [204, 204, 204, 255] or something.
