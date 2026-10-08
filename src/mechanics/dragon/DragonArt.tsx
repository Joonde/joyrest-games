// Дракон на экране зала: свой рисунок (SVG), четыре окраса, живые эффекты — дыхание, взмах крыльев,
// искры, светящиеся глаза; удар героев — вспышка и тряска, удар дракона — струя пламени, повержен — серый и
// падает. Цвета — переменные окраса в styles.css (.dr-art--fire и т. д.), анимации — только transform/opacity.

export type DragonKind = "fire" | "ice" | "gold" | "shadow";
export type DragonMood = "idle" | "hurt" | "attack" | "hurtAttack" | "down";

const KINDS: DragonKind[] = ["fire", "ice", "gold", "shadow"];

/** Окрас по имени дракона («Огненный», «Ледяной», «Древний», «Теневой»), иначе — по номеру боя. */
export function dragonKind(name: string, index: number): DragonKind {
  const n = name.toLocaleLowerCase("ru");
  if (/огн|плам|жар|вулкан|красн/.test(n)) return "fire";
  if (/лед|лёд|снеж|мороз|зимн|ледян|голуб|син/.test(n)) return "ice";
  if (/древн|золот|изумруд|зел|лесн|болот|ядов/.test(n)) return "gold";
  if (/тен|тён|тьм|ночн|чёрн|черн|фиолет|сумер/.test(n)) return "shadow";
  return KINDS.at(index % KINDS.length) ?? "fire";
}

