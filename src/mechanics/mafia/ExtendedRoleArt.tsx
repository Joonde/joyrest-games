import { useId } from "react";
import { ROLES, type RoleId } from "./content";

export type ExtendedRoleId = Extract<RoleId, "courtesan" | "maniac" | "advocate">;

/** Векторные портреты новых ролей в классической стилистике JoyRest. */
export function ExtendedRoleArt({ role }: { role: ExtendedRoleId }) {
  const uid = useId().replace(/:/g, "");
  const id = (name: string) => `mf-ext-${name}-${uid}`;
  return (
    <svg className={`mf-art mf-art--${role}`} viewBox="0 0 200 250" role="img" aria-label={ROLES[role].title}>
      <defs>
        <radialGradient id={id("halo")} cx="50%" cy="38%" r="62%">
          <stop offset="0" stopColor="var(--mf-glow)" stopOpacity="0.72" />
          <stop offset="1" stopColor="var(--mf-glow)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id("suit")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--mf-suit-top)" />
          <stop offset="1" stopColor="var(--mf-suit-bottom)" />
        </linearGradient>
        <linearGradient id={id("skin")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f0cdb0" />
          <stop offset="1" stopColor="#c88f70" />
        </linearGradient>
        <linearGradient id={id("rim")} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--mf-glow)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--mf-glow)" stopOpacity="0.75" />
        </linearGradient>
      </defs>
      <circle className="mf-art__halo" cx="100" cy="100" r="97" fill={`url(#${id("halo")})`} />
      {role === "courtesan" ? <Courtesan id={id} /> : role === "maniac" ? <Maniac id={id} /> : <Advocate id={id} />}
    </svg>
  );
}

type Id = (name: string) => string;

function Eyes({ mood = "calm" }: { mood?: "calm" | "sharp" | "sly" | "tired" }) {
  const brow = mood === "sharp" ? "M83 105 L96 102 M104 102 L117 105" : mood === "sly" ? "M83 104 L96 108 M104 108 L117 103" : mood === "tired" ? "M84 105 Q90 104 96 101 M104 101 Q110 104 116 105" : "M84 104 Q90 101 96 104 M104 104 Q110 101 116 104";
  return (
    <g>
      <path d={brow} stroke="#352219" strokeWidth="2.8" strokeLinecap="round" fill="none" />
      <ellipse cx="91" cy="114" rx="5" ry={mood === "sly" ? 2.5 : 3.5} fill="#fff8ee" />
      <ellipse cx="109" cy="114" rx="5" ry={mood === "sly" ? 2.5 : 3.5} fill="#fff8ee" />
      <g className={mood === "sharp" ? "mf-art__look" : undefined} fill="#281b19">
        <circle cx="92" cy="114" r="2.3" />
        <circle cx="110" cy="114" r="2.3" />
      </g>
      <g className="mf-art__blink" fill="#d9a888">
        <ellipse cx="91" cy="114" rx="5.6" ry="4" />
        <ellipse cx="109" cy="114" rx="5.6" ry="4" />
      </g>
    </g>
  );
}

function FaceBase({ id, children, mood = "calm" }: { id: Id; children?: React.ReactNode; mood?: "calm" | "sharp" | "sly" | "tired" }) {
  return (
    <g>
      <ellipse cx="72" cy="118" rx="5" ry="9" fill="#d9a888" />
      <ellipse cx="128" cy="118" rx="5" ry="9" fill="#d9a888" />
      <path d="M88 140 h24 v23 c-8 5 -16 5 -24 0 Z" fill="#d9a888" />
      <path d="M72 108 C72 84 84 76 100 76 C116 76 128 84 128 108 C128 130 116 146 100 146 C84 146 72 130 72 108 Z" fill={`url(#${id("skin")})`} />
      <path d="M113 80 C125 88 128 99 128 110 C127 130 116 146 100 146 C112 136 117 121 116 104 C115 92 113 84 113 80 Z" fill="#9f6758" opacity="0.35" />
      <Eyes mood={mood} />
      <path d="M100 115 C98 122 97 126 100 128 C102 129 104 128 104 127" stroke="#a8745a" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d={mood === "sly" ? "M91 135 Q100 139 110 132" : mood === "sharp" ? "M91 135 L109 134" : mood === "tired" ? "M92 137 Q100 131 108 137" : "M92 134 Q100 140 108 134"} stroke="#803c3c" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {children}
    </g>
  );
}

