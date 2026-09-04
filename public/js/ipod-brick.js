'use strict';
// v1.270 - BRICK. The iPod's hidden game, as an easter egg on the Pocket Classic
// skins (Dean: "keep extremely small and modular... almost a little easter egg").
//
// DELIBERATELY SELF-CONTAINED. Nothing else in the app imports this; the skin
// engine hands it wheel rotation through one generic subscriber and otherwise
// does not know it exists. Written rather than vendored: every Breakout clone
// takes mouse/keyboard input and paints a full-page canvas, so the two things
// that make this one ours - wheel-driven paddle, sized into the iPod LCD - would
// have been rewritten anyway, and vendoring adds a licence for code we'd replace.
//
// HAPTICS, honestly: iOS ticks come from the OS tracking a finger on a hidden
// switch control, so they fire while you SPIN THE WHEEL to move the paddle. There
// is no way to fire one on a brick hit - that is not a thing the web can do.
//
// Music keeps playing throughout: this is a canvas over the LCD, nothing else.
(function () {
  var LIVES = 3;
  var COLS = 8, ROWS = 5;
  var PADDLE_W = 0.18;   // fraction of the board
  var BALL_R = 0.016;    // fraction of the board's shorter side
  var SPEED0 = 0.34;     // board-heights per second
  var DEG_PER_BOARD = 220; // wheel degrees to cross the full width

  function mount(host, opts) {
    if (!host) return null;
    var o = opts || {};
    var doc = host.ownerDocument || document;
    var win = doc.defaultView || window;

    var wrap = doc.createElement('div');
    wrap.className = 'ipod-brick';
    var canvas = doc.createElement('canvas');
    wrap.appendChild(canvas);
    host.appendChild(wrap);

    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1;
    function resize() {
      var r = wrap.getBoundingClientRect();
      W = Math.max(80, Math.round(r.width));
      H = Math.max(60, Math.round(r.height));
      dpr = Math.min(3, win.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    var state = 'ready'; // ready | playing | over
    var lives = LIVES, score = 0, level = 1;
    var padX = 0.5;                 // centre, 0..1
    var ball = null;
    var bricks = [];

    function layout() {
      bricks = [];
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) bricks.push({ r: r, c: c, alive: true });
      }
    }
    function resetBall() {
      ball = { x: padX, y: 0.72, vx: (Math.random() < 0.5 ? -1 : 1) * 0.55, vy: -1, sp: SPEED0 + (level - 1) * 0.06 };
    }
    layout(); resetBall();

    // ---- wheel input: the ONLY thing the engine feeds us ----
    function onRotate(deg) {
      if (state === 'over') return;
      padX += (deg / DEG_PER_BOARD);
      if (padX < PADDLE_W / 2) padX = PADDLE_W / 2;
      if (padX > 1 - PADDLE_W / 2) padX = 1 - PADDLE_W / 2;
      if (state === 'ready') ball.x = padX;
    }
    function select() {
      if (state === 'ready') { state = 'playing'; return true; }
      if (state === 'over') {
        lives = LIVES; score = 0; level = 1; layout(); resetBall(); state = 'ready'; return true;
      }
      return false;
    }

    // ---- the sim ----
    function step(dt) {
      if (state !== 'playing') return;
      var bw = 1 / COLS, bh = 0.055, top = 0.10;
      var nx = ball.x + ball.vx * ball.sp * dt;
      var ny = ball.y + ball.vy * ball.sp * dt;
      if (nx < BALL_R) { nx = BALL_R; ball.vx = Math.abs(ball.vx); }
      if (nx > 1 - BALL_R) { nx = 1 - BALL_R; ball.vx = -Math.abs(ball.vx); }
      if (ny < top - 0.06) { ny = top - 0.06; ball.vy = Math.abs(ball.vy); }

      // bricks
      if (ny > top && ny < top + ROWS * bh) {
        var rr = Math.floor((ny - top) / bh);
        var cc = Math.floor(nx / bw);
        for (var i = 0; i < bricks.length; i++) {
          var b = bricks[i];
          if (b.alive && b.r === rr && b.c === cc) {
            b.alive = false; score += 10 * (ROWS - rr);
            ball.vy = -ball.vy;
            if (typeof o.onBrick === 'function') { try { o.onBrick(score); } catch (_) { /* never break the loop */ } }
            break;
          }
        }
        var any = false;
        for (var j = 0; j < bricks.length; j++) { if (bricks[j].alive) { any = true; break; } }
        if (!any) { level += 1; layout(); resetBall(); state = 'ready'; return; }
      }

      // paddle
      var py = 0.90;
      if (ny > py - BALL_R && ball.y <= py - BALL_R) {
        if (nx > padX - PADDLE_W / 2 && nx < padX + PADDLE_W / 2) {
          ny = py - BALL_R;
          ball.vy = -Math.abs(ball.vy);
          ball.vx += (nx - padX) * 2.2; // english off the paddle
          var m = Math.hypot(ball.vx, ball.vy) || 1;
          ball.vx /= m; ball.vy /= m;
        }
      }
      if (ny > 1.02) {
        lives -= 1;
        if (lives <= 0) { state = 'over'; } else { resetBall(); state = 'ready'; }
        return;
      }
      ball.x = nx; ball.y = ny;
    }

    // ---- paint (LCD-flavoured: ink on the panel's own white) ----
    function paint() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      var bw = W / COLS, bh = 0.055 * H, top = 0.10 * H;
      ctx.fillStyle = '#2b3a4a';
      for (var i = 0; i < bricks.length; i++) {
        var b = bricks[i];
        if (!b.alive) continue;
        ctx.globalAlpha = 1 - b.r * 0.13;
        ctx.fillRect(b.c * bw + 1, top + b.r * bh + 1, bw - 2, bh - 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillRect((padX - PADDLE_W / 2) * W, 0.90 * H, PADDLE_W * W, Math.max(3, 0.022 * H));
      ctx.beginPath();
      ctx.arc(ball.x * W, ball.y * H, Math.max(2, BALL_R * Math.min(W, H)), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 ' + Math.round(Math.max(9, 0.055 * H)) + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(score), 4, Math.round(0.07 * H));
      var lt = '';
      for (var k = 0; k < lives; k++) lt += '●';
      ctx.fillText(lt, W - 6 - ctx.measureText(lt).width, Math.round(0.07 * H));
      if (state !== 'playing') {
        var msg = state === 'over' ? 'GAME OVER - Select' : 'Select to launch';
        ctx.font = '600 ' + Math.round(Math.max(9, 0.06 * H)) + 'px ui-sans-serif, system-ui, sans-serif';
        var tw = ctx.measureText(msg).width;
        ctx.fillText(msg, (W - tw) / 2, 0.55 * H);
      }
    }

    var raf = 0, last = 0, dead = false;
    function loop(t) {
      // The panel's repaint replaces innerHTML wholesale, which detaches us without
      // any event firing - so the loop asks whether it is still in the document
      // rather than waiting to be told (the v1.203 isConnected lesson). Belt to the
      // engine's braces: it now releases the takeover before repainting.
      if (dead || !wrap.isConnected) { dead = true; return; }
      if (!last) last = t;
      var dt = Math.min(0.05, (t - last) / 1000); last = t;
      step(dt); paint();
      raf = win.requestAnimationFrame(loop);
    }
    raf = win.requestAnimationFrame(loop);

    var onResize = function () { resize(); };
    try { win.addEventListener('resize', onResize); } catch (_) { /* no window events */ }

    return {
      onRotate: onRotate,
      select: select,
      destroy: function () {
        dead = true;
        try { win.cancelAnimationFrame(raf); } catch (_) { /* already stopped */ }
        try { win.removeEventListener('resize', onResize); } catch (_) { /* ditto */ }
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      },
    };
  }

  window.FileTubeBrick = { mount: mount };
})();
