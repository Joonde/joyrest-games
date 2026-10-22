/* Картинка расчёта JoyRest (PNG шириной 1080, высота — по содержимому) для отправки менеджеру: сайт (витрина) и /calc/.
 * Мессенджеры не дают сайту положить файл прямо в чат, поэтому картинка уходит через меню «Поделиться»
 * телефона (navigator.share с файлом: WhatsApp, Telegram, Авито, почта), а где его нет — скачивается.
 * Вход — результат JoyPricing.calcSummary и id выбранного формата ведущего. */
(function (root) {
  'use strict';
  var W = 1080, H = 2000, PAD = 84;
  var C = { bg: '#1E1A17', card: '#2A2622', line: 'rgba(227,198,140,.35)', ink: '#FBF6F1', soft: '#C7BCAC', gold: '#E3C68C', rose: '#C49E96', dark: '#221E1B', green: '#A3C2AA' };
  var SERIF = '"Cormorant Garamond", Georgia, serif', SANS = 'Jost, system-ui, sans-serif';

  function money(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw(summary, levelId, names) {
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var ctx = cv.getContext('2d');
    var g = ctx.createRadialGradient(W / 2, -200, 100, W / 2, 200, 1300);
    g.addColorStop(0, '#2E2620'); g.addColorStop(1, C.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    var y = PAD + 40;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.gold; ctx.font = '600 30px ' + SANS;
    ctx.fillText('ДЖОЙРЕСТ · РАСЧЁТ ПРАЗДНИКА', PAD, y);
    ctx.fillStyle = C.soft; ctx.font = '400 28px ' + SANS; ctx.textAlign = 'right';
    ctx.fillText(new Date().toLocaleDateString('ru-RU'), W - PAD, y);
    ctx.textAlign = 'left';

    y += 100;
    ctx.fillStyle = C.ink; ctx.font = '700 76px ' + SERIF;
    wrap(ctx, summary.type, W - PAD * 2).forEach(function (l) { ctx.fillText(l, PAD, y); y += 80; });

    y += 6;
    ctx.font = '500 34px ' + SANS;
    summary.parts.forEach(function (p) {
      var text = p.charAt(0).toUpperCase() + p.slice(1);
      wrap(ctx, text, W - PAD * 2 - 40).forEach(function (l, i) {
        if (i === 0) { ctx.fillStyle = C.gold; ctx.fillText('•', PAD, y); }
        ctx.fillStyle = C.ink; ctx.fillText(l, PAD + 40, y); y += 46;
      });
      y += 6;
    });

    y += 14;
    ctx.fillStyle = C.green; ctx.font = '600 36px ' + SANS;
    ctx.fillText('Вечер ' + summary.duration, PAD, y);

    y += 52;
    if (summary.totals) {
      ctx.fillStyle = C.soft; ctx.font = '500 28px ' + SANS;
      ctx.fillText('ИТОГО ЗА ВЕЧЕР — ПО ФОРМАТУ ВЕДУЩЕГО', PAD, y);
      y += 28;
      summary.totals.forEach(function (t, i) {
        var on = (names[i] && names[i] === levelId) || (!levelId && i === 0);
        var h = 116;
        ctx.fillStyle = on ? C.rose : C.card; round(ctx, PAD, y, W - PAD * 2, h, 22); ctx.fill();
        if (!on) { ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.fillStyle = on ? C.dark : C.ink; ctx.font = '600 38px ' + SANS;
        ctx.fillText(t.name + (on ? '  ✓' : ''), PAD + 34, y + 72);
        ctx.font = '700 60px ' + SERIF; ctx.textAlign = 'right';
        ctx.fillStyle = on ? C.dark : C.gold;
        ctx.fillText(money(t.price), W - PAD - 34, y + 77);
        ctx.textAlign = 'left';
        y += h + 18;
      });
      if (summary.season) {
        ctx.fillStyle = C.rose; ctx.font = '500 30px ' + SANS;
        wrap(ctx, 'Праздничная цена уже в итоге: ' + summary.season.replace(/^праздничная цена /, ''), W - PAD * 2).forEach(function (l) { ctx.fillText(l, PAD, y + 30); y += 40; });
        y += 10;
      }
    } else {
      ctx.fillStyle = C.gold; ctx.font = '700 60px ' + SERIF;
      ctx.fillText('Цена — обсудим индивидуально', PAD, y + 60);
    }

    var fy = Math.max(y + 70, 1000);
    ctx.fillStyle = C.soft; ctx.font = '400 28px ' + SANS;
    ctx.fillText('Цены предварительные · по Москве выезд включён', PAD, fy);
    ctx.fillStyle = C.gold; ctx.font = '600 30px ' + SANS;
    ctx.fillText('joy-rest.ru  ·  t.me/JoyRest', PAD, fy + 50);
    var out = document.createElement('canvas');
    out.width = W; out.height = fy + 50 + PAD;
    var o = out.getContext('2d');
    o.drawImage(cv, 0, 0);
    o.strokeStyle = C.line; o.lineWidth = 3; round(o, 30, 30, W - 60, out.height - 60, 36); o.stroke();
    return out;
  }

  /** PNG-файл расчёта. levelIds — id форматов в порядке summary.totals (подсветить выбранный). */
  function make(summary, levelId, levelIds) {
    var ready = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('700 60px "Cormorant Garamond"'), document.fonts.load('600 30px Jost'), document.fonts.load('500 30px Jost')]).catch(function () {})
      : Promise.resolve();
    return ready.then(function () {
      var cv = draw(summary, levelId, levelIds || []);
      return new Promise(function (ok, fail) {
        cv.toBlob(function (b) { if (b) ok(new File([b], 'raschet-joyrest.png', { type: 'image/png' })); else fail(new Error('canvas')); }, 'image/png');
      });
    });
  }

  /** Меню «Поделиться» телефона с картинкой; нет его — скачать. Ответ: 'shared' | 'saved' | 'cancel'. */
  function share(file, text) {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: 'Расчёт JoyRest', text: text }).then(function () { return 'shared'; }, function (e) {
        return e && e.name === 'AbortError' ? 'cancel' : save(file);
      });
    }
    return Promise.resolve(save(file));
  }
  function save(file) {
    var url = URL.createObjectURL(file), a = document.createElement('a');
    a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return 'saved';
  }

  root.JoyCalcImage = { make: make, share: share };
})(window);
