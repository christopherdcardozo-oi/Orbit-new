import sys
try:
    from PIL import Image, ImageChops
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'Pillow'])
    from PIL import Image, ImageChops

def crop_white_border(image_path, output_path):
    img = Image.open(image_path).convert('RGB')
    bg = Image.new('RGB', img.size, (255, 255, 255))
    diff = ImageChops.difference(img, bg)
    bbox = diff.getbbox()
    if bbox:
        # Add a tiny padding just in case (optional, maybe 0)
        padding = 0
        left = max(0, bbox[0] - padding)
        top = max(0, bbox[1] - padding)
        right = min(img.width, bbox[2] + padding)
        bottom = min(img.height, bbox[3] + padding)
        
        # We want to keep it perfectly square.
        width = right - left
        height = bottom - top
        size = max(width, height)
        
        # Center the square crop over the bbox
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        
        new_left = max(0, cx - size // 2)
        new_top = max(0, cy - size // 2)
        
        cropped_img = img.crop((new_left, new_top, new_left + size, new_top + size))
        cropped_img.save(output_path, 'PNG')
        print(f"Cropped successfully. Original size: {img.size}, New size: {cropped_img.size}")
    else:
        print("Image is entirely white or couldn't find bounding box.")

crop_white_border('/Users/cdcardozo/.gemini/antigravity/brain/71b65078-7563-4070-a32f-42f566a59d3e/.user_uploaded/media_1787772520184.jpg', '/Users/cdcardozo/.gemini/antigravity/scratch/antigravity-mobile/assets/icon.png')