export function DragonArt({ kind, mood, pulse }: { kind: DragonKind; mood: DragonMood; pulse: string }) {
  const hurt = mood === "hurt" || mood === "hurtAttack";
  const attack = mood === "attack" || mood === "hurtAttack";
  return (
    <div className={`dr-art dr-art--${kind}${mood === "down" ? " is-down" : ""}`} aria-hidden="true">
      <span className="dr-art__aura" />
      {/* key: новая анимация на каждый удар. */}
      <div key={`${pulse}:${mood}`} className={`dr-art__shake${hurt ? " is-hurt" : ""}`}>
        <svg className="dr-art__svg" viewBox="0 0 240 180" overflow="visible">
          <g className="dr-art__bob">
            {/* Дальнее крыло */}
            <g className="dr-art__wing dr-art__wing--back">
              <path d="M132 84 L152 40 L138 8 Q120 22 98 14 Q104 30 90 42 Q106 50 104 68 Q120 68 124 84 Z" fill="var(--dr-dark)" />
            </g>
            {/* Хвост */}
            <path
              d="M82 112 C48 116 20 136 22 158 C24 172 44 176 52 164 C42 166 36 158 42 148 C52 134 70 130 88 130 Z"
              fill="var(--dr-main)"
            />
            <path d="M50 164 L34 172 L40 156 Z" fill="var(--dr-horn)" />
            {/* Задняя лапа */}
            <path d="M88 130 C80 148 84 160 96 162 L110 162 C104 156 100 148 104 136 Z" fill="var(--dr-dark)" />
            {/* Тело */}
            <path d="M70 120 C66 92 92 74 124 78 C150 82 164 102 158 126 C152 146 98 152 76 138 Z" fill="var(--dr-main)" />
            {/* Брюхо с пластинами */}
            <path d="M88 138 C108 134 134 132 154 122 C150 140 122 150 98 148 Z" fill="var(--dr-belly)" />
            <path d="M104 146 L108 136 M118 147 L121 135 M132 144 L134 132 M144 139 L146 128" stroke="var(--dr-dark)" strokeWidth="1.5" strokeLinecap="round" opacity="0.45" />
            {/* Шипы на спине */}
            <path d="M100 80 L106 66 L113 79 Z M116 77 L124 62 L130 78 Z M134 80 L143 65 L147 83 Z" fill="var(--dr-horn)" />
            {/* Передняя лапа с когтями */}
            <path d="M136 132 C136 148 138 158 148 162 L162 162 C156 156 152 146 154 128 Z" fill="var(--dr-main)" />
            <path d="M148 162 l3 5 l3 -5 M154 162 l3 5 l3 -5 M98 162 l3 5 l3 -5" stroke="var(--dr-horn)" strokeWidth="2" fill="none" strokeLinejoin="round" />
            {/* Шея */}
            <path d="M138 96 C150 72 160 58 176 48 L192 62 C178 72 170 86 160 106 Z" fill="var(--dr-main)" />
            <path d="M150 74 L158 60 L162 72 Z M162 62 L172 50 L174 62 Z" fill="var(--dr-horn)" />
            {/* Ближнее крыло — машет */}
            <g className="dr-art__wing dr-art__wing--front">
              <path d="M124 90 L140 44 L118 10 Q98 24 74 16 Q82 34 64 46 Q82 54 80 74 Q100 72 112 90 Z" fill="var(--dr-wing)" />
              <path d="M124 90 L140 44 L118 10 M118 10 L74 16 M118 10 L64 46 M118 10 L80 74" stroke="var(--dr-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
            </g>
            {/* Голова */}
            <g className="dr-art__head">
              <path d="M180 38 L168 10 L190 32 Z M194 32 L192 6 L206 30 Z" fill="var(--dr-horn)" />
              <path d="M172 46 C176 32 194 26 210 30 L230 38 C238 42 238 52 228 54 L208 58 C198 66 184 68 176 62 Z" fill="var(--dr-main)" />
              {/* Пасть: отблеск огня внутри */}
              <path className="dr-art__mouth" d="M200 56 L230 54 L224 60 Z" fill="var(--dr-fire2)" />
              <path className="dr-art__jaw" d="M194 60 L226 58 C224 66 212 70 202 68 Z" fill="var(--dr-dark)" />
              <path d="M210 56 l2 4 l2 -4 M218 55 l2 4 l2 -4" stroke="var(--dr-horn)" strokeWidth="1.5" fill="none" />
              <circle cx="230" cy="43" r="1.6" fill="var(--dr-dark)" />
              <path d="M196 35 L212 33 L210 37 Z" fill="var(--dr-dark)" />
              {/* Глаз */}
              <ellipse className="dr-art__eye" cx="204" cy="41" rx="5" ry="3.4" fill="var(--dr-eye)" />
              <rect x="203" y="38" width="2" height="6" rx="1" fill="var(--dr-dark)" className="dr-art__pupil" />
              <path className="dr-art__eye-x" d="M199 36 L209 44 M209 36 L199 44" stroke="var(--dr-dark)" strokeWidth="2" strokeLinecap="round" />
              {/* Дымок из ноздрей */}
              <circle className="dr-art__smoke dr-art__smoke--1" cx="234" cy="40" r="3" />
              <circle className="dr-art__smoke dr-art__smoke--2" cx="234" cy="40" r="2.4" />
            </g>
            {/* Струя пламени (удар дракона) */}
            {attack && (
              <g className="dr-art__breath" transform="translate(226 58)">
                <path className="dr-art__flame dr-art__flame--1" d="M0 0 C30 -26 80 -22 130 -6 C90 12 40 18 0 0 Z" fill="var(--dr-fire1)" />
                <path className="dr-art__flame dr-art__flame--2" d="M0 0 C26 -16 64 -14 104 -4 C68 8 32 12 0 0 Z" fill="var(--dr-fire2)" />
                <path className="dr-art__flame dr-art__flame--3" d="M0 0 C20 -8 46 -7 72 -2 C46 5 22 6 0 0 Z" fill="var(--dr-core)" />
              </g>
            )}
          </g>
          {/* Искры вокруг */}
          <g className="dr-art__embers">
            <circle cx="60" cy="150" r="2.2" />
            <circle cx="96" cy="160" r="1.6" />
            <circle cx="130" cy="156" r="2.4" />
            <circle cx="170" cy="150" r="1.8" />
            <circle cx="112" cy="120" r="1.4" />
            <circle cx="150" cy="110" r="2" />
          </g>
        </svg>
        {hurt && <span className="dr-art__flash" />}
      </div>
    </div>
  );
}
