/* Расчёт стоимости вечера (калькулятор сайта). Чистые данные и функция без обращения к
 * странице: её же проверяет server/src/sitePricing.test.ts (все пути калькулятора).
 *
 * Порядок итога для каждой из трёх цен:
 * (пакет + добавленные игры + продление + обычные допы) × 1,1 в пт–вс
 *   × (1 − скидка ведущего) → вверх до 100 ₽ → + фиксированные допы. */
(function (root) {
  'use strict';

  /** Ступени гостей: до 15 … до 90. Индекс 5 — «90+», цена индивидуально. */
  var TIERS = [15, 25, 45, 60, 90];

  var PACKAGES = [
    { id: 'game', name: 'Игровой вечер', games: 'Мафия, Бункер, Шпион, Правда или действие', prices: [14900, 18900, 24900, 29900, 37900] },
    { id: 'quiz', name: 'Квиз', games: 'Классический или авторский', prices: [19900, 24900, 32900, 39900, 49900] },
    { id: 'show', name: 'Шоу-вечер', games: 'Своя игра, Кто хочет стать миллионером + мини-квиз', prices: [22900, 27900, 35900, 42900, 52900] },
    { id: 'music', name: 'Музыкальный', games: 'Угадай мелодию, Музыкальное лото, «Спой лучше всех»', prices: [19900, 24900, 32900, 39900, 49900] },
    { id: 'dance', name: 'Танцевальный', games: 'Just Dance Battle, Танцевальное лото, Танцевальный кураж', prices: [19900, 24900, 32900, 39900, 49900] },
    { id: 'active', name: 'Активные настолки', games: 'Бой с драконом, Гонка на выживание, Шашки', prices: [21400, 26400, 34400, 41400, 51400] }
  ];
  var TURNKEY = { id: 'turnkey', name: 'Под ключ', games: 'Свой сценарий и большая программа', from: 35000 };

  /** Продление: подпись, цена, часы. */
  var EXTENSIONS = [
    { label: 'Нет', price: 0, hours: 0 },
    { label: '+30 мин', price: 3900, hours: 0.5 },
    { label: '+1 ч', price: 7900, hours: 1 },
    { label: '+1,5 ч', price: 11800, hours: 1.5 },
    { label: '+2 ч', price: 15800, hours: 2 }
  ];

  /** Допы. fixed — не меняются от дня недели и формата ведущего. */
  var ADDONS = [
    { id: 'corp', label: 'Квиз под компанию', tag: '«индивидуально»', price: 7000, fixed: false,
      info: 'Вопросы пишем специально под вас: сфера компании, её история, коллеги и внутренние шутки. Вы присылаете факты — мы собираем квиз. Заказывать минимум за 2 недели.' },
    { id: 'logo', label: 'Логотип на экранах', tag: '', price: 3000, fixed: false,
      info: 'Ваш логотип и цвета — на экране зала, на заставке с QR-кодом и на странице итогов, которую получают гости.' },
    { id: 'prize', label: 'Призы и медали', tag: '', price: 2500, fixed: true,
      info: 'Медали и небольшие призы победителям — вручаем на пьедестале в финале игры. Цена призов не меняется от дня недели и выбора ведущего.' },
    { id: 'dance', label: 'Танцевальная пауза', tag: '', price: 3000, fixed: false,
      info: 'Короткий танцевальный батл между играми другого пакета: гости танцуют под клипы, зал ставит оценки с телефонов. Нужен целый танцевальный вечер — выберите пакет «Танцевальный».' },
    { id: 'out', label: 'Игра на открытом воздухе', tag: '', price: 2500, fixed: false,
      info: 'Игры на улице или за городом: дополнительное оборудование и реквизит для открытого воздуха.' },
    { id: 'far', label: 'Выезд за Московскую область', tag: '', price: 2000, fixed: true,
      info: 'Москва и Подмосковье — выезд уже включён в пакет. Дальше — +2 000 ₽ и такси ведущему по факту. Эта сумма не меняется от дня недели и выбора ведущего.' }
  ];

  /** Формат ведущего — те же значения, что hostLevel в /api/lead. */
  var LEVELS = [
    { id: 'standard', name: 'Опытный', badge: '', discount: 0 },
    { id: 'new', name: 'Новые лица', badge: '−20%', discount: 0.2 },
    { id: 'first', name: 'Первый старт', badge: '−35%', discount: 0.35 }
  ];

  var WEEKEND = 1.1;
  var MAX_EXTRAS = 2;

  function pkgById(id) {
    for (var i = 0; i < PACKAGES.length; i++) if (PACKAGES[i].id === id) return PACKAGES[i];
    return null;
  }
  /** Вверх до сотни; сначала до копеек — 24 900 × 1,1 в JS даёт 27 390,000000000004. */
  function roundUp(y) { return Math.ceil(Math.round(y * 100) / 100 / 100) * 100; }
  /** Цена добавленной игры: половина её пакета на той же ступени, вверх до сотни. */
  function extraPrice(id, tier) { return Math.ceil(pkgById(id).prices[tier] * 0.5 / 100) * 100; }
  function hoursWord(n) { return (n % 1 !== 0 || (n >= 2 && n <= 4)) ? 'часа' : 'часов'; }
  function gamesWord(n) { return n === 1 ? 'игра' : (n >= 2 && n <= 4 ? 'игры' : 'игр'); }
  function hh(n) { return String(n).replace('.', ','); }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

  /**
   * opts: { pkg: id пакета | 'turnkey', tier: 0…5 (5 — больше 90), weekend: boolean,
   *         extras: [id других пакетов], ext: 0…4, addons: [id допов] }
   * Ответ: { individual, reason, totals: [{ id, name, badge, price }], lines: [{ label, value, fixed }],
   *          hours: { min, max }, extrasCount }
   */
  function calcPrice(opts) {
    var pkgId = opts.pkg || 'quiz';
    var tier = typeof opts.tier === 'number' ? opts.tier : 0;
    var weekend = !!opts.weekend;
    var ext = EXTENSIONS[opts.ext || 0] ? (opts.ext || 0) : 0;
    var addons = opts.addons || [];
    var pkg = pkgById(pkgId);
    var extras = (opts.extras || []).filter(function (id) { return id !== pkgId && pkgById(id); });
    var nEx = extras.length;
    var hours = { min: 1.5 + nEx + EXTENSIONS[ext].hours, max: 2 + nEx + EXTENSIONS[ext].hours };

    var reason = '';
    if (pkgId === TURNKEY.id || !pkg) reason = 'turnkey';
    else if (tier >= TIERS.length) reason = 'guests';
    else if (nEx > MAX_EXTRAS) reason = 'extras';
    if (reason) return { individual: true, reason: reason, totals: [], lines: [], hours: hours, extrasCount: nEx };

    var flex = pkg.prices[tier];
    var fixedSum = 0;
    var lines = [{ label: pkg.name + ', до ' + TIERS[tier] + ' гостей', value: pkg.prices[tier], fixed: false }];
    extras.forEach(function (id) {
      var v = extraPrice(id, tier);
      flex += v;
      lines.push({ label: '+ ' + pkgById(id).name + ' в тот же вечер', value: v, fixed: false });
    });
    if (ext > 0) {
      flex += EXTENSIONS[ext].price;
      lines.push({ label: 'Продление ' + EXTENSIONS[ext].label.replace('+', ''), value: EXTENSIONS[ext].price, fixed: false });
    }
    var fixedLines = [];
    ADDONS.forEach(function (a) {
      if (addons.indexOf(a.id) < 0) return;
      if (a.fixed) { fixedSum += a.price; fixedLines.push({ label: a.label + ' (без скидок)', value: a.price, fixed: true }); }
      else { flex += a.price; lines.push({ label: a.label, value: a.price, fixed: false }); }
    });
    var x = flex * (weekend ? WEEKEND : 1);
    var totals = LEVELS.map(function (l) {
      return { id: l.id, name: l.name, badge: l.badge, price: roundUp(x * (1 - l.discount)) + fixedSum };
    });
    return { individual: false, reason: '', totals: totals, lines: lines.concat(fixedLines), weekend: weekend, hours: hours, extrasCount: nEx };
  }

  var api = {
    TIERS: TIERS, PACKAGES: PACKAGES, TURNKEY: TURNKEY, EXTENSIONS: EXTENSIONS, ADDONS: ADDONS, LEVELS: LEVELS,
    MAX_EXTRAS: MAX_EXTRAS, calcPrice: calcPrice, extraPrice: extraPrice, pkgById: pkgById,
    roundUp: roundUp, hoursWord: hoursWord, gamesWord: gamesWord, hh: hh, money: money
  };
  // Браузер: обычный скрипт → window.JoyPricing. Тесты (vitest) импортируют файл и читают globalThis.JoyPricing.
  root.JoyPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
