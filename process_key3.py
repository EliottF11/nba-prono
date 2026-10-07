import cv2
import numpy as np

img = cv2.imread("static/icons/badges/icon_key_clean.png", cv2.IMREAD_UNCHANGED)
if img.shape[2] == 3:
    img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)

gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
_, thresh = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

# RETR_EXTERNAL only gets the outermost contours
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

mask = np.zeros(gray.shape, dtype=np.uint8)

if contours:
    # Find the largest contour (the outer edge of the key)
    areas = [cv2.contourArea(c) for c in contours]
    max_idx = np.argmax(areas)
    
    # Draw the outer contour filled. This keeps everything inside the key outline!
    cv2.drawContours(mask, contours, max_idx, 255, thickness=cv2.FILLED)

# Apply mask (anything outside the key becomes transparent)
img[:, :, 3] = mask

# Optional: also make the checkerboard inside the eye-hole transparent
# The checkerboard is light grey / white. The cream is also light, but maybe less white.
# Let's just output this first and see if it's enough.

cv2.imwrite("static/icons/badges/icon_key.png", img)
print("Key processed with ONLY external background removed. Interior preserved.")
