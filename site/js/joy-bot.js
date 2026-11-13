/* Окно помощника «Джой» (решение владельца 6 ноября 2026; ответы — js/joy-faq.js, цены — js/pricing.js).
 * Кнопка слева внизу (справа — «Задать вопрос»), окно с перепиской, кнопки частых вопросов и поле для своего вопроса.
 * Бот ничего не отправляет на сервер и ничего не хранит: переписка живёт, пока открыта страница.
 * Аватар — кадры Джой (img/joy-*.webp): обычный, моргание, рот «А», «О», «И». Моргает раз в 3–5 с, пока отвечает — рот
 * открывается по кадрам. При «уменьшить движение» — неподвижный обычный кадр. Озвучка — следующим шагом. */
(function () {
  'use strict';
  var P = window.JoyPricing, F = window.JoyFaq;
  var fab = document.getElementById('joyFab');
  var panel = document.getElementById('joyPanel');
  if (!P || !F || !fab || !panel) return;

  var log = document.getElementById('joyLog');
  var chips = document.getElementById('joyChips');
  var form = document.getElementById('joyForm');
  var input = document.getElementById('joyInput');
  var status = document.getElementById('joyStatus');
  var avatar = document.getElementById('joyAvatar');
  var items = F.build(P, P.moscowToday());
  var byId = {};
  items.forEach(function (it) { byId[it.id] = it; });
  var misses = 0;
  var talkTimer = 0;
  var mouthTimer = 0;
  var talking = false;
  var openers = Array.prototype.slice.call(document.querySelectorAll('[data-joy-open]'));
  var lastOpener = fab;
  // Лица Джой на кнопках (плавающая и в шапке) моргают вместе с окном.
  var faces = [fab.querySelector('.joy-av'), avatar].concat(openers.map(function (o) { return o.querySelector('.joy-av'); })).filter(Boolean);
  var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOUTH = ['a', 'i', 'o', 'base', 'a', 'o', 'i', 'base', 'i', 'a'];
  var started = false;

  var HELLO = 'Здравствуйте! Я Джой, помощник JoyRest. Выберите вопрос внизу или напишите свой — отвечу сразу.';
  // Нестандартный вопрос (решение владельца 6 ноября 2026): Джой честно говорит, что информации нет, и ведёт в Telegram
  // менеджера — вопрос посетителя уже вставлен в сообщение (так же открывается чат в окне «Куда отправить расчёт?»).
  var MISS = 'По этой теме у меня нет информации. Напишите нам в Telegram — менеджер ответит лично. Ваш вопрос я уже вставила в сообщение.';
  var MISS_AGAIN = 'И об этом у меня нет информации — лучше спросить менеджера в Telegram, он ответит лично. Ваш вопрос уже в сообщении.';
  var TG_CHAT = 'https://t.me/+79857822689';
  function tgLink(question) {
    var text = 'Здравствуйте! Вопрос с сайта JoyRest: ' + String(question || '').trim().slice(0, 500);
    if (P && P.telegramText) text = P.telegramText(text);
    return TG_CHAT + '?text=' + encodeURIComponent(text);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  /** Кадр аватара: base, blink, a, o, i (CSS показывает слой по data-frame). */
  function frame(el, name) {
    if (!el) return;
    if (name === 'base') el.removeAttribute('data-frame'); else el.setAttribute('data-frame', name);
  }

  /** Моргание обоих аватаров; во время речи большой аватар не моргает — рот важнее. */
  function blinkLater() {
    setTimeout(function () {
      faces.forEach(function (el) { if (!(talking && el === avatar)) frame(el, 'blink'); });
      setTimeout(function () {
        faces.forEach(function (el) { if (!(talking && el === avatar)) frame(el, 'base'); });
        blinkLater();
      }, 140);
    }, 3000 + Math.random() * 2000);
  }

  /** Джой «говорит»: рот по кадрам и подсветка, пока читается ответ (при «уменьшить движение» — без анимации). */
  function talk(text) {
    clearTimeout(talkTimer);
    clearInterval(mouthTimer);
    talking = true;
    avatar.classList.add('is-talking');
    status.textContent = 'Джой отвечает…';
    if (!still) {
      var n = 0;
      mouthTimer = setInterval(function () { frame(avatar, MOUTH[n++ % MOUTH.length]); }, 120);
    }
    talkTimer = setTimeout(function () {
      clearInterval(mouthTimer);
      talking = false;
      frame(avatar, 'base');
      avatar.classList.remove('is-talking');
      status.textContent = 'Отвечаю на частые вопросы';
    }, Math.min(6000, Math.max(1200, text.length * 40)));
  }
  if (!still) blinkLater();

  function chipButton(it) {
    var b = el('button', 'joy-chip', it.q);
    b.type = 'button';
    b.addEventListener('click', function () { ask(it.q, it); });
    return b;
  }

  function botSay(text, opts) {
    opts = opts || {};
    log.appendChild(el('div', 'joy-msg joy-msg--bot', text));
    var acts = el('div', 'joy-acts');
    if (opts.cta === 'calc') acts.appendChild(action('Посчитать в калькуляторе', '#calculator'));
    if (opts.cta === 'games') acts.appendChild(action('Открыть обзор игр', '#games'));
    if (opts.tg != null) {
      var tg = el('a', 'joy-cta joy-cta--link', 'Написать в Telegram');
      tg.href = tgLink(opts.tg);
      tg.target = '_blank';
      tg.rel = 'noopener';
      acts.appendChild(tg);
      acts.appendChild(action('Другие способы связи', '#contact', true));
    } else if (opts.cta === 'contact' || opts.human) acts.appendChild(action('Написать менеджеру', '#contact'));
    (opts.chips || []).forEach(function (it) { acts.appendChild(chipButton(it)); });
    if (acts.childNodes.length) log.appendChild(acts);
    talk(text);
    scrollDown();
  }

  /** Кнопка ответа ведёт к разделу страницы и закрывает окно. */
  function action(label, hash, quiet) {
    var b = el('button', quiet ? 'joy-cta joy-cta--quiet' : 'joy-cta', label);
    b.type = 'button';
    b.addEventListener('click', function () {
      setOpen(false, true);
      var target = document.querySelector(hash);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return b;
  }

  function ask(text, known) {
    log.appendChild(el('div', 'joy-msg joy-msg--me', text));
    var found = known ? { item: known, others: [] } : F.match(text, items);
    if (found.item) {
      misses = 0;
      var it = found.item;
      botSay(it.a, { cta: it.cta, chips: it.next.map(function (id) { return byId[id]; }).filter(Boolean) });
    } else if (found.others.length) {
      botSay('Уточните, пожалуйста, вы имели в виду:', { chips: found.others });
    } else {
      misses += 1;
      botSay(misses >= 2 ? MISS_AGAIN : MISS, { tg: text });
    }
  }

  function start() {
    if (started) return;
    started = true;
    items.filter(function (it) { return it.star; }).forEach(function (it) { chips.appendChild(chipButton(it)); });
    botSay(HELLO);
  }

  function setOpen(open, quiet) {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    openers.forEach(function (o) { if (o.tagName === 'BUTTON') o.setAttribute('aria-expanded', String(open)); });
    if (open) {
      start();
      log.focus({ preventScroll: true });
      scrollDown();
    } else if (!quiet) {
      // Фокус — туда, откуда открыли; плавающая кнопка на телефоне может быть спрятана.
      var shown = function (n) { return n && n.offsetParent !== null && !n.classList.contains('is-away'); };
      var back = [lastOpener, fab, document.getElementById('burgerBtn')].filter(shown)[0];
      if (back) back.focus({ preventScroll: true });
    }
  }

  fab.addEventListener('click', function () { lastOpener = fab; setOpen(panel.hidden); });
  // Джой в шапке и в меню телефона: открыть окно (ссылка меню сама закрывает меню — js/script.js).
  openers.forEach(function (o) {
    o.addEventListener('click', function (e) {
      e.preventDefault();
      lastOpener = o.tagName === 'BUTTON' ? o : document.querySelector('.joy-hbtn');
      setOpen(true);
    });
  });
  document.getElementById('joyClose').addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim().slice(0, 200);
    if (!text) return;
    input.value = '';
    ask(text);
  });
  document.getElementById('joyHuman').addEventListener('click', function () { setOpen(false, true); });

  // На телефоне кнопка не закрывает первый экран, калькулятор и форму заявки (как «Задать вопрос», .joy-fab.is-away).
  if ('IntersectionObserver' in window) {
    var visible = new Set();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target); });
      fab.classList.toggle('is-away', visible.size > 0);
    }, { threshold: 0.05 });
    [document.querySelector('.hero'), document.getElementById('calculator'), document.getElementById('leadForm')]
      .forEach(function (n) { if (n) observer.observe(n); });
  }
})();
