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
  var BALL_R = 0.016;    // fraction of the board's shorter side
  var DEG_PER_BOARD = 220; // wheel degrees to cross the full width

  // ---- feel (v1.271; every number here was picked by MEASUREMENT, not by eye) ----
  // The first cut played like an idle animation: a perfect paddle took 126 SECONDS to
  // clear one level, and a lazy autoplayer that only crept toward the ball never lost
  // a single life in a minute. These constants are the fix, and the harness in the
  // test file re-measures each claim so a lazy edit cannot quietly undo them.
  var PAD_W0 = 0.18;     // paddle width at level 1, fraction of the board
  var PAD_MIN = 0.085;   // ...and the floor: still several ball-widths, so not unfair
  var SPEED0 = 0.62;     // board-heights/sec. 0.34 crossed the board in 3s - a stroll.
  var SPEED_LEVEL = 0.10; // each level starts faster
  var SPEED_CAP = 1.45;  // hard ceiling: below this the substepper cannot be outrun
  var HIT_ACCEL = 1.008;  // every brick winds the rally up a notch (compounding). Tuned
                          // so a clean level 1 ends near the cap without pinning against
                          // it, leaving the later levels somewhere to go: the gate seat
                          // measured that finish as a DISTRIBUTION, 1.231-1.446 (median
                          // 1.395), not the single 1.43 this comment used to claim.
  var PAD_ACCEL = 1.006; // ...and so does every return, so a rally builds pace even
                          // while you are only defending and breaking nothing.
  var BREAK_KICK = 1.18;  // breaking into the top two rows: Atari's own speed jump
  var MAX_DEFLECT = Math.PI / 3; // 60deg off vertical at the paddle's very edge
  var MIN_VX = 0.10;     // never a dead-vertical rally (see the deflection comment)
  var SUB_STEP = 0.018;  // integrate in slices this small: under one brick height, so
  var SUB_CAP = 8;       // a fast ball cannot tunnel a row. Capped: no unbounded loop.

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
    var padW = PAD_W0;
    var padX = 0.5;                 // centre, 0..1
    var broke = false;              // has this level's top two rows been reached?
    var ball = null;
    var bricks = [];

    function layout() {
      bricks = [];
      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) bricks.push({ r: r, c: c, alive: true });
      }
    }
    // The paddle is the difficulty dial: a slice off it per level, and - Atari's own
    // move - it drops to 60% the moment you break through to the top rows, right as
    // the speed kick lands. That pairing turns a deep rally into a real fight.
    function refit() {
      padW = Math.max(PAD_MIN, PAD_W0 - (level - 1) * 0.018);
      if (broke) padW = Math.max(PAD_MIN, padW * 0.6);
      clampPad();
    }
    function clampPad() {
      var h = padW / 2;
      if (!(padX > h)) padX = h;              // written as !( > ) so a NaN lands here
      if (padX > 1 - h) padX = 1 - h;
    }
    function baseSpeed() { return Math.min(SPEED_CAP, SPEED0 + (level - 1) * SPEED_LEVEL); }
    function resetBall() {
      // Launch out of the paddle at 13-41 degrees off vertical, either way. Never dead
      // vertical, so the first rally cannot be a metronome down one column.
      var a = (Math.random() * 0.5 + 0.22) * (Math.random() < 0.5 ? -1 : 1);
      ball = { x: padX, y: 0.72, vx: Math.sin(a), vy: -Math.cos(a), sp: baseSpeed() };
    }
    layout(); refit(); resetBall();

    // ---- wheel input: the ONLY thing the engine feeds us ----
    function onRotate(deg) {
      if (state === 'over') return;
      if (typeof deg !== 'number' || !isFinite(deg)) return; // a NaN here poisons the
      padX += (deg / DEG_PER_BOARD);                         // paddle, then the canvas
      clampPad();
      if (state === 'ready') ball.x = padX;
    }
    function select() {
      if (state === 'ready') { state = 'playing'; return true; }
      if (state === 'over') {
        lives = LIVES; score = 0; level = 1; broke = false;
        layout(); refit(); resetBall(); state = 'ready'; return true;
      }
      return false;
    }

    // ---- the sim ----
    // A frame is integrated in slices no longer than SUB_STEP. At the old crawl one
    // slice was plenty; at 1.45 board-heights/sec a single 50ms frame moves the ball
    // further than a brick is tall, and it would sail straight through a row.
    function step(dt) {
      if (state !== 'playing') return;
      var dist = ball.sp * dt;
      if (!(dist > 0)) return;
      var n = Math.min(SUB_CAP, Math.max(1, Math.ceil(dist / SUB_STEP)));
      for (var s = 0; s < n && state === 'playing'; s++) advance(dt / n);
    }

    function advance(dt) {
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
            // Which face did we come through? A ball cutting ALONG a row (which the
            // 60deg deflections now produce constantly) enters from the side, and
            // flipping vy there would plough it through the whole row unopposed.
            if (Math.floor((ball.y - top) / bh) === rr && Math.floor(ball.x / bw) !== cc) ball.vx = -ball.vx;
            else ball.vy = -ball.vy;
            ball.sp = Math.min(SPEED_CAP, ball.sp * HIT_ACCEL);
            if (rr <= 1 && !broke) { broke = true; ball.sp = Math.min(SPEED_CAP, ball.sp * BREAK_KICK); refit(); }
            if (typeof o.onBrick === 'function') { try { o.onBrick(score); } catch (_) { /* never break the loop */ } }
            break;
          }
        }
        var any = false;
        for (var j = 0; j < bricks.length; j++) { if (bricks[j].alive) { any = true; break; } }
        if (!any) { level += 1; broke = false; layout(); refit(); resetBall(); state = 'ready'; return; }
      }

      // paddle
      var py = 0.90;
      if (ny > py - BALL_R && ball.y <= py - BALL_R) {
        var half = padW / 2;
        if (nx > padX - half && nx < padX + half) {
          ny = py - BALL_R;
          // CONTACT POSITION -> EXIT ANGLE. This is the Breakout rule and the whole
          // point of the rewrite: where you hit the paddle decides where the ball
          // goes, and the incoming direction is DISCARDED. The old code added the
          // offset to vx and renormalised, which is a nudge - measured end to end it
          // bent the ball by 14.7 degrees across the entire paddle, so the ball just
          // carried on the way it came. Mapped to an angle it is 120 degrees, and a
          // ball you catch EARLY (contact on the near edge, paddle overshot) goes back
          // the way it came, while one caught LATE (contact on the far edge) carries on.
          // (Slim S3: this comment said the opposite until the seat measured it.)
          // Clamped to +-60deg so it can never skim off almost horizontally forever.
          // The hit test above is nx strictly INSIDE padX +- half, so off is already
          // bounded to (-1, 1); a clamp here would be a branch that can never run.
          // MAX_DEFLECT is what does the clamping, and it is what the test measures.
          var a = ((nx - padX) / half) * MAX_DEFLECT;
          ball.vx = Math.sin(a); ball.vy = -Math.cos(a);
          // Dead centre is a perfectly vertical rally that can never reach the columns
          // either side of it - a stalemate, and the one degenerate this map allows.
          if (ball.vx > -MIN_VX && ball.vx < MIN_VX) {
            ball.vx = nx < padX ? -MIN_VX : MIN_VX;
            ball.vy = -Math.sqrt(1 - MIN_VX * MIN_VX);
          }
          ball.sp = Math.min(SPEED_CAP, ball.sp * PAD_ACCEL); // the rally builds pace
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
      ctx.fillRect((padX - padW / 2) * W, 0.90 * H, padW * W, Math.max(3, 0.022 * H));
      ctx.beginPath();
      ctx.arc(ball.x * W, ball.y * H, Math.max(2, BALL_R * Math.min(W, H)), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '600 ' + Math.round(Math.max(9, 0.055 * H)) + 'px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(String(score), 4, Math.round(0.07 * H));
      var lt = '';
      for (var k = 0; k < lives; k++) lt += '●';
      ctx.fillText(lt, W - 6 - ctx.measureText(lt).width, Math.round(0.07 * H));
      if (state !== 'playing') {
        // The level number earns its place now that each level is visibly faster and
        // the paddle is visibly shorter - without it the difficulty ramp is invisible.
        var msg = state === 'over' ? 'GAME OVER - Select' : 'LEVEL ' + level + ' - Select';
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

  // ---- the VIEW-side wiring, shared (v1.273) ----------------------------------
  // v1.270 shipped this as ~50 lines inside music.js, so podcasts - which runs the
  // SAME player on the SAME skins - simply had no Brick row (Dean: "podcasts just
  // doesn't show up as an option even though it's the same player"). Copying those
  // lines into podcasts.js would have made two of everything, including two copies
  // of the skin list, which is the v1.259 registry lesson: a hand-maintained sibling
  // list is where a feature goes inert. So the wiring lives here, once, and every
  // view asks for it. It lands in THIS file rather than a new one on purpose - a new
  // global script would have to be added to all TEN entry shells that load the skin
  // engine (the SHELL PARITY class - the gate seat counted them: 12 public/*.html, of
  // which 10 load skin-surface.js; "nine" here was my own miscount), and this file
  // already ships wherever the skin engine does.
  //
  // The engine stays generic: it never learns what a takeover is talking to. What
  // this adds is only what a VIEW would otherwise have to repeat.
  var WHEEL_SKINS = ['ipod', 'ipod-black']; // Pocket Classic pair. Seattle Classic
  // shares the chassis but its pad is half the usable rotation ring (tech-debt #207),
  // and Dean scoped this to "specifically the pocket classic"; flat skins have no wheel.

  function activeSkinId() {
    try {
      var sk = window.FileTubeMusicSkins;
      return (sk && typeof sk.activeSkinId === 'function') ? sk.activeSkinId() : '';
    } catch (_) { return ''; }
  }

  // wire({ getEngine }) -> { visible, onTap, stop, isRunning }
  // `visible` and `onTap` are the sticker hook a view hands the engine; `stop` is the
  // view's teardown arm (its own destroy path, which delivers no engine event).
  function wire(opts) {
    var o = opts || {};
    var game = null, keyDoc = null, keyFn = null;
    var engineOf = function () {
      try { return (typeof o.getEngine === 'function') ? o.getEngine() : null; } catch (_) { return null; }
    };
    function stop() {
      if (!game) return;
      // LOAD-BEARING (the v1.270 seat measured this): the engine releases the takeover
      // for paths that destroy the panel and for MENU, but the VIEW-initiated exits -
      // the sticker row toggling Brick off, and Escape - never enter the engine. Without
      // this clear the next MENU press is eaten by a stale pointer.
      var eng = engineOf();
      try { if (eng && typeof eng.setWheelTakeover === 'function') eng.setWheelTakeover(null); } catch (_) { /* engine gone */ }
      try { game.destroy(); } catch (_) { /* already torn down */ }
      game = null;
      if (keyDoc && keyFn) { try { keyDoc.removeEventListener('keydown', keyFn, true); } catch (_) { /* ignore */ } }
      keyDoc = null; keyFn = null;
    }
    function start() {
      if (game) { stop(); return; } // the row toggles
      var eng = engineOf();
      if (!eng || typeof eng.lcdHost !== 'function') return;
      var host = null;
      try { host = eng.lcdHost(); } catch (_) { host = null; }
      if (!host) return;
      game = mount(host, {});
      if (!game) return;
      if (typeof eng.setWheelTakeover === 'function') {
        eng.setWheelTakeover({
          onRotate: game.onRotate,
          onSelect: game.select,   // launch the ball / restart after GAME OVER
          onExit: stop,            // MENU backs out, the iPod rule
        });
      }
      // Escape belongs to the host's OWN document. music.js bound it to the main
      // `document`, which is right for an in-tab skin and wrong for any surface whose
      // panel lives elsewhere - the v1.250 foreign-window lesson.
      keyDoc = host.ownerDocument || document;
      keyFn = function (e) { if (game && e && e.key === 'Escape') { e.preventDefault(); stop(); } };
      try { keyDoc.addEventListener('keydown', keyFn, true); } catch (_) { keyDoc = null; keyFn = null; }
    }
    return {
      visible: function () {
        if (WHEEL_SKINS.indexOf(activeSkinId()) < 0) return false;
        // ...and the surface must actually have a wheel to play it WITH.
        //
        // READ THIS BEFORE TRUSTING THE TWO CHECKS BELOW. They do NOT currently protect
        // the tray, and the adversarial seat measured why - twice I described this guard
        // as working and twice I was wrong, so the mechanism is written out in full:
        //
        // This wiring is per-VIEW, not per-SURFACE. A view builds ONE wiring whose
        // `getEngine` returns its own in-tab engine, and the pop-out/tray engine is
        // constructed from that same view cfg - so when the TRAY's sticker menu asks
        // `visible()`, it runs this closure, which looks at the IN-TAB engine's host.
        // `mms-tray` is set on the pop-out document's body, never the main one, so the
        // body-class check below always reads false; and the skin check reads the global
        // preference while the tray overrides its engine's getSkinId to force `ipod`.
        // Both checks are therefore inert for the tray, and `onTap` would mount the game
        // on the IN-TAB LCD (measured).
        //
        // None of that is reachable today: the engine gates the whole row on `inMainDoc`
        // (skin-surface.js), and the tray is a pop-out document, so `visible()` is never
        // called there. The checks stand as correct statements about the surface they CAN
        // see - a main-document panel - and the tray body-class check costs nothing.
        // BUT: lifting `inMainDoc` to bring Brick to the pop-out (a named future
        // decision) requires making `wire()` per-SURFACE first - `getEngine` must return
        // the engine of the surface doing the asking. Until then neither check means what
        // its name suggests, and the unit fixture that "proves" the tray case hands this
        // wiring the tray's own engine, which no view ever does.
        var eng = engineOf();
        if (!eng || typeof eng.lcdHost !== 'function') return false;
        var host = null;
        try { host = eng.lcdHost(); } catch (_) { host = null; }
        if (!host) return false;
        var d = host.ownerDocument;
        if (d && d.body && d.body.classList && d.body.classList.contains('mms-tray')) return false;
        var root = (typeof host.closest === 'function' && host.closest('.music-nowplaying-panel')) || d;
        return !!(root && root.querySelector && root.querySelector('.ip-wheel'));
      },
      onTap: start,
      stop: stop,
      isRunning: function () { return !!game; },
    };
  }

  window.FileTubeBrick = { mount: mount, wire: wire };
})();
