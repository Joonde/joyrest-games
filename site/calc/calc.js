/* Калькулятор JoyRest без заявки (/calc/, решение владельца 15 октября 2026). Расчёт — JoyPricing из js/pricing.js
 * (тот же, что у сайта и в server/src/sitePricing.test.ts). Выбор запоминается на телефоне (localStorage, с try/catch:
 * в приватном режиме его может не быть). «Отправить расчёт менеджеру» — системное «Поделиться» текстом, иначе копия. */
(function () {
  'use strict';
  var P = window.JoyPricing;
  if (!P) return;
  var KEY = 'jr-calc-page';
  var state = { pkg: 'quiz', tier: 1, weekend: false, extras: [], ext: 0, addons: [], level: 'standard' };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') for (var k in state) if (k in saved) state[k] = saved[k];
  } catch (e) { /* без памяти — просто с начала */ }

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

    fill('days', [
      opt('Будни', 'пн–чт', '', !state.weekend, function () { set({ weekend: false }); }),
      opt('Пятница–воскресенье', '+10%', '', state.weekend, function () { set({ weekend: true }); })
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
        return opt(a.label, a.info, '+' + money(a.price) + (a.fixed ? ' · без скидок' : ''), on, function () {
          set({ addons: on ? state.addons.filter(function (x) { return x !== a.id; }) : state.addons.concat([a.id]) });
        });
      }));
    }

    var r = P.calcPrice(state);
    var body = $('resBody');
    body.textContent = '';
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
        b.innerHTML = '<span><span class="total__name"></span><span class="total__badge"></span></span><span class="total__price"></span>';
        b.querySelector('.total__name').textContent = t.name;
        b.querySelector('.total__badge').textContent = t.badge;
        b.querySelector('.total__price').textContent = money(t.price);
        b.addEventListener('click', function () { set({ level: t.id }); });
        totals.appendChild(b);
      });
      body.appendChild(totals);
      var hint = document.createElement('p');
      hint.className = 'small muted';
      hint.textContent = '«Новые лица» и «Первый старт» — молодые ведущие JoyRest. Коснитесь цены, чтобы выбрать формат.';
      body.appendChild(hint);
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
      body.appendChild(ul);
    }
  }

  /** Текст расчёта для менеджера: тот же, что карточка «Ваш расчёт» в заявке сайта, + выбранный формат. */
  function text() {
    var s = P.calcSummary(state);
    var level = P.LEVELS.filter(function (l) { return l.id === state.level; })[0];
    var r = P.calcPrice(state);
    return 'Расчёт JoyRest: ' + s.text + (level && !r.individual ? ' Формат ведущего: ' + level.name + '.' : '');
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
  function send(e) {
    var value = text();
    sheetFrom = e && e.currentTarget;
    $('sWa').href = 'https://wa.me/79857822689?text=' + encodeURIComponent(value);
    $('sMail').href = 'mailto:joyrest@mail.ru?subject=' + encodeURIComponent('Расчёт JoyRest') + '&body=' + encodeURIComponent(value);
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    $('sWa').focus();
  }
  function pasteHint(where) {
    return function () { copy('Расчёт скопирован — вставьте его в чат ' + where); closeSheet(); };
  }
  $('sWa').addEventListener('click', function () { setTimeout(closeSheet, 0); });
  $('sMail').addEventListener('click', function () { setTimeout(closeSheet, 0); });
  $('sTg').addEventListener('click', pasteHint('Telegram'));
  $('sAvito').addEventListener('click', pasteHint('на Авито'));
  $('sCopy').addEventListener('click', function () { copy(); closeSheet(); });
  $('sClose').addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (ev) { if (ev.target === sheet) closeSheet(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeSheet(); });

  $('send').addEventListener('click', send);
  $('barSend').addEventListener('click', send);
  $('copy').addEventListener('click', function () { copy(); });
  render();
})();
