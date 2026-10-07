from PIL import Image

def remove_white_bg(img_path):
    img = Image.open(img_path)
    img = img.convert("RGBA")
    datas = img.getdata()
    new_data = []
    for item in datas:
        # Check if pixel is close to white
        if item[0] > 230 and item[1] > 230 and item[2] > 230:
            # Change to transparent
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
    img.putdata(new_data)
    img.save(img_path, "PNG")

remove_white_bg("static/icons/badges/badge_rookie.png")
remove_white_bg("static/icons/badges/badge_eye.png")
print("Removed white background from Rookie and Eye icons.")
