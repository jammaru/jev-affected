"""Generate original vector marks and a 1200x630 social card. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path('assets')
out.mkdir(exist_ok=True)
def mark(color):
    return f'<g fill="none" stroke="{color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path opacity=".25" d="M32 10L10 35M32 10L54 35"/><path d="M32 10V54"/></g><g fill="{color}"><circle cx="32" cy="10" r="6"/><circle cx="32" cy="35" r="6"/><circle cx="32" cy="54" r="6"/><circle opacity=".25" cx="10" cy="35" r="5"/><circle opacity=".25" cx="54" cy="35" r="5"/></g>'
for name,color in [('logo.svg','#161a17'),('logo-dark.svg','#f1f5f0'),('logo-mark.svg','#161a17'),('favicon.svg','#161a17')]:
    (out/name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="jev-affected semantic graph">{mark(color)}</svg>')
(out/'logo-wordmark.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 96" role="img" aria-label="jev-affected"><rect width="560" height="96" rx="12" fill="#101713"/><g transform="translate(20 16)">{mark("#f1f5f0")}</g><text x="108" y="62" fill="#f1f5f0" font-family="ui-monospace,Consolas,monospace" font-size="46" font-weight="600">jev-affected</text></svg>')
im=Image.new('RGB',(1200,630),'#101713')
d=ImageDraw.Draw(im)
fontroot=Path('C:/Windows/Fonts')
def font(size,bold=False):
    candidates=[fontroot/('consolab.ttf' if bold else 'consola.ttf'),Path('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')]
    return ImageFont.truetype(str(next(p for p in candidates if p.exists())),size)
d.line([(85,120),(125,70),(165,120)],fill='#4b574e',width=6)
d.line([(125,70),(125,164)],fill='#dafb73',width=7)
for x,y,c in [(125,70,'#dafb73'),(125,120,'#dafb73'),(125,164,'#dafb73'),(85,120,'#4b574e'),(165,120,'#4b574e')]:d.ellipse((x-9,y-9,x+9,y+9),fill=c)
d.text((215,87),'jev-affected',font=font(66,True),fill='#f1f5f0')
d.line((80,213,1120,213),fill='#3b4940',width=2)
d.text((80,263),'Run tasks based on what changed,',font=font(43),fill='#f1f5f0')
d.text((80,328),'not where it changed.',font=font(43),fill='#dafb73')
d.text((80,500),'Semantic task routing powered by Jev.',font=font(27),fill='#b4c0b6')
d.text((80,555),'INDEPENDENT OPEN SOURCE  /  PUBLIC BETA',font=font(19),fill='#b4c0b6')
im.save(out/'social-card.png')
