// «Олимп» — телефон игрока, как в согласованном прототипе: 6 страниц бога листаются пальцем
// (Бог · Силы · История · Сумка · Одежда · Журнал), номер страницы и точки сверху, вкладки снизу,
// подсказка о листании при первом открытии, настройки (вид хода в бою). Когда нужно действие —
// выбрать бога, бросить кубик, проголосовать, сделать ход — снизу выезжает шторка.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PodiumPhone } from "../../components/live/Podium";
import { useServerNow } from "../../components/live/useServerNow";
import { NameText } from "../../components/NameText";
import { acceptsAnswers, secondsLeft } from "../../core/session";
import type { Session } from "../../data/types";
import type { PlayerViewProps } from "../types";
import { battleTotals, effectText, godDamage, type Battle, type Fighter, type LogEntry } from "./combat";
import { storyOf, type OlympContent } from "./content";
import { foeOf } from "./foes";
import { abilitiesOf, godOf, GODS, ROLES, type Ability, type God, type RoleId } from "./gods";
import { currentScene, godName, hpMaxOfMember, memberRollMod, memberStat, parseOlympResult, readyAbilities, type Member, type OlympResult } from "./logic";
import { ELEMENT_NAMES, ELEMENTS, OUTCOME_MULT, STAT_NAMES, STATS, STRONG, levelOf, threshold, xpToNext, type ElementId, type Outcome, type StatId } from "./rules";
import { placeOf, visibleOptions } from "./story";
import { Coin, EL_COLORS, ElChip, ElIcon, Icon, portraitOf } from "./look/art";
import { GodEmb, LogText, OUTCOME_COLORS } from "./hall";
import "./look/olymp.css";

export type OlympAnswerValue = { god: string } | { roll: true } | { vote: number } | { ability: string; target: string | null };

type TurnMode = "sheet" | "fan" | "steps";
const MODE_KEY = "olymp.turnMode";
const HINT_KEY = "olymp.swipeHint";
const PAGES = [
  { id: "god", name: "Бог", icon: "god" },
  { id: "powers", name: "Силы", icon: "powers" },
  { id: "lore", name: "История", icon: "lore" },
  { id: "bag", name: "Сумка", icon: "bag" },
  { id: "wear", name: "Одежда", icon: "wear" },
  { id: "log", name: "Журнал", icon: "log" },
] as const;

const ROLE_COLORS: Record<RoleId, string> = { warrior: "#E8875A", guardian: "#9EC3D6", healer: "#A3C2AA", oracle: "#F3DFAE", sorcerer: "#B3AADD", trickster: "#D98AB8" };
const STAT_HINTS: Record<StatId, string> = { might: "урон, сила ударов", influence: "разговоры, убеждение", wisdom: "знания, магия", endurance: "защита, здоровье", luck: "крит. удачи чаще", cunning: "обман, ловушки" };
const OUT_SHORT: Array<[Outcome, string]> = [
  ["crit", "крит"],
  ["good", "хорошо"],
  ["mid", "средне"],
  ["bad", "плохо"],
  ["fail", "провал"],
];
const EVK: Record<string, [string, string, string]> = {
  fight: ["⚔", "#E8875A", "бой"],
  curse: ["☠", "#E3AA9C", "проклятие"],
  heal: ["✚", "#A3C2AA", "помощь: лечение, щиты, благословения"],
  coin: ["◉", "#E3C68C", "награда"],
  level: ["★", "#F3DFAE", "уровень"],
  idea: ["💡", "#CFE3EE", "идея"],
  vote: ["✓", "#B3AADD", "голосование"],
  start: ["⚑", "#9EC3D6", "начало боя"],
  story: ["❧", "#CFE3EE", "сюжет"],
};

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // Приватный режим — настройка живёт до перезагрузки.
  }
};

function RoleChip({ role }: { role: RoleId }) {
  return (
    <span className="olx-elchip" style={{ ["--ec" as string]: ROLE_COLORS[role] }}>
      {ROLES[role].name}
    </span>
  );
}

function kindLabel(a: Ability): string {
  return (
    {
      strike: "урон одному",
      blast: "урон всем",
      heal: a.target === "allies" ? "лечение всех" : "лечение",
      shield: a.target === "allies" ? "щит всем" : "щит союзнику",
      bless: a.target === "allies" ? "благословение всем" : "благословение",
      curse: "проклятие",
    } as Record<string, string>
  )[a.kind] ?? "";
}

function abilityIcon(a: Ability): string {
  if (a.ult) return "ult";
  return a.kind === "strike" ? "strike" : a.kind === "blast" ? "blast" : a.kind === "heal" ? "heal" : a.kind === "shield" ? "shield" : a.kind === "bless" ? "bless" : "curse";
}

/** Что даст способность при каждом исходе броска (против текущего противника, если идёт бой). */
function outcomesOf(a: Ability, level: number, b: Battle | null): string[] {
  const foe = b ? foeOf(b.foe) : undefined;
  const resist = a.element && foe ? (foe.resist[a.element] ?? 100) / 100 : 1;
  return OUT_SHORT.map(([o]) => {
    if (o === "fail") return "промах и «Рок» на себя: −10 к следующему броску";
    if (a.kind === "strike" || a.kind === "blast") return `${godDamage(a.power, o, level, resist, 1)} урона${a.kind === "blast" ? " каждому" : ""}`;
    if (a.kind === "heal") return `+${Math.round(a.power * OUTCOME_MULT[o])} здоровья`;
    if (a.kind === "shield") return `щит на ${Math.round(a.power * OUTCOME_MULT[o])}`;
    if (a.effect) return o === "bad" ? "слабо: эффект на 1 ход" : `«${a.effect.name}»${effectText(a.effect)}`;
    return "";
  });
}

function Odds({ values }: { values: string[] }) {
  return (
    <div className="olp-odds">
      {OUT_SHORT.map(([o, n], i) => (
        <span key={o} style={{ background: OUTCOME_COLORS[o] }}>
          {n}
          <br />
          {values[i]?.replace(/ урона.*/, "").replace(/^щит на /, "щит ").slice(0, 14)}
        </span>
      ))}
    </div>
  );
}

