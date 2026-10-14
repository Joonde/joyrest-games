// Сайт агентства JoyRest: шапка и меню, тема, калькулятор (расчёт — js/pricing.js), обзор игр,
// правила и политика в окнах, формы (POST /api/lead). Без библиотек и внешних скриптов.
(function () {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = reduceMotion ? 'auto' : 'smooth';
  const $ = (id) => document.getElementById(id);

  // ---------- Шапка: тень при прокрутке ----------
  const siteHeader = $('siteHeader');
  const onScroll = () => siteHeader.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- Тема: вечерняя / дневная (выбор запоминается, js/theme.js применяет до отрисовки) ----------
  const root = document.documentElement;
  const themeToggle = $('themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function applyTheme(theme){
    root.setAttribute('data-theme', theme);
    themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
    if(themeMeta) themeMeta.setAttribute('content', theme === 'dark' ? '#1A1714' : '#FBF6F1');
  }
  applyTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  themeToggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try{ localStorage.setItem('jr-theme', next); }catch(_){ /* приватный режим — тема до перезагрузки */ }
  });

  // ---------- Появление блоков при прокрутке: двигается только положение, текст виден всегда ----------
  if('IntersectionObserver' in window && !reduceMotion){
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if(entry.isIntersecting){ entry.target.classList.add('in'); io.unobserve(entry.target); }
      });
    }, { threshold: 0.12 });
    document.querySelectorAll('.section .wrap > *:not(.mbar)').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  }

  // ---------- Направления, которых пока нет (data-service-* у <body>) ----------
  // Варианты списков с data-needs / data-unless убираем здесь — iPhone не прячет <option> стилями.
  const serviceOn = (name) => document.body.dataset['service' + name[0].toUpperCase() + name.slice(1)] === 'on';
  document.querySelectorAll('option[data-needs], option[data-unless]').forEach((option) => {
    const needs = (option.dataset.needs || '').split(' ').filter(Boolean);
    const unless = (option.dataset.unless || '').split(' ').filter(Boolean);
    if(needs.some((n) => !serviceOn(n)) || (unless.length && unless.every(serviceOn))) option.remove();
  });

  // ---------- Отправка форм: POST /api/lead на сервер того же сайта ----------
  // Токена бота в браузере нет. «Спасибо» — только при ответе 200, при ошибке — понятный текст
  // и ссылка на канал; введённое не стираем, чтобы можно было повторить.
  const FALLBACK_URL = 'https://t.me/JoyRest';
  function showError(el, message){
    const text = (message || 'Не получилось отправить.').replace(/\s*Напишите нам в Telegram: t\.me\/JoyRest\.?/i, '');
    el.textContent = text + ' Напишите нам в Telegram: ';
    const link = document.createElement('a');
    link.href = FALLBACK_URL; link.target = '_blank'; link.rel = 'noopener';
    link.textContent = 't.me/JoyRest';
    el.append(link);
    el.classList.add('show');
  }
  async function sendLead(form, payload, noteEl, errorEl){
    const button = form.querySelector('button[type="submit"]');
    if(button.disabled) return false;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Отправляем…';
    noteEl.classList.remove('show');
    errorEl.classList.remove('show');
    payload.consent = form.querySelector('.consent-row input[type="checkbox"]').checked;
    payload.website = form.querySelector('input[name="website"]').value;
    let ok = false;
    try{
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let data = null;
      try{ data = await res.json(); }catch(_){ /* не JSON — ответил не наш сервер */ }
      if(res.status === 200 && data && data.ok === true){
        ok = true;
        noteEl.classList.add('show');
      }else{
        showError(errorEl, data && data.message ? data.message : 'Не получилось отправить.');
      }
    }catch(_){
      showError(errorEl, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    }finally{
      button.disabled = false;
      button.textContent = label;
    }
    return ok;
  }

  // ---------- «Задать вопрос» ----------
  const askFabBtn = $('askFabBtn');
  const askPanel = $('askPanel');
  const setAsk = (open) => { askPanel.classList.toggle('open', open); askFabBtn.setAttribute('aria-expanded', open); };
  askFabBtn.addEventListener('click', () => setAsk(!askPanel.classList.contains('open')));
  // На телефоне кнопка не закрывает первый экран, итог калькулятора и форму заявки (.ask-fab.is-away).
  if('IntersectionObserver' in window){
    const visible = new Set();
    const fabObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target));
      askFabBtn.classList.toggle('is-away', visible.size > 0);
    }, { threshold: 0.05 });
    [document.querySelector('.hero'), $('calculator'), $('leadForm')].forEach((el) => { if(el) fabObserver.observe(el); });
  }
  document.addEventListener('click', (e) => {
    if(askPanel.classList.contains('open') && !askPanel.contains(e.target) && !askFabBtn.contains(e.target)) setAsk(false);
  });
  $('askForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const ok = await sendLead(this, {
      type: 'question',
      contact: $('askContact').value.trim(),
      text: $('askText').value.trim(),
    }, $('askNote'), $('askError'));
    if(ok){
      this.reset();
      setTimeout(() => setAsk(false), 1800);
    }
  });

  // ---------- Отзыв (скрыт, пока data-review-form="off") ----------
  const reviewFormWrap = $('reviewFormWrap');
  $('openReviewForm').addEventListener('click', () => reviewFormWrap.classList.toggle('open'));
  const stars = document.querySelectorAll('#ratingStars button');
  const ratingInput = $('reviewRating');
  function setStars(v){
    stars.forEach((s) => {
      const on = parseInt(s.dataset.v, 10) <= v;
      s.classList.toggle('active', on);
      s.setAttribute('aria-pressed', on);
    });
    ratingInput.value = v;
  }
  setStars(5);
  stars.forEach((s) => s.addEventListener('click', () => setStars(parseInt(s.dataset.v, 10))));
  $('reviewForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const ok = await sendLead(this, {
      type: 'review',
      name: $('reviewName').value.trim(),
      rating: parseInt(ratingInput.value, 10),
      text: $('reviewText').value.trim(),
    }, $('reviewNote'), $('reviewError'));
    if(ok){ this.reset(); setStars(5); }
  });

  // ---------- Меню на телефоне ----------
  const burger = $('burgerBtn');
  const panel = $('mobilePanel');
  function closeMobileMenu(){
    panel.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', false);
    burger.setAttribute('aria-label', 'Открыть меню');
  }
  burger.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    burger.classList.toggle('open', isOpen);
    burger.setAttribute('aria-expanded', isOpen);
    burger.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
  });
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMobileMenu));
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeMobileMenu(); });

  // ---------- Заявка: переходы к форме ----------
  const hostLevelField = $('hostLevel');
  const formMore = $('formMore');
  const typeField = $('type');
  function goToForm(){
    closeMobileMenu();
    $('contact').scrollIntoView({ behavior: smooth, block: 'start' });
    // Фокус сразу, в том же нажатии: иначе iPhone не откроет клавиатуру.
    $('name').focus({ preventScroll: true });
  }
  // «Оставить заявку» ведёт к форме и ставит фокус в первое поле.
  document.querySelectorAll('[data-focus-target]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const field = $(link.dataset.focusTarget);
      const target = document.querySelector(link.getAttribute('href'));
      if(!field || !target) return;
      e.preventDefault();
      closeMobileMenu();
      target.scrollIntoView({ behavior: smooth, block: 'start' });
      field.focus({ preventScroll: true });
    });
  });
  // Плитки «Организуем» первого экрана: повод сразу в поле «Тип мероприятия».
  function selectType(text){
    const option = Array.from(typeField.options).find((o) => o.text === text);
    if(option) typeField.value = option.value || option.text;
  }
  document.querySelectorAll('[data-event-type]').forEach((link) => {
    link.addEventListener('click', (e) => { e.preventDefault(); selectType(link.dataset.eventType); goToForm(); });
  });
  // «Выбрать этот формат» у ведущих: формат — в заявку (#hostLevel), карточка ведущего подсвечена; страница ведёт к итогу
  // калькулятора с ценой этого ведущего, а если расчёт уже в заявке — к нему (chooseLevel ниже, в калькуляторе).
  document.querySelectorAll('[data-host-level]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if(link.dataset.hostLevel !== 'standard') formMore.open = true;
      chooseLevel(link.dataset.hostLevel);
      closeMobileMenu();
      if(sentCalc) goToCard();
      else $('calcSummary').scrollIntoView({ behavior: smooth, block: 'center' });
    });
  });
  // Подсветка выбранного формата у карточек ведущих.
  function markHosts(){
    document.querySelectorAll('[data-host-level]').forEach((link) => {
      const on = link.dataset.hostLevel === (hostLevelField.value || 'standard');
      link.closest('.host').classList.toggle('host--main', on);
      link.textContent = on ? 'Выбран ✓' : 'Выбрать этот формат';
      link.setAttribute('aria-pressed', on);
    });
  }
  markHosts();

  // ---------- Калькулятор ----------
  const P = window.JoyPricing;
  const calc = { pkg: 'quiz', tier: 0, weekend: false, extras: {}, ext: 0, addons: {}, info: '' };
  const money = (n) => P.money(n);
  const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
  const el = (tag, cls, html) => { const n = document.createElement(tag); if(cls) n.className = cls; if(html !== undefined) n.innerHTML = html; return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tierIndex = () => Math.min(calc.tier, P.TIERS.length - 1);
  const extrasList = () => P.PACKAGES.filter((p) => calc.extras[p.id] && p.id !== calc.pkg).map((p) => p.id);
  const addonsList = () => P.ADDONS.filter((a) => calc.addons[a.id]).map((a) => a.id);
  const ui = { packs: [], tiers: [], days: [], extras: [], ext: [], addons: [] };

  function pressable(btn, on){ btn.classList.toggle('is-on', on); btn.setAttribute('aria-pressed', on); }

  // Шаг 1 — пакеты
  [...P.PACKAGES, P.TURNKEY].forEach((p) => {
    const b = el('button', 'pack');
    b.type = 'button';
    const from = p.id === P.TURNKEY.id ? `от ${money(p.from)} · индивидуально` : `от ${money(p.prices[0])}`;
    b.innerHTML = (p.id === 'quiz' ? '<span class="pack__badge">Хит</span>' : '') +
      `<span class="pack__name">${esc(p.name)}</span><span class="pack__games">${esc(p.games)}</span><span class="pack__from">${from}</span>`;
    b.addEventListener('click', () => {
      calc.pkg = p.id;
      delete calc.extras[p.id]; // выбранный пакет не может быть «ещё игрой»; гости не сбрасываются
      update();
    });
    ui.packs.push([p.id, b]);
    $('calcPacks').append(b);
  });
  // Шаг 2 — гости
  [...P.TIERS.map((t) => `до ${t}`), '90+'].forEach((label, i) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.setAttribute('aria-label', i < P.TIERS.length ? `${label} гостей` : 'больше 90 гостей');
    b.addEventListener('click', () => { calc.tier = i; update(); });
    ui.tiers.push(b);
    $('calcTiers').append(b);
  });
  // Шаг 3 — день
  [['Будни (пн–чт)', false], ['Пятница–воскресенье · +10%', true]].forEach(([label, wk]) => {
    const b = el('button', 'chip', label);
    b.type = 'button';
    b.addEventListener('click', () => { calc.weekend = wk; update(); });
    ui.days.push([wk, b]);
    $('calcDays').append(b);
  });
  // Шаг 4 — ещё игра в этот вечер
  P.PACKAGES.forEach((p) => {
    const b = el('button', 'extra');
    b.type = 'button';
    b.innerHTML = `<span class="box">${CHECK}</span><span class="extra__text"><span class="extra__name">+ ${esc(p.name)}</span><span class="extra__games">${esc(p.games)} · ещё около часа</span></span><span class="extra__price"><s class="extra__old"></s><span class="extra__new"></span></span>`;
    b.addEventListener('click', () => {
      if(calc.extras[p.id]) delete calc.extras[p.id]; else calc.extras[p.id] = true;
      update();
    });
    ui.extras.push([p.id, b]);
    $('calcExtras').append(b);
  });
  // Шаг 5 — продление
  P.EXTENSIONS.forEach((x, i) => {
    const b = el('button', 'chip', x.label);
    b.type = 'button';
    b.addEventListener('click', () => { calc.ext = i; update(); });
    ui.ext.push(b);
    $('calcExt').append(b);
  });
  // Шаг 6 — допы с пояснением «i» (открыто одно пояснение за раз)
  P.ADDONS.forEach((a) => {
    const wrap = el('div', 'addon');
    const row = el('div', 'addon__row');
    const b = el('button', 'check');
    b.type = 'button';
    b.innerHTML = `<span class="check__left"><span class="box">${CHECK}</span><span class="check__label">${esc(a.label)}${a.tag ? `<span class="tag">${esc(a.tag)}</span>` : ''}</span></span><span class="check__price">+${money(a.price)}</span>`;
    b.addEventListener('click', () => {
      if(calc.addons[a.id]) delete calc.addons[a.id]; else calc.addons[a.id] = true;
      update();
    });
    const info = el('button', 'info', 'i');
    info.type = 'button';
    info.setAttribute('aria-label', 'Пояснение: ' + a.label);
    info.setAttribute('aria-controls', 'addonInfo-' + a.id);
    const desc = el('p', 'addon__desc');
    desc.id = 'addonInfo-' + a.id;
    desc.textContent = a.info;
    info.addEventListener('click', () => { calc.info = calc.info === a.id ? '' : a.id; update(); });
    row.append(b, info);
    wrap.append(row, desc);
    ui.addons.push([a.id, b, info, desc]);
    $('calcAddons').append(wrap);
  });

  const DAY_LABEL = (wk) => wk ? 'пятница–воскресенье' : 'будни';
  function durationText(h){ return `≈ ${P.hh(h.min)}–${P.hh(h.max)} ${P.hoursWord(h.max)}`; }
  let lastResult = null;
  // Расчёт в заявке (карточка «Ваш расчёт»): { opts, text } или null. Пока он есть — карточка обновляется сама.
  let sentCalc = null;
  let autoGuests = ''; // число гостей, которое вписал калькулятор

  function update(){
    const ti = tierIndex();
    ui.packs.forEach(([id, b]) => pressable(b, id === calc.pkg));
    ui.tiers.forEach((b, i) => pressable(b, i === calc.tier));
    ui.days.forEach(([wk, b]) => pressable(b, wk === calc.weekend));
    ui.extras.forEach(([id, b]) => {
      const same = id === calc.pkg;
      b.hidden = same;
      pressable(b, !!calc.extras[id] && !same);
      b.querySelector('.extra__old').textContent = money(P.pkgById(id).prices[ti]);
      b.querySelector('.extra__new').textContent = '+' + money(P.extraPrice(id, ti));
    });
    ui.ext.forEach((b, i) => pressable(b, i === calc.ext));
    ui.addons.forEach(([id, b, info, desc]) => {
      pressable(b, !!calc.addons[id]);
      const open = calc.info === id;
      info.setAttribute('aria-expanded', open);
      desc.hidden = !open;
    });

    const r = P.calcPrice({ pkg: calc.pkg, tier: calc.tier, weekend: calc.weekend, extras: extrasList(), ext: calc.ext, addons: addonsList() });
    lastResult = r;
    const pkg = P.pkgById(calc.pkg);
    const nEx = r.extrasCount;
    $('calcIndiv').hidden = !r.individual;
    $('calcLevels').hidden = r.individual;
    $('calcDuration').hidden = r.individual;
    // Три цены — кнопки: касание выбирает формат ведущего (то же поле, что в заявке), выбранный подсвечен.
    const level = hostLevelField.value || 'standard';
    $('calcLevels').innerHTML = r.totals.map((t) =>
      `<button type="button" class="level${t.id === level ? ' level--top' : ''}" data-level="${esc(t.id)}" aria-pressed="${t.id === level}"><span class="level__name">${esc(t.name)}</span><span class="level__badge">${esc(t.badge)}</span><span class="level__price">${money(t.price)}</span></button>`).join('');
    let text;
    if(r.reason === 'turnkey') text = 'Под ключ — соберём программу под ваш повод';
    else if(r.reason === 'guests') text = 'Больше 90 гостей — подберём ведущих и программу';
    else if(r.reason === 'extras') text = 'Больше двух дополнительных игр — это индивидуальный заказ: соберём программу на весь вечер';
    else text = `${pkg.name}${nEx ? ` + ещё ${nEx} ${P.gamesWord(nEx)}` : ''} · до ${P.TIERS[ti]} гостей · ${DAY_LABEL(calc.weekend)}`;
    $('calcText').textContent = text;
    $('calcDurValue').textContent = durationText(r.hours);
    const parts = r.individual ? [] : [`${pkg.name} · 1,5–2 ч`, ...extrasList().map((id) => `+ ${P.pkgById(id).name} · ~1 ч`)];
    if(!r.individual && calc.ext > 0) parts.push(`+ продление · ${P.EXTENSIONS[calc.ext].label.replace('+', '')}`);
    $('calcDurParts').innerHTML = parts.map((p) => `<span>${esc(p)}</span>`).join('');
    const lines = r.lines.filter((l) => !l.fixed).map((l) => [l.label, '+' + money(l.value)]);
    if(lines.length) lines[0][1] = money(r.lines[0].value);
    if(r.weekend) lines.push(['Пятница–воскресенье', '+10%']);
    r.lines.filter((l) => l.fixed).forEach((l) => lines.push([l.label, '+' + money(l.value)]));
    $('calcLines').innerHTML = lines.map(([k, v]) => `<li><span>${esc(k)}</span><span>${v}</span></li>`).join('');
    // Полоска итога внизу экрана телефона
    $('calcBarSum').innerHTML = r.individual
      ? '<span class="mbar__dur">Итог расчёта</span><span class="mbar__indiv">Обсудим индивидуально</span>'
      : `<span class="mbar__dur">Вечер ${esc(durationText(r.hours).replace(' часа', ' ч').replace(' часов', ' ч'))} · итог с каким ведущим</span>` +
        r.totals.map((t) => `<span class="mbar__lv${t.id === level ? ' is-on' : ''}"><span class="mbar__name">${esc(t.name)}</span><span class="mbar__price">${money(t.price)}</span></span>`).join('');
    // Расчёт уже в заявке — обновляем его вместе с калькулятором, чтобы в заявку не ушла старая цена.
    if(sentCalc) attachCalc(calcOpts(), false);
  }
  update();
  // Полоска итога на телефоне и планшете: видна, пока калькулятор на экране, а полный итог — нет.
  if('IntersectionObserver' in window){
    const bar = $('calcBar');
    let inCalc = false, sumVisible = false;
    const sync = () => bar.classList.toggle('is-shown', inCalc && !sumVisible);
    new IntersectionObserver((e) => { inCalc = e[0].isIntersecting; sync(); }, { rootMargin: '-30% 0px -10% 0px' }).observe(document.querySelector('.calc__steps'));
    new IntersectionObserver((e) => { sumVisible = e[0].isIntersecting; sync(); }, { threshold: 0.15 }).observe($('calcSummary'));
  }

  // «Отправить расчёт в заявку» (кнопка итога и «В заявку» в полоске телефона): карточка «Ваш расчёт» над
  // комментарием, пакет — в «Тип мероприятия», гости — в поле. Пока расчёт в заявке, он обновляется вместе с
  // калькулятором. Касание цены в карточке выбирает формат ведущего. Расчёт помнит телефон (jr-calc), после
  // отправки заявки — забывает. В /api/lead уходит полем calc.
  const CALC_KEY = 'jr-calc';
  function calcOpts(){ return { pkg: calc.pkg, tier: calc.tier, weekend: calc.weekend, extras: extrasList(), ext: calc.ext, addons: addonsList() }; }
  function saveCalc(opts){
    try{ if(opts) localStorage.setItem(CALC_KEY, JSON.stringify(opts)); else localStorage.removeItem(CALC_KEY); }catch(_){ /* приватный режим — расчёт до перезагрузки */ }
  }

  // Уведомление сверху экрана (под шапкой), с необязательной кнопкой.
  let toastTimer = 0;
  function topToast(text, action, onAction, ms){
    const box = $('topToast');
    const btn = $('topToastAction');
    $('topToastText').textContent = text;
    btn.hidden = !action;
    btn.textContent = action || '';
    btn.onclick = action ? () => { hideToast(); onAction(); } : null;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 3500);
  }
  function hideToast(){ clearTimeout(toastTimer); $('topToast').hidden = true; }

  function markLevel(){
    $('calcCardTotals').querySelectorAll('.calc-card__lv').forEach((b) => {
      const on = b.dataset.level === hostLevelField.value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on);
    });
  }
  function renderCalcCard(s){
    $('calcCardType').textContent = s.type;
    $('calcCardParts').textContent = s.parts.join(' · ');
    const list = $('calcCardTotals');
    list.textContent = '';
    if(s.totals){
      P.LEVELS.forEach((l, i) => {
        const li = el('li', 'calc-card__row');
        const b = el('button', 'calc-card__lv');
        b.type = 'button';
        b.dataset.level = l.id;
        const name = el('span');
        name.textContent = l.name + (l.badge ? ' ' + l.badge : '');
        const price = el('strong');
        price.textContent = money(s.totals[i].price);
        b.append(name, price);
        b.addEventListener('click', () => chooseLevel(l.id));
        li.append(b);
        list.append(li);
      });
      markLevel();
    }else{
      const li = el('li');
      li.textContent = 'Стоимость обсудим индивидуально';
      list.append(li);
    }
    $('calcCardHint').hidden = !s.totals;
    $('calcCardDur').textContent = 'Вечер ' + s.duration;
  }
  function setLinked(on){
    $('calcCard').hidden = !on;
    $('calcLink').hidden = on;
    $('calcLinked').hidden = !on;
    $('calcSubmit').textContent = on ? 'Перейти к заявке' : 'Отправить расчёт в заявку';
    $('calcBar').classList.toggle('is-linked', on);
    $('calcBarSend').textContent = on ? 'В заявке ✓ · открыть' : 'В заявку';
  }
  // Поставить расчёт в заявку (или обновить его); fill — заодно тип мероприятия и гости.
  function attachCalc(opts, fill){
    const s = P.calcSummary(opts);
    sentCalc = { opts, text: s.text };
    renderCalcCard(s);
    setLinked(true);
    saveCalc(opts);
    selectType(s.type);
    // Гостей вписываем, если поле пустое или там число от прошлого расчёта (своё число человека не трогаем).
    const guestsField = $('guests');
    if(s.guests && (fill || guestsField.value === autoGuests) && (!guestsField.value || guestsField.value === autoGuests)){
      guestsField.value = s.guests;
      autoGuests = String(s.guests);
    }
    return s;
  }
  function clearCalcCard(){
    sentCalc = null;
    setLinked(false);
    saveCalc(null);
  }
  // К карточке в заявке: видно расчёт, клавиатура не открывается и не закрывает его.
  function goToCard(){
    closeMobileMenu();
    $('calcCard').scrollIntoView({ behavior: smooth, block: 'center' });
  }
  function sendCalc(){
    if(sentCalc){ goToCard(); return; }
    attachCalc(calcOpts(), true);
    goToCard();
    topToast('Расчёт добавлен в заявку ✓');
  }
  $('calcSubmit').addEventListener('click', sendCalc);
  $('calcBarSend').addEventListener('click', sendCalc);
  $('calcCardEdit').addEventListener('click', () => {
    $('calculator').scrollIntoView({ behavior: smooth, block: 'start' });
    topToast('Меняйте выбор — расчёт в заявке обновится сам');
  });
  $('calcCardRemove').addEventListener('click', () => {
    const was = sentCalc && sentCalc.opts;
    clearCalcCard();
    topToast('Расчёт убран из заявки', 'Вернуть', () => { if(was){ attachCalc(was, false); topToast('Расчёт снова в заявке ✓'); } }, 6000);
  });
  // Формат ведущего: касание цены в итоге калькулятора или в карточке, выбор в заявке, «Выбрать этот формат» у ведущих —
  // одно поле #hostLevel; калькулятор и карточка подсвечивают выбранный.
  function chooseLevel(id){
    const l = P.LEVELS.find((x) => x.id === id);
    if(!l) return;
    hostLevelField.value = id;
    update();
    markLevel();
    markHosts();
    topToast('Ведущий: ' + l.name + (l.badge ? ' ' + l.badge : '') + (sentCalc ? ' — в заявке' : ''));
  }
  $('calcLevels').addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if(b) chooseLevel(b.dataset.level);
  });
  hostLevelField.addEventListener('change', () => { update(); markLevel(); markHosts(); });
  // Сохранённый расчёт: вернуть выбор калькулятора и карточку (неизвестные пакеты и допы отбрасываются).
  (() => {
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem(CALC_KEY) || 'null'); }catch(_){ saved = null; }
    if(!saved || typeof saved !== 'object') return;
    const known = (id) => id === P.TURNKEY.id || !!P.pkgById(id);
    if(typeof saved.pkg !== 'string' || !known(saved.pkg)) return;
    const tier = Number.isInteger(saved.tier) && saved.tier >= 0 && saved.tier <= P.TIERS.length ? saved.tier : 0;
    const ext = Number.isInteger(saved.ext) && P.EXTENSIONS[saved.ext] ? saved.ext : 0;
    calc.pkg = saved.pkg; calc.tier = tier; calc.weekend = saved.weekend === true; calc.ext = ext;
    calc.extras = {}; calc.addons = {};
    (Array.isArray(saved.extras) ? saved.extras : []).forEach((id) => { if(typeof id === 'string' && P.pkgById(id) && id !== calc.pkg) calc.extras[id] = true; });
    (Array.isArray(saved.addons) ? saved.addons : []).forEach((id) => { if(P.ADDONS.some((a) => a.id === id)) calc.addons[id] = true; });
    attachCalc(calcOpts(), false);
    update();
  })();

  // ---------- Обзор игр: фильтр разделов и «Показать ещё» ----------
  const LIMIT = 9;
  const games = Array.from(document.querySelectorAll('#gamesGrid .game'));
  const filters = Array.from(document.querySelectorAll('.filter'));
  const moreBtn = $('gamesMore');
  let gFilter = 'all', gAll = false;
  const inFilter = (g, f) => f === 'all' || (f === 'phone' ? g.hasAttribute('data-phone') : g.dataset.cat === f);
  function renderGames(){
    const list = games.filter((g) => inFilter(g, gFilter));
    // Остаток меньше трёх карточек — показываем сразу всё, без кнопки.
    const limit = gAll || list.length <= LIMIT + 3 ? list.length : LIMIT;
    games.forEach((g) => { g.hidden = true; });
    list.forEach((g, i) => { g.hidden = i >= limit; g.style.setProperty('--i', Math.min(i, 8)); });
    moreBtn.hidden = limit >= list.length;
    moreBtn.textContent = `Показать ещё ${list.length - limit}`;
    filters.forEach((f) => pressable(f, f.dataset.filter === gFilter));
  }
  filters.forEach((f) => f.addEventListener('click', () => { gFilter = f.dataset.filter; gAll = false; renderGames(); }));
  moreBtn.addEventListener('click', () => { gAll = true; renderGames(); });
  renderGames();

  // ---------- Правила игр ----------
  const RULES = {
    'mafia': { title: 'Мафия', text: 'Игроки тайно делятся на мирных жителей и мафию; есть Дон, Комиссар и Доктор. Днём все обсуждают и голосуют за подозреваемого, ночью мафия выбирает жертву. Мирные жители побеждают, если вычисляют всю мафию; мафия — если сравнивается с ними по числу. Роли тайно приходят на телефоны, ночные ходы и голосование — тоже с телефона. За вечер можно сыграть несколько партий.' },
    'bunker': { title: 'Бункер', text: 'Каждый игрок получает карточку персонажа: профессия, биология, здоровье, хобби, багаж, факт и особое условие. По раундам все раскрывают часть информации о себе, и группа тайно голосует, кто покидает бункер. Мест в бункере — вдвое меньше, чем игроков. Карточки приходят на телефоны, за вечер можно сыграть несколько партий.' },
    'durak': { title: 'Дурак', text: 'Классический «Дурак» на всю компанию: стол с крупье — на экране зала, свои карты — на телефоне каждого игрока. Ходят касанием карты на телефоне, за правилами следит платформа. Колоды на выбор: классика JoyRest, свадебная и аниме.' },
    'board': { title: 'Своя игра', text: 'Поле из тем и стоимостей на экране зала, два-три раунда. Ведущий открывает клетку и читает вопрос, потом запускает отсчёт — кто первым нажмёт кнопку на телефоне, тот отвечает: верно — очки и право выбрать следующую клетку, неверно — слово следующему. В клетках бывают музыкальные фрагменты, картинки, «Кот в мешке» (вопрос отдают другому игроку) и «Аукцион» со ставками.' },
    'millionaire': { title: 'Кто хочет стать миллионером', text: '12 вопросов с четырьмя вариантами — от простых к сложным, с несгораемыми ступенями. Команды играют по очереди, у каждой своя лестница на экране. Подсказки — по одной каждого вида на команду: 50 на 50, помощь зала (голосуют телефоны остальных), звонок другу, право на ошибку, замена вопроса и совет ведущего.' },
    'survival': { title: 'Гонка на выживание', text: 'До 30 раундов: вопросы с вариантами, открытые вопросы и задания. Никто не выбывает — гонка по очкам. Каждый пятый раунд — «Войнушка»: команды делают ставки, первая верно ответившая забирает банк. После второй войнушки появляется аукцион билета освобождения.' },
    'dragon': { title: 'Бой с драконом', text: 'Каждая команда выбирает героя — у всех своя сила — и раскладывает очки по свойствам: сила, ум, ловкость, удача, харизма. Вопросы, задания и бросок кубика наносят дракону урон; не справились — дракон отнимает жизнь. Победили дракона — бонус. Есть вариант для детей.' },
    'story': { title: 'Давайте знакомиться', text: 'Игра на знакомство из нескольких разделов: «Чья история?» — угадываем автора случая из жизни, «Две правды и ложь», «Что было дальше?» — настоящая концовка среди выдуманных, «Сочиняем историю» — предложение из слов гостей, которое потом показывают, и «Кто это сказал?». Всё пишется и угадывается с телефонов.' },
    'checkers': { title: 'Шашки', text: 'Русские шашки команда на команду на большом экране: капитан ходит с телефона, подсвечены только разрешённые ходы. Съели шашку — команда, потерявшая её, отвечает на вопрос и может заработать очки. Очки — за шашки, дамки и победу.' },
    'melody': { title: 'Угадай мелодию', text: 'Ведущий включает короткие отрывки песен — участники угадывают трек и исполнителя. Отрывок звучит с экрана зала, ответы — с телефонов, за быстрый верный ответ — больше очков.' },
    'sing': { title: '«Спой лучше всех»', text: 'Караоке-батл: команда открывает карточку и поёт хит под клип на экране зала. Остальные команды ставят оценки с телефонов, команде — средний балл. В финале — пьедестал и аплодисменты лучшим голосам вечера.' },
    'truth': { title: 'Правда или действие', text: 'Игроки по очереди выбирают между честным ответом на вопрос или выполнением шуточного задания от ведущего или других участников. Карточка появляется на экране, а свои вопросы и задания гости могут предложить с телефона.' },
    'spy': { title: 'Шпион', text: 'Все игроки, кроме одного, знают секретное место или слово. С помощью наводящих вопросов участники пытаются вычислить шпиона, а шпион — не выдать себя и угадать секрет.' },
    'kazaki': { title: 'Казаки-разбойники: Допрос', text: 'Активная игра на природе. Разбойники прячут на теле кусочки общей фразы и разбегаются по территории. Казаки ищут, угадывают за 5 попыток место тайника и выполняют задание, чтобы получить фрагмент. Побеждают, если верно соберут фразу.' },
    'chaos': { title: 'Большой переполох', text: 'Все пишут смешные задания на бумажках, складывают в эффектную ёмкость, передают под музыку по кругу — у кого в руках, когда музыка стихла, тот тянет и выполняет.' },
    'toasts': { title: 'Битва тостов', text: 'Участник вытягивает карточку с двумя случайными несочетаемыми темами и должен произнести тост, органично их объединив, за 20–30 секунд. Оценка — аплодисментами зала. Подходит и для корпоратива, и для дня рождения.' },
    'freeze': { title: 'Замри! Живые скульптуры', text: 'Ведущий называет слово или сцену — участники за 5 секунд застывают в позе, изображающей это. Зал выбирает лучшую скульптуру. Быстрый, энергичный формат для любого мероприятия.' },
    'mute': { title: 'Немая история', text: 'Команда вытягивает 10 карточек с изображениями (локации, персонажи, эмоции), собирает из них историю и показывает её жестами, без слов, другой команде. Очки — за каждую угаданную карточку.' },
    'orchestra': { title: 'Живой оркестр', text: 'Компактная игра для помещения. Каждому участнику назначается звук или жест-«инструмент», ведущий-«дирижёр» управляет громкостью и вступлением — получается импровизированный «оркестр» из зала. Подходит любому возрасту, без физической нагрузки.' },
    'musicloto': { title: 'Музыкальное лото', text: 'Музыкальное бинго: у каждого игрока или команды на телефоне своя карточка из названий песен — в оформлении «Вечер» или «День». Ведущий включает отрывки, игроки отмечают совпадения. Собрал линию — жмёт «Лото!», платформа сама проверяет заявку и даёт очки первым.' },
    'custom': { title: 'Игра под ваш запрос', text: 'Обсуждаем тематику и состав гостей и разрабатываем правила специально под ваш сценарий мероприятия.' },
    'quiz-classic': { title: 'Классический квиз', text: 'Стандартный набор туров на общую эрудицию: кино, музыка, история, логика. Вопросы и варианты — на большом экране, команды отвечают с телефонов, очки и таблица считаются сами; можно и на бланках, если так удобнее.' },
    'quiz-unusual': { title: 'Авторский квиз', text: 'Нестандартные форматы вопросов и тем — визуальные загадки, аудио-раунды, неожиданные категории. Для компаний, которые хотят удивить гостей.' },
    'quiz-company': { title: 'Квиз под компанию', text: 'Вопросы составляем индивидуально под сферу деятельности и специфику команды — отличный формат для корпоративов. Вы присылаете факты, мы собираем квиз; заказывать минимум за 2 недели.' },
    'quiz-games': { title: 'Квиз с элементами игр', text: 'Классические туры чередуются с короткими мини-играми и активностями между раундами — динамика выше, чем у обычного квиза.' },
    'quiz-dance': { title: 'Квиз с музыкой и танцами', text: 'Вопросы чередуются с музыкальными и танцевальными раундами — сочетание викторины и активной вечеринки.' },
    'justdance': { title: 'Just Dance Battle', text: 'Командная игра с закрытыми плитками на игровом поле. Открыл плитку — обязан станцевать под клип или спеть под минус в заданном составе (девушка, парни, вся команда). Побеждает команда с наибольшим числом баллов от зала. Оценки другие команды ставят с телефонов.' },
    'danceloto': { title: 'Танцевальное лото', text: 'Тот же принцип, что и музыкальное лото, но в ячейках — танцевальные движения. Чтобы закрыть клетку, нужно реально исполнить движение, а не просто узнать его.' },
    'dancekuraj': { title: 'Танцевальный кураж', text: 'Под каждый трек команда получает готовую связку движений и должна повторить её слаженно и вовремя — это баттл между командами: кто точнее и с большим драйвом воспроизведёт хореографию, тот получает баллы от зала. Раунды можно разнообразить: «Зеркальный баттл» — пары повторяют движения друг друга; тематические треки из известных фильмов и клипов на угадывание; раунд-фант, где сбившиеся выполняют весёлое задание; и финальный фристайл капитанов — импровизация без заготовки под общий трек.' },
    'alcohol': { title: 'Алкогольные приключения', text: 'Настольная игра-ходилка на 60 клеток с фишками-рюмками. На клетках — выпить, станцевать, спеть, сыграть в мини-игру или выполнить необычный фант. Две версии по градусу раскрепощённости: Lite и Intense. Только для гостей 18+.' },
    'sweet-adventure': { title: 'Сладкие приключения', text: 'Настольная игра-ходилка на 60 клеток без градуса: вместо рюмок — фишки-стаканчики сока или лимонада. На клетках — выпить сок, станцевать, спеть, сыграть в мини-игру или выполнить весёлый фант. Подходит для детских праздников и семейных мероприятий.' },
    'snowball': { title: 'Снежный десант', text: 'Команды бросают снежки по мишеням разного номинала на скорость и точность. Короткие раунды, не утомляет, расстояние регулируется под возраст. Сезонная игра — зима.' },
    'waterballoon': { title: 'Не урони каплю', text: 'Пары перебрасывают друг другу водный шарик, после каждой удачной ловли делая шаг назад. Побеждает пара, продержавшаяся на наибольшей дистанции. Сезонная игра — лето.' }
  };

  // ---------- Окна: правила и политика. Фокус — в окно, Escape и фон закрывают, фокус возвращается. ----------
  let lastFocus = null;
  function openModal(overlay){
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
    overlay.querySelector('.modal__close').focus();
  }
  function closeModal(overlay){
    if(!overlay.classList.contains('open')) return;
    overlay.classList.remove('open');
    if(!document.querySelector('.modal.open')) document.body.classList.remove('modal-open');
    if(lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  const ruleModal = $('ruleModalOverlay');
  const privacyModal = $('privacyModalOverlay');
  document.querySelectorAll('[data-rule-key]').forEach((btn) => btn.addEventListener('click', () => {
    const r = RULES[btn.dataset.ruleKey];
    if(!r) return;
    $('ruleModalTitle').textContent = r.title;
    $('ruleModalText').textContent = r.text;
    openModal(ruleModal);
  }));
  document.querySelectorAll('.privacy-link').forEach((link) => link.addEventListener('click', (e) => { e.preventDefault(); openModal(privacyModal); }));
  [ruleModal, privacyModal].forEach((overlay) => {
    overlay.querySelector('.modal__close').addEventListener('click', () => closeModal(overlay));
    overlay.addEventListener('click', (e) => { if(e.target === overlay) closeModal(overlay); });
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){ closeModal(ruleModal); closeModal(privacyModal); setAsk(false); }
  });

  // ---------- Эмблема первого экрана ----------
  // Пока она видна под шапкой, логотип в шапке скрыт (место сохраняется), ушла за верх экрана —
  // логотип плавно появляется. Вне экрана анимация на паузе (батарея). Наклон от датчика — только
  // там, где он работает без запроса разрешения (на iPhone остаётся плавная анимация из CSS).
  const emblem = document.querySelector('.emblem');
  if(emblem && 'IntersectionObserver' in window){
    let logoObserver = null;
    const watchLogo = () => {
      if(logoObserver) logoObserver.disconnect();
      logoObserver = new IntersectionObserver((entries) => {
        siteHeader.classList.toggle('logo-hidden', entries[0].isIntersecting);
      }, { rootMargin: `-${Math.round(siteHeader.getBoundingClientRect().height)}px 0px 0px 0px` });
      logoObserver.observe(emblem);
    };
    watchLogo();
    window.addEventListener('resize', watchLogo);
  }
  if(emblem && !reduceMotion){
    if('IntersectionObserver' in window){
      new IntersectionObserver((entries) => {
        emblem.classList.toggle('is-paused', !entries[0].isIntersecting);
      }).observe(emblem);
    }
    const needsPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if('DeviceOrientationEvent' in window && !needsPermission){
      const tilt = emblem.querySelector('.emblem-tilt');
      const clamp = (v) => Math.max(-12, Math.min(12, v));
      let base = null, frame = 0, last = null;
      window.addEventListener('deviceorientation', (e) => {
        if(e.beta === null || e.gamma === null) return;
        if(base === null){ base = e.beta; emblem.classList.add('is-device'); }
        last = e;
        if(frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const x = clamp((last.beta - base) / 3);
          const y = clamp(last.gamma / 3);
          tilt.style.transform = `rotateX(${x.toFixed(2)}deg) rotateY(${y.toFixed(2)}deg)`;
        });
      });
    }
  }

  // ---------- Заявка ----------
  $('leadForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const ok = await sendLead(this, {
      type: 'lead',
      name: $('name').value.trim(),
      phone: $('phone').value.trim(),
      eventType: typeField.value,
      guests: $('guests').value.trim(),
      contactMethod: $('contactMethod').value,
      contactLink: $('contactLink').value.trim(),
      message: $('message').value.trim(),
      calc: sentCalc ? sentCalc.text : '',
      hostLevel: hostLevelField.value,
      terms: document.getElementById('termsAccept').checked,
      deposit: document.getElementById('depositAccept').checked,
      marketing: document.getElementById('marketingAccept').checked,
    }, $('formNote'), $('formError'));
    if(ok){ this.reset(); clearCalcCard(); update(); markHosts(); }
  });

  /* Промо-ролик: превью в «Обзоре игр» открывает плеер поверх страницы. Видео грузится только сейчас
     (preload="none"); обложка — та же картинка превью (атрибут poster сборка не переписывает). */
  const promoOpen = $('promoOpen'), promoModal = $('promoModal'), promoVideo = $('promoVideo');
  if(promoOpen && promoModal && promoVideo){
    const closePromo = () => {
      if(promoModal.hidden) return;
      promoVideo.pause(); promoModal.hidden = true; document.body.style.overflow = ''; promoOpen.focus();
    };
    promoOpen.addEventListener('click', () => {
      const poster = $('promoPoster');
      if(poster && !promoVideo.poster) promoVideo.poster = poster.currentSrc || poster.src;
      promoModal.hidden = false; document.body.style.overflow = 'hidden';
      try{ promoVideo.currentTime = 0; }catch(e){}
      const p = promoVideo.play(); if(p && p.catch) p.catch(() => {});
      $('promoClose').focus();
    });
    $('promoClose').addEventListener('click', closePromo);
    promoModal.addEventListener('click', (e) => { if(e.target === promoModal) closePromo(); });
    promoVideo.addEventListener('ended', closePromo);
    document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closePromo(); });
  }
})();
