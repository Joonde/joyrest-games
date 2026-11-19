const states = [
  {
    id: 'overview', tab: 'Обзор', eyebrow: 'Конструктор · общие настройки', title: 'Вся игра настраивается в одном месте', image: 'constructor-overview.png',
    description: 'Сначала задаются общие правила, затем содержимое каждой карточки. Проверены четыре типа: танец, караоке, батл и специальный раунд.',
    host: ['Установить оценку от 20 до 200.', 'Задать 150 очков за победу.', 'Выбрать 45 секунд на голосование.', 'Добавлять и удалять карточки, возвращать удалённые.'],
    game: ['Правила попадают в новый запуск игры.', 'Ограничения не дают сохранить неподходящие значения.', 'Каждая карточка раскрывается отдельно.'],
    caption: 'Общие настройки и список карточек — настоящий DanceEditor.',
  },
  {
    id: 'dance-editor', tab: 'Танец', eyebrow: 'Конструктор · карточка «Танец»', title: 'Видео-образец и обычный музыкальный фрагмент', image: 'constructor-dance.png',
    description: 'У классического танца можно изменить тип, стиль, название, подсказку, ссылку на видео и трек. При смене «Танец» ↔ «Караоке» ссылка сохраняется.',
    host: ['Выбрать стиль «Латина».', 'Изменить название и подсказку.', 'Вставить YouTube, VK Видео или Rutube.', 'Настроить начало, длину и звучание трека.'],
    game: ['Команда повторяет движения за экраном.', 'Другие команды ставят оценки.', 'Средняя оценка начисляется выступающей команде.'],
    caption: 'Классическая карточка после редактирования всех основных полей.',
  },
  {
    id: 'karaoke-editor', tab: 'Караоке', eyebrow: 'Конструктор · карточка «Караоке»', title: 'Тот же формат, но участники поют', image: 'constructor-karaoke.png',
    description: 'Караоке использует видео с текстом или музыку. Его настройки не ломаются при переключении с обычного танца.',
    host: ['Назвать песню и указать состав выступающих.', 'Прикрепить видео с текстом или оставить трек.', 'Проверить ссылку заранее на репетиции.'],
    game: ['Участник или команда поёт.', 'Остальные оценивают выступление.', 'Правила подсчёта совпадают с танцем.'],
    caption: 'Отдельная карточка караоке с собственными названием и видео.',
  },
  {
    id: 'battle-editor', tab: 'Батл', eyebrow: 'Конструктор · обычный батл', title: 'Один трек и голосование за победителя', image: 'constructor-battle.png',
    description: 'Обычный батл не требует видео. Ведущий выбирает трек и его фрагмент — все команды выступают, затем капитаны голосуют.',
    host: ['Выбрать второй трек из библиотеки.', 'Установить фрагмент длиной 20 секунд.', 'Настроить начало, затухание и прослушивание.'],
    game: ['Все команды выступают по очереди.', 'За свою команду голосовать нельзя.', 'Победитель получает очки батла.'],
    caption: 'Проверка выбора трека и изменения длительности до 20 секунд.',
  },
  {
    id: 'special-editor', tab: 'Танцуй иначе', eyebrow: 'Конструктор · специальный раунд', title: 'Три обязательных трека по 3–15 секунд', image: 'constructor-special.png',
    description: 'У специальной карточки нет видео и одиночного трека: есть три самостоятельных музыкальных фрагмента и фиксированные усложнения.',
    host: ['Выбрать треки 2, 3 и 1 для трёх частей.', 'Задать начало каждого фрагмента.', 'Проверить автоматическое ограничение длины 15 секунд.'],
    game: ['Капитаны сначала выбирают усложнение.', 'Музыка меняется по серверному времени.', 'После ремикса идёт обычное голосование батла.'],
    caption: 'Все три музыкальных блока специального раунда.',
  },
  {
    id: 'dance-game', tab: 'Выступление', eyebrow: 'Игра · классический танец', title: 'Экран, пульт и телефон синхронизированы', image: 'game-dance.png',
    description: 'На экране название и выступающая команда, на пульте переходы и медиа, на телефоне капитана — понятная подсказка.',
    host: ['Поставить паузу или продолжить.', 'Запустить выступление сначала.', 'Открыть оценивание или вернуться назад.'],
    game: ['Команда видит «Ваш выход».', 'Экран показывает текущее выступление.', 'Музыка и видео не играют одновременно.'],
    caption: 'Выступление классической команды с настоящим оформлением JoyRest.',
  },
  {
    id: 'rate-game', tab: 'Оценка', eyebrow: 'Игра · оценка выступления', title: 'Другие команды оценивают, выступающая ждёт', image: 'game-rate.png',
    description: 'Во время голосования видно только число ответов и таймер, не промежуточные оценки. Выступающая команда не оценивает себя.',
    host: ['Следить за временем и числом голосов.', 'Нажать «Показать итог».', 'При необходимости вернуться к выступлению.'],
    game: ['Капитаны других команд ставят оценки.', 'Участники подсказывают капитанам.', 'Среднее округляется до целого.'],
    caption: 'Состояние оценки на экране, пульте и телефоне выступающей команды.',
  },
  {
    id: 'modifier-game', tab: 'Усложнение', eyebrow: 'Игра · выбор правила залом', title: 'Сначала зрители выбирают усложнение', image: 'game-modifier.png',
    description: '«Только руки», «Как роботы» и «Замедление» видны всем. Капитаны голосуют, участники видят те же варианты и подсказывают.',
    host: ['Смотреть голоса за каждый вариант.', 'Запустить батл с лидирующим правилом.', 'При ничьей использовать порядок списка.'],
    game: ['Без голосов выбирается «Только руки».', 'После запуска правило фиксируется.', 'Ответы этого этапа не смешиваются с голосами за победу.'],
    caption: 'Отдельный этап modifier до начала специального выступления.',
  },
  {
    id: 'remix-game', tab: 'Ремикс', eyebrow: 'Игра · специальное выступление', title: 'Музыка меняется, правило остаётся на экране', image: 'game-remix.png',
    description: 'Три участка показаны над сценой. Текущий участок и оставшееся время вычисляются по серверным меткам, а не по независимому таймеру браузера.',
    host: ['Поставить ремикс на паузу.', 'Продолжить с текущего места.', 'Запустить ремикс сначала или открыть голосование.'],
    game: ['Звук переключается track1 → track2 → track3.', 'При повторном открытии экрана играет текущий участок со смещения.', 'Пауза останавливает и звук, и отсчёт.'],
    caption: 'Экран ремикса после исправления перекрытия индикатора выступления.',
  },
  {
    id: 'vote-game', tab: 'Голосование', eyebrow: 'Игра · выбор победителя', title: 'Капитаны голосуют за другую команду', image: 'game-vote.png',
    description: 'Финальное голосование отделено от выбора усложнения новым шагом сессии. Своя команда исключена из вариантов.',
    host: ['Следить за числом голосов и временем.', 'Показать итог по свежим ответам.', 'При ничьей выбрать победителя вручную.'],
    game: ['Голоса других шагов не учитываются.', 'Голоса за свою команду не считаются.', 'Без голосов очки не начисляются.'],
    caption: 'Финальное голосование специального батла.',
  },
  {
    id: 'result-game', tab: 'Результат', eyebrow: 'Игра · начисление и следующий ход', title: 'Очки начисляются один раз, затем ход переходит дальше', image: 'game-result.png',
    description: 'Победитель получает очки батла, таблица обновляется сразу. При возврате начисление снимается, чтобы пересчитать итог без дублей.',
    host: ['Показать результат и начисление.', 'Перейти к следующей команде.', 'Использовать «Назад» для пересчёта или награждения в конце.'],
    game: ['Победитель видит +100 очков.', 'Остальные команды видят итог на экране.', 'Следующий капитан выбирает новую карточку.'],
    caption: 'Финальный экран победы и обновлённая таблица.',
  },
];

