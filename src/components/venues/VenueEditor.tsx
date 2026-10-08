/**
 * Анкета площадки: разделы 1–8 (фото и меню-файлы — у страницы, они загружаются отдельно).
 * Один компонент для анкеты по QR-коду и для правки владельцем.
 */
import type { ReactNode } from "react";
import {
  AGENCY,
  ALCOHOL,
  CLOSE,
  CONNECTIONS,
  CONTRACTORS,
  CUISINES,
  DIETS,
  DISTRICTS,
  EQUIPMENT,
  FEATURES,
  FURNITURE,
  FX,
  LAYOUTS,
  LOCATIONS,
  LOUDNESS,
  MAX_CUISINES,
  MENU_KINDS,
  OWN_ITEMS,
  PARALLEL,
  PARKING,
  PAY,
  SETUP,
  TERRACE_SEASONS,
  TEXT_LIMITS,
  UNTIL,
  VENUE_TYPES,
  type VenueData,
} from "../../core/venues";
import { ChoiceChips, MultiChips, NumberField, Section, TextField, Toggle } from "./Fields";
import { layoutSvg } from "./layoutIcons";

interface Props {
  value: VenueData;
  onChange: (value: VenueData) => void;
  /** Меню-файлы показывает страница; здесь — только ссылка и виды меню. */
  menuFiles?: ReactNode;
}

