'use strict';

// channel-row-probe (v1.340) - the measurement behind "Notify never moves its row": renders the
// watch page's channel-row buttons (Subscribe / Pin channel / Notify) in five states, OLD labels
// (the pre-v1.340 textContent) and NEW (common.js stableToggleLabelHtml), on a static page that
// links <repo-root>/public/css/style.css, in each era, at 390px; prints per era/kind how many
// distinct x/width each button takes across the states (1 = steady) and every state's
// [x, width, y, height]; saves row-<era>.html/.png in <out-dir>.
//   CHROME=<chromium binary> node scripts/channel-row-probe.js <repo-root> <out-dir>
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const ROOT=process.argv[2]; const OUT=process.argv[3];
const common=require(path.join(ROOT,'public/js/common.js'));
const H=common.stableToggleLabelHtml;
const old={sub:(s)=>s?'Subscribed':'Subscribe',pin:(p)=>p?'Pinned ★':'Pin channel',bell:(b)=>b?'🔔 Notifying':'🔕 Notify'};
const nu={sub:(s)=>H(s?'Subscribed':'Subscribe',['Subscribed','Subscribe']),pin:(p)=>H(p?'Pinned':'Pin channel',['Pin channel','Pinned'],{Pinned:{name:'starFilled',after:true}}),bell:(b)=>H(b?'Notifying':'Notify',['Notifying','Notify'],{Notifying:'bell',Notify:'bellOff'})};
const states=[[1,0,0],[1,1,0],[1,0,1],[1,1,1],[0,0,0]];
let rows='';
for(const era of ['2005','2009','2014','2021']) for(const [kind,f] of [['old',old],['new',nu]]) states.forEach((st,i)=>{
 rows+=`<section data-era="${era}" data-kind="${kind}" data-st="${st.join('')}"><div class="uploader-info-panel" style="width:358px"><div class="uploader-profile"><div class="uploader-avatar">A</div><div><a class="uploader-channel-link">Channel</a></div></div><div><button class="btn ${st[0]?'':'btn-primary'}" data-b="sub">${f.sub(st[0])}</button><button class="btn" data-b="pin" style="margin-left:var(--space-4)">${f.pin(st[1])}</button><button class="btn" data-b="bell" style="margin-left:var(--space-4)">${f.bell(st[2])}</button></div></div></section>`;
});
const css=path.join(ROOT,'public/css/style.css');
for (const era of ['2005','2009','2014','2021']) {
const html=`<!doctype html><html data-theme="${era}" data-mode="light"><head><meta name=viewport content="width=390"><link rel=stylesheet href="file://${css}"></head><body>${rows.split('<section').filter(x=>x.includes(`data-era="${era}"`)).map(x=>'<section'+x).join('')}<pre id=out></pre><script>
addEventListener('load',()=>{const r=[];document.querySelectorAll('section').forEach(s=>{const o={kind:s.dataset.kind,st:s.dataset.st};s.querySelectorAll('button').forEach(b=>{const q=b.getBoundingClientRect();o[b.dataset.b]=[Math.round(q.x*10)/10,Math.round(q.width*10)/10,Math.round(q.y-s.getBoundingClientRect().y),Math.round(q.height*10)/10]});r.push(o)});document.getElementById('out').textContent=JSON.stringify(r)});</script></body></html>`;
const f=path.join(OUT,`row-${era}.html`); fs.writeFileSync(f,html);
const dom=execFileSync(process.env.CHROME,['--headless','--no-sandbox','--allow-file-access-from-files','--window-size=390,2400','--virtual-time-budget=3000','--dump-dom','file://'+f],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
const j=JSON.parse(dom.match(/<pre id="out">([^<]*)<\/pre>/)[1].replace(/&quot;/g,'"'));
for(const kind of ['old','new']){const set=j.filter(x=>x.kind===kind);const moved=['sub','pin','bell'].map(b=>{const xs=new Set(set.map(x=>x[b][0]+'/'+x[b][1]));return b+':'+xs.size}).join(' ');console.log(era,kind,'distinct x/w per button across 5 states ->',moved,'|',set.map(x=>x.st+' '+['sub','pin','bell'].map(b=>x[b].join(',')).join(' ')).join(' ; '));}
execFileSync(process.env.CHROME,['--headless','--no-sandbox','--allow-file-access-from-files','--window-size=390,1100','--screenshot='+path.join(OUT,`row-${era}.png`),'file://'+f],{stdio:'ignore'});
}
