// Тема сайта до отрисовки страницы (без мигания): вечерняя по умолчанию, выбор посетителя —
// в localStorage этого браузера (может быть недоступен — тогда просто вечерняя). Переключатель — js/script.js.
(function () {
  var theme = 'dark';
  try { if (localStorage.getItem('jr-theme') === 'light') theme = 'light'; } catch (e) { /* приватный режим */ }
  document.documentElement.setAttribute('data-theme', theme);
})();
