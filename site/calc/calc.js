/* Калькулятор JoyRest без заявки (/calc/, решение владельца 15 октября 2026). Расчёт — JoyPricing из js/pricing.js
 * (тот же, что у сайта и в server/src/sitePricing.test.ts). Выбор запоминается на телефоне (localStorage, с try/catch:
 * в приватном режиме его может не быть). «Отправить расчёт менеджеру» — системное «Поделиться» текстом, иначе копия. */
(function () {
  'use strict';
  var P = window.JoyPricing;
  if (!P) return;
  var KEY = 'jr-calc-page';
  var state = { pkg: 'quiz', tier: 1, weekend: false, date: '', time: '', extras: [], ext: 0, addons: [], level: 'standard' };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') for (var k in state) if (k in saved) state[k] = saved[k];
  } catch (e) { /* без памяти — просто с начала */ }
  // Сегодня по Москве: ранняя бронь и прошедшие даты. Прошедшая или кривая дата из памяти не возвращается.
  function today() { return P.moscowToday(); }
  if (typeof state.date !== 'string' || !P.parseDate(state.date) || state.date < today()) state.date = '';
  state.time = P.cleanTime(state.time);
  function opts() {
    return { pkg: state.pkg, tier: state.tier, weekend: state.weekend, date: state.date, time: state.time, today: today(), extras: state.extras, ext: state.ext, addons: state.addons };
  }

  var $ = function (id) { return document.getElementById(id); };
  var money = P.money;

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* нет памяти — не страшно */ }
  }

  function opt(title, hint, price, pressed, onClick, disabled) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (disabled) b.disabled = true;
    var t = document.createElement('span');
    t.className = 'opt__title';
    t.textContent = title;
    b.appendChild(t);
    if (hint) {
      var h = document.createElement('span');
      h.className = 'opt__hint';
      h.textContent = hint;
      b.appendChild(h);
    }
    if (price) {
      var p = document.createElement('span');
      p.className = 'opt__price';
      p.textContent = price;
      b.appendChild(p);
    }
    b.addEventListener('click', onClick);
    return b;
  }

  function fill(id, nodes) {
    var el = $(id);
    el.textContent = '';
    nodes.forEach(function (n) { el.appendChild(n); });
  }

  function set(patch) {
    for (var k in patch) state[k] = patch[k];
    state.extras = state.extras.filter(function (id) { return id !== state.pkg; });
    save();
    render();
  }

  function render() {
    var turnkey = state.pkg === P.TURNKEY.id;
    var tierOk = state.tier < P.TIERS.length;

    fill('pkgs', P.PACKAGES.map(function (p) {
      return opt(p.name, p.games, 'от ' + money(p.prices[0]), state.pkg === p.id, function () { set({ pkg: p.id }); });
    }).concat([opt(P.TURNKEY.name, P.TURNKEY.games, 'от ' + money(P.TURNKEY.from) + ' · обсудим', turnkey, function () { set({ pkg: P.TURNKEY.id }); })]));

    fill('tiers', P.TIERS.map(function (n, i) {
      return opt('до ' + n, '', '', state.tier === i, function () { set({ tier: i }); });
    }).concat([opt('больше 90', 'обсудим', '', state.tier === P.TIERS.length, function () { set({ tier: P.TIERS.length }); })]));

    var r = P.calcPrice(opts());
    var dateEl = $('date');
    dateEl.min = today();
    if (dateEl.value !== state.date) dateEl.value = state.date;
    if ($('time').value !== state.time) $('time').value = state.time;
    var info = $('dateInfo');
    info.textContent = '';
    if (r.date) {
      var b = document.createElement('b');
      b.textContent = r.date.label.replace(/, [а-я]+$/, '') + ', ' + r.date.weekday;
      info.appendChild(b);
      info.appendChild(document.createTextNode(' — ' + (r.weekend ? 'пятница–воскресенье, +10%' : 'будний день') +
        (r.season ? ' · ' + r.season.title.toLowerCase() : '') + '.' + (state.date < today() ? ' Эта дата уже прошла — проверьте.' : '')));
    } else info.textContent = 'Укажите дату — день недели и праздничную цену посчитаем сами. Дата ещё не известна — выберите день ниже.';
    fill('days', [
      opt('Будни', 'пн–чт', '', !r.weekend, function () { set({ weekend: false }); }, !!r.date),
      opt('Пятница–воскресенье', '+10%', '', r.weekend, function () { set({ weekend: true }); }, !!r.date)
    ]);

    $('extraSection').hidden = turnkey;
    $('extSection').hidden = turnkey;
    $('addSection').hidden = turnkey;
    if (!turnkey) {
      fill('extras', P.PACKAGES.filter(function (p) { return p.id !== state.pkg; }).map(function (p) {
        var on = state.extras.indexOf(p.id) >= 0;
        var full = !on && state.extras.length >= P.MAX_EXTRAS;
        return opt(p.name, p.games, tierOk ? '+' + money(P.extraPrice(p.id, state.tier)) : '', on, function () {
          set({ extras: on ? state.extras.filter(function (x) { return x !== p.id; }) : state.extras.concat([p.id]) });
        }, full);
      }));
      fill('exts', P.EXTENSIONS.map(function (e, i) {
        return opt(e.label, '', e.price ? money(e.price) : '', state.ext === i, function () { set({ ext: i }); });
      }));
      fill('addons', P.ADDONS.map(function (a) {
        var on = state.addons.indexOf(a.id) >= 0;
        var price = a.id === 'far' ? r.travel : a.price;
        return opt(a.label, a.info, '+' + money(price) + (a.id === 'far' ? ' + такси' : '') + (a.fixed ? ' · без скидок' : ''), on, function () {
          set({ addons: on ? state.addons.filter(function (x) { return x !== a.id; }) : state.addons.concat([a.id]) });
        });
      }));
    }

    var body = $('resBody');
    body.textContent = '';
    var season = r.individual ? null : r.season;
    if (season) {
      var box = document.createElement('div');
      box.className = 'season';
      var title = document.createElement('p');
      title.className = 'season__title';
      var tName = document.createElement('span');
      tName.textContent = 'Праздничная цена · ' + season.title;
      var tBadge = document.createElement('span');
      tBadge.className = 'season__badge';
      tBadge.textContent = P.seasonBadge(season);
      title.appendChild(tName); title.appendChild(tBadge);
      box.appendChild(title);
      var why = document.createElement('p');
      why.textContent = season.text;
      box.appendChild(why);
      if (season.early) {
        var std = r.totals[0];
        var early = document.createElement('p');
        early.className = 'early';
        early.textContent = 'Ранняя бронь до ' + P.earlyUntilLabel(state.date) + ': +' + season.pct + '% вместо +' + season.fullPct + '% — экономия ' +
          money(P.roundUp(std.base * season.fullPct / 100) - std.extra) + ' на формате «' + std.name + '».';
        box.appendChild(early);
      }
      var note = document.createElement('p');
      note.textContent = 'Праздничная цена зависит от даты праздника, а не от дня брони, и считается последней — от суммы вечера со всеми выбранными пунктами.';
      box.appendChild(note);
      body.appendChild(box);
    }
    if (!r.individual && r.hint) {
      var hintEl = document.createElement('p');
      hintEl.className = 'hint-ok';
      hintEl.textContent = r.hint;
      body.appendChild(hintEl);
    }
    if (!r.individual && !r.date) {
      var nd = document.createElement('p');
      nd.className = 'small muted';
      nd.textContent = 'Укажите дату праздника — в декабре, перед праздниками и в сами праздники действует праздничная цена.';
      body.appendChild(nd);
    }
    if (r.individual) {
      var p = document.createElement('p');
      p.textContent = r.reason === 'turnkey'
        ? '«Под ключ» — от ' + money(P.TURNKEY.from) + '. Свой сценарий и большая программа: стоимость обсудим индивидуально.'
        : 'Такой вечер обсудим индивидуально — отправьте расчёт, менеджер всё уточнит.';
      body.appendChild(p);
      $('bar').hidden = true;
    } else {
      var totals = document.createElement('div');
      totals.className = 'totals';
      totals.setAttribute('role', 'group');
      totals.setAttribute('aria-label', 'Формат ведущего — коснитесь, чтобы выбрать');
      r.totals.forEach(function (t) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'total';
        b.setAttribute('aria-pressed', state.level === t.id ? 'true' : 'false');
        b.innerHTML = '<span><span class="total__name"></span><span class="total__badge"></span><span class="total__calc"></span></span><span class="total__price"></span>';
        b.querySelector('.total__name').textContent = t.name;
        b.querySelector('.total__badge').textContent = t.badge;
        b.querySelector('.total__calc').textContent = !season ? '' : (season.min && t.base + P.roundUp(t.base * season.pct / 100) < season.min
          ? 'минимум в новогоднюю ночь ' + money(season.min)
          : money(t.base) + ' + праздничная цена ' + money(t.extra));
        b.querySelector('.total__price').textContent = money(t.price);
        b.addEventListener('click', function () { set({ level: t.id }); });
        totals.appendChild(b);
      });
      body.appendChild(totals);
      var hint = document.createElement('p');
      hint.className = 'small muted';
      hint.textContent = 'Коснитесь цены, чтобы выбрать формат ведущего.';
      body.appendChild(hint);
      var help = document.createElement('button');
      help.type = 'button';
      help.className = 'help';
      help.innerHTML = '<b aria-hidden="true">?</b><span>Чем отличаются ведущие</span>';
      help.addEventListener('click', openLevels);
      body.appendChild(help);
      var chosen = r.totals.filter(function (t) { return t.id === state.level; })[0] || r.totals[0];
      $('barLabel').textContent = chosen.name;
      $('barSum').textContent = money(chosen.price);
      $('bar').hidden = false;
    }
    var d = document.createElement('p');
    d.className = 'duration';
    d.textContent = 'Вечер ≈ ' + P.hh(r.hours.min) + '–' + P.hh(r.hours.max) + ' ' + P.hoursWord(r.hours.max);
    body.appendChild(d);
    if (r.lines.length) {
      var ul = document.createElement('ul');
      ul.className = 'lines';
      r.lines.forEach(function (l) {
        var li = document.createElement('li');
        li.textContent = l.label + ' — ' + money(l.value);
        ul.appendChild(li);
      });
      if (r.weekend) { var wli = document.createElement('li'); wli.textContent = 'Пятница–воскресенье — +10%'; ul.appendChild(wli); }
      if (season) { var sli = document.createElement('li'); sli.textContent = 'Праздничная цена · ' + season.title + ' — ' + P.seasonBadge(season); ul.appendChild(sli); }
      body.appendChild(ul);
    }
  }

  /** Текст расчёта для менеджера: строки «Что: значение» и три цены, выбранный формат отмечен ✅. */
  function text() {
    return P.calcMessage(opts(), state.level || '');
  }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function copy(message) {
    var value = text();
    var done = function () { toast(typeof message === 'string' ? message : 'Расчёт скопирован — вставьте его в чат с менеджером'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, function () { fallback(value); });
    } else fallback(value);
    function fallback(v) {
      var area = document.createElement('textarea');
      area.value = v;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Не получилось скопировать — выделите текст вручную'); }
      document.body.removeChild(area);
    }
  }

  // Окно «Куда отправить расчёт?» (как на витрине сайта): WhatsApp и почта — с готовым текстом,
  // Telegram и Авито текст подставить не дают — копируем и открываем чат.
  var sheet = $('sheet'), sheetFrom = null;
  function closeSheet() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    document.body.style.overflow = '';
    if (sheetFrom) sheetFrom.focus();
  }
  var sheetFile = null;
  function levelIds() { return P.LEVELS.map(function (l) { return l.id; }); }
  function send(e) {
    var value = text();
    sheetFrom = e && e.currentTarget;
    $('sWa').href = 'https://wa.me/79857822689?text=' + encodeURIComponent(value);
    // Telegram сам вставляет текст в чат по номеру (t.me/+номер?text=…).
    $('sTg').href = 'https://t.me/+79857822689?text=' + encodeURIComponent(value);
    $('sMail').href = 'mailto:joyrest@mail.ru?subject=' + encodeURIComponent('Расчёт JoyRest') + '&body=' + encodeURIComponent(value);
    // Картинку готовим сразу: «Поделиться» телефона должно открыться прямо по касанию.
    sheetFile = null;
    if (window.JoyCalcImage) window.JoyCalcImage.make(P.calcSummary(opts()), state.level || 'standard', levelIds()).then(function (f) { sheetFile = f; }, function () {});
    $('sImg').hidden = !window.JoyCalcImage;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    $('sWa').focus();
  }
  $('sWa').addEventListener('click', function () { setTimeout(closeSheet, 0); });
  $('sMail').addEventListener('click', function () { setTimeout(closeSheet, 0); });
  $('sTg').addEventListener('click', function () { copy('Открываем Telegram — расчёт уже в сообщении (и скопирован, если понадобится вставить)'); closeSheet(); });
  $('sAvito').addEventListener('click', function () { copy('Расчёт скопирован. На Авито нажмите «Написать» и вставьте его в сообщение'); closeSheet(); });
  $('sImg').addEventListener('click', function () {
    var go = function (f) {
      return window.JoyCalcImage.share(f, text()).then(function (how) {
        if (how === 'saved') toast('Картинка расчёта сохранена — прикрепите её в чат с нами');
        if (how !== 'cancel') closeSheet();
      });
    };
    if (sheetFile) go(sheetFile);
    else window.JoyCalcImage.make(P.calcSummary(opts()), state.level || 'standard', levelIds()).then(go, function () { toast('Не получилось сделать картинку — отправьте текстом'); });
  });
  $('sCopy').addEventListener('click', function () { copy(); closeSheet(); });
  $('sClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });

  // «?» у трёх цен: чем отличаются форматы ведущих.
  var lv = $('lvSheet'), lvFrom = null;
  function openLevels(e) { lvFrom = e && e.currentTarget; lv.hidden = false; document.body.style.overflow = 'hidden'; $('lvClose').focus(); }
  function closeLevels() { if (lv.hidden) return; lv.hidden = true; document.body.style.overflow = ''; if (lvFrom && document.body.contains(lvFrom)) lvFrom.focus(); }
  $('lvClose').addEventListener('click', closeLevels);
  lv.addEventListener('click', function (ev) { if (ev.target === lv) closeLevels(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeLevels(); });

  var setDate = function () { var v = $('date').value; set({ date: P.parseDate(v) ? v : '' }); };
  $('date').addEventListener('change', setDate);
  $('date').addEventListener('input', setDate);
  var setTime = function () { set({ time: P.cleanTime($('time').value) }); };
  $('time').addEventListener('change', setTime);
  $('time').addEventListener('input', setTime);
  // Ранняя бронь Нового года — с 1 сентября по 15 ноября по Москве.
  (function () {
    var t = today(), y = t.slice(0, 4);
    var until = y + '-' + ('0' + P.EARLY_UNTIL.m).slice(-2) + '-' + ('0' + P.EARLY_UNTIL.d).slice(-2);
    $('promo').hidden = !(t >= y + '-09-01' && t <= until);
  })();
  $('send').addEventListener('click', send);
  $('barSend').addEventListener('click', send);
  $('copy').addEventListener('click', function () { copy(); });
  render();
})();
