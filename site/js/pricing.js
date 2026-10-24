/* Расчёт стоимости вечера (калькулятор сайта). Чистые данные и функция без обращения к
 * странице: её же проверяет server/src/sitePricing.test.ts (все пути калькулятора).
 *
 * Порядок итога для каждой из трёх цен:
 * (пакет + добавленные игры + продление + обычные допы) × 1,1 в пт–вс
 *   × (1 − скидка ведущего) → вверх до 100 ₽ → + призы
 *   → + праздничная цена (процент от этой суммы, вверх до 100 ₽; 31 декабря и 1 января — не меньше 50 000 ₽)
 *   → + выезд за город (своя цена по дате, без процентов).
 * Праздничная цена (решение владельца 22 октября 2026) зависит от даты праздника, а не от дня брони; границы
 * включительно: 5–18 декабря +20%, 19–30 декабря +40%, 31 декабря и 1 января +40% и не меньше 50 000 ₽; перед
 * 14 февраля, 23 февраля и 8 марта: за 14–8 дней +10%, за 7–1 день +15%, в сам праздник +25%. Ранняя бронь —
 * сегодня (по Москве) не позже 15 ноября: новогодняя праздничная цена 5–28 декабря вдвое меньше. */
(function (root) {
  'use strict';

  /** Ступени гостей: до 15 … до 90. Индекс 5 — «90+», цена индивидуально. */
  var TIERS = [15, 25, 45, 60, 90];

  var PACKAGES = [
    { id: 'game', name: 'Игровой вечер', games: 'Мафия, Убежище, Шпион, Правда или действие', prices: [14900, 18900, 24900, 29900, 37900] },
    { id: 'quiz', name: 'Квиз', games: 'Классический или авторский', prices: [19900, 24900, 32900, 39900, 49900] },
    { id: 'show', name: 'Шоу-вечер', games: 'Ставка на знания, Миллион на кону + мини-квиз', prices: [22900, 27900, 35900, 42900, 52900] },
    { id: 'music', name: 'Музыкальный', games: 'Узнай по нотам, Музыкальное лото, «Спой лучше всех»', prices: [19900, 24900, 32900, 39900, 49900] },
    { id: 'dance', name: 'Танцевальный', games: 'Танцуй как звезда, Танцевальное лото, Танцевальный кураж', prices: [19900, 24900, 32900, 39900, 49900] },
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
    { id: 'far', label: 'Выезд за город', tag: '', price: 2000, fixed: true,
      info: 'По Москве выезд включён; если рядом с местом праздника нет метро (дальше 10–15 минут пешком) — такси ведущему по факту. Города Подмосковья (Химки, Мытищи, Балашиха…) и дальше — +2 000 ₽ и такси ведущему по факту; в праздничные дни — 5 000 ₽, с 19 декабря по 1 января — 7 000 ₽. Эта сумма не меняется от дня недели и выбора ведущего.' }
  ];

  /** Формат ведущего — те же значения, что hostLevel в /api/lead. */
  var LEVELS = [
    { id: 'standard', name: 'Опытный', badge: '', discount: 0 },
    { id: 'new', name: 'Новые лица', badge: '−20%', discount: 0.2 },
    { id: 'first', name: 'Первый старт', badge: '−35%', discount: 0.35 }
  ];

  var WEEKEND = 1.1;
  var MAX_EXTRAS = 2;


  // ---------- Праздничная цена ----------
  /** Праздники со ступенями «за 2 недели / за неделю / в сам день» (решение владельца 22 октября 2026). */
  var HOLIDAYS = [
    { m: 2, d: 14, name: '14 февраля' },
    { m: 2, d: 23, name: '23 февраля' },
    { m: 3, d: 8, name: '8 марта' }
  ];
  var NY_MIN = 50000;
  /** Ранняя бронь Нового года: сегодня не позже этого дня (месяц, число) того же года, что и декабрь праздника. */
  var EARLY_UNTIL = { m: 11, d: 15 };
  /** Выезд за город: обычные дни, праздничные периоды, пик (19 декабря — 1 января). */
  var TRAVEL = { normal: 2000, holiday: 5000, peak: 7000 };
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

  /** «2026-12-10» → { y, m, d, t (сутки от 1970), wd } или null (не дата, несуществующий день). */
  function parseDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof iso === 'string' ? iso : '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    // Пока год набирают с клавиатуры, браузер отдаёт «0002-12-15», «0020-…» — это ещё не дата.
    if (y < 2000 || y > 2999) return null;
    var ms = Date.UTC(y, mo - 1, d);
    var back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return { y: y, m: mo, d: d, t: Math.round(ms / 86400000), wd: back.getUTCDay() };
  }
  function iso(y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
  /** Сегодня по Москве (UTC+3, без перехода на летнее время) — «2026-10-22». */
  function moscowToday(nowMs) {
    var t = new Date((typeof nowMs === 'number' ? nowMs : Date.now()) + 3 * 3600000);
    return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function dateLabel(p) { return p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y + ', ' + WD_SHORT[p.wd]; }
  function isWeekendDay(p) { return p.wd === 5 || p.wd === 6 || p.wd === 0; }

  /**
   * Праздничная цена на дату праздника (today — сегодня по Москве, для ранней брони).
   * Ответ: null (обычный день) | { id, pct, fullPct, early, min, travel, title, text, holiday }.
   */
  function seasonFor(date, today) {
    var p = parseDate(date);
    if (!p) return null;
    var s = null;
    if ((p.m === 12 && p.d === 31) || (p.m === 1 && p.d === 1)) {
      s = { id: 'nynight', pct: 40, min: NY_MIN, travel: 'peak', title: 'Новогодняя ночь',
        text: '31 декабря и 1 января — самые востребованные дни года: ведущий работает в новогоднюю ночь. Любой праздник в эти дни — от 50 000 ₽.' };
    } else if (p.m === 12 && p.d >= 19) {
      s = { id: 'nypeak', pct: 40, travel: 'peak', title: 'Пик новогодних корпоративов',
        text: 'С 19 по 30 декабря — самые плотные даты года: ведущих бронируют за месяцы вперёд, праздники идут один за другим.' };
    } else if (p.m === 12 && p.d >= 5) {
      s = { id: 'nyseason', pct: 20, travel: 'holiday', title: 'Новогодний сезон',
        text: 'С 5 по 18 декабря начинается сезон новогодних корпоративов: спрос на ведущих растёт, свободных дат всё меньше.' };
    } else {
      var best = null;
      [p.y, p.y + 1].forEach(function (yy) {
        HOLIDAYS.forEach(function (h) {
          var hp = parseDate(iso(yy, h.m, h.d));
          var diff = hp.t - p.t;
          if (diff >= 0 && diff <= 14 && (!best || diff < best.diff)) best = { diff: diff, h: h };
        });
      });
      if (best) {
        var n = best.h.name;
        if (best.diff === 0) s = { id: 'holiday', pct: 25, travel: 'holiday', title: 'Праздничный день: ' + n,
          text: n + ' — сам праздник: самый востребованный день, ведущих бронируют заранее.' };
        else if (best.diff <= 7) s = { id: 'week', pct: 15, travel: 'holiday', title: 'Неделя до ' + n,
          text: 'За неделю до ' + n + ' праздников больше всего: компании и семьи отмечают в эти дни, свободных ведущих почти нет.' };
        else s = { id: 'twoweeks', pct: 10, travel: 'holiday', title: 'Две недели до ' + n,
          text: 'За две недели до ' + n + ' начинается сезон праздников: спрос на ведущих растёт.' };
        s.holiday = n;
      }
    }
    if (!s) return null;
    s.fullPct = s.pct;
    s.min = s.min || 0;
    s.early = false;
    // Ранняя бронь: только новогодние даты 5–28 декабря и только если сегодня не позже 15 ноября того же года.
    var t = parseDate(today);
    if (p.m === 12 && p.d >= 5 && p.d <= 28 && t && t.t <= parseDate(iso(p.y, EARLY_UNTIL.m, EARLY_UNTIL.d)).t) {
      s.pct = s.fullPct / 2;
      s.early = true;
    }
    return s;
  }

  /** Подсказка «успейте без праздничной цены»: дата праздника — 14 ноября … 4 декабря. */
  function seasonHint(date) {
    var p = parseDate(date);
    if (!p) return '';
    if ((p.m === 11 && p.d >= 14) || (p.m === 12 && p.d <= 4)) return 'Праздник до 4 декабря включительно — без новогодней праздничной цены. С 5 декабря действует новогодний сезон.';
    return '';
  }
  function travelPrice(season) { return TRAVEL[season ? season.travel : 'normal']; }
  /** «+20%» или «+10% вместо +20% (ранняя бронь)», для 31.12 и 1.01 — «+40%, от 50 000 ₽». */
  function seasonBadge(s) {
    if (!s) return '';
    var b = '+' + hh(s.pct) + '%';
    if (s.early) b += ' вместо +' + s.fullPct + '%';
    if (s.min) b += ', от ' + money(s.min);
    return b;
  }
  function earlyUntilLabel(date) {
    var p = parseDate(date);
    return EARLY_UNTIL.d + ' ' + MONTHS[EARLY_UNTIL.m - 1] + (p ? ' ' + p.y : '');
  }

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
   *         extras: [id других пакетов], ext: 0…4, addons: [id допов],
   *         date: «2026-12-10» — дата праздника (есть — день недели берётся из неё), today: сегодня по Москве }
   * Ответ: { individual, reason, totals: [{ id, name, badge, price, base, extra }], lines: [{ label, value, fixed }],
   *          hours: { min, max }, extrasCount, weekend, date: { iso, label, weekday } | null, season, hint, travel }
   * price — итог; base — до праздничной цены (без выезда); extra — праздничная цена в рублях.
   */
  function calcPrice(opts) {
    var pkgId = opts.pkg || 'quiz';
    var tier = typeof opts.tier === 'number' ? opts.tier : 0;
    var day = parseDate(opts.date);
    var weekend = day ? isWeekendDay(day) : !!opts.weekend;
    var today = typeof opts.today === 'string' && parseDate(opts.today) ? opts.today : moscowToday();
    var season = day ? seasonFor(opts.date, today) : null;
    var hint = day ? seasonHint(opts.date) : '';
    var dateInfo = day ? { iso: opts.date, label: dateLabel(day), weekday: WEEKDAYS[day.wd] } : null;
    var ext = EXTENSIONS[opts.ext || 0] ? (opts.ext || 0) : 0;
    var addons = opts.addons || [];
    var pkg = pkgById(pkgId);
    var extras = (opts.extras || []).filter(function (id) { return id !== pkgId && pkgById(id); });
    var nEx = extras.length;
    var hours = { min: 1.5 + nEx + EXTENSIONS[ext].hours, max: 2 + nEx + EXTENSIONS[ext].hours };
    var travel = travelPrice(season);
    var common = { hours: hours, extrasCount: nEx, weekend: weekend, date: dateInfo, season: season, hint: hint, travel: travel };

    var reason = '';
    if (pkgId === TURNKEY.id || !pkg) reason = 'turnkey';
    else if (tier >= TIERS.length) reason = 'guests';
    else if (nEx > MAX_EXTRAS) reason = 'extras';
    if (reason) return assign({ individual: true, reason: reason, totals: [], lines: [] }, common);

    var flex = pkg.prices[tier];
    var prizes = 0, far = 0;
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
      if (a.id === 'far') { far = travel; fixedLines.push({ label: a.label + ' (+ такси ведущему)', value: travel, fixed: true }); }
      else if (a.fixed) { prizes += a.price; fixedLines.push({ label: a.label + ' (без скидок)', value: a.price, fixed: true }); }
      else { flex += a.price; lines.push({ label: a.label, value: a.price, fixed: false }); }
    });
    var x = flex * (weekend ? WEEKEND : 1);
    var totals = LEVELS.map(function (l) {
      var base = roundUp(x * (1 - l.discount)) + prizes;
      var withSeason = base;
      if (season) {
        withSeason = base + roundUp(base * season.pct / 100);
        if (season.min && withSeason < season.min) withSeason = season.min;
      }
      return { id: l.id, name: l.name, badge: l.badge, base: base, extra: withSeason - base, price: withSeason + far };
    });
    return assign({ individual: false, reason: '', totals: totals, lines: lines.concat(fixedLines) }, common);
  }
  function assign(a, b) { for (var k in b) a[k] = b[k]; return a; }

  /** Строка о праздничной цене для текстов: «Праздничная цена +20% — Новогодний сезон». */
  function seasonLine(s, date) {
    if (!s) return '';
    var line = 'праздничная цена ' + seasonBadge(s) + ' — ' + s.title;
    if (s.early) line += ' (ранняя бронь до ' + earlyUntilLabel(date) + ')';
    return line;
  }

  /**
   * Расчёт для заявки (карточка «Ваш расчёт» и поле calc в /api/lead): тот же выбор, что у calcPrice.
   * Ответ: { type: «Пакет «…»» | «Под ключ», guests: число | null, parts: [строки выбора],
   *          totals: [{ name, price, base, extra }] | null (индивидуально), duration, season: строка | '', date: строка | '',
   *          text — одной строкой для Telegram }.
   */
  /**
   * Время начала (решение владельца 23 октября 2026): по желанию, на цену не влияет — только строка менеджеру.
   * Принимаем «ЧЧ:ММ» (00:00–23:59), иначе пусто. Время подтверждает менеджер: свободны ли ведущие.
   */
  /** Текст для ссылки t.me/…?text=: Telegram раскодирует её дважды и обрезает сообщение на «%» (и путает «+», «&»),
   *  поэтому здесь — похожие знаки, которые ему не мешают (жалоба владельца 24 октября 2026: расчёт приходил не целиком). */
  function telegramText(t) {
    return String(t || '').replace(/%/g, '\uFF05').replace(/\+/g, '\uFF0B').replace(/&/g, ' и ');
  }
  /** Письмо с расчётом: почта в браузере (Gmail, Яндекс, Mail.ru) или почтовое приложение (mailto).
   *  Решение владельца 24 октября 2026: клиенту не нужно открывать почтовую программу Mac. */
  function mailLinks(text) {
    var to = 'joyrest@mail.ru', su = 'Расчёт JoyRest', enc = encodeURIComponent;
    var app = 'mailto:' + to + '?subject=' + enc(su) + '&body=' + enc(String(text || ''));
    return {
      gmail: 'https://mail.google.com/mail/?view=cm&fs=1&to=' + enc(to) + '&su=' + enc(su) + '&body=' + enc(String(text || '')),
      yandex: 'https://mail.yandex.ru/compose?mailto=' + enc(app),
      mailru: 'https://e.mail.ru/compose/?mailto=' + enc(app),
      app: app
    };
  }
  function cleanTime(t) {
    return typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : '';
  }

  function calcSummary(opts) {
    var r = calcPrice(opts);
    var pkgId = opts.pkg || 'quiz';
    var pkg = pkgById(pkgId);
    var tier = typeof opts.tier === 'number' ? opts.tier : 0;
    var turnkey = pkgId === TURNKEY.id || !pkg;
    var type = turnkey ? 'Под ключ' : 'Пакет «' + pkg.name + '»';
    var parts = [tier < TIERS.length ? 'до ' + TIERS[tier] + ' гостей' : 'больше 90 гостей'];
    if (r.date) parts.push('дата ' + r.date.label);
    if (cleanTime(opts.time)) parts.push('начало в ' + cleanTime(opts.time));
    parts.push(r.weekend ? 'пятница–воскресенье' : 'будни');
    var extras = (opts.extras || []).filter(function (id) { return id !== pkgId && pkgById(id); });
    if (extras.length) parts.push('ещё в этот вечер: ' + extras.map(function (id) { return pkgById(id).name; }).join(', '));
    var ext = EXTENSIONS[opts.ext || 0] ? (opts.ext || 0) : 0;
    if (ext > 0) parts.push('продление ' + EXTENSIONS[ext].label.replace('+', ''));
    var addons = ADDONS.filter(function (a) { return (opts.addons || []).indexOf(a.id) >= 0; }).map(function (a) { return a.label; });
    if (addons.length) parts.push('допы: ' + addons.join(', '));
    var season = seasonLine(r.season, opts.date);
    if (season) parts.push(season);
    var hasFar = (opts.addons || []).indexOf('far') >= 0;
    if (hasFar) parts.push('выезд за город ' + money(r.travel) + ' + такси ведущему');
    var duration = '≈ ' + hh(r.hours.min) + '–' + hh(r.hours.max) + ' ' + hoursWord(r.hours.max);
    var totals = r.individual ? null : r.totals.map(function (t) { return { name: t.name, price: t.price, base: t.base, extra: t.extra }; });
    var totalText = totals ? totals.map(function (t) { return t.name + ' — ' + money(t.price); }).join(', ') : 'обсудим индивидуально';
    var text = type + ', ' + parts.join(', ') + '. Вечер ' + duration + '. Итого' + (season && totals ? ' (праздничная цена уже в итоге)' : '') + ': ' + totalText + '.';
    if (!r.date) text += ' Дата праздника не указана.';
    return {
      type: type,
      guests: tier < TIERS.length ? TIERS[tier] : null,
      parts: parts.map(function (x) { return x.replace(/\u00a0/g, ' '); }),
      totals: totals,
      duration: duration,
      season: season,
      date: r.date ? r.date.label : '',
      text: text.replace(/ /g, ' ')
    };
  }

  /**
   * Расчёт сообщением менеджеру (решение владельца 17 октября 2026): строки «Что: значение», чтобы было видно, что
   * напротив чего. Мессенджеры и Авито таблиц не рисуют, поэтому каждая строка — пара, без разметки (Telegram, WhatsApp,
   * Авито, почта показывают одинаково). levelId — выбранный формат ведущего (отмечен ✓) или пусто.
   * Праздничная цена (22 октября 2026): строка «Праздничная цена» с причиной, у цен — «32 900 ₽ (27 400 + 5 500)».
   */
  function calcMessage(opts, levelId) {
    var r = calcPrice(opts);
    var pkgId = opts.pkg || 'quiz';
    var pkg = pkgById(pkgId);
    var tier = typeof opts.tier === 'number' ? opts.tier : 0;
    var rows = [['Пакет', pkgId === TURNKEY.id || !pkg ? 'Под ключ' : pkg.name]];
    rows.push(['Гостей', tier < TIERS.length ? 'до ' + TIERS[tier] : 'больше 90']);
    rows.push(['Дата', r.date ? r.date.label : 'не указана']);
    if (cleanTime(opts.time)) rows.push(['Начало', 'в ' + cleanTime(opts.time) + ' (примерно, подтвердит менеджер)']);
    rows.push(['День', r.weekend ? 'пятница–воскресенье' : 'будни']);
    var extras = (opts.extras || []).filter(function (id) { return id !== pkgId && pkgById(id); });
    if (extras.length) rows.push(['Ещё игры', extras.map(function (id) { return pkgById(id).name; }).join(', ')]);
    var ext = EXTENSIONS[opts.ext || 0] ? (opts.ext || 0) : 0;
    rows.push(['Продление', ext > 0 ? EXTENSIONS[ext].label.replace('+', '') : 'нет']);
    var addons = ADDONS.filter(function (a) { return (opts.addons || []).indexOf(a.id) >= 0; }).map(function (a) { return a.label; });
    rows.push(['Допы', addons.length ? addons.join(', ') : 'нет']);
    if ((opts.addons || []).indexOf('far') >= 0) rows.push(['Выезд за город', money(r.travel) + ' + такси ведущему']);
    rows.push(['Длительность', '≈ ' + hh(r.hours.min) + '–' + hh(r.hours.max) + ' ' + hoursWord(r.hours.max)]);
    if (r.season) {
      rows.push(['Праздничная цена', seasonBadge(r.season) + ' — ' + r.season.title]);
      if (r.season.early) rows.push(['Ранняя бронь', 'до ' + earlyUntilLabel(opts.date) + ' — посчитано ' + niceDate(opts.today || moscowToday())]);
    }
    var line = '────────────';
    var out = ['🧮 Расчёт JoyRest', line];
    rows.forEach(function (row) { out.push(row[0] + ': ' + row[1]); });
    out.push(line);
    if (r.individual) {
      out.push('Стоимость: обсудим индивидуально');
    } else {
      var chosen = LEVELS.filter(function (l) { return l.id === levelId; })[0];
      var far = (opts.addons || []).indexOf('far') >= 0;
      out.push('Стоимость по формату ведущего' + (r.season ? ' (праздничная цена уже в итоге)' : '') + ':');
      r.totals.forEach(function (t) {
        var pick = chosen && chosen.id === t.id;
        var how = '';
        if (r.season) {
          var minHit = r.season.min && t.base + roundUp(t.base * r.season.pct / 100) < r.season.min;
          how = minHit ? ' (' + money(t.base) + ' → минимум ' + money(r.season.min) + ')' : ' (' + money(t.base) + ' + ' + money(t.extra) + ' праздничная цена)';
          if (far) how = how.replace(/\)$/, ' + ' + money(r.travel) + ' выезд)');
        }
        out.push((pick ? '✅ ' : '▫️ ') + t.name + (t.badge ? ' (' + t.badge + ')' : '') + ': ' + money(t.price) + how + (pick ? ' — выбран' : ''));
      });
    }
    return out.join('\n').replace(/ /g, ' ');
  }
  function niceDate(isoDate) {
    var p = parseDate(isoDate);
    return p ? p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y : isoDate;
  }

  var api = {
    TIERS: TIERS, PACKAGES: PACKAGES, TURNKEY: TURNKEY, EXTENSIONS: EXTENSIONS, ADDONS: ADDONS, LEVELS: LEVELS,
    MAX_EXTRAS: MAX_EXTRAS, HOLIDAYS: HOLIDAYS, TRAVEL: TRAVEL, NY_MIN: NY_MIN, EARLY_UNTIL: EARLY_UNTIL,
    seasonFor: seasonFor, seasonHint: seasonHint, seasonBadge: seasonBadge, seasonLine: seasonLine, moscowToday: moscowToday,
    parseDate: parseDate, cleanTime: cleanTime, telegramText: telegramText, mailLinks: mailLinks, earlyUntilLabel: earlyUntilLabel, calcPrice: calcPrice, calcSummary: calcSummary, calcMessage: calcMessage, extraPrice: extraPrice, pkgById: pkgById,
    roundUp: roundUp, hoursWord: hoursWord, gamesWord: gamesWord, hh: hh, money: money
  };
  // Браузер: обычный скрипт → window.JoyPricing. Тесты (vitest) импортируют файл и читают globalThis.JoyPricing.
  root.JoyPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
