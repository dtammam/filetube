const pw = require(require('path').resolve(__dirname, '../../../tools/capture/node_modules/playwright'));
const [,, which = 'chromium', filter = ''] = process.argv;
const TARGETS = [25, 88, 166, 224, 307, 375];
(async () => {
  const launch = { chromium: { args: ['--autoplay-policy=no-user-gesture-required'] },
    firefox: { executablePath: process.env.FFX, firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false, 'media.cubeb.force_null_context': true } }, webkit: { executablePath: process.env.WKX } }[which];
  const b = await pw[which].launch(launch); const pages = {};
  const page = async base => { if (!pages[base]) { pages[base] = await b.newPage(); await pages[base].goto(base + '/lab.html'); } return pages[base]; };
  const cases = [];
  for (const name of ['album.mp3', 'album.m4a']) for (const [link, base] of [['fast', 'http://127.0.0.1:8801'], ['slow', 'http://127.0.0.1:8802']]) {
    cases.push({ name, link, base, mode: 'control', T: 4 });
    for (const mode of ['fresh', 'inplay']) for (const T of TARGETS) cases.push({ name, link, base, mode, T });
  }
  for (const c of cases.filter(c => (c.name + c.link + c.mode).includes(filter))) {
    try { const p = await page(c.base); const r = await p.evaluate(a => window.runCase(a), c); console.log(which, c.name, c.link, JSON.stringify(r)); }
    catch (e) { console.log(which, c.name, c.link, c.mode, c.T, 'FAILED', String(e.message).split('\n')[0]); }
  }
  await b.close();
})();
