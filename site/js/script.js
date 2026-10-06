// Header shadow on scroll
  const header = document.getElementById('siteHeader');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
  });

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if(entry.isIntersecting){
        setTimeout(() => entry.target.classList.add('in'), i * 60);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  revealEls.forEach(el => io.observe(el));

  // Отправка форм: POST /api/lead на сервер того же сайта, сервер пересылает в Telegram.
  // Токена бота в браузере нет. «Спасибо» показываем только при ответе 200, при ошибке —
  // понятный текст и ссылку на канал; введённое не стираем, чтобы можно было повторить.
  const FALLBACK_URL = 'https://t.me/JoyRest';
  function showError(el, message){
    // Сервер сам предлагает написать в Telegram — делаем из этого ссылку.
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

  const askFabBtn = document.getElementById('askFabBtn');
  const askPanel = document.getElementById('askPanel');
  askFabBtn.addEventListener('click', () => askPanel.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if(askPanel.classList.contains('open') && !askPanel.contains(e.target) && !askFabBtn.contains(e.target)){
      askPanel.classList.remove('open');
    }
  });
  document.getElementById('askForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const ok = await sendLead(this, {
      type: 'question',
      contact: document.getElementById('askContact').value.trim(),
      text: document.getElementById('askText').value.trim(),
    }, document.getElementById('askNote'), document.getElementById('askError'));
    if(ok){
      this.reset();
      setTimeout(() => askPanel.classList.remove('open'), 1800);
    }
  });

  // Review form: open/close, star rating, submit
  const openReviewBtn = document.getElementById('openReviewForm');
  const reviewFormWrap = document.getElementById('reviewFormWrap');
  openReviewBtn.addEventListener('click', () => {
    reviewFormWrap.classList.toggle('open');
  });
  const stars = document.querySelectorAll('#ratingStars span');
  const ratingInput = document.getElementById('reviewRating');
  function setStars(v){
    stars.forEach(s => s.classList.toggle('active', parseInt(s.dataset.v, 10) <= v));
    ratingInput.value = v;
  }
  setStars(5);
  stars.forEach(s => s.addEventListener('click', () => setStars(parseInt(s.dataset.v, 10))));
  document.getElementById('reviewForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const ok = await sendLead(this, {
      type: 'review',
      name: document.getElementById('reviewName').value.trim(),
      rating: parseInt(ratingInput.value, 10),
      text: document.getElementById('reviewText').value.trim(),
    }, document.getElementById('reviewNote'), document.getElementById('reviewError'));
    if(ok){
      this.reset();
      setStars(5);
    }
  });

  // Price calculator
  const calcPackage = document.getElementById('calcPackage');
  const calcPackageNote = document.getElementById('calcPackageNote');
  const calcDayInputs = document.querySelectorAll('input[name="calcDay"]');
  const calcHours = document.getElementById('calcHours');
  const calcHoursValue = document.getElementById('calcHoursValue');
  const calcGuests = document.getElementById('calcGuests');
  const calcGuestsValue = document.getElementById('calcGuestsValue');
  const calcCustom = document.getElementById('calcCustom');
  const calcComplexityRow = document.getElementById('calcComplexityRow');
  const calcComplexity = document.getElementById('calcComplexity');
  const calcBase = document.getElementById('calcBase');
  const calcExtraRow = document.getElementById('calcExtraRow');
  const calcExtra = document.getElementById('calcExtra');
  const calcFormatsRow = document.getElementById('calcFormatsRow');
  const calcFormats = document.getElementById('calcFormats');
  const calcSurchargeRow = document.getElementById('calcSurchargeRow');
  const calcSurcharge = document.getElementById('calcSurcharge');
  const calcDiscountRow = document.getElementById('calcDiscountRow');
  const calcDiscount = document.getElementById('calcDiscount');
  const calcWeekendDiscountRow = document.getElementById('calcWeekendDiscountRow');
  const calcWeekendDiscount = document.getElementById('calcWeekendDiscount');
  const calcHoursDiscountRow = document.getElementById('calcHoursDiscountRow');
  const calcHoursDiscount = document.getElementById('calcHoursDiscount');
  const calcTaxiNote = document.getElementById('calcTaxiNote');
  const calcTotal = document.getElementById('calcTotal');
  const formatCheckboxes = [
    document.getElementById('calcClassic'),
    document.getElementById('calcQuiz'),
    document.getElementById('calcDance'),
    document.getElementById('calcOutdoor'),
    document.getElementById('calcOutOfTown')
  ];
  const fmt = (n) => Math.round(n).toLocaleString('ru-RU') + ' ₽';

  function recalc(){
    calcPackageNote.style.display = calcPackage.value === 'host' ? 'none' : '';
    document.getElementById('calcDjRow').style.display = (calcPackage.value === 'dj' || calcPackage.value === 'full') ? '' : 'none';

    const isWeekend = document.querySelector('input[name="calcDay"]:checked').value === 'weekend';
    const hourlyRate = isWeekend ? 8500 : 7000;

    const hours = parseFloat(calcHours.value);
    calcHoursValue.textContent = hours.toString().replace('.', ',') + ' ч';
    const guests = parseInt(calcGuests.value, 10);
    calcGuestsValue.textContent = guests;

    const base = hours * hourlyRate;
    calcBase.textContent = fmt(base) + (isWeekend ? ' (ставка выходного дня)' : '');

    let extra = 0;
    if(calcCustom.checked){
      calcComplexityRow.style.display = '';
      calcExtraRow.style.display = '';
      extra = parseInt(calcComplexity.value, 10);
      calcExtra.textContent = fmt(extra);
    } else {
      calcComplexityRow.style.display = 'none';
      calcExtraRow.style.display = 'none';
    }

    // Additional formats: classic / quiz / dance / outdoor / out-of-town
    let formatsFee = 0;
    let anyFormatChecked = false;
    formatCheckboxes.forEach(cb => {
      if(cb.checked){
        anyFormatChecked = true;
        formatsFee += parseInt(cb.dataset.fee, 10);
      }
    });
    if(anyFormatChecked){
      calcFormatsRow.style.display = '';
      calcFormats.textContent = formatsFee > 0 ? fmt(formatsFee) : '0 ₽ (входит в работу ведущего)';
    } else {
      calcFormatsRow.style.display = 'none';
    }
    calcTaxiNote.style.display = document.getElementById('calcOutOfTown').checked ? '' : 'none';

    // Surcharge: from 20 guests, +3000 ₽ per each 5 guests over 20 (tiered)
    let surcharge = 0;
    if(guests >= 20){
      const tier = Math.floor((guests - 20) / 5) + 1;
      surcharge = tier * 3000;
      calcSurchargeRow.style.display = '';
      calcSurcharge.textContent = fmt(surcharge);
    } else {
      calcSurchargeRow.style.display = 'none';
    }

    let runningTotal = base + extra + formatsFee + surcharge;

    // Discount: from 25 guests, +5% per each 5 guests over 25 (tiered), capped at 20%,
    // applied only to the guest-count surcharge amount — not the whole subtotal
    let discountPercent = 0;
    if(guests >= 25 && surcharge > 0){
      const dtier = Math.floor((guests - 25) / 5) + 1;
      discountPercent = Math.min(dtier * 5, 20);
    }
    const discountAmount = surcharge * discountPercent / 100;
    if(discountPercent > 0){
      calcDiscountRow.style.display = '';
      calcDiscount.textContent = `−${fmt(discountAmount)} (${discountPercent}% от наценки за гостей)`;
    } else {
      calcDiscountRow.style.display = 'none';
    }
    runningTotal -= discountAmount;

    // Weekend discount: additional -10% on top, applied after guest discount
    let weekendDiscountAmount = 0;
    if(isWeekend){
      weekendDiscountAmount = runningTotal * 0.10;
      calcWeekendDiscountRow.style.display = '';
      calcWeekendDiscount.textContent = `−${fmt(weekendDiscountAmount)}`;
    } else {
      calcWeekendDiscountRow.style.display = 'none';
    }
    runningTotal -= weekendDiscountAmount;

    // Duration discount: -5% if 3+ hours of host work
    let hoursDiscountAmount = 0;
    if(hours >= 3){
      hoursDiscountAmount = runningTotal * 0.05;
      calcHoursDiscountRow.style.display = '';
      calcHoursDiscount.textContent = `−${fmt(hoursDiscountAmount)}`;
    } else {
      calcHoursDiscountRow.style.display = 'none';
    }
    runningTotal -= hoursDiscountAmount;

    calcTotal.textContent = fmt(runningTotal);
  }
  [calcPackage, ...calcDayInputs, calcHours, calcGuests, calcCustom, calcComplexity, ...formatCheckboxes].forEach(el => el.addEventListener('input', recalc));
  recalc();

  document.getElementById('calcSubmit').addEventListener('click', () => {
    const summary = `Расчёт с калькулятора: пакет «${calcPackage.options[calcPackage.selectedIndex].text}», ${calcHoursValue.textContent} ведущего, ${calcGuestsValue.textContent} гостей` +
      (calcCustom.checked ? `, индивидуальный сценарий (${calcComplexity.options[calcComplexity.selectedIndex].text})` : '') +
      `. Итого: ${calcTotal.textContent}.`;
    const messageField = document.getElementById('message');
    messageField.value = messageField.value ? messageField.value + '\n' + summary : summary;
    document.getElementById('contact').scrollIntoView({ behavior: 'smooth' });
  });

  // Section collapse/expand toggles (Мероприятия / Услуги / Пакеты услуг).
  // У секции класс is-open: свёрнутая секция компактная (стили в css/style.css).
  const sectionToggles = {};
  function setupSectionToggle(btnId, wrapId){
    const btn = document.getElementById(btnId);
    const wrap = document.getElementById(wrapId);
    if(!btn || !wrap) return;
    const section = wrap.closest('section');
    const setOpen = (isOpen) => {
      wrap.classList.toggle('open', isOpen);
      section.classList.toggle('is-open', isOpen);
      btn.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', isOpen);
      btn.childNodes[0].textContent = isOpen ? 'Скрыть ' : 'Показать ';
    };
    btn.addEventListener('click', () => setOpen(!wrap.classList.contains('open')));
    sectionToggles[section.id] = setOpen;
  }
  setupSectionToggle('eventsToggleBtn', 'eventsList');
  setupSectionToggle('servicesToggleBtn', 'servicesList');
  setupSectionToggle('packagesToggleBtn', 'packagesList');

  // Шапка: «Услуги» раскрывает раздел, «Оставить заявку» ведёт к форме и ставит фокус в первое поле.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-open-section]').forEach(link => {
    link.addEventListener('click', (e) => {
      const section = document.getElementById(link.dataset.openSection);
      if(!section) return;
      e.preventDefault();
      if(sectionToggles[section.id]) sectionToggles[section.id](true);
      section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });
  document.querySelectorAll('[data-focus-target]').forEach(link => {
    link.addEventListener('click', (e) => {
      const field = document.getElementById(link.dataset.focusTarget);
      const target = document.querySelector(link.getAttribute('href'));
      if(!field || !target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      // Фокус сразу, в том же нажатии: иначе iPhone не откроет клавиатуру.
      field.focus({ preventScroll: true });
    });
  });

  // Event-type picker
  const PICKER_INFO = {
    wedding: `<strong>Пока не оказываем услугу организации свадеб</strong> — это в ближайших планах компании. Оставьте заявку, и мы напишем первыми, как только запустим направление. А пока можете полистать форматы игр ниже — многие из них (например, «Битва тостов») отлично подойдут для банкета своими силами.`,
    corporate: `<strong>Для корпоративов чаще всего берут:</strong> квизы (в том числе под сферу вашей компании), классические командные игры (Мафия, Бункер, Шпион) и активности вроде «Живого оркестра» или «Битвы тостов». Ниже показаны только они — если нужно больше вариантов, нажмите «Показать все форматы».`,
    birthday: `<strong>Уточните возраст:</strong> подберём подходящие форматы отдельно для детского и отдельно для взрослого праздника.<div class="age-picks"><button type="button" class="age-pick" data-age="birthday-kids">Детский день рождения</button><button type="button" class="age-pick" data-age="birthday-adult">Взрослый день рождения</button></div>`,
    other: `Отлично — тогда показываем все форматы без ограничений: игры, квизы, танцевальные форматы, сезонные и алкоразвлечения. Листайте ниже и выбирайте, что откликается.`
  };
  const pickerBtns = document.querySelectorAll('.picker-btn');
  const pickerInfo = document.getElementById('pickerInfo');
  const pickerInfoInner = document.getElementById('pickerInfoInner');
  const filterResetBtn = document.getElementById('filterResetBtn');
  const allTiles = document.querySelectorAll('.format-tile[data-events]');

  function updateCategoryHeaders(){
    document.querySelectorAll('.other-format-cat').forEach(header => {
      const grid = header.nextElementSibling;
      if(!grid) return;
      const hasVisible = Array.from(grid.children).some(t => !t.classList.contains('filtered-out'));
      header.style.display = hasVisible ? '' : 'none';
      grid.style.display = hasVisible ? '' : 'none';
    });
  }

  function applyFilter(eventType){
    if(eventType === 'other' || !eventType){
      allTiles.forEach(t => t.classList.remove('filtered-out'));
      filterResetBtn.classList.remove('show');
      updateCategoryHeaders();
      return;
    }
    allTiles.forEach(t => {
      const events = (t.dataset.events || '').split(',');
      t.classList.toggle('filtered-out', !events.includes(eventType));
    });
    filterResetBtn.classList.add('show');
    updateCategoryHeaders();
  }

  pickerBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.event;
      const alreadyActive = btn.classList.contains('active');
      pickerBtns.forEach(b => b.classList.remove('active'));
      if(alreadyActive){
        pickerInfo.classList.remove('open');
        applyFilter(null);
        return;
      }
      btn.classList.add('active');
      pickerInfoInner.innerHTML = PICKER_INFO[type];
      pickerInfo.classList.add('open');
      if(type === 'wedding' || type === 'birthday'){
        applyFilter(null);
      } else {
        applyFilter(type);
      }
    });
  });
  pickerInfoInner.addEventListener('click', (e) => {
    const ageBtn = e.target.closest('.age-pick');
    if(!ageBtn) return;
    document.querySelectorAll('.age-pick').forEach(b => b.classList.remove('active'));
    ageBtn.classList.add('active');
    const label = ageBtn.dataset.age === 'birthday-kids' ? 'детского' : 'взрослого';
    applyFilter(ageBtn.dataset.age);
    let note = pickerInfoInner.querySelector('.age-filter-note');
    if(!note){
      note = document.createElement('p');
      note.className = 'age-filter-note';
      note.style.cssText = 'margin-top:12px; font-size:12.5px; color:var(--ink-soft);';
      pickerInfoInner.appendChild(note);
    }
    note.textContent = `Ниже показаны только форматы, подходящие для ${label} праздника — остальные скрыты, а не удалены. Нажмите «Показать все форматы» под плитками, чтобы увидеть полный список.`;
  });
  filterResetBtn.addEventListener('click', () => {
    pickerBtns.forEach(b => b.classList.remove('active'));
    pickerInfo.classList.remove('open');
    applyFilter(null);
  });

  // Full rules database + modal
  const RULES = {
    'mafia': { title: 'Мафия', text: 'Игроки тайно делятся на мирных жителей и мафию. Днём все обсуждают и голосуют за подозреваемого, ночью мафия выбирает жертву. Мирные жители побеждают, если вычисляют всю мафию; мафия — если сравнивается с ними по числу.' },
    'bunker': { title: 'Бункер', text: 'Каждый игрок получает карточку персонажа с профессией, качествами и особенностями. По раундам все раскрывают часть информации о себе, и группа голосует, кто покидает бункер. Побеждают те, кто остаётся в финальном составе.' },
    'melody': { title: 'Угадай мелодию', text: 'Ведущий включает короткие отрывки песен — участники первыми поднимают сигнал и называют трек и исполнителя. За каждый верный ответ начисляется балл.' },
    'truth': { title: 'Правда или действие', text: 'Игроки по очереди выбирают между честным ответом на вопрос или выполнением шуточного задания от ведущего или других участников.' },
    'spy': { title: 'Шпион', text: 'Все игроки, кроме одного, знают секретное место или слово. С помощью наводящих вопросов участники пытаются вычислить шпиона, а шпион — не выдать себя и угадать секрет.' },
    'kazaki': { title: 'Казаки-разбойники: Допрос', text: 'Активная игра на природе. Разбойники прячут на теле кусочки общей фразы и разбегаются по территории. Казаки ищут, угадывают за 5 попыток место тайника и выполняют задание, чтобы получить фрагмент. Побеждают, если верно соберут фразу.' },
    'chaos': { title: 'Большой переполох', text: 'Все пишут смешные задания на бумажках, складывают в эффектную ёмкость, передают под музыку по кругу — у кого в руках, когда музыка стихла, тот тянет и выполняет.' },
    'toasts': { title: 'Битва тостов', text: 'Участник вытягивает карточку с двумя случайными несочетаемыми темами и должен произнести тост, органично их объединив, за 20–30 секунд. Оценка — аплодисментами зала. Подходит и для свадьбы, и для корпоратива.' },
    'freeze': { title: 'Замри! Живые скульптуры', text: 'Ведущий называет слово или сцену — участники за 5 секунд застывают в позе, изображающей это. Зал выбирает лучшую скульптуру. Быстрый, энергичный формат для любого мероприятия.' },
    'mute': { title: 'Немая история', text: 'Команда вытягивает 10 карточек с изображениями (локации, персонажи, эмоции), собирает из них историю и показывает её жестами, без слов, другой команде. Очки — за каждую угаданную карточку.' },
    'orchestra': { title: 'Живой оркестр', text: 'Компактная игра для помещения. Каждому участнику назначается звук или жест-«инструмент», ведущий-«дирижёр» управляет громкостью и вступлением — получается импровизированный «оркестр» из зала. Подходит любому возрасту, без физической нагрузки.' },
    'musicloto': { title: 'Музыкальное лото', text: 'Классическое музыкальное бинго: на карточках — названия треков, ведущий включает отрывки песен, игроки закрывают совпадения. Первый, закрывший линию или всю карточку, — победитель.' },
    'custom': { title: 'Своя игра под запрос', text: 'Обсуждаем тематику и состав гостей и разрабатываем правила специально под ваш сценарий мероприятия.' },
    'quiz-classic': { title: 'Классический квиз', text: 'Стандартный набор туров на общую эрудицию: кино, музыка, история, логика. Ведущий читает вопросы по турам, команды пишут ответы на бланках, после каждого тура — подсчёт очков.' },
    'quiz-unusual': { title: 'Авторский квиз', text: 'Нестандартные форматы вопросов и тем — визуальные загадки, аудио-раунды, неожиданные категории. Для компаний, которые хотят удивить гостей.' },
    'quiz-company': { title: 'Квиз под компанию', text: 'Вопросы составляем индивидуально под сферу деятельности и специфику команды — отличный формат для корпоративов.' },
    'quiz-games': { title: 'Квиз с элементами игр', text: 'Классические туры чередуются с короткими мини-играми и активностями между раундами — динамика выше, чем у обычного квиза.' },
    'quiz-dance': { title: 'Квиз с музыкой и танцами', text: 'Вопросы чередуются с музыкальными и танцевальными раундами — сочетание викторины и активной вечеринки.' },
    'justdance': { title: 'Just Dance Battle', text: 'Командная игра с закрытыми плитками на игровом поле. Открыл плитку — обязан станцевать под клип или спеть под минус в заданном составе (девушка, парни, вся команда). Побеждает команда с наибольшим числом баллов от зала.' },
    'danceloto': { title: 'Танцевальное лото', text: 'Тот же принцип, что и музыкальное лото, но в ячейках — танцевальные движения. Чтобы закрыть клетку, нужно реально исполнить движение, а не просто узнать его.' },
    'dancekuraj': { title: 'Танцевальный кураж', text: 'Под каждый трек команда получает готовую связку движений и должна повторить её слаженно и вовремя — это баттл между командами: кто точнее и с большим драйвом воспроизведёт хореографию, тот получает баллы от зала. Раунды можно разнообразить: «Зеркальный баттл» — пары повторяют движения друг друга; тематические треки из известных фильмов и клипов на угадывание; штрафной раунд, где сбившиеся выполняют весёлый фант; и финальный фристайл капитанов — импровизация без заготовки под общий трек.' },
    'alcohol': { title: 'Алкогольные приключения', text: 'Настольная игра-ходилка на 60 клеток с фишками-рюмками. На клетках — выпить, станцевать, спеть, сыграть в мини-игру или выполнить необычный фант. Две версии по градусу раскрепощённости: Lite и Intense.' },
    'sweet-adventure': { title: 'Сладкие приключения', text: 'Та же настольная игра-ходилка на 60 клеток, что и «Алкогольные приключения», но без градуса: вместо рюмок — фишки-стаканчики сока или лимонада. На клетках — выпить сок, станцевать, спеть, сыграть в мини-игру или выполнить весёлый фант. Подходит для детских праздников и семейных мероприятий.' },
    'snowball': { title: 'Снежный десант', text: 'Команды бросают снежки по мишеням разного номинала на скорость и точность. Короткие раунды, не утомляет, расстояние регулируется под возраст. Сезонная игра — зима.' },
    'waterballoon': { title: 'Не урони каплю', text: 'Пары перебрасывают друг другу водный шарик, после каждой удачной ловли делая шаг назад. Побеждает пара, продержавшаяся на наибольшей дистанции. Сезонная игра — лето.' }
  };
  const ruleModalOverlay = document.getElementById('ruleModalOverlay');
  const ruleModalTitle = document.getElementById('ruleModalTitle');
  const ruleModalText = document.getElementById('ruleModalText');
  function openRuleModal(key){
    const r = RULES[key];
    if(!r) return;
    ruleModalTitle.textContent = r.title;
    ruleModalText.textContent = r.text;
    ruleModalOverlay.classList.add('open');
  }
  function closeRuleModal(){ ruleModalOverlay.classList.remove('open'); }
  document.getElementById('ruleModalClose').addEventListener('click', closeRuleModal);
  ruleModalOverlay.addEventListener('click', (e) => { if(e.target === ruleModalOverlay) closeRuleModal(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape'){ closeRuleModal(); closePrivacyModal(); } });

  // Privacy policy modal
  const privacyModalOverlay = document.getElementById('privacyModalOverlay');
  function openPrivacyModal(e){ if(e) e.preventDefault(); privacyModalOverlay.classList.add('open'); }
  function closePrivacyModal(){ privacyModalOverlay.classList.remove('open'); }
  document.querySelectorAll('.privacy-link').forEach(link => link.addEventListener('click', openPrivacyModal));
  document.getElementById('privacyModalClose').addEventListener('click', closePrivacyModal);
  privacyModalOverlay.addEventListener('click', (e) => { if(e.target === privacyModalOverlay) closePrivacyModal(); });

  // Format tiles — tap to flip on touch devices (hover already flips on desktop)
  document.querySelectorAll('.format-tile').forEach(tile => {
    tile.addEventListener('click', (e) => {
      if(e.target.closest('.format-more-btn')) return;
      tile.classList.toggle('flipped');
    });
  });
  document.querySelectorAll('.format-more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRuleModal(btn.dataset.ruleKey);
    });
  });

  // "Show other formats" toggle
  const toggleMoreFormats = document.getElementById('toggleMoreFormats');
  const moreFormatsWrap = document.getElementById('moreFormatsWrap');
  if(toggleMoreFormats){
    toggleMoreFormats.addEventListener('click', () => {
      const isOpen = moreFormatsWrap.classList.toggle('open');
      toggleMoreFormats.textContent = isOpen ? 'Скрыть остальные форматы' : toggleMoreFormats.dataset.closedLabel;
    });
    toggleMoreFormats.dataset.closedLabel = toggleMoreFormats.textContent;
  }

  // Touch/tap ripple effect
  const rippleLayer = document.getElementById('rippleLayer');
  if(!reduceMotion){
    document.addEventListener('pointerdown', (e) => {
      const r = document.createElement('span');
      r.className = 'ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      rippleLayer.appendChild(r);
      setTimeout(() => r.remove(), 650);
    });
  }

  // Mobile menu
  const burger = document.getElementById('burgerBtn');
  const panel = document.getElementById('mobilePanel');
  burger.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    burger.classList.toggle('open', isOpen);
    burger.setAttribute('aria-expanded', isOpen);
  });
  panel.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    panel.classList.remove('open');
    burger.classList.remove('open');
    burger.setAttribute('aria-expanded', false);
  }));

  // Form
  document.getElementById('leadForm').addEventListener('submit', async function(e){
    e.preventDefault();
    const ok = await sendLead(this, {
      type: 'lead',
      name: document.getElementById('name').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      eventType: document.getElementById('type').value,
      guests: document.getElementById('guests').value.trim(),
      contactMethod: document.getElementById('contactMethod').value,
      contactLink: document.getElementById('contactLink').value.trim(),
      message: document.getElementById('message').value.trim(),
    }, document.getElementById('formNote'), document.getElementById('formError'));
    if(ok) this.reset();
  });

  // Пост Telegram: скрипт виджета грузим, только когда блок подходит к экрану.
  const tgPost = document.getElementById('tgPost');
  if(tgPost){
    const loadWidget = () => {
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.dataset.telegramPost = tgPost.dataset.telegramPost;
      script.dataset.width = '100%';
      tgPost.appendChild(script);
    };
    if('IntersectionObserver' in window){
      const tgObserver = new IntersectionObserver((entries) => {
        if(entries.some(entry => entry.isIntersecting)){
          tgObserver.disconnect();
          loadWidget();
        }
      }, { rootMargin: '400px 0px' });
      tgObserver.observe(tgPost);
    }else{
      loadWidget();
    }
  }
