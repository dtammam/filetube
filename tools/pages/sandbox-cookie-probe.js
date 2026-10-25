const http = require('http');
const pw = require('/home/coder/projects/filetube/tools/capture/node_modules/playwright');
const log = [];
const csp = (sandbox) => "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" + (sandbox ? '; sandbox allow-popups allow-popups-to-escape-sandbox' : '');
const srv = http.createServer((req, res) => {
  const c = req.headers.cookie || '';
  if (req.url === '/login') { res.setHeader('Set-Cookie', 'sess=1; Path=/; HttpOnly; SameSite=Lax'); res.end('ok'); return; }
  if (req.url === '/app') { res.setHeader('content-type', 'text/html'); res.end('<html><body><iframe sandbox="allow-popups allow-popups-to-escape-sandbox" src="/doc"></iframe><iframe sandbox="allow-popups allow-popups-to-escape-sandbox" src="/doc2"></iframe></body></html>'); return; }
  if (req.url === '/doc' || req.url === '/doc2') {
    log.push(req.url + ' cookie=' + (c.includes('sess=1')));
    res.setHeader('content-type', 'text/html');
    res.setHeader('content-security-policy', csp(req.url === '/doc2'));
    res.end('<html><body><img src="img' + (req.url === '/doc2' ? '2' : '1') + '.png"></body></html>');
    return;
  }
  if (req.url.startsWith('/img')) { log.push(req.url + ' cookie=' + c.includes('sess=1')); res.setHeader('content-type', 'image/png'); res.end(Buffer.from('89504e470d0a1a0a', 'hex')); return; }
  res.statusCode = 404; res.end();
});
srv.listen(0, async () => {
  const port = srv.address().port;
  for (const [name, type] of [['chromium', pw.chromium], ['webkit', pw.webkit], ['firefox', pw.firefox]]) {
    log.length = 0;
    let b;
    try { b = await type.launch(); } catch (e) { console.log(name, 'launch failed', e.message.split('\n')[0]); continue; }
    const ctx = await b.newContext(); const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/login`); await p.goto(`http://127.0.0.1:${port}/app`); await p.waitForTimeout(1500);
    console.log(name, JSON.stringify(log));
    await b.close();
  }
  srv.close();
});
