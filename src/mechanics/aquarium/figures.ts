// Фигуры «Аквариума и Ёлки» — перенесены из согласованного прототипа (18 октября 2026) без изменений: рыбки смотрят
// вправо (+x), игрушки висят сверху. Контуры — строки SVG-путей в координатах листа раскраски (w × h). Движок раскрасок —
// по мотивам Paper Aquarium (автор MrMoT9I, MIT): плоский силуэт «надувается» в объёмную фигуру.

export type FigureKind = "fish" | "orn";

export interface FigurePart {
  /** Какие контуры — отдельная часть (лапы черепашки). */
  idx: number[];
  pivot: [number, number];
  flap: number;
  sweep: number;
  ph: number;
}

export interface FigureDef {
  id: string;
  name: string;
  kind: FigureKind;
  w: number;
  h: number;
  size?: number;
  puff?: number;
  wave?: number;
  speed?: number;
  /** Контуры тела (без отдельных частей). */
  body?: number[];
  parts?: FigurePart[];
  shapes: string[];
  accent?: number[];
  details: string[];
  eyes?: Array<[number, number, number]>;
  metal?: number[];
  dots?: Array<[number, number, number]>;
  fills?: Array<[string, string]>;
  style?: "snow" | "plain" | "cane";
  pal?: [string, string, string];
}

