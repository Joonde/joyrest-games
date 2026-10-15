// Лента отзывов на сайте (решение владельца 15 октября 2026): владелец отмечает отзывы гостей «Поместить на сайт» в
// студии платформы, сайт берёт их с /api/site/reviews. Лента листается пальцем по кругу без конца (три копии
// списка, на широком экране — больше; незаметный перескок в середину), на компьютере — стрелки. Нет отзывов или сервер не ответил — ленты нет,
// раздел остаётся «Следите за нами».
(function(){
  'use strict';
  var box = document.getElementById('siteReviews');
  var track = document.getElementById('reviewsTrack');
  if(!box || !track || !window.fetch) return;

  function card(r){
    var li = document.createElement('article');
    li.className = 'review-card';
    var stars = document.createElement('p');
    stars.className = 'review-card__stars';
    stars.setAttribute('aria-label', 'Оценка ' + r.rating + ' из 5');
    stars.textContent = '★★★★★'.slice(0, r.rating);
    var rest = document.createElement('span');
    rest.className = 'review-card__rest';
    rest.textContent = '★★★★★'.slice(0, 5 - r.rating);
    stars.appendChild(rest);
    li.appendChild(stars);
    if(r.text){
      var text = document.createElement('p');
      text.className = 'review-card__text';
      text.textContent = r.text;
      li.appendChild(text);
    }
    var who = document.createElement('p');
    who.className = 'review-card__who';
    who.textContent = [r.name || 'Гость праздника', r.month].filter(Boolean).join(' · ');
    li.appendChild(who);
    return li;
  }

  function show(reviews){
    if(!reviews.length) return;
    document.getElementById('reviewsEyebrow').textContent = 'Отзывы';
    document.getElementById('reviewsTitle').textContent = 'Что говорят гости';
    document.getElementById('reviewsSub').textContent = 'Отзывы гостей наших мероприятий — листайте. Были у нас? Напишите свой.';
    var loop = reviews.length > 1;
    var copies = loop ? 3 : 1;
    for(var c = 0; c < copies; c++){
      reviews.forEach(function(r){
        var el = card(r);
        // Копии — только для бесконечной ленты: экранный диктор читает отзывы один раз.
        if(c !== 1 && loop) el.setAttribute('aria-hidden', 'true');
        track.appendChild(el);
      });
    }
    box.hidden = false;
    if(!loop){ box.classList.add('reviews--single'); return; }

    var setWidth = 0;
    function measure(){
      var first = track.children[0];
      var middle = track.children[reviews.length];
      setWidth = middle.offsetLeft - first.offsetLeft;
    }
    // Широкий экран и мало отзывов: трёх копий не хватает, чтобы перескок был незаметен и лента не упиралась в край, —
    // добавляем копии, пока запас прокрутки меньше двух с половиной списков.
    function ensureCopies(){
      var guard = 0;
      while(setWidth > 0 && track.scrollWidth - track.clientWidth < setWidth * 2.5 && guard < 12){
        reviews.forEach(function(r){
          var el = card(r);
          el.setAttribute('aria-hidden', 'true');
          track.appendChild(el);
        });
        guard++;
      }
    }
    function center(){ measure(); ensureCopies(); track.scrollLeft = setWidth; }
    // Ушли в первую или третью копию — тихо перескакиваем на то же место во второй.
    var timer = 0;
    track.addEventListener('scroll', function(){
      clearTimeout(timer);
      timer = setTimeout(function(){
        if(!setWidth) measure();
        if(track.scrollLeft < setWidth * 0.5) track.scrollLeft += setWidth;
        else if(track.scrollLeft > setWidth * 1.5) track.scrollLeft -= setWidth;
      }, 120);
    }, { passive: true });
    function step(dir){
      var one = track.children[0].getBoundingClientRect().width + 16;
      track.scrollBy({ left: dir * one, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    document.getElementById('reviewsPrev').addEventListener('click', function(){ step(-1); });
    document.getElementById('reviewsNext').addEventListener('click', function(){ step(1); });
    track.addEventListener('keydown', function(e){
      if(e.key === 'ArrowLeft'){ e.preventDefault(); step(-1); }
      if(e.key === 'ArrowRight'){ e.preventDefault(); step(1); }
    });
    window.addEventListener('resize', center);
    requestAnimationFrame(center);
  }

  fetch('/api/site/reviews', { headers: { Accept: 'application/json' } })
    .then(function(res){ return res.ok ? res.json() : null; })
    .then(function(data){ if(data && Array.isArray(data.reviews)) show(data.reviews); })
    .catch(function(){});
})();