function Courtesan({ id }: { id: Id }) {
  return (
    <g>
      <path d="M8 250 V0 H52 C40 46 47 102 34 153 C26 190 32 220 40 250 Z" fill="#4b101e" opacity="0.75" />
      <path d="M192 250 V0 H151 C163 49 154 98 166 150 C177 194 169 221 160 250 Z" fill="#4b101e" opacity="0.75" />
      <path d="M18 0 C30 55 21 112 34 158 M181 0 C169 55 180 112 166 158" stroke="#d89a9f" strokeOpacity="0.25" strokeWidth="3" fill="none" />
      <g transform="translate(159 132)">
        <path d="M0 0 V49" stroke="#b58a4a" strokeWidth="3" />
        <path d="M-12 49 H12" stroke="#b58a4a" strokeWidth="4" strokeLinecap="round" />
        <path className="mf-art__flame" d="M0 -2 C-7 -10 -2 -18 0 -23 C5 -15 6 -8 0 -2 Z" fill="#ffd27a" />
        <ellipse cx="0" cy="3" rx="17" ry="23" fill="#ffd27a" opacity="0.12" />
      </g>
      <g className="mf-art__body">
        <path d="M10 250 C18 191 51 162 100 158 C149 162 182 191 190 250 Z" fill={`url(#${id("suit")})`} />
        <path d="M72 160 L100 181 L128 160 C118 157 109 156 100 157 C91 156 82 157 72 160 Z" fill={`url(#${id("skin")})`} />
        <path d="M68 159 L100 185 L132 159 L142 176 L121 197 L100 184 L79 197 L58 176 Z" fill="#2a1a1d" stroke="#725054" strokeWidth="1.5" />
        <path d="M52 178 L75 250 M148 178 L125 250" stroke="#6e4850" strokeOpacity="0.45" strokeWidth="2" fill="none" />
        <path d="M145 169 C165 186 176 210 180 250 H170 C165 211 154 186 137 175 Z" fill={`url(#${id("rim")})`} />
        <path d="M69 108 C58 91 66 69 98 65 C128 62 142 82 134 108 L143 174 C139 188 123 185 118 163 L122 129 C130 111 125 91 111 82 C102 93 84 91 75 105 L79 159 C75 180 60 187 54 174 L65 119 Z" fill="#27191d" />
        <FaceBase id={id} mood="sharp">
          <path d="M83 121 Q91 124 96 122 M104 122 Q111 125 118 121 M88 141 L85 145 M112 141 L115 145" stroke="#9b6e60" strokeWidth="1.4" fill="none" opacity="0.7" />
          <path d="M85 110 L80 107 M88 108 L86 104 M115 110 L120 107 M112 108 L114 104" stroke="#2b1b1b" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M92 134 Q100 139 108 134 Q100 143 92 134 Z" fill="#8f3a45" opacity="0.85" />
        </FaceBase>
        <ellipse className="mf-art__eyeglow" cx="91" cy="113" rx="7" ry="3" fill="var(--mf-accent)" opacity="0.75" />
        <ellipse className="mf-art__eyeglow" cx="109" cy="113" rx="7" ry="3" fill="var(--mf-accent)" opacity="0.75" />
        <path d="M69 108 C62 83 77 65 99 66 C124 62 139 82 130 111 C127 93 119 86 111 82 C103 93 84 91 75 105 L75 133 C66 126 64 116 69 108 Z" fill="#27191d" />
        <path d="M72 91 C58 108 70 131 62 145 M127 88 C143 104 130 126 139 142 M75 74 L64 61 M122 72 L136 58" stroke="#5c3034" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d="M82 161 Q100 170 118 161" stroke="#3b2428" strokeWidth="4" fill="none" />
        <g className="mf-art__rose" transform="translate(57 190)">
          <path d="M0 5 L8 47" stroke="#45623d" strokeWidth="3" />
          <path d="M4 27 Q-8 19 -9 31 Q0 34 4 27 M6 35 Q18 25 19 38 Q12 42 6 35" fill="#52734a" />
          <circle cx="0" cy="0" r="11" fill="#a71935" />
          <path d="M-7 -2 Q0 -12 7 -2 Q3 8 -5 5 Q-10 1 -7 -2 Z" fill="#d13c55" />
          <path d="M-3 -3 Q2 -7 5 -1 Q2 5 -3 2 Z" fill="#7e1029" />
        </g>
        <g transform="translate(132 205)">
          <path d="M0 25 L-30 -5 Q0 -23 30 -5 Z" fill="#17131b" stroke="#d8a9b2" strokeOpacity="0.55" />
          <path d="M0 25 L-21 -10 M0 25 L-10 -16 M0 25 L10 -16 M0 25 L21 -10" stroke="#d8a9b2" strokeOpacity="0.45" />
          <circle cx="0" cy="25" r="4" fill="#e3c68c" />
        </g>
      </g>
    </g>
  );
}

