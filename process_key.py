import cv2
import numpy as np

img_path = "static/icons/badges/icon_key_clean.png"
img = cv2.imread(img_path, cv2.IMREAD_UNCHANGED)

if img.shape[2] == 3:
    img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)

# Find dark pixels
gray = cv2.cvtColor(img, cv2.COLOR_BGRA2GRAY)
_, thresh = cv2.threshold(gray, 100, 255, cv2.THRESH_BINARY_INV)

# Find contours
contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

if contours:
    # Find largest contour (the key)
    largest_contour = max(contours, key=cv2.contourArea)
    
    # Create mask of the key
    mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.drawContours(mask, [largest_contour], -1, 255, thickness=cv2.FILLED)
    
    # Apply mask to alpha channel
    img[:, :, 3] = mask
    
    cv2.imwrite("static/icons/badges/icon_key.png", img)
    print("Successfully processed key with OpenCV")
else:
    print("No contours found")