const ell = (cx: number, cy: number, rx: number, ry: number) => `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
const circ = (cx: number, cy: number, r: number) => ell(cx, cy, r, r);

function starPath(cx: number, cy: number, ro: number, ri: number, n: number): string {
  let s = "";
  for (let k = 0; k < n * 2; k++) {
    const r = k % 2 ? ri : ro;
    const a = -Math.PI / 2 + (k * Math.PI) / n;
    s += (k ? " L " : "M ") + (cx + Math.cos(a) * r).toFixed(1) + " " + (cy + Math.sin(a) * r).toFixed(1);
  }
  return s + " Z";
}

function spikes(cx: number, cy: number, r0: number, r1: number, angles: number[]): string[] {
  return angles.map((deg) => {
    const a = (deg * Math.PI) / 180;
    const w = 0.13;
    const p = (ang: number, r: number) => (cx + Math.cos(ang) * r).toFixed(1) + " " + (cy + Math.sin(ang) * r).toFixed(1);
    return `M ${p(a - w, r0)} L ${p(a, r1)} L ${p(a + w, r0)} Z`;
  });
}

function armRect(cx: number, cy: number, ang: number, r0: number, r1: number, w: number): string {
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const nx = (-sn * w) / 2;
  const ny = (c * w) / 2;
  const q = (r: number, o: number) => (cx + c * r + o * nx).toFixed(1) + " " + (cy + sn * r + o * ny).toFixed(1);
  return `M ${q(r0, -1)} L ${q(r1, -1)} L ${q(r1, 1)} L ${q(r0, 1)} Z`;
}

export const FISH: FigureDef[] = [
  { id:'clown', name:'Клоун', kind:'fish', w:512, h:256, size:1.15,
    shapes:[ ell(290,128,165,80), 'M 150 128 L 46 58 Q 22 128 46 198 Z', 'M 215 64 Q 282 2 365 60 Z', 'M 238 190 Q 288 246 332 194 Z' ],
    accent:[1,2,3], details:[ circ(408,108,13), 'M 372 62 Q 344 128 372 194', 'M 456 142 Q 444 150 430 145', 'M 62 96 L 140 124', 'M 62 160 L 140 132' ], eyes:[[408,108,13]] },
  { id:'angel', name:'Скалярия', kind:'fish', w:512, h:256, size:1.05,
    shapes:[ ell(300,128,125,88), 'M 235 66 L 200 6 Q 300 16 375 72 Z', 'M 235 190 L 200 250 Q 300 240 375 184 Z', 'M 192 128 L 90 62 Q 72 128 90 194 Z' ],
    accent:[1,2,3], details:[ circ(388,112,12), 'M 268 46 L 268 210', 'M 328 42 L 328 214', 'M 420 138 Q 410 146 398 142' ], eyes:[[388,112,12]] },
  { id:'puffer', name:'Рыба-шар', kind:'fish', w:512, h:256, size:.95, puff:.85,
    shapes:[ circ(300,128,100), 'M 212 128 L 128 78 Q 110 128 128 178 Z' ].concat(spikes(300,128,92,124,[-125,-95,-65,-35,35,65,95,125,150,-150])),
    accent:[1], details:[ circ(346,100,16), 'M 394 140 Q 386 152 374 147', circ(280,160,9), circ(250,110,7), circ(310,182,6) ], eyes:[[346,100,16]] },
  { id:'whale', name:'Китёнок', kind:'fish', w:512, h:256, size:1.3,
    shapes:[ 'M 472 150 C 476 80 402 44 300 46 C 210 48 160 88 128 118 C 110 108 90 94 70 66 C 54 98 60 118 84 128 C 60 138 54 158 70 190 C 90 162 110 148 128 138 C 170 186 230 212 310 210 C 412 208 470 198 472 150 Z',
             'M 296 178 Q 310 238 248 232 Q 258 204 276 182 Z' ],
    accent:[1], details:[ circ(404,118,10), 'M 470 162 Q 424 178 384 166', 'M 330 196 Q 400 204 458 182', 'M 344 182 Q 404 188 452 172' ], eyes:[[404,118,10]] },
  { id:'shark', name:'Акулёнок', kind:'fish', w:512, h:256, size:1.35,
    shapes:[ 'M 486 140 C 470 100 400 78 300 80 C 230 82 170 100 130 120 L 50 50 Q 60 110 74 128 Q 62 150 56 210 L 130 140 C 180 170 260 182 330 178 C 420 174 480 160 486 140 Z',
             'M 258 86 Q 290 20 332 28 Q 318 60 330 84 Z', 'M 332 172 Q 332 232 280 238 Q 290 202 300 174 Z' ],
    accent:[1,2], details:[ circ(430,118,9), 'M 386 112 Q 380 130 386 148', 'M 372 114 Q 366 130 372 146', 'M 484 146 Q 452 160 420 156', 'M 470 152 Q 380 170 220 160' ], eyes:[[430,118,9]] },
  { id:'gold', name:'Золотая рыбка', kind:'fish', w:512, h:256, size:1.05,
    shapes:[ ell(330,128,110,72), 'M 236 128 C 180 60 90 20 30 40 C 70 90 60 110 100 128 C 60 146 70 166 30 216 C 90 236 180 196 236 128 Z', 'M 280 66 Q 320 10 380 64 Z', 'M 300 190 Q 300 236 260 240 Q 270 210 282 192 Z' ],
    accent:[1,2,3], details:[ circ(400,108,13), 'M 222 120 Q 140 80 60 56', 'M 222 136 Q 140 176 60 200', 'M 212 128 L 90 128', 'M 362 70 Q 340 128 362 186' ], eyes:[[400,108,13]] },
  { id:'butterfly', name:'Рыба-бабочка', kind:'fish', w:512, h:256, size:1.0,
    shapes:[ ell(280,128,120,100), 'M 380 112 L 472 120 L 472 136 L 380 146 Z', 'M 172 128 L 96 84 Q 84 128 96 172 Z', 'M 200 62 Q 280 2 360 56 Z' ],
    accent:[2,3], details:[ circ(372,104,11), 'M 334 32 Q 346 128 334 224', 'M 240 30 L 240 226', 'M 200 50 L 200 206' ], eyes:[[372,104,11]] },
  { id:'sword', name:'Рыба-меч', kind:'fish', w:512, h:256, size:1.45,
    shapes:[ ell(280,128,150,52), 'M 418 118 L 508 126 L 508 130 L 418 140 Z', 'M 138 128 L 50 36 Q 96 128 50 220 Z', 'M 220 86 Q 240 10 330 28 Q 330 60 340 84 Z' ],
    accent:[2,3], details:[ circ(400,118,9), 'M 380 100 Q 370 128 380 156', 'M 160 140 Q 280 170 410 140' ], eyes:[[400,118,9]] },
  { id:'turtle', name:'Черепашка', kind:'fish', w:512, h:256, size:1.2, wave:0, speed:.55, puff:1.2, body:[0,1,4],
    parts:[{idx:[2],pivot:[352,178],flap:.7,sweep:.3,ph:0},{idx:[3],pivot:[154,182],flap:.5,sweep:.25,ph:1.6}],
    shapes:[ ell(260,140,150,80), circ(430,132,36), 'M 330 180 Q 380 242 442 236 Q 420 206 360 170 Z', 'M 160 186 Q 120 232 78 224 Q 110 196 150 172 Z', 'M 114 136 L 66 150 L 114 162 Z' ],
    accent:[1,2,3,4], details:[ 'M 150 96 Q 260 70 370 96', 'M 116 150 Q 260 170 404 150', 'M 200 74 L 200 206', 'M 260 62 L 260 216', 'M 320 70 L 320 208', circ(446,122,7), 'M 466 142 Q 456 148 444 146' ], eyes:[[446,122,7]] },
  { id:'dolphin', name:'Дельфин', kind:'fish', w:512, h:256, size:1.4,
    shapes:[ 'M 500 150 C 470 140 450 136 440 130 C 420 80 360 62 290 66 C 220 70 160 100 120 130 L 60 96 Q 66 128 80 140 Q 60 156 54 190 L 126 150 C 190 186 300 196 380 180 C 420 172 450 162 500 156 Z',
             'M 268 72 Q 270 18 322 16 Q 300 40 318 70 Z', 'M 330 180 Q 320 232 270 228 Q 290 206 296 184 Z' ],
    accent:[1,2], details:[ circ(420,118,8), 'M 498 154 Q 470 160 440 156', 'M 440 150 Q 330 178 200 158' ], eyes:[[420,118,8]] }
];
const ring = circ(128, 22, 15);
const cap = 'M 104 32 H 152 V 62 H 104 Z';
const pcd: string[] = [];
for (let y = 100, r = 0; y <= 290; y += 30, r++) {
  for (let x = 72 + (r % 2) * 20; x <= 190; x += 40) pcd.push(`M ${x - 20} ${y} Q ${x} ${y + 22} ${x + 20} ${y}`);
}
const flake: string[] = [ ring, 'M 120 32 H 136 V 80 H 120 Z', circ(128,180,34) ];
for (let k = 0; k < 6; k++) {
  const a = -Math.PI / 2 + (k * Math.PI) / 3;
  flake.push(armRect(128, 180, a, 0, 108, 24));
  [-0.8, 0.8].forEach((o) => flake.push(armRect(128 + Math.cos(a) * 62, 180 + Math.sin(a) * 62, a + o, 0, 40, 15)));
}
export const ORN: FigureDef[] = [
  { id:'ball', name:'Шар', kind:'orn', w:256, h:320, shapes:[ ring, cap, circ(128,190,112) ], metal:[0,1],
    details:[ 'M 22 168 Q 128 206 234 168', 'M 20 214 Q 128 252 236 214', 'M 116 32 V 62', 'M 140 32 V 62' ] },
  { id:'star', name:'Звезда', kind:'orn', w:256, h:320, shapes:[ ring, 'M 112 32 H 144 V 60 H 112 Z', starPath(128,188,126,56,5) ], metal:[0,1],
    details:[ starPath(128,188,62,28,5) ] },
  { id:'bell', name:'Колокольчик', kind:'orn', w:256, h:320,
    shapes:[ ring, 'M 114 32 H 142 V 58 H 114 Z', 'M 128 52 C 70 52 60 120 58 190 C 56 238 34 258 26 272 L 230 272 C 222 258 200 238 198 190 C 196 120 186 52 128 52 Z', circ(128,288,22) ], metal:[0,1], accent:[3],
    details:[ 'M 50 232 Q 128 252 206 232', 'M 64 150 Q 128 166 192 150' ] },
  { id:'icicle', name:'Сосулька', kind:'orn', w:256, h:320, shapes:[ ring, 'M 108 32 H 148 V 58 H 108 Z', 'M 84 56 Q 128 42 172 56 Q 152 180 128 316 Q 104 180 84 56 Z' ], metal:[0,1],
    details:[ 'M 94 100 Q 128 124 162 96', 'M 104 160 Q 128 178 152 156', 'M 114 222 Q 128 234 142 216' ] },
  { id:'snow', name:'Снеговик', kind:'orn', w:256, h:320, style:'snow',
    shapes:[ ring, 'M 96 34 H 160 V 74 H 178 V 90 H 78 V 74 H 96 Z', circ(128,128,52), circ(128,236,80), 'M 78 168 Q 128 192 178 168 L 182 188 Q 128 212 74 188 Z' ],
    metal:[0], accent:[1,4], details:[ 'M 128 132 L 160 140 L 128 144', 'M 108 152 Q 128 162 148 152' ],
    dots:[[110,118,5],[146,118,5],[128,222,6],[128,254,6]], fills:[['M 128 132 L 160 140 L 128 144 Z','#ff8a2a']] },
  { id:'heart', name:'Сердце', kind:'orn', w:256, h:320, shapes:[ ring, 'M 116 32 H 140 V 110 H 116 Z', 'M 128 300 C 40 230 10 180 20 120 C 30 70 100 56 128 104 C 156 56 226 70 236 120 C 246 180 216 230 128 300 Z' ], metal:[0,1],
    details:[ 'M 60 130 Q 70 100 96 96', 'M 128 180 C 108 160 92 170 100 190 C 108 206 128 220 128 220 C 128 220 148 206 156 190 C 164 170 148 160 128 180 Z' ] },
  { id:'cone', name:'Шишка', kind:'orn', w:256, h:320, pal:['#9c6b3c','#e8c48a','#4a2c17'], style:'plain',
    shapes:[ ring, cap, 'M 128 56 C 190 56 214 140 200 220 C 190 280 150 314 128 316 C 106 314 66 280 56 220 C 42 140 66 56 128 56 Z' ], metal:[0,1], details:pcd },
  { id:'mitten', name:'Варежка', kind:'orn', w:256, h:320,
    shapes:[ circ(128,26,15), 'M 70 40 H 190 V 90 H 70 Z', 'M 78 86 L 78 220 C 78 292 190 300 196 220 L 200 150 C 230 140 236 100 214 92 C 196 86 190 110 188 120 L 186 86 Z' ], metal:[0], accent:[1],
    details:[ 'M 70 64 H 190', 'M 132 160 L 132 220 M 104 190 L 160 190 M 112 170 L 152 210 M 152 170 L 112 210' ] },
  { id:'sock', name:'Носок', kind:'orn', w:256, h:320,
    shapes:[ circ(120,22,15), 'M 66 34 H 176 V 86 H 66 Z', 'M 74 84 L 74 200 C 74 230 60 240 50 250 C 20 280 50 320 90 306 L 160 276 C 186 264 172 236 168 210 L 168 84 Z' ], metal:[0], accent:[1],
    details:[ 'M 168 232 Q 140 250 150 280', 'M 62 268 Q 90 262 100 300', 'M 74 150 H 168' ] },
  { id:'cane', name:'Леденец', kind:'orn', w:256, h:320, style:'cane', puff:.8,
    shapes:[ 'M 150 316 L 150 110 C 150 70 106 70 106 110 L 106 130 L 70 130 L 70 110 C 70 30 186 30 186 110 L 186 316 Z' ], details:[] },
  { id:'house', name:'Пряничный домик', kind:'orn', w:256, h:320, pal:['#c47a3d','#ffffff','#e63946'], style:'plain',
    shapes:[ circ(128,30,15), 'M 20 150 L 128 46 L 236 150 Z', 'M 46 140 H 210 V 300 H 46 Z', 'M 170 70 H 196 V 130 H 170 Z' ], metal:[0], accent:[1],
    details:[ 'M 110 300 V 236 Q 128 216 146 236 V 300', 'M 66 180 H 100 V 214 H 66 Z', 'M 156 180 H 190 V 214 H 156 Z', 'M 30 152 Q 50 170 70 152 Q 90 170 110 152 Q 130 170 150 152 Q 170 170 190 152 Q 210 170 230 152' ] },
  { id:'drop', name:'Капля', kind:'orn', w:256, h:320, shapes:[ ring, cap, 'M 128 56 C 128 56 220 170 220 230 C 220 290 176 316 128 316 C 80 316 36 290 36 230 C 36 170 128 56 128 56 Z' ], metal:[0,1],
    details:[ 'M 50 220 Q 128 246 206 220', 'M 80 160 Q 128 176 176 160', 'M 44 268 Q 128 292 212 268' ] },
  { id:'flake', name:'Снежинка', kind:'orn', w:256, h:320, shapes:flake, metal:[0,1], details:[ circ(128,180,16) ] }
];

export const ALL_FIGURES: FigureDef[] = [...FISH, ...ORN];

export function figureById(id: string): FigureDef | null {
  return ALL_FIGURES.find((f) => f.id === id) ?? null;
}

/** Фигуры сцены: рыбки — для аквариума, игрушки — для ёлки. */
export function figuresOf(scene: "aqua" | "tree"): FigureDef[] {
  return scene === "aqua" ? FISH : ORN;
}
