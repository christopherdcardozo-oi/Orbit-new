from PIL import Image

def manual_crop():
    img = Image.open('/Users/cdcardozo/.gemini/antigravity/brain/71b65078-7563-4070-a32f-42f566a59d3e/.user_uploaded/media_1787772520184.jpg').convert('RGB')
    
    # The icon is in the center. Let's crop a 700x700 square from the center.
    size = 680
    cx = img.width // 2
    cy = img.height // 2
    
    left = cx - size // 2
    top = cy - size // 2
    right = cx + size // 2
    bottom = cy + size // 2
    
    cropped = img.crop((left, top, right, bottom))
    cropped.save('/Users/cdcardozo/.gemini/antigravity/scratch/antigravity-mobile/assets/icon.png', 'PNG')
    
manual_crop()