function Bar2({ label, value, max, kind }: { label: ReactNode; value: number; max: number; kind: "hp" | "xp" }) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="olp-bar2">
      <div className="olp-bar2__t">
        <span>{label}</span>
        <b>
          {value} / {max}
        </b>
      </div>
      <div className="olp-track">
        <i className={`is-${kind}${kind === "hp" && share < 0.35 ? " is-low" : ""}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function EvRow({ e }: { e: LogEntry }) {
  const k = EVK[e.k] ?? EVK.story ?? ["•", "#B5ABA2", ""];
  return (
    <div className={`olp-ev olp-ev--${e.k}`}>
      <span className="olp-evi" style={{ ["--evc" as string]: k[1] }} title={k[2]} aria-label={k[2]}>
        {k[0]}
      </span>
      <span>
        <LogText e={e} />
      </span>
    </div>
  );
}

// ------------------------------------------------------------------ страницы

interface Me {
  m: Member;
  god: God;
  f: Fighter | undefined;
}

function PageGod({ me, r, onJournal }: { me: Me; r: OlympResult; onJournal: () => void }) {
  const { m, god, f } = me;
  const lv = levelOf(m.xp);
  const need = xpToNext(lv.level);
  const hp = f ? f.hp : m.hp;
  const hpMax = f ? f.hpMax : hpMaxOfMember(m);
  const effects = f ? f.effects.map((e) => ({ id: e.id, name: e.name, kind: e.kind, left: e.left, text: effectText({ ...e, turns: e.left }) })) : m.effects.map((e) => ({ id: e.id, name: e.name, kind: e.kind, left: e.left, text: effectText({ ...e, turns: e.left }) }));
  const [all, setAll] = useState(false);
  const list = [...effects].sort((a, b) => (a.kind === "curse" ? -1 : 1) - (b.kind === "curse" ? -1 : 1));
  const shown = all ? list : list.slice(0, 2);
  const curses = list.filter((e) => e.kind === "curse").length;
  const portrait = portraitOf(god.id);
  const ring = 213.6;
  return (
    <>
      <div className="olp-hero">
        {portrait ? <img src={portrait} alt={god.name} /> : <div className="olp-hero__emb"><GodEmb god={god.id} size="150px" /></div>}
        <div className="olp-hero__who">
          <div>
            <b>{god.name}</b>
            <span className="olp-tags">
              <RoleChip role={god.role} />
              <ElChip el={god.element} />
            </span>
          </div>
          <div className="olp-lvl">
            <svg className="olp-ring" viewBox="0 0 74 74" aria-hidden="true">
              <circle cx="37" cy="37" r="34" fill="none" stroke="rgba(251,246,241,.12)" strokeWidth="4" />
              <circle cx="37" cy="37" r="34" fill="none" stroke="#E3C68C" strokeWidth="4" strokeLinecap="round" strokeDasharray={ring} strokeDashoffset={ring * (1 - Math.min(1, lv.xp / Math.max(1, need)))} />
            </svg>
            <GodEmb god={god.id} size="62px" />
            <em>{lv.level}</em>
          </div>
        </div>
      </div>
      <div className="olp-bars">
        <Bar2 label="Здоровье" value={hp} max={hpMax} kind="hp" />
        <Bar2 label={`Опыт до ${lv.level + 1}-го уровня`} value={lv.xp} max={need} kind="xp" />
      </div>
      <div className="olp-infobox">
        <div className="olp-infobox__hd">
          <Icon name="info" />
          Состояние
          <span className="olp-cnt">{curses ? `${curses} проклят.` : "чисто"}</span>
        </div>
        {list.length === 0 && <p className="olp-sub">Эффектов нет</p>}
        {shown.map((e) => (
          <div key={e.id} className="olp-fx">
            <span className={`olp-fx__ic ${e.kind === "curse" ? "is-bad" : "is-good"}`}>
              <Icon name={e.kind === "curse" ? "curse" : "bless"} />
            </span>
            <div>
              <b>{e.name}</b>
              <small>
                {e.kind === "curse" ? "проклятие" : "благословение"}
                {e.text}
              </small>
            </div>
            <span className="olp-fx__left">
              {e.left} {e.left === 1 ? "ход" : "хода"}
            </span>
          </div>
        ))}
        {list.length > 2 && (
          <button type="button" className="olp-link" onClick={() => setAll(!all)}>
            {all ? "Свернуть" : `Ещё ${list.length - 2}`}
          </button>
        )}
        {r.log[0] && (
          <div className="olp-lastev">
            <span className="olp-lk">Последнее</span>
            <EvRow e={r.log[0]} />
            <button type="button" className="olp-link" onClick={onJournal}>
              Журнал: все события ({r.log.length}) →
            </button>
          </div>
        )}
      </div>
      <div className="olp-statlist">
        {STATS.map((k) => {
          const base = god.stats[k];
          const now = memberStat(m, k);
          const fx = f ? f.stats[k] - base : now - base;
          return (
            <div key={k} className="olp-statrow">
              <div className="olp-statrow__nm">
                {STAT_NAMES[k]}
                <small>{fx ? <i className={fx < 0 ? "neg" : "pos"}>{`${fx > 0 ? "+" : "−"}${Math.abs(fx)} эффекты`}</i> : STAT_HINTS[k]}</small>
              </div>
              <span className="olp-statrow__val">{f ? f.stats[k] : now}</span>
            </div>
          );
        })}
        <div className="olp-statrow">
          <div className="olp-statrow__nm">
            Скорость<small>только от одежды и предметов</small>
          </div>
          <span className="olp-statrow__val">{f ? f.speed : god.speed}</span>
          <span className="olp-lock" aria-label="Очки сюда не вкладываются">
            <Icon name="lock" />
          </span>
        </div>
      </div>
    </>
  );
}

function PagePowers({ me, b, onScheme }: { me: Me; b: Battle | null; onScheme: () => void }) {
  const { god, f } = me;
  const lv = levelOf(me.m.xp).level;
  const foe = b ? foeOf(b.foe) : undefined;
  return (
    <>
      <div className="olp-rowhd">
        <span className="olp-ptitle">Способности</span>
        <button type="button" className="olp-use" onClick={onScheme}>
          Схема стихий
        </button>
      </div>
      {abilitiesOf(god).map((a) => {
        const outs = outcomesOf(a, lv, b);
        const cd = f?.cd[a.id] ?? 0;
        return (
          <details key={a.id} className={`olp-ab${a.ult ? " is-ult" : ""}`}>
            <summary>
              <span className="olp-ab__ic">
                <Icon name={abilityIcon(a)} />
              </span>
              <span className="olp-ab__nm">
                <b>{a.name}</b>
                <span className="olp-tags">
                  {a.element && <ElChip el={a.element} />}
                  <span className="olp-kind">
                    {kindLabel(a)}
                    {a.ult ? " · раз за бой" : ""}
                  </span>
                </span>
              </span>
              <span className="olp-more">Подробнее</span>
            </summary>
            <div className="olp-ab__body">
              <p>
                {a.text}{" "}
                <span className="olp-soft">
                  {a.ult ? "заряд копится от ходов и урона" : a.cooldown ? `перезарядка ${a.cooldown} ${a.cooldown === 1 ? "ход" : "хода"}` : "можно каждый ход"}
                  {cd ? ` · сейчас ждать ${cd}` : ""}. Бросок — {STAT_NAMES[a.stat]}.
                </span>
              </p>
              {a.ult && f && (
                <div className="olp-bar2">
                  <div className="olp-bar2__t">
                    <span>Заряд</span>
                    <b>{f.ultUsed ? "использована" : `${f.charge}%`}</b>
                  </div>
                  <div className="olp-charge">
                    <i style={{ width: `${f.ultUsed ? 0 : f.charge}%` }} />
                  </div>
                </div>
              )}
              <div className="olp-outcomes">
                {OUT_SHORT.map(([o, n], i) => (
                  <div key={o}>
                    <span style={{ background: OUTCOME_COLORS[o] }}>{n}</span>
                    <span>{outs[i]}</span>
                  </div>
                ))}
              </div>
              {foe && a.element && (
                <div className="olp-vs">
                  {foe.name} — стихия {ELEMENT_NAMES[foe.element]}: {ELEMENT_NAMES[a.element]} проходит на <b>{foe.resist[a.element] ?? 100}%</b>.
                </div>
              )}
            </div>
          </details>
        );
      })}
    </>
  );
}

function PageLore({ me }: { me: Me }) {
  const { god } = me;
  return (
    <>
      <span className="olp-ptitle">О боге</span>
      <div className="olp-lorehead">
        <GodEmb god={god.id} size="56px" />
        <div>
          <b>{god.name}</b>
          <small>олимпиец · {ROLES[god.role].name.toLowerCase()}</small>
        </div>
      </div>
      <p className="olp-lore">{god.about}</p>
      <dl className="olp-facts">
        <dt>Роль</dt>
        <dd>
          <RoleChip role={god.role} /> {ROLES[god.role].hint}
        </dd>
        <dt>Стихия</dt>
        <dd>
          <ElChip el={god.element} />
        </dd>
        <dt>Символы</dt>
        <dd>{god.symbols}</dd>
        <dt>Слабость</dt>
        <dd>{god.weakness}</dd>
        <dt>Дом</dt>
        <dd>Олимп</dd>
      </dl>
      <span className="olp-ptitle">Способности</span>
      <div className="olp-ablist">
        {abilitiesOf(god).map((a) => (
          <div key={a.id}>
            <span className="olp-ab__ic">
              <Icon name={abilityIcon(a)} />
            </span>
            <span>
              <b>
                {a.name}
                {a.ult ? " · ультимативный" : ""}
              </b>
              <small>
                {a.element ? `${ELEMENT_NAMES[a.element]} · ` : ""}
                {kindLabel(a)}
              </small>
            </span>
          </div>
        ))}
      </div>
      <span className="olp-ptitle">Роли богов</span>
      <div className="olp-roles">
        {(Object.keys(ROLES) as RoleId[]).map((k) => (
          <div key={k}>
            <RoleChip role={k} />
            <small>{ROLES[k].hint}</small>
          </div>
        ))}
      </div>
    </>
  );
}

function PageBag({ me, toast }: { me: Me; toast: (t: string) => void }) {
  return (
    <>
      <div className="olp-gold">
        <Coin size={70} onToss={(side) => toast(`Выпало: ${side === "athena" ? "Афина" : "Олимп"}`)} />
        <div>
          <b>{me.m.coins}</b>
          <small>
            драхм · золото Олимпа, передать нельзя
            <br />
            коснитесь монеты — подбросить
          </small>
        </div>
      </div>
      <span className="olp-ptitle">Артефакты · 4 слота</span>
      <div className="olp-slots">
        {[1, 2, 3, 4].map((i) => (
          <button key={i} type="button" className="olp-slot" onClick={() => toast("Свободный слот: артефакты появятся в кампаниях «Олимпа»")}>
            <Icon name="art" />
            <span className="olp-slot__nm">Слот {i}</span>
            <span className="olp-slot__nm is-sm">пусто</span>
          </button>
        ))}
      </div>
      <span className="olp-ptitle">Расходники</span>
      <p className="olp-sub">Пока пусто. Зелья, амброзия и оболы — в лавках Гермеса в кампаниях.</p>
    </>
  );
}

const SLOTS: Array<[string, string]> = [
  ["head", "Голова"],
  ["body", "Тело"],
  ["cloak", "Плащ"],
  ["feet", "Ноги"],
  ["acc", "Аксессуар"],
];

function PageWear({ me, toast }: { me: Me; toast: (t: string) => void }) {
  return (
    <>
      <div className="olp-speed">
        <div>
          <small>Скорость</small>
          <b>{me.f ? me.f.speed : me.god.speed}</b>
        </div>
        <span className="olx-elchip" style={{ ["--ec" as string]: "#A9D3B5" }}>
          +0 от одежды и артефактов
        </span>
      </div>
      <span className="olp-ptitle">Надето · касание — свойства</span>
      <div className="olp-slots olp-slots--five">
        {SLOTS.map(([k, n]) => (
          <button key={k} type="button" className="olp-slot" onClick={() => toast("Свободно: одежда появится в кампаниях «Олимпа»")}>
            <Icon name={k} />
            <span className="olp-slot__nm">{n}</span>
            <span className="olp-slot__nm is-sm">пусто</span>
          </button>
        ))}
      </div>
      <span className="olp-ptitle">Гардероб</span>
      {SLOTS.map(([k, n]) => (
        <details key={k} className="olp-folder">
          <summary>
            <Icon name={k} />
            <b>{n}</b>
            <span className="olp-cnt3">0</span>
            <span className="olp-chev">▾</span>
          </summary>
          <p className="olp-sub">Пока ничего нет</p>
        </details>
      ))}
      <div className="olp-setbox">
        <div className="olp-setbox__hd">
          <b>«Олимпиец»</b>
          <span className="olp-setcnt">0 из 4</span>
        </div>
        <div className="is-off">
          <span>2 вещи:</span> +5% опыта
        </div>
        <div className="is-off">
          <span>4 вещи:</span> ульта заряжается на 15% быстрее
        </div>
      </div>
    </>
  );
}

const JF: Array<[string, string]> = [
  ["all", "Все"],
  ["fight", "Удары"],
  ["curse", "Проклятия"],
  ["heal", "Помощь"],
  ["coin", "Награды"],
  ["vote", "Голоса"],
  ["story", "Сюжет"],
];
const IMP: Record<string, number> = { curse: 0, level: 1, coin: 2, fight: 3, heal: 4, vote: 5, idea: 6, start: 7, story: 8 };
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

function PageLog({ me, r }: { me: Me; r: OlympResult }) {
  const [f, setF] = useState("all");
  const [who, setWho] = useState("all");
  const [sort, setSort] = useState("new");
  const [q, setQ] = useState("");
  const names = useMemo(() => [...new Set(r.order.map((p) => godName(r, p)).filter(Boolean))], [r]);
  const b = r.battle;
  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  let list = r.log.filter((e) => (f === "all" || e.k === f || (f === "coin" && e.k === "level") || (f === "story" && e.k === "start")) && (who === "all" || e.who.includes(who) || e.x.includes(who)) && words.every((w) => norm(e.x).includes(w)));
  list = [...list].sort(sort === "old" ? (a, c) => a.n - c.n : sort === "imp" ? (a, c) => (IMP[a.k] ?? 9) - (IMP[c.k] ?? 9) || c.n - a.n : (a, c) => c.n - a.n);
  const totals = b ? battleTotals(b) : null;
  const myName = me.f?.name ?? me.god.name;
  return (
    <>
      {b && totals && (
        <div className="olp-jsum">
          <div className="olp-jsum__t">Бой: {foeOf(b.foe)?.name}</div>
          <div className="olp-jnums">
            <div>
              <b>{totals.dealt[myName] ?? 0}</b>
              <small>вы нанесли</small>
            </div>
            <div>
              <b>{totals.taken[myName] ?? 0}</b>
              <small>вы получили</small>
            </div>
            <div>
              <b>{totals.help}</b>
              <small>помощь отряду</small>
            </div>
            <div>
              <b>{totals.curses}</b>
              <small>проклятий</small>
            </div>
          </div>
        </div>
      )}
      <label className="olp-jsearch">
        <span className="olx-sr">Поиск по журналу</span>
        <input type="search" placeholder="Поиск: имя, умение, проклятие…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="olp-evf olp-jscroll" role="group" aria-label="Что показать">
        {JF.map(([k, n]) => (
          <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>
            {n}
          </button>
        ))}
      </div>
      <div className="olp-jsel">
        <label>
          <span>Кто</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Все</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n === myName ? `${n} (вы)` : n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Порядок</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="new">Новые сверху</option>
            <option value="old">По порядку</option>
            <option value="imp">Сначала важное</option>
          </select>
        </label>
      </div>
      <div className="olp-jcount">
        Показано {list.length} из {r.log.length}
        {(f !== "all" || who !== "all" || q) && (
          <button
            type="button"
            className="olp-link"
            onClick={() => {
              setF("all");
              setWho("all");
              setQ("");
            }}
          >
            Сбросить
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="olp-jempty">Таких событий нет</div>
      ) : (
        <div className="olp-feed">
          {list.map((e) => (
            <EvRow key={e.n} e={e} />
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ шторки и окна

function Sheet({ children, onClose, closeLabel = "Закрыть" }: { children: ReactNode; onClose?: () => void; closeLabel?: string }) {
  return (
    <div className="olp-psheet">
      <div className="olp-psheet__bg" onClick={onClose} />
      <div className="olp-psheet__card" role="dialog" aria-modal="true">
        <span className="olp-grab" />
        {children}
        {onClose && (
          <button type="button" className="olp-close" onClick={onClose}>
            {closeLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function ElementScheme({ sel, onSel }: { sel: ElementId | null; onSel: (e: ElementId | null) => void }) {
  const ORDER: ElementId[] = ["fire", "dark", "wind", "ice", "poison", "chaos", "earth", "water", "light", "bolt"];
  const POS = Object.fromEntries(ORDER.map((k, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 10;
    return [k, [150 + 112 * Math.cos(a), 150 + 112 * Math.sin(a)] as [number, number]];
  })) as Record<ElementId, [number, number]>;
  const WEAK: Record<string, ElementId[]> = {};
  for (const a of ELEMENTS) for (const b of STRONG[a]) (WEAK[b] = WEAK[b] ?? []).push(a);
  const lines: ReactNode[] = [];
  for (const a of ORDER)
    for (const b of STRONG[a]) {
      const cls = sel ? (a === sel ? "win" : b === sel ? "lose" : "dim") : "all";
      const [x1, y1] = POS[a];
      const [x2, y2] = POS[b];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const L = Math.hypot(dx, dy);
      const ux = dx / L;
      const uy = dy / L;
      lines.push(<line key={`${a}${b}`} className={`is-${cls}`} x1={x1 + ux * 20} y1={y1 + uy * 20} x2={x2 - ux * 22} y2={y2 - uy * 22} markerEnd={`url(#olp-ar-${cls})`} />);
    }
  const mk = (id: string, c: string) => (
    <marker key={id} id={`olp-ar-${id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill={c} />
    </marker>
  );
  return (
    <>
      <h4>Схема стихий</h4>
      <svg className="olp-elsvg" viewBox="0 0 300 310" role="img" aria-label="Какие стихии сильнее каких">
        <defs>{[mk("all", "rgba(227,198,140,.45)"), mk("win", "#A3C2AA"), mk("lose", "#E3AA9C"), mk("dim", "rgba(251,246,241,.08)")]}</defs>
        {lines}
        {ORDER.map((k) => {
          const [x, y] = POS[k];
          return (
            <g key={k} className={`olp-enode${k === sel ? " is-on" : ""}`} tabIndex={0} role="button" aria-label={ELEMENT_NAMES[k]} onClick={() => onSel(k === sel ? null : k)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSel(k === sel ? null : k)}>
              <circle cx={x} cy={y} r="19" style={{ stroke: EL_COLORS[k] }} />
              <svg x={x - 10} y={y - 10} width="20" height="20" viewBox="0 0 24 24">
                <ElIcon el={k} size={24} />
              </svg>
              <text x={x} y={y + 32} textAnchor="middle">
                {ELEMENT_NAMES[k]}
              </text>
            </g>
          );
        })}
      </svg>
      {sel ? (
        <div className="olp-kv">
          <span>Сильнее против (урон ×1,5)</span>
          <b className="plus">{STRONG[sel].map((k) => ELEMENT_NAMES[k]).join(", ")}</b>
          <span>Слабее против (урон ×0,5)</span>
          <b className="minus">{(WEAK[sel] ?? []).map((k) => ELEMENT_NAMES[k]).join(", ")}</b>
        </div>
      ) : (
        <p className="olp-sub">Стрелка — «сильнее против». Коснитесь стихии, чтобы увидеть её связи.</p>
      )}
      <div className="olp-vs">У каждой стихии 2 сильные и 2 слабые стороны. У противников к этому добавляются свои сопротивления.</div>
    </>
  );
}

/** Выбор бога: карточки листаются, у каждой — роль, стихия, о боге и способности. */
function GodPick({ sending, onSend }: { sending: boolean; onSend: (v: OlympAnswerValue) => void }) {
  const [god, setGod] = useState(GODS[0]?.id ?? "zeus");
  const g = godOf(god);
  return (
    <div className="olp-pick">
      <span className="olp-ptitle">Выберите бога для команды</span>
      <div className="olp-pick__row" role="radiogroup" aria-label="Бог">
        {GODS.map((x) => (
          <button key={x.id} type="button" role="radio" aria-checked={god === x.id} className="olp-pick__card" onClick={() => setGod(x.id)}>
            {portraitOf(x.id) ? <img src={portraitOf(x.id) as string} alt="" /> : <GodEmb god={x.id} size="54px" />}
            <b>{x.name}</b>
            <small>{ROLES[x.role].name}</small>
          </button>
        ))}
      </div>
      {g && (
        <div className="olp-pick__info">
          <div className="olp-tags">
            <RoleChip role={g.role} />
            <ElChip el={g.element} />
          </div>
          <p className="olp-lore olp-lore--sm">{g.about}</p>
          <div className="olp-ablist">
            {abilitiesOf(g).map((a) => (
              <div key={a.id}>
                <span className="olp-ab__ic">
                  <Icon name={abilityIcon(a)} />
                </span>
                <span>
                  <b>
                    {a.name}
                    {a.ult ? " · ульта" : ""}
                  </b>
                  <small>{a.text}</small>
                </span>
              </div>
            ))}
          </div>
          <p className="olp-sub">Если бога уже взяла другая команда, вам достанется первый свободный.</p>
        </div>
      )}
      <button type="button" className="olp-rollbtn" disabled={sending} onClick={() => onSend({ god })}>
        Играть за: {g?.name}
      </button>
    </div>
  );
}

/** Ход в бою — три вида (шторка, веер карт, по шагам): способность → цель → бросок. */
function TurnPicker({ b, pid, mode, left, sending, onSend }: { b: Battle; pid: string; mode: TurnMode; left: number | null; sending: boolean; onSend: (v: OlympAnswerValue) => void }) {
  const me = b.fighters.find((f) => f.id === pid);
  const god = me ? godOf(me.ref) : undefined;
  const ready = readyAbilities(b, pid).map((a) => a.id);
  const abilities = god ? abilitiesOf(god) : [];
  const [pick, setPick] = useState<string | null>(ready[0] ?? null);
  const [target, setTarget] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const ab = abilities.find((a) => a.id === pick);
  const allies = b.fighters.filter((f) => f.side === "god" && !f.down);
  const needTarget = ab?.target === "ally";
  useEffect(() => {
    if (needTarget && !target) setTarget(allies.slice().sort((a, c) => a.hp / a.hpMax - c.hp / c.hpMax)[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick]);
  if (!me || !god) return null;
  const lv = me.level;
  const send = () => pick && onSend({ ability: pick, target: needTarget ? target : null });
  const abLabel = (a: Ability) => {
    const cd = me.cd[a.id] ?? 0;
    if (a.ult) return me.ultUsed ? "уже использована" : `${a.element ? ELEMENT_NAMES[a.element].toLowerCase() + " · " : ""}заряд ${me.charge}%`;
    if (cd) return `через ${cd} ход.`;
    return `${a.element ? ELEMENT_NAMES[a.element].toLowerCase() + " · " : ""}${kindLabel(a)}`;
  };
  const targets = needTarget && (
    <div className={mode === "fan" ? "olp-fantg" : "olp-targets"}>
      {allies.map((f) => (
        <button key={f.id} type="button" className={`olp-tg${target === f.id ? " is-sel" : ""}`} onClick={() => setTarget(f.id)}>
          <GodEmb god={f.ref} size="38px" />
          {f.id === pid ? "Себя" : f.name}
          <span className="olp-hp">
            <i className={f.hp / f.hpMax < 0.35 ? "is-low" : undefined} style={{ width: `${(f.hp / f.hpMax) * 100}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
  const odds = ab && <Odds values={outcomesOf(ab, lv, b)} />;
  const roll = (
    <button type="button" className="olp-rollbtn" disabled={sending || !pick || (needTarget && !target)} onClick={send}>
      <Icon name="game" />
      Бросить кубик
    </button>
  );
  if (mode === "fan") {
    const n = abilities.length;
    return (
      <div className="olp-turn olp-turn--fan">
        <div className="olp-turnhd">
          <span>Ваш ход! Выберите карту</span>
          {left !== null && <span>{left} с</span>}
        </div>
        {needTarget && <span className="olp-lbl">Цель</span>}
        {targets}
        <div className="olp-fan">
          {abilities.map((a, i) => {
            const off = !ready.includes(a.id);
            const sel = pick === a.id;
            const x = (i - (n - 1) / 2) * 54;
            const rot = (i - (n - 1) / 2) * 5;
            return (
              <button key={a.id} type="button" className={`olp-card${a.ult ? " is-ult" : ""}${off ? " is-off" : ""}${sel ? " is-sel" : ""}`} style={{ transform: `translateX(${x}px) rotate(${rot}deg)${sel ? " translateY(-30px)" : ""}`, zIndex: sel ? 9 : i + 1 }} disabled={off} onClick={() => setPick(a.id)}>
                <Icon name={abilityIcon(a)} />
                <b>{a.name}</b>
                <small>{abLabel(a)}</small>
              </button>
            );
          })}
        </div>
        <button type="button" className="olp-bigdie" disabled={sending || !pick || (needTarget && !target)} onClick={send} aria-label="Бросить кубик">
          d100
        </button>
      </div>
    );
  }
  if (mode === "steps") {
    const last = needTarget ? 3 : 2;
    return (
      <div className="olp-turn olp-turn--steps">
        <div className="olp-steps">
          {Array.from({ length: last }, (_, i) => (
            <span key={i} className={i < step ? "is-on" : undefined} />
          ))}
        </div>
        <span className="olp-lbl">
          Шаг {step} из {last}
          {ab && step > 1 ? ` · ${ab.name}` : ""}
          {left !== null ? ` · ${left} с` : ""}
        </span>
        {step === 1 && (
          <>
            <h4>Какую способность?</h4>
            {abilities.map((a) => {
              const off = !ready.includes(a.id);
              return (
                <button key={a.id} type="button" className={`olp-ally${pick === a.id ? " is-sel" : ""}`} disabled={off} onClick={() => setPick(a.id)}>
                  <span className="olp-ab__ic">
                    <Icon name={abilityIcon(a)} />
                  </span>
                  <span>
                    <b>{a.name}</b>
                    <small>{abLabel(a)}</small>
                  </span>
                </button>
              );
            })}
          </>
        )}
        {step === 2 && needTarget && (
          <>
            <h4>Кого {ab?.kind === "shield" ? "защитить" : ab?.kind === "heal" ? "вылечить" : "благословить"}?</h4>
            {allies.map((f) => (
              <button key={f.id} type="button" className={`olp-ally${target === f.id ? " is-sel" : ""}`} onClick={() => setTarget(f.id)}>
                <GodEmb god={f.ref} size="44px" />
                <span>
                  <b>{f.id === pid ? "Себя" : f.name}</b>
                  <span className="olp-hp">
                    <i className={f.hp / f.hpMax < 0.35 ? "is-low" : undefined} style={{ width: `${(f.hp / f.hpMax) * 100}%` }} />
                  </span>
                </span>
                <em>{f.hp}</em>
              </button>
            ))}
          </>
        )}
        {step === last && (
          <>
            <h4>Бросок: {ab?.name}</h4>
            {odds}
          </>
        )}
        <div className="olp-navrow">
          <button type="button" className="olp-back" disabled={step === 1} onClick={() => setStep(step - 1)}>
            Назад
          </button>
          {step < last ? (
            <button type="button" className="olp-next" disabled={!pick || (step === 2 && needTarget && !target)} onClick={() => setStep(step + 1)}>
              Дальше
            </button>
          ) : (
            <button type="button" className="olp-next" disabled={sending || !pick || (needTarget && !target)} onClick={send}>
              Бросить кубик
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="olp-turn">
      <div className="olp-turnhd">
        <span>Ваш ход!</span>
        {left !== null && <span>{left} с</span>}
      </div>
      <span className="olp-lbl">Способность</span>
      <div className="olp-abgrid">
        {abilities.map((a) => {
          const off = !ready.includes(a.id);
          return (
            <button key={a.id} type="button" className={`olp-abt${a.ult ? " is-ult" : ""}${off ? " is-off" : ""}${pick === a.id ? " is-sel" : ""}`} disabled={off} onClick={() => setPick(a.id)}>
              <Icon name={abilityIcon(a)} />
              <span>
                {a.name}
                <small>{abLabel(a)}</small>
              </span>
            </button>
          );
        })}
      </div>
      {needTarget && <span className="olp-lbl">{ab?.kind === "shield" ? "Кого защитить" : ab?.kind === "heal" ? "Кого вылечить" : "На кого"}</span>}
      {targets}
      {odds}
      {roll}
    </div>
  );
}

// ------------------------------------------------------------------ телефон

function teamOf(session: Session, pid: string): string {
  return session.leaderboard[pid]?.name ?? "";
}

export function OlympPlayerView({ session, content, pid, role, myAnswer, sending, onAnswer }: PlayerViewProps<OlympContent, OlympAnswerValue>) {
  const r = useMemo(() => parseOlympResult(session.state.result), [session.state.result]);
  const { stage, phase } = session.state;
  const now = useServerNow(500, stage === "question");
  const open = acceptsAnswers(session.state, now);
  const left = stage === "question" ? secondsLeft(session.state, now) : null;
  const scene = currentScene(content, r);
  const story = storyOf(content);
  const place = scene ? placeOf(story, scene.place) : undefined;
  const captain = role !== "member";
  const canAct = captain && open && !myAnswer;
  const m = r.party[pid];
  const god = m ? godOf(m.god) : undefined;
  const b = r.battle;
  const f = b?.fighters.find((x) => x.id === pid);
  const me: Me | null = m && god ? { m, god, f } : null;

  const [page, setPage] = useState(0);
  const pages = useRef<HTMLDivElement>(null);
  const [mode, setModeState] = useState<TurnMode>(() => {
    const v = read(MODE_KEY);
    return v === "fan" || v === "steps" ? v : "sheet";
  });
  const setMode = (v: TurnMode) => {
    setModeState(v);
    write(MODE_KEY, v);
  };
  const [settings, setSettings] = useState(false);
  const [scheme, setScheme] = useState<ElementId | null | false>(false);
  const [hint, setHint] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const [seen, setSeen] = useState(r.seq);
  const [hideSheet, setHideSheet] = useState(false);
  const toast = (t: string) => {
    setToastText(t);
    window.setTimeout(() => setToastText((x) => (x === t ? null : x)), 2600);
  };

  // Подсказка о листании — один раз на телефоне, когда страницы появились.
  useEffect(() => {
    if (me && read(HINT_KEY) !== "1") setHint(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!me]);

  const go = (i: number) => {
    const n = Math.max(0, Math.min(PAGES.length - 1, i));
    const el = pages.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    setPage(n);
  };
  useEffect(() => {
    if (page === 5) setSeen(r.seq);
  }, [page, r.seq]);
  useEffect(() => {
    const el = pages.current;
    if (!el) return;
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => el.clientWidth && setPage(Math.round(el.scrollLeft / el.clientWidth)), 60);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      if (el.clientWidth) el.scrollLeft = page * el.clientWidth;
    });
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!me]);

  // Что нужно от этого телефона прямо сейчас.
  const myTurn = !!b && b.actor === pid && !b.over && !r.acted;
  const action: "pick" | "roll" | "vote" | "turn" | null =
    phase !== "playing" || stage !== "question" || !canAct
      ? null
      : r.phase === "pick"
        ? "pick"
        : r.phase === "check" && r.check?.who === pid
          ? "roll"
          : r.phase === "vote"
            ? "vote"
            : r.phase === "fight" && myTurn
              ? "turn"
              : null;
  useEffect(() => {
    setHideSheet(false);
  }, [action, session.state.step]);

  // Строка «что сейчас»: сцена, бросок, голосование, бой.
  let now1 = "";
  let now2 = "";
  if (phase === "lobby") {
    now1 = "Вы в отряде!";
    now2 = "Ждём, когда ведущий начнёт";
  } else if (phase === "finished") {
    now1 = "История окончена";
    now2 = "Спасибо за игру!";
  } else if (stage === "podium") {
    now1 = "Пантеон героев";
    now2 = "Смотрите на экран";
  } else if (r.phase === "pick" || r.order.length === 0) {
    now1 = "Выбор богов";
    now2 = myAnswer ? "Бог выбран — ждём остальных" : captain ? (stage === "question" ? "Выберите бога" : "Скоро начнём") : "Капитан выбирает бога";
  } else if (r.phase === "party") {
    now1 = "Боги разобраны";
    now2 = "Смотрите на экран";
  } else if (scene) {
    now1 = scene.title;
    if (r.phase === "check" && r.check) {
      const mine = r.check.who === pid;
      now2 = mine
        ? r.check.outcome
          ? "Бросок сделан — смотрите на экран"
          : myAnswer
            ? "Бросок отправлен — смотрите на экран"
            : role === "member"
              ? "Бросает капитан вашей команды"
              : stage === "question"
                ? "Ваш бросок!"
                : "Бросаете вы! Кубик появится, когда ведущий нажмёт «Бросок»"
        : `Бросает ${godName(r, r.check.who)}`;
    } else if (r.phase === "vote" && r.vote) {
      const opts = scene.kind === "vote" ? visibleOptions(scene, r.flags) : [];
      now2 = r.vote.picked !== null ? `Решили: «${opts[r.vote.picked]?.label ?? ""}»` : myAnswer ? "Голос отправлен" : stage === "question" ? (captain ? "Голосуйте!" : "Голосует капитан — подсказывайте!") : "Скоро голосование";
    } else if (r.phase === "fight" && b) {
      now2 = myTurn ? (myAnswer ? "Ход отправлен — смотрите на экран" : role === "member" ? "Ходит капитан вашей команды" : stage === "question" ? "Ваш ход!" : "Ваш ход — ждите кнопки") : `Бой: ходит ${b.fighters.find((x) => x.id === b.actor)?.name ?? "—"}`;
    } else if (r.phase === "fightEnd" && r.fightEnd) {
      now2 = r.fightEnd.win ? `Победа! +${r.fightEnd.xp[pid] ?? 0} опыта${r.fightEnd.coins[pid] ? `, драхм +${r.fightEnd.coins[pid]}` : ""}` : "Отряд отступает";
    } else {
      now2 = place ? `${place.name} · смотрите на экран` : "Смотрите на экран";
    }
  }

  // До выбора бога — без страниц.
  if (!me) {
    return (
      <div className="olp olp--solo">
        <div className="olp-solohead">
          <span className="olp-brand">ОЛИМП</span>
          <span className="olp-sub">{story.title}</span>
        </div>
        {action === "pick" ? (
          <GodPick sending={sending} onSend={onAnswer} />
        ) : (
          <div className="olp-now olp-now--big">
            <b>{now1}</b>
            <span>{now2}</span>
            {phase === "lobby" && <p className="olp-sub">Одна команда — один бог. Капитан выберет бога, когда ведущий откроет выбор.</p>}
          </div>
        )}
      </div>
    );
  }

  const newEvents = page === 5 ? 0 : Math.max(0, r.seq - seen);
  const sheetOpen = !!action && action !== "pick" && !hideSheet;
  let sheet: ReactNode = null;
  if (action === "roll" && scene?.kind === "check") {
    const stat = memberStat(me.m, scene.stat);
    const mod = memberRollMod(me.m);
    const thr = threshold(stat);
    sheet = (
      <div className="olp-turn">
        <div className="olp-turnhd">
          <span>Ваш бросок!</span>
          {left !== null && <span>{left} с</span>}
        </div>
        <p className="olp-sub">{scene.screen}</p>
        <div className="olp-kv">
          <span>{STAT_NAMES[scene.stat]}</span>
          <b>{stat}</b>
          <span>Нужно выбросить</span>
          <b>{thr}+</b>
          {mod !== 0 && (
            <>
              <span>Эффекты</span>
              <b className={mod > 0 ? "plus" : "minus"}>{`${mod > 0 ? "+" : "−"}${Math.abs(mod)}`}</b>
            </>
          )}
        </div>
        <div className="olp-odds">
          {OUT_SHORT.map(([o, n]) => (
            <span key={o} style={{ background: OUTCOME_COLORS[o] }}>
              {n}
              <br />
              {o === "crit" ? "96+" : o === "good" ? `${Math.min(96, thr + 20)}+` : o === "mid" ? `${thr}+` : o === "bad" ? "6+" : "1–5"}
            </span>
          ))}
        </div>
        <button type="button" className="olp-bigdie olp-bigdie--wide" disabled={sending} onClick={() => onAnswer({ roll: true })}>
          Бросить d100
        </button>
        <small className="olp-sub">Число выпадет на экране зала</small>
      </div>
    );
  } else if (action === "vote" && scene?.kind === "vote" && r.vote) {
    const opts = visibleOptions(scene, r.flags);
    sheet = (
      <div className="olp-turn">
        <div className="olp-turnhd">
          <span>{scene.title}</span>
          {left !== null && <span>{left} с</span>}
        </div>
        <span className="olp-lbl">Куда идёт отряд?</span>
        {opts.map((o, i) => (
          <button key={o.next + i} type="button" className="olp-choice" disabled={sending} onClick={() => onAnswer({ vote: i })}>
            <i />
            <span>
              {o.label}
              <small>{o.hint}</small>
            </span>
          </button>
        ))}
      </div>
    );
  } else if (action === "turn" && b) {
    sheet = <TurnPicker key={session.state.step} b={b} pid={pid} mode={mode} left={left} sending={sending} onSend={onAnswer} />;
  }

  return (
    <div className={`olp${sheetOpen ? " is-acting" : ""}`}>
      <div className="olp-phead">
        <span className="olp-pnum">
          <b>{page + 1}</b>/ {PAGES.length} · {PAGES[page]?.name}
        </span>
        <span className="olp-who">
          {god?.name} · <NameText name={teamOf(session, pid)} />
        </span>
        <button type="button" className="olp-gear" aria-label="Настройки телефона" onClick={() => setSettings(true)}>
          <Icon name="gear" />
        </button>
      </div>
      <button type="button" className={`olp-now${action && hideSheet ? " is-call" : ""}`} onClick={() => action && setHideSheet(false)} disabled={!action || !hideSheet}>
        <b>{now1}</b>
        <span>{action && hideSheet ? `${now2} — открыть` : now2}</span>
      </button>
      {phase === "playing" && stage === "podium" && (
        <div className="olp-podium">
          <PodiumPhone session={session} pid={pid} />
        </div>
      )}
      <div className="olp-dotsrow">
        <button type="button" className="olp-edge" disabled={page === 0} onClick={() => go(page - 1)} aria-label="Предыдущая страница">
          ‹
        </button>
        <div className="olp-dots">
          {PAGES.map((p, i) => (
            <i key={p.id} className={i === page ? "is-on" : undefined} />
          ))}
        </div>
        <button type="button" className="olp-edge" disabled={page === PAGES.length - 1} onClick={() => go(page + 1)} aria-label="Следующая страница">
          ›
        </button>
      </div>
      <div className="olp-pages" ref={pages}>
        <section className="olp-page" aria-label="Бог">
          <PageGod me={me} r={r} onJournal={() => go(5)} />
        </section>
        <section className="olp-page" aria-label="Силы">
          <PagePowers me={me} b={b && (r.phase === "fight" || r.phase === "fightEnd") ? b : null} onScheme={() => setScheme(null)} />
        </section>
        <section className="olp-page" aria-label="История">
          <PageLore me={me} />
        </section>
        <section className="olp-page" aria-label="Сумка">
          <PageBag me={me} toast={toast} />
        </section>
        <section className="olp-page" aria-label="Одежда">
          <PageWear me={me} toast={toast} />
        </section>
        <section className="olp-page" aria-label="Журнал">
          <PageLog me={me} r={r} />
        </section>
      </div>
      <nav className="olp-nav" aria-label="Страницы бога">
        {PAGES.map((p, i) => (
          <button key={p.id} type="button" aria-current={i === page} onClick={() => go(i)}>
            <em>{i + 1}</em>
            <Icon name={p.icon} />
            {p.name}
            {i === 5 && newEvents > 0 && <span className="olp-badge">{newEvents > 9 ? "9+" : newEvents}</span>}
          </button>
        ))}
      </nav>
      {sheetOpen && (
        <Sheet onClose={() => setHideSheet(true)} closeLabel="Свернуть — посмотреть страницы">
          {sheet}
        </Sheet>
      )}
      {hint && (
        <div className="olp-swipehint">
          <div className="olp-hand">
            <Icon name="hand" />
            <span className="olp-hand__trail" />
          </div>
          <b>
            Листайте пальцем
            <br />
            влево и вправо
          </b>
          <p>У вашего бога 6 страниц, последняя — журнал всех событий. Номер страницы — сверху, переключать можно и кнопками внизу.</p>
          <div className="olp-hintlist">
            {PAGES.map((p, i) => (
              <span key={p.id}>
                {i + 1} {p.name}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="olp-okbtn"
            onClick={() => {
              setHint(false);
              write(HINT_KEY, "1");
            }}
          >
            Понятно
          </button>
        </div>
      )}
      {settings && (
        <Sheet onClose={() => setSettings(false)}>
          <h4>Настройки</h4>
          <span className="olp-ptitle">Вид хода в бою</span>
          {(
            [
              ["sheet", "Шторка снизу", "способности, цель и бросок на одном экране"],
              ["fan", "Веер карт", "способности как карты в руке"],
              ["steps", "По шагам", "короткие экраны — проще для новичков"],
            ] as const
          ).map(([k, n, h]) => (
            <button key={k} type="button" className="olp-choice" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}>
              <i />
              <span>
                {n}
                <small>{h}</small>
              </span>
            </button>
          ))}
          <div className="olp-vs">Вид боя на большом экране выбирает ведущий на пульте.</div>
          <button
            type="button"
            className="olp-use olp-use--wide"
            onClick={() => {
              setSettings(false);
              setHint(true);
            }}
          >
            Показать подсказку о листании
          </button>
        </Sheet>
      )}
      {scheme !== false && (
        <Sheet onClose={() => setScheme(false)}>
          <ElementScheme sel={scheme} onSel={(e) => setScheme(e)} />
        </Sheet>
      )}
      <div className={`olp-toast${toastText ? " is-on" : ""}`} role="status" aria-live="polite">
        {toastText}
      </div>
    </div>
  );
}


