import sys, pathlib, subprocess
from playwright.sync_api import sync_playwright
P = pathlib.Path(sys.argv[1]); mode = sys.argv[2]
R = 'file:///home/claude/joyrest-games'
import os, glob
# Папка снимков «Снимки игр» (ветка e2e-shots, папка shots/): SHOTS=/путь python3 render.py <папка> preview|frames
X = 'file://' + os.environ.get('SHOTS', '/tmp/shots')
html = (P/'promo.html').read_text().replace('url(R/', f'url({R}/').replace('"S/', f'"{R}/').replace("'S/", f"'{R}/").replace('"X/', f'"{X}/').replace("'X/", f"'{X}/")
(P/'_r.html').write_text(html)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=sorted(glob.glob('/opt/pw-browsers/chromium-*/chrome-linux*/chrome'))[-1], args=['--allow-file-access-from-files'])
    pg = b.new_page(viewport={'width':720,'height':1280}, device_scale_factor=1.5)
    pg.goto((P/'_r.html').as_uri()); pg.wait_for_timeout(1500)
    if mode == 'preview':
        for t in [1.5,4.5,6.8,8.0,9.3,10.8,12.0,14.5,17.5,20.2,21.8,23.9,26.5]:
            pg.evaluate(f'setT({t})'); pg.screenshot(path=str(P/f'pv_{t}.jpg'), type='jpeg', quality=80)
    else:
        out = P/'frames'; out.mkdir(exist_ok=True)
        n = int(27.73*30)
        for i in range(n):
            pg.evaluate(f'setT({i/30})'); pg.screenshot(path=str(out/f'{i:05d}.jpg'), type='jpeg', quality=92)
    b.close()
