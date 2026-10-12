const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const F = '/home/claude/joyrest-games/public/fonts/';
const LIST = [["Земфира","Хочешь?"],["Мумий Тролль","Владивосток 2000"],["Звери","Районы-кварталы"],["Руки Вверх!","Он тебя целует"],["Сплин","Выхода нет"],["Би-2","Полковнику никто не пишет"],["Ночные Снайперы","31-я весна"],["Валерий Меладзе","Салют, Вера"],["Дискотека Авария","Если хочешь остаться"],["Чичерина","Ту-лу-ла"],["Ленинград","WWW"],["Корни","Вика"],["Тату","Нас не догонят"],["Ёлка","Прованс"],["Uma2rman","Проститься"],["Агата Кристи","Как на войне"],["Hi-Fi","Седьмой лепесток"],["Вирус","Ты меня не ищи"],["Король и Шут","Лесник"],["Кино","Звезда по имени Солнце"],["Любэ","Конь"],["Мираж","Музыка нас связала"],["Ирина Аллегрова","С днём рождения"],["Ария","Беспечный ангел"]];
const face = (fam, w, file) => `@font-face{font-family:'${fam}';font-weight:${w};src:url(file://${F}${file}) format('woff2')}`;
const fonts = [face('Cormorant Garamond',700,'cormorant-garamond-cyrillic-700-normal.woff2'),face('Cormorant Garamond',700,'cormorant-garamond-latin-700-normal.woff2'),face('Cormorant Garamond',600,'cormorant-garamond-cyrillic-600-normal.woff2'),face('Cormorant Garamond',600,'cormorant-garamond-latin-600-normal.woff2'),face('Jost',500,'jost-cyrillic-500-normal.woff2'),face('Jost',500,'jost-latin-500-normal.woff2'),face('Jost',400,'jost-cyrillic-400-normal.woff2'),face('Jost',400,'jost-latin-400-normal.woff2'),face('Jost',600,'jost-cyrillic-600-normal.woff2'),face('Jost',600,'jost-latin-600-normal.woff2')].join('');
const T = {
  evening: { bg: 'loto-evening.png', top: 300, bottom: 1065, ink: '#F3ECE3', soft: '#C7BCAC', cell: 'rgba(42,38,33,.82)', line: 'rgba(227,198,140,.55)', title: '#E3C68C', mark: '#C49E96', markInk: '#221E1B', num: 7, songs: [0,5,10,15,2,7,12,17,4,9,14,19,6,11,16,21], marked: [0,5,10] },
  day: { bg: 'loto-day.png', top: 330, bottom: 1060, ink: '#322D28', soft: '#6B6256', cell: 'rgba(255,255,255,.78)', line: 'rgba(154,116,68,.55)', title: '#8A5148', mark: '#A3C2AA', markInk: '#221E1B', num: 12, songs: [1,3,8,13,18,20,22,23,6,9,11,16,4,14,19,0], marked: [3,6,9,12] },
};
function html(k){ const t=T[k];
  const cells = t.songs.map((s,i)=>{const [a,ti]=LIST[s]; const on=t.marked.includes(i); return `<div class="c${on?' on':''}"><b>${ti}</b><span>${a}</span>${on?'<i>♪</i>':''}</div>`}).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
  body{margin:0;width:960px;height:1280px;position:relative;background:url(${t.bg}) center/cover;font-family:Jost}
  .h{position:absolute;left:0;right:0;top:${t.top}px;text-align:center}
  .h h1{margin:0;font:700 60px/1 'Cormorant Garamond';color:${t.title};letter-spacing:.02em}
  .h p{margin:10px 0 0;font:500 19px Jost;letter-spacing:.24em;text-transform:uppercase;color:${t.soft}}
  .g{position:absolute;left:150px;right:150px;top:${t.top+120}px;bottom:${1280-t.bottom}px;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:1fr;gap:12px}
  .c{position:relative;border:1.5px solid ${t.line};border-radius:16px;background:${t.cell};display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:10px 8px;gap:6px}
  .c b{font:700 25px/1.08 'Cormorant Garamond';color:${t.ink}}
  .c span{font:400 14.5px/1.2 Jost;color:${t.soft}}
  .c.on{background:${t.mark};border-color:${t.mark}}
  .c.on b,.c.on span{color:${t.markInk}}
  .c i{position:absolute;top:6px;right:9px;font-style:normal;font-size:20px;color:${t.markInk}}
  </style></head><body><div class="h"><h1>Музыкальное лото</h1><p>Карточка № ${t.num} · одна линия</p></div><div class="g">${cells}</div></body></html>`;}
(async()=>{
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
  const p = await b.newPage({viewport:{width:960,height:1280}});
  for (const k of Object.keys(T)){ fs.writeFileSync(`card-${k}.html`, html(k)); await p.goto('file://'+process.cwd()+`/card-${k}.html`); await p.evaluate(()=>document.fonts.ready); await p.screenshot({path:`card-${k}.png`}); }
  await b.close();
})();