let index = 0;
const tabs = document.querySelector('#gallery-tabs');
const prev = document.querySelector('#prev');
const next = document.querySelector('#next');

for (const [i, state] of states.entries()) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gallery-tab';
  button.textContent = state.tab;
  button.dataset.index = String(i);
  button.setAttribute('aria-label', `Показать: ${state.tab}`);
  button.addEventListener('click', () => show(i));
  tabs.append(button);
}

function list(id, items) {
  const root = document.querySelector(id);
  root.replaceChildren(...items.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

function show(nextIndex) {
  index = (nextIndex + states.length) % states.length;
  const state = states[index];
  document.querySelector('#eyebrow').textContent = state.eyebrow;
  document.querySelector('#state-title').textContent = state.title;
  document.querySelector('#description').textContent = state.description;
  list('#host-actions', state.host);
  list('#game-actions', state.game);
  const image = document.querySelector('#state-image');
  image.src = `/assets/${state.image}`;
  image.alt = `${state.tab}: ${state.title}`;
  const enlarged = document.querySelector('#lightbox-image');
  enlarged.src = image.src;
  enlarged.alt = image.alt;
  document.querySelector('#lightbox-title').textContent = `${state.tab} · ${state.title}`;
  document.querySelector('#state-caption').textContent = state.caption;
  document.querySelector('#counter').textContent = `${index + 1} / ${states.length}`;
  for (const button of tabs.children) {
    const active = Number(button.dataset.index) === index;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    if (active) button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

prev.addEventListener('click', () => show(index - 1));
next.addEventListener('click', () => show(index + 1));
const lightbox = document.querySelector('#lightbox');
document.querySelector('#zoom').addEventListener('click', () => lightbox.showModal());
document.querySelector('#lightbox-close').addEventListener('click', () => lightbox.close());
lightbox.addEventListener('click', (event) => { if (event.target === lightbox) lightbox.close(); });
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') show(index - 1);
  if (event.key === 'ArrowRight') show(index + 1);
});
show(0);