export function VenueEditor({ value: v, onChange, menuFiles }: Props) {
  const set = <K extends keyof VenueData>(key: K, next: VenueData[K]) => onChange({ ...v, [key]: next });

  return (
    <>
      <Section title="1. Заведение">
        <TextField label="Название" required value={v.name} maxLength={TEXT_LIMITS.name} placeholder="Как вас найти" onChange={(x) => set("name", x)} />
        <ChoiceChips label="Тип" required options={VENUE_TYPES} value={v.type} onChange={(x) => set("type", x)} />
        <TextField label="Адрес" required value={v.address} maxLength={TEXT_LIMITS.address} placeholder="Улица, дом" onChange={(x) => set("address", x)} />
        <ChoiceChips label="Округ" options={DISTRICTS} value={v.district} onChange={(x) => set("district", x)} />
        <TextField label="Метро" value={v.metro} maxLength={TEXT_LIMITS.metro} onChange={(x) => set("metro", x)} />
        <TextField label="Сайт или соцсети" value={v.site} maxLength={TEXT_LIMITS.site} inputMode="url" placeholder="ссылка" onChange={(x) => set("site", x)} />
        <TextField
          label="Коротко о площадке"
          hint="до 500 знаков, увидит клиент"
          multiline
          value={v.about}
          maxLength={TEXT_LIMITS.about}
          onChange={(x) => set("about", x)}
        />
      </Section>

      <Section title="2. Кто с нами на связи" hint="Контакты видим только мы. Клиенту их не показываем.">
        <TextField label="Имя и фамилия" required value={v.person} maxLength={TEXT_LIMITS.person} autoComplete="name" onChange={(x) => set("person", x)} />
        <TextField label="Должность" value={v.role} maxLength={TEXT_LIMITS.role} placeholder="администратор, банкет-менеджер…" onChange={(x) => set("role", x)} />
        <TextField label="Телефон" required type="tel" inputMode="tel" value={v.phone} maxLength={TEXT_LIMITS.phone} placeholder="+7" autoComplete="tel" onChange={(x) => set("phone", x)} />
        <TextField label="Telegram или WhatsApp" value={v.messenger} maxLength={TEXT_LIMITS.messenger} placeholder="@ник или номер" onChange={(x) => set("messenger", x)} />
        <TextField label="Почта" type="email" inputMode="email" value={v.email} maxLength={TEXT_LIMITS.email} onChange={(x) => set("email", x)} />
      </Section>

      <Section title="3. Гости и залы">
        <div className="two-cols">
          <NumberField label="Банкет, сидя" required value={v.seated} max={5000} placeholder="гостей" onChange={(x) => set("seated", x)} />
          <NumberField label="Фуршет, стоя" required value={v.standing} max={5000} placeholder="гостей" onChange={(x) => set("standing", x)} />
        </div>
        <div className="two-cols">
          <NumberField label="Залов" value={v.halls} max={50} placeholder="1" onChange={(x) => set("halls", x)} />
          <NumberField label="Минимум гостей" value={v.minGuests} max={5000} placeholder="если есть" onChange={(x) => set("minGuests", x)} />
        </div>
        <Toggle label="Есть летняя веранда" checked={v.terrace} onChange={(x) => onChange({ ...v, terrace: x, terraceSeats: x ? v.terraceSeats : null, terraceSeason: x ? v.terraceSeason : "" })} />
        {v.terrace && (
          <div className="venue-reveal">
            <NumberField label="Мест на веранде" value={v.terraceSeats} max={5000} onChange={(x) => set("terraceSeats", x)} />
            <ChoiceChips label="Когда работает" options={TERRACE_SEASONS} value={v.terraceSeason} onChange={(x) => set("terraceSeason", x)} />
          </div>
        )}
        <Toggle label="Есть отдельный VIP-зал" checked={v.vip} onChange={(x) => onChange({ ...v, vip: x, vipSeats: x ? v.vipSeats : null })} />
        {v.vip && (
          <div className="venue-reveal">
            <NumberField label="Мест в VIP-зале" value={v.vipSeats} max={1000} onChange={(x) => set("vipSeats", x)} />
          </div>
        )}
        <Toggle label="Есть место для танцев" checked={v.dance} onChange={(x) => set("dance", x)} />
        <TextField
          label="Комментарий о залах"
          hint="необязательно: сколько гостей в каждом зале, особенности"
          multiline
          placeholder="Большой зал — 80, малый — 25, веранда летом — 40"
          value={v.hallsNote}
          maxLength={TEXT_LIMITS.hallsNote}
          onChange={(x) => set("hallsNote", x)}
        />
      </Section>

      <Section title="4. Мебель и рассадка">
        <ChoiceChips label="Мебель" options={FURNITURE} value={v.furniture} onChange={(x) => set("furniture", x)} />
        <MultiChips
          label="Какую рассадку можно сделать"
          hint="можно несколько"
          options={LAYOUTS}
          value={v.layouts}
          onChange={(x) => set("layouts", x)}
          render={(name) => (
            <>
              <span className="pick-tile__icon" dangerouslySetInnerHTML={{ __html: layoutSvg(name) }} />
              <span>{name}</span>
            </>
          )}
        />
      </Section>

      <Section title="5. Особенности площадки">
        <MultiChips label="Что есть у вас" hint="можно несколько" options={FEATURES} value={v.features} onChange={(x) => set("features", x)} />
        <ChoiceChips label="Где находитесь" options={LOCATIONS} value={v.location} onChange={(x) => set("location", x)} />
        <ChoiceChips label="Громкость" options={LOUDNESS} value={v.loudness} onChange={(x) => set("loudness", x)} />
        <ChoiceChips label="Парковка" options={PARKING} value={v.parking} onChange={(x) => set("parking", x)} />
        <NumberField label="Машиномест примерно" value={v.parkingSpots} max={10000} placeholder="если есть" onChange={(x) => set("parkingSpots", x)} />
        <Toggle label="Можно подъехать к входу и разгрузить технику" checked={v.unload} onChange={(x) => set("unload", x)} />
      </Section>

      <Section title="6. Кухня и меню">
        <MultiChips label="Преобладающая кухня" hint={`до ${MAX_CUISINES}`} limit={MAX_CUISINES} options={CUISINES} value={v.cuisine} onChange={(x) => set("cuisine", x)} />
        <MultiChips label="В меню есть" hint="можно несколько" options={DIETS} value={v.diet} onChange={(x) => set("diet", x)} />
        <NumberField label="Банкет на гостя, от, ₽" hint="примерно, без алкоголя" value={v.perGuest} onChange={(x) => set("perGuest", x)} />
        <div className="venue-menu-box">
          <p className="field__label">
            Меню<span className="required" aria-hidden="true"> *</span>
            <span className="field__hint"> фото страниц, PDF или ссылка — достаточно одного</span>
          </p>
          {menuFiles}
          <TextField label="Ссылка на меню" value={v.menuLink} maxLength={TEXT_LIMITS.menuLink} inputMode="url" placeholder="сайт, Яндекс Диск, соцсети" onChange={(x) => set("menuLink", x)} />
          <MultiChips label="Какое меню" options={MENU_KINDS} value={v.menuKinds} onChange={(x) => set("menuKinds", x)} />
        </div>
      </Section>

      <Section title="7. Оборудование" hint="Отметьте, что есть на площадке, и укажите количество.">
        <ul className="equipment">
          {EQUIPMENT.map((name) => {
            const count = v.equipment[name] ?? 0;
            const setCount = (n: number) => {
              const next = { ...v.equipment };
              if (n <= 0) delete next[name];
              else next[name] = Math.min(99, n);
              set("equipment", next);
            };
            return (
              <li key={name} className="equipment__item">
                <label className="equipment__name">
                  <input type="checkbox" checked={count > 0} onChange={(e) => setCount(e.target.checked ? 1 : 0)} />
                  <span>{name}</span>
                </label>
                {count > 0 && (
                  <span className="stepper">
                    <button type="button" className="stepper__btn" aria-label={`${name}: меньше`} onClick={() => setCount(count - 1)}>
                      −
                    </button>
                    <output aria-live="polite">{count}</output>
                    <button type="button" className="stepper__btn" aria-label={`${name}: больше`} onClick={() => setCount(count + 1)}>
                      +
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <MultiChips label="Как подключить ноутбук ведущего" hint="можно несколько" options={CONNECTIONS} value={v.connections} onChange={(x) => set("connections", x)} />
        <Toggle label="Ведущий может привезти свою технику" checked={v.ownTech} onChange={(x) => set("ownTech", x)} />
        <Toggle label="На площадке есть техник или звукорежиссёр" checked={v.technician} onChange={(x) => set("technician", x)} />
      </Section>

      <Section title="8. Условия">
        <MultiChips label="Можно принести своё" hint="можно несколько" options={OWN_ITEMS} value={v.ownItems} onChange={(x) => set("ownItems", x)} />
        <ChoiceChips label="Свой алкоголь" options={ALCOHOL} value={v.alcohol} onChange={(x) => onChange({ ...v, alcohol: x, corkage: x === "Пробковый сбор" ? v.corkage : null })} />
        {v.alcohol === "Пробковый сбор" && <NumberField label="Пробковый сбор, ₽ за бутылку" value={v.corkage} onChange={(x) => set("corkage", x)} />}
        <div className="two-cols">
          <NumberField label="Депозит или мин. заказ, ₽" value={v.deposit} max={100_000_000} onChange={(x) => set("deposit", x)} />
          <NumberField label="Сервисный сбор, %" value={v.service} max={50} placeholder="0" onChange={(x) => set("service", x)} />
        </div>
        <ChoiceChips label="В один день у вас бывает" options={PARALLEL} value={v.parallel} onChange={(x) => set("parallel", x)} />
        <MultiChips label="Что разрешено на мероприятии" hint="можно несколько" options={FX} value={v.fx} onChange={(x) => set("fx", x)} />
        <ChoiceChips label="Наши подрядчики (ведущий, диджей, декоратор, фотограф)" options={CONTRACTORS} value={v.contractors} onChange={(x) => set("contractors", x)} />
        <ChoiceChips label="За сколько до начала можно заехать на монтаж" options={SETUP} value={v.setup} onChange={(x) => set("setup", x)} />
        <ChoiceChips label="Закрываете заведение под мероприятие" options={CLOSE} value={v.close} onChange={(x) => set("close", x)} />
        <ChoiceChips label="Мероприятие может идти до" options={UNTIL} value={v.until} onChange={(x) => set("until", x)} />
        <MultiChips label="Оплата" options={PAY} value={v.pay} onChange={(x) => set("pay", x)} />
        <ChoiceChips label="Работаете с ивент-агентствами" options={AGENCY} value={v.agency} onChange={(x) => onChange({ ...v, agency: x, commission: x === "Да, платим комиссию" ? v.commission : null })} />
        {v.agency === "Да, платим комиссию" && <NumberField label="Комиссия агентству, %" value={v.commission} max={50} onChange={(x) => set("commission", x)} />}
      </Section>
    </>
  );
}
