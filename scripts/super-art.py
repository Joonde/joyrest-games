# Нарезка листов суперигры (Canva, public/super/art/*.png) на WebP 384 px по уровням и фон сокровищницы.
# Запуск: python3 scripts/super-art.py (из любой папки; пишет в public/super/art/web/).
import numpy as np, os
from PIL import Image
from scipy import ndimage
src=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','public','super','art')+'/'
out=src+'web/'; os.makedirs(out,exist_ok=True)
names=['bronze','silver','gold','diamond']
for sheet in ['chests','chests-open','keys','crowns','cups']:
    a=np.asarray(Image.open(src+sheet+'.png').convert('RGB')).astype(float)
    bg=np.median(a[:20,:,:].reshape(-1,3),axis=0)
    d=np.sqrt(((a-bg)**2).sum(2)); H,W=d.shape
    for i in range(4):
        x0,x1=i*W//4,(i+1)*W//4
        dz=d[:,x0:x1].copy(); m=dz>28
        lab,n=ndimage.label(ndimage.binary_dilation(m,iterations=3))
        sizes=ndimage.sum(m,lab,range(1,n+1)); big=sizes.max()
        good=np.zeros(n+1,bool)
        for k,sl in enumerate(ndimage.find_objects(lab)):
            edge = sl[1].start<=2 or sl[1].stop>=m.shape[1]-2
            good[k+1] = sizes[k] >= big*0.002 and not (edge and sizes[k]<big*0.05)
        keep=good[lab]
        dz[~keep]=0; m=m&keep
        ys,xs=np.where(m)
        top,bot=max(ys.min()-16,0),min(ys.max()+16,H); l,r=max(xs.min()-16,0),min(xs.max()+16,x1-x0)
        crop=a[top:bot,x0+l:x0+r]; alpha=np.clip((dz[top:bot,l:r]-10)/40,0,1)
        o=Image.fromarray(np.dstack([crop,alpha*255]).astype(np.uint8),'RGBA')
        side=max(o.size); c=Image.new('RGBA',(side,side),(0,0,0,0)); c.paste(o,((side-o.width)//2,(side-o.height)//2))
        c=c.resize((384,384),Image.LANCZOS)
        c.save(f'{out}{sheet}-{names[i]}.webp','WEBP',quality=82,method=4)
v=Image.open(src+'vault.png').convert('RGB')
v.resize((1920,1080),Image.LANCZOS).save(out+'vault.webp','WEBP',quality=78,method=4)
v.resize((1280,720),Image.LANCZOS).save(out+'vault-1280.webp','WEBP',quality=78,method=4)
