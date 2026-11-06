/* Окно помощника «Джой» (решение владельца 6 ноября 2026; ответы — js/joy-faq.js, цены — js/pricing.js).
 * Кнопка слева внизу (справа — «Задать вопрос»), окно с перепиской, кнопки частых вопросов и поле для своего вопроса.
 * Бот ничего не отправляет на сервер и ничего не хранит: переписка живёт, пока открыта страница.
 * Персонаж Джой с кадрами (моргание, рот по звукам) и озвучка — следующим шагом; пока говорит монограмма JR. */
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
  var started = false;

  var HELLO = 'Здравствуйте! Я Джой, помощник JoyRest. Выберите вопрос внизу или напишите свой — отвечу сразу.';
  var MISS = 'Пока я не знаю ответа на этот вопрос. Выберите тему ниже или напишите менеджеру — ответим лично.';
  var MISS_AGAIN = 'Похоже, тут лучше ответит человек. Напишите менеджеру — ' + F.CONTACTS + '.';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }

  /** Джой «говорит»: подсветка аватара на время чтения ответа (при «уменьшить движение» — без анимации, CSS). */
  function talk(text) {
    clearTimeout(talkTimer);
    avatar.classList.add('is-talking');
    status.textContent = 'Джой отвечает…';
    talkTimer = setTimeout(function () {
      avatar.classList.remove('is-talking');
      status.textContent = 'Отвечаю на частые вопросы';
    }, Math.min(6000, Math.max(1200, text.length * 40)));
  }

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
    if (opts.cta === 'contact' || opts.human) acts.appendChild(action('Написать менеджеру', '#contact'));
    (opts.chips || []).forEach(function (it) { acts.appendChild(chipButton(it)); });
    if (acts.childNodes.length) log.appendChild(acts);
    talk(text);
    scrollDown();
  }

  /** Кнопка ответа ведёт к разделу страницы и закрывает окно. */
  function action(label, hash) {
    var b = el('button', 'joy-cta', label);
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
      botSay(misses >= 2 ? MISS_AGAIN : MISS, { human: true });
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
    if (open) {
      start();
      log.focus({ preventScroll: true });
      scrollDown();
    } else if (!quiet) {
      fab.focus();
    }
  }

  fab.addEventListener('click', function () { setOpen(panel.hidden); });
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
