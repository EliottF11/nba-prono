import cv2
import numpy as np

img = cv2.imread("static/icons/badges/icon_key_clean.png", cv2.IMREAD_UNCHANGED)
if img.shape[2] == 3:
    img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)

# The checkerboard is composed of very specific colors.
# Typically white (255,255,255) and grey (around 204,204,204 or 237,237,237)
# Let's find all pixels that are NOT the black outline and NOT the cream inside.
# Actually, the easiest way is to use floodFill from the top-left to find the background,
# but since it's a checkerboard, it's not a single color.
# Let's just find the black outline, which is contiguous.
gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
_, thresh = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

# Find all contours
contours, hierarchy = cv2.findContours(thresh, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)

mask = np.zeros(gray.shape, dtype=np.uint8)

if hierarchy is not None:
    # Find the largest contour (the outer edge of the key)
    areas = [cv2.contourArea(c) for c in contours]
    max_idx = np.argmax(areas)
    
    # Draw the outer contour filled
    cv2.drawContours(mask, contours, max_idx, 255, thickness=cv2.FILLED)
    
    # Now find all child contours of the largest contour (the holes inside the key)
    # hierarchy[0][i] = [Next, Previous, First_Child, Parent]
    for i, contour in enumerate(contours):
        if hierarchy[0][i][3] == max_idx: # if parent is the max contour
            # This is a hole! Draw it black (0) to subtract it from the mask
            cv2.drawContours(mask, [contour], -1, 0, thickness=cv2.FILLED)

# Apply mask
img[:, :, 3] = mask

cv2.imwrite("static/icons/badges/icon_key.png", img)
print("Key processed with holes removed.")