function Maniac({ id }: { id: Id }) {
  return (
    <g>
      <circle cx="155" cy="45" r="18" fill="#d9c8e8" opacity="0.55" />
      <circle cx="162" cy="40" r="17" fill="var(--mf-bg2)" />
      <g fill="#0c0c13" opacity="0.85">
        <path d="M0 250 V105 H34 V250 Z M165 250 V82 H200 V250 Z" />
        <path d="M25 250 V142 H58 V250 Z M143 250 V128 H173 V250 Z" />
      </g>
      <g stroke="#c5b1df" strokeOpacity="0.22" strokeWidth="1.4" className="mf-art__rain">
        {Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${(i * 37) % 200} ${(i * 29) % 130} l-5 17`} />)}
      </g>
      <g className="mf-art__body" transform="translate(-3 3) rotate(4 100 170)">
        <path d="M13 250 C18 188 54 160 100 157 C146 159 181 188 187 250 Z" fill={`url(#${id("suit")})`} />
        <path d="M52 159 L79 197 L100 166 L121 197 L148 156 L136 250 H64 Z" fill="#17191d" stroke="#4c4654" strokeWidth="2" />
        <path d="M82 160 L100 188 L118 160 L108 202 H92 Z" fill="#a9a29a" />
        <path d="M97 172 H104 L108 199 L100 207 L93 199 Z" fill="#3b252d" />
        <path d="M144 170 C165 187 176 213 180 250 H170 C165 211 154 186 137 175 Z" fill={`url(#${id("rim")})`} />
        <path d="M119 188 Q126 183 131 191 L128 202 Q119 201 119 188 M71 214 Q78 209 82 217 L78 225 Q70 224 71 214" fill="#6f1422" opacity="0.85" />
        <FaceBase id={id} mood="tired">
          <path d="M83 121 Q90 126 96 123 M104 123 Q111 127 118 121" stroke="#6f5052" strokeWidth="2.4" fill="none" opacity="0.8" />
        </FaceBase>
        <ellipse className="mf-art__eyeglow" cx="91" cy="113" rx="7" ry="3" fill="var(--mf-accent)" opacity="0.85" />
        <ellipse className="mf-art__eyeglow" cx="109" cy="113" rx="7" ry="3" fill="var(--mf-accent)" opacity="0.85" />
        <path d="M70 103 C67 80 82 66 102 68 C123 66 133 82 129 105 L121 89 L114 94 L106 81 L97 91 L86 82 L76 101 Z" fill="#17151b" />
        <path d="M75 99 L86 104 M125 98 L115 104 M75 81 L64 68 M91 74 L83 60 M117 76 L129 62" stroke="#17151b" strokeWidth="4.5" strokeLinecap="round" />
        <g transform="translate(48 199) rotate(12)">
          <ellipse cx="0" cy="-6" rx="8" ry="11" fill={`url(#${id("skin")})`} />
          <path d="M-6 -12 Q0 -7 6 -11 M-5 -5 Q0 0 5 -4" stroke="#8b1b28" strokeWidth="3" fill="none" />
          <path d="M0 0 L-5 40 L5 40 Z" fill="#b9c5cf" stroke="#e4e9ef" strokeWidth="1" />
          <path d="M-4 23 L-5 40 L5 40 L3 22 Q0 27 -4 23 Z" fill="#8b1424" />
          <path d="M0 5 V22" stroke="#6f7a86" />
          <rect x="-5" y="-12" width="10" height="16" rx="3" fill="#211a1e" />
          <circle cx="6" cy="34" r="2.2" fill="#9c1829" />
        </g>
      </g>
    </g>
  );
}

function Advocate({ id }: { id: Id }) {
  return (
    <g>
      <g opacity="0.5">
        <rect x="8" y="38" width="46" height="134" rx="2" fill="#17100c" stroke="#9c7945" />
        <path d="M12 78 H50 M12 122 H50" stroke="#9c7945" strokeWidth="3" />
        <g fill="#5b3130">
          <rect x="15" y="48" width="7" height="27" /><rect x="25" y="44" width="9" height="31" /><rect x="38" y="51" width="8" height="24" />
          <rect x="15" y="88" width="9" height="31" /><rect x="28" y="93" width="7" height="26" /><rect x="39" y="85" width="7" height="34" />
        </g>
      </g>
      <g transform="translate(158 87)">
        <path d="M0 18 V88 M-17 88 H17" stroke="#b89855" strokeWidth="3" />
        <path d="M-30 27 H30 M0 12 L-25 27 M0 12 L25 27" stroke="#c9aa68" strokeWidth="2" />
        <path d="M-36 28 Q-25 46 -14 28 Z M14 28 Q25 46 36 28 Z" fill="#9f7c42" />
        <circle cx="0" cy="12" r="4" fill="#e3c68c" />
      </g>
      <g className="mf-art__body">
        <path d="M18 250 C24 186 58 158 100 157 C142 158 176 186 182 250 Z" fill={`url(#${id("suit")})`} />
        <path d="M75 161 L100 194 L125 161 L116 250 H84 Z" fill="#1a243b" stroke="#60708f" strokeOpacity="0.5" />
        <path d="M82 160 L100 186 L118 160 L108 199 H92 Z" fill="#eee7dc" />
        <path d="M97 170 H104 L108 197 L100 205 L93 197 Z" fill="#263c62" />
        <path d="M75 165 L88 210 M125 165 L112 210" stroke="#9baecc" strokeOpacity="0.45" strokeWidth="2" />
        <path d="M144 170 C165 187 176 213 180 250 H170 C165 211 154 186 137 175 Z" fill={`url(#${id("rim")})`} />
        <FaceBase id={id} mood="sly">
          <g fill="none" stroke="#c5a66a" strokeWidth="2">
            <circle cx="90" cy="114" r="10" /><circle cx="111" cy="114" r="10" /><path d="M100 113 H101 M80 111 L72 107 M121 111 L128 107" />
          </g>
        </FaceBase>
        <path d="M72 101 C69 79 84 67 102 69 C122 67 132 81 128 102 C122 87 113 82 101 82 C88 82 79 87 72 101 Z" fill="#252127" />
        <path d="M76 87 Q88 73 102 80 M99 78 Q116 71 126 88" stroke="#4a4246" strokeWidth="3" fill="none" />
        <g transform="translate(53 198) rotate(-10)">
          <path d="M0 0 L44 3 L39 49 L-5 44 Z" fill="#c8b68e" stroke="#f1e4c8" strokeWidth="2" />
          <path d="M5 9 L34 11 M4 17 L31 19 M3 25 L27 27" stroke="#806e55" strokeWidth="1.5" opacity="0.6" />
          <path d="M27 37 L34 38" stroke="#8b2033" strokeWidth="3" />
        </g>
        <g transform="translate(140 225)">
          <rect x="-22" y="-15" width="48" height="32" rx="4" fill="#211711" stroke="#9c7945" strokeWidth="2" />
          <path d="M-8 -15 V-22 H12 V-15" fill="none" stroke="#9c7945" strokeWidth="3" />
          <circle cx="2" cy="1" r="3" fill="#e3c68c" />
        </g>
      </g>
    </g>
  );
}
