'use strict';
/* Aspria v0.2: all asset information stays in this browser's IndexedDB unless the user exports JSON. */
const CATEGORIES = [
  {key:'bank',label:'銀行口座',color:'#80a9c7'},
  {key:'savings',label:'財形貯蓄',color:'#d8b871'},
  {key:'investment',label:'投資',color:'#81ad8a'},
  {key:'physical',label:'有形資産',color:'#cba0a5'}
];
const DEFAULT_STATE = () => ({version:1,accounts:[],records:{},updatedAt:null});
let state = DEFAULT_STATE();
let selectedMonth = localMonth();
let activeView = 'home';
let persistQueue = Promise.resolve();
let saveNumber = 0;
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ja-JP');
const money = n => fmt(n)+'円';
const shortMoney = n => Math.abs(n)>=1e8 ? (n/1e8).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')+'億' : Math.abs(n)>=1e4 ? Math.round(n/1e4).toLocaleString('ja-JP')+'万' : fmt(n);
const catInfo = key => CATEGORIES.find(c=>c.key===key);
const monthIndex = m => Number(m.slice(0,4))*12 + Number(m.slice(5,7))-1;
const monthLabel = m => `${m.slice(0,4)}年${Number(m.slice(5,7))}月`;
const isMonth = x => typeof x==='string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
function localMonth(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function offsetMonth(m,add){const d=new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1+add,1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;}
function el(tag,cls,text){const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=String(text);return node;}
function append(parent,...nodes){nodes.forEach(n=>parent.append(n));return parent;}
function textBadge(text,cls='neutral'){const b=el('span','pill '+cls,text);return b;}
function notify(message){const toast=$('toast');toast.textContent=message;toast.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>toast.hidden=true,3600);}
function emptyCard(heading,description,action,callback){const box=el('div','card empty');append(box,el('div','empty-illustration','🌱'),el('h2','',heading),el('p','',description));if(action){const btn=el('button','primary-button',action);btn.type='button';btn.addEventListener('click',callback);box.append(btn);}return box;}
function getDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('aspria-local',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('state'))req.result.createObjectStore('state');};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function loadLocal(){const db=await getDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly');const req=tx.objectStore('state').get('main');req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}finally{db.close();}}
async function writeLocal(snapshot){const db=await getDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(snapshot,'main');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{db.close();}}
function persist(){state.updatedAt=new Date().toISOString();const snapshot=structuredClone(state);const n=++saveNumber;$('save-state').textContent='端末内へ保存中…';persistQueue=persistQueue.catch(()=>{}).then(()=>writeLocal(snapshot)).then(()=>{if(n===saveNumber)$('save-state').textContent='✓ この端末に自動保存済み';}).catch(err=>{$('save-state').textContent='保存に失敗しました。バックアップしてください。';notify('保存に失敗しました: '+err.message);});return persistQueue;}
function accountActive(a,m){return (!a.start || a.start<=m)&&(!a.end || a.end>=m);}
function monthAccounts(m){return state.accounts.filter(a=>accountActive(a,m));}
function monthStatus(m){const active=monthAccounts(m),entries=state.records[m]||{};const recorded=active.filter(a=>entries[a.id]?.status==='recorded').length;return {active:active.length,recorded,complete:active.length>0 && recorded===active.length};}
function sumMonth(m){const sums=Object.fromEntries(CATEGORIES.map(c=>[c.key,0]));for(const a of monthAccounts(m)){const entry=state.records[m]?.[a.id];if(entry?.status==='recorded')sums[a.category]+=entry.amount;}return {month:m,sums,total:Object.values(sums).reduce((a,b)=>a+b,0),financial:sums.bank+sums.savings+sums.investment};}
function completeMonths(){return Object.keys(state.records).filter(m=>isMonth(m) && monthStatus(m).complete).sort().map(sumMonth);}
function latestAndPrevious(){const rows=completeMonths();return {latest:rows.at(-1),previous:rows.at(-2),rows};}
function getPrevValue(a,m){const months=Object.keys(state.records).filter(k=>isMonth(k)&&k<m).sort().reverse();for(const old of months){const entry=state.records[old]?.[a.id];if(entry?.status==='recorded')return {month:old,amount:entry.amount};}return null;}
function addField(parent,title,value,extraClass=''){const row=el('div','stat-pair '+extraClass);append(row,el('span','muted',title),el('strong','',value));parent.append(row);}
function setView(view){activeView=view;document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==`view-${view}`);document.querySelectorAll('[data-view]').forEach(b=>{const yes=b.dataset.view===view;b.classList.toggle('active',yes);if(yes)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});renderView();}
function renderView(){if(activeView==='home')renderHome();if(activeView==='input')renderInput();if(activeView==='analysis')renderAnalysis();}
function openSettings(){renderAccounts();$('settings-dialog').showModal();}
function renderHome(){const root=$('home-content');root.replaceChildren();const {latest,previous}=latestAndPrevious();if(!latest){root.append(emptyCard('これから育つ、資産の記録','最初に口座を登録し、月次の残高を入力してください。サンプルデータでグラフを試すこともできます。','口座を登録する',openSettings));if(state.accounts.length===0){const b=el('button','outline-button','サンプルデータで試す');b.onclick=loadDemo;root.append(b);}return;}
  const hero=el('section','card');append(hero,el('p','hero-label','最新の確定総資産'),el('p','hero-month',monthLabel(latest.month)),el('div','big-number',money(latest.total)));
  const sub=el('div','hero-metric');if(previous){const delta=latest.total-previous.total;sub.append(textBadge(`前回（${monthLabel(previous.month)}）比 ${delta>=0?'+':''}${money(delta)}`,delta>=0?'':'warn'));}else{sub.append(textBadge('最初の確定記録'));}hero.append(sub);addField(hero,'金融資産（有形資産を除く）',money(latest.financial));root.append(hero);
  const mix=el('section','card');mix.append(el('h2','section-subhead','分類別の資産構成'));const wrap=el('div','donut-wrap');const donut=el('div','donut');let cursor=0;const gradient=[];CATEGORIES.forEach(c=>{const p=latest.total>0?latest.sums[c.key]/latest.total*100:0;gradient.push(`${c.color} ${cursor}% ${cursor+p}%`);cursor+=p;});donut.style.background=latest.total>0?`conic-gradient(${gradient.join(',')})`:'var(--surface2)';const hole=el('div','donut-hole');append(hole,el('strong','',latest.total>0?'100%':'—'),el('span','','4つの資産分類'));donut.append(hole);wrap.append(donut);const legend=el('div','donut-legend');CATEGORIES.forEach(c=>{const item=el('div','legend-line');const left=el('span','');const dot=el('i','dot');dot.style.background=c.color;append(left,dot,document.createTextNode(' '+c.label));append(item,left,el('strong','',latest.total>0?`${(latest.sums[c.key]/latest.total*100).toFixed(1)}%`:'—'));legend.append(item);});wrap.append(legend);mix.append(wrap);
  const cats=el('div','category-list');CATEGORIES.forEach(c=>{const tile=el('div','cat-stat');const lab=el('div','cat-label');const dot=el('i','dot');dot.style.background=c.color;append(lab,dot,document.createTextNode(c.label));append(tile,lab,el('div','cat-number',money(latest.sums[c.key])));cats.append(tile);});mix.append(cats);root.append(mix);
  const current=monthStatus(selectedMonth);if(current.active>0&&!current.complete){const box=el('section','card');const action=el('div','action-strip');append(action,el('h2','section-subhead','現在の入力状況'),textBadge('入力途中','warn'));box.append(action);const progress=el('div','small',`${monthLabel(selectedMonth)}：${current.recorded} / ${current.active} 口座`);box.append(progress);const track=el('div','progress-track');const fill=el('div','progress-fill');fill.style.width=`${100*current.recorded/current.active}%`;track.append(fill);box.append(track);box.append(el('p','note','未入力の月は総資産に含めません。入力内容は自動保存されます。'));const b=el('button','outline-button','入力を続ける');b.onclick=()=>setView('input');box.append(b);root.append(box);}
}
function renderInput(){const root=$('input-content');root.replaceChildren();$('record-month').value=selectedMonth;const accounts=monthAccounts(selectedMonth);if(!state.accounts.length){root.append(emptyCard('まずは口座を登録しましょう','設定から銀行口座、財形貯蓄、投資、有形資産を登録できます。','口座を登録する',openSettings));return;}if(!accounts.length){root.append(emptyCard('この月に対象の口座がありません','設定で各口座の記録開始月・終了月を確認してください。','口座設定を開く',openSettings));return;}
  const status=monthStatus(selectedMonth);const progressCard=el('section','card');const top=el('div','action-strip');top.append(el('strong','',`記録済み ${status.recorded} / ${status.active} 口座`));top.append(textBadge(status.complete?'確定':'入力途中',status.complete?'':'warn'));progressCard.append(top);const track=el('div','progress-track');const fill=el('div','progress-fill');fill.style.width=`${status.recorded/status.active*100}%`;track.append(fill);progressCard.append(track);progressCard.append(el('p','note','各口座の金額は入力するたびに端末内へ保存します。0円は有効な金額、空欄は未記録です。'));root.append(progressCard);
  CATEGORIES.forEach(category=>{const members=accounts.filter(a=>a.category===category.key);if(!members.length)return;const card=el('section','card');const title=el('div','account-group-title');const dot=el('i','dot');dot.style.background=category.color;append(title,dot,document.createTextNode(category.label));card.append(title);
    members.forEach(a=>{const prev=getPrevValue(a,selectedMonth);const entry=state.records[selectedMonth]?.[a.id];const row=el('div','account-row');const top=el('div','row-head');append(top,el('strong','',a.name),el('span','',prev?`前回 ${monthLabel(prev.month)}：${money(prev.amount)}`:'過去の記録なし'));row.append(top);
      const line=el('div','row-entry');const input=el('input');input.type='text';input.inputMode='numeric';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label',`${a.name} ${monthLabel(selectedMonth)} の残高（円）`);input.placeholder='当月の残高';input.value=entry?.status==='recorded'?String(entry.amount):entry?.status==='draft'?entry.text:'';
      input.addEventListener('input',()=>{const raw=input.value;let value;if(raw.trim()===''){value={status:'missing'};}else if(/^\d+$/.test(raw.replaceAll(',',''))&&Number.isSafeInteger(Number(raw.replaceAll(',','')))){value={status:'recorded',amount:Number(raw.replaceAll(',',''))};}else{value={status:'draft',text:raw.slice(0,32)};}if(!state.records[selectedMonth])state.records[selectedMonth]={};state.records[selectedMonth][a.id]=value;persist();const s=monthStatus(selectedMonth);progressCard.querySelector('.action-strip strong').textContent=`記録済み ${s.recorded} / ${s.active} 口座`;const badge=progressCard.querySelector('.pill');badge.textContent=s.complete?'確定':'入力途中';badge.className='pill '+(s.complete?'neutral':'warn');fill.style.width=`${s.recorded/s.active*100}%`;});
      input.addEventListener('blur',()=>{if(state.records[selectedMonth]?.[a.id]?.status==='recorded')input.value=String(state.records[selectedMonth][a.id].amount);});line.append(input,el('span','yen','円'));if(prev){const copy=el('button','tiny-button','コピー');copy.type='button';copy.setAttribute('aria-label',`${a.name}の前回残高をコピー`);copy.addEventListener('click',()=>{input.value=String(prev.amount);input.dispatchEvent(new Event('input',{bubbles:true}));notify(`${a.name}の前回残高をコピーしました`);});line.append(copy);}row.append(line);if(entry?.status==='draft'){row.append(el('p','row-note','⚠ 数字を確認してください。未確定の入力です。'));}card.append(row);
    });root.append(card);
  });
  root.append(el('p','note','金額の入力だけで保存されます。Google Driveに保存する場合は、右上の設定から「JSONを書き出す」を選んでください。'));
}
function pointsForRange(rows){const range=$('chart-range').value;if(range==='all'||!rows.length)return rows;const end=rows.at(-1).month;const start=monthIndex(end)-Number(range)+1;return rows.filter(r=>monthIndex(r.month)>=start);}
function svgRoot(w=354,h=238){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox',`0 0 ${w} ${h}`);s.setAttribute('role','img');s.setAttribute('aria-label','資産推移グラフ');return s;}
function svgEl(name,attrs={},txt){const s=document.createElementNS('http://www.w3.org/2000/svg',name);Object.entries(attrs).forEach(([k,v])=>s.setAttribute(k,String(v)));if(txt!==undefined)s.textContent=txt;return s;}
function renderLineChart(rows){const w=354,h=235,l=50,r=14,t=12,b=36,plotW=w-l-r,plotH=h-t-b,s=svgRoot(w,h);const lo=Math.min(...rows.flatMap(p=>[p.total,p.financial]));const hi=Math.max(...rows.map(p=>p.total));const mn=Math.max(0,lo-(hi-lo)*.23);const mx=hi===mn?mn+1:hi+(hi-lo)*.15;const first=monthIndex(rows[0].month),last=monthIndex(rows.at(-1).month);const x=m=>l+(monthIndex(m)-first)/Math.max(1,last-first)*plotW;const y=v=>t+(mx-v)/(mx-mn)*plotH;
  for(let i=0;i<=4;i++){const val=mn+(mx-mn)*i/4;const yp=y(val);s.append(svgEl('line',{x1:l,y1:yp,x2:w-r,y2:yp,stroke:'#e0e8dd'}),svgEl('text',{x:l-7,y:yp+4,'text-anchor':'end',fill:'#76857b','font-size':10},shortMoney(val)));}
  for(const [key,color] of [['total','#3d6f4b'],['financial','#83abc9']]){const d=rows.map((v,i)=>`${i?'L':'M'} ${x(v.month).toFixed(2)} ${y(v[key]).toFixed(2)}`).join(' ');if(rows.length>1)s.append(svgEl('path',{d,fill:'none',stroke:color,'stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'}));rows.forEach(v=>s.append(svgEl('circle',{cx:x(v.month),cy:y(v[key]),r:3.2,fill:color,stroke:'white','stroke-width':1})));}
  const mid=rows[Math.floor((rows.length-1)/2)].month;for(const m of [...new Set([rows[0].month,mid,rows.at(-1).month])])s.append(svgEl('text',{x:x(m),y:h-9,'text-anchor':m===rows[0].month?'start':m===rows.at(-1).month?'end':'middle',fill:'#76857b','font-size':10},m.replace('-','/')));
  return s;
}
function renderStackedChart(rows){const w=354,h=235,l=44,r=14,t=12,b=36,pw=w-l-r,ph=h-t-b,s=svgRoot(w,h);const first=monthIndex(rows[0].month),last=monthIndex(rows.at(-1).month);const x=m=>l+(monthIndex(m)-first)/Math.max(1,last-first)*pw;const y=p=>t+(100-p)/100*ph;
  for(let i=0;i<=4;i++){const percent=i*25,yp=y(percent);s.append(svgEl('line',{x1:l,y1:yp,x2:w-r,y2:yp,stroke:'#e0e8dd'}),svgEl('text',{x:l-7,y:yp+4,'text-anchor':'end',fill:'#76857b','font-size':10},`${percent}%`));}
  const running=rows.map(()=>0);for(const category of CATEGORIES){const bottom=[...running];rows.forEach((v,i)=>running[i]+=v.sums[category.key]/v.total*100);const top=[...running];const pts=[...rows.map((v,i)=>`${x(v.month)},${y(top[i])}`),...rows.map((v,i)=>`${x(v.month)},${y(bottom[i])}`).reverse()];if(rows.length>1)s.append(svgEl('polygon',{points:pts.join(' '),fill:category.color,opacity:.86,stroke:'white','stroke-width':1}));else{s.append(svgEl('rect',{x:l-5,y:y(top[0]),width:10,height:y(bottom[0])-y(top[0]),fill:category.color}));}}
  const mid=rows[Math.floor((rows.length-1)/2)].month;for(const m of [...new Set([rows[0].month,mid,rows.at(-1).month])])s.append(svgEl('text',{x:x(m),y:h-9,'text-anchor':m===rows[0].month?'start':m===rows.at(-1).month?'end':'middle',fill:'#76857b','font-size':10},m.replace('-','/')));return s;
}
function chartLegend(pairs){const row=el('div','legend');for(const [title,color] of pairs){const line=el('span');const dot=el('i','dot');dot.style.background=color;append(line,dot,document.createTextNode(title));row.append(line);}return row;}
function renderAnalysis(){const root=$('analysis-content');root.replaceChildren();const rows=pointsForRange(completeMonths());const type=$('chart-type').value;if(!rows.length){root.append(emptyCard('まだ確定した記録がありません','対象月のすべての口座に残高が入力されると、グラフに表示されます。','月次入力へ',()=>setView('input')));return;}
  const card=el('section','card');if(type==='wealth'){card.append(el('h2','section-subhead','総資産と金融資産の推移'));const svg=renderLineChart(rows);card.append(append(el('div','chart-wrap'),svg),chartLegend([['総資産','#3d6f4b'],['金融資産','#83abc9']]));card.append(el('p','note',`対象：${monthLabel(rows[0].month)} ～ ${monthLabel(rows.at(-1).month)}。欠測月は補完せず、記録のある点だけを結んでいます。`));}
  if(type==='mix'){const filtered=rows.filter(r=>r.total>0);card.append(el('h2','section-subhead','資産構成比の推移'));if(!filtered.length){card.append(el('p','note','構成比を計算できる記録がありません。'));}else{card.append(append(el('div','chart-wrap'),renderStackedChart(filtered)),chartLegend(CATEGORIES.map(c=>[c.label,c.color])));card.append(el('p','note','4分類の合計を100%とした割合です。総資産が0円の月は表示していません。'));}}
  if(type==='delta'){card.append(el('h2','section-subhead','資産増減の寄与度'));if(rows.length<2){card.append(el('p','note','比較には2つ以上の確定記録が必要です。'));}else{const a=rows.at(-2),b=rows.at(-1);card.append(el('p','small muted',`${monthLabel(a.month)} → ${monthLabel(b.month)}`));const diffs=CATEGORIES.map(c=>({c,delta:b.sums[c.key]-a.sums[c.key]}));const scale=Math.max(1,...diffs.map(d=>Math.abs(d.delta)));diffs.forEach(d=>{const r=el('div','bar-row');r.append(el('span','',d.c.label));const track=el('div','bar-track');const bar=el('div','bar-fill');bar.style.width=`${Math.abs(d.delta)/scale*49}%`;bar.style.background=d.c.color;bar.style.left=d.delta>=0?'50%':`${50-Math.abs(d.delta)/scale*49}%`;track.append(bar);r.append(track,el('span','bar-amount',`${d.delta>=0?'+':''}${shortMoney(d.delta)}`));card.append(r);});addField(card,'総資産の増減',`${b.total-a.total>=0?'+':''}${money(b.total-a.total)}`);card.append(el('p','note','投資残高の増減には入出金が含まれます。運用利益を示すものではありません。'));}}
  root.append(card);
  if(type==='wealth'||type==='mix'){const latest=rows.at(-1);const detail=el('section','card');detail.append(el('h2','section-subhead',`${monthLabel(latest.month)}の内訳`));CATEGORIES.forEach(c=>addField(detail,c.label,money(latest.sums[c.key])));root.append(detail);}
}
function renderAccounts(){const list=$('account-list');list.replaceChildren();if(!state.accounts.length){list.append(el('p','help','口座はまだ登録されていません。'));return;}state.accounts.forEach(a=>{const r=el('div','account-manage-row');const info=el('div');append(info,el('strong','',a.name),el('p','',`${catInfo(a.category).label} · ${a.start||'開始指定なし'} ～ ${a.end||'終了指定なし'}`));const controls=el('div','manage-controls');const btn=el('button','','編集');btn.type='button';btn.onclick=()=>{$('account-id').value=a.id;$('account-name').value=a.name;$('account-category').value=a.category;$('account-start').value=a.start||'';$('account-end').value=a.end||'';$('account-name').focus();};const del=el('button','','削除');del.type='button';del.setAttribute('aria-label',`${a.name}の完全削除`);del.onclick=()=>{const hasHistory=Object.values(state.records).some(entries=>entries[a.id]);if(!confirm(`「${a.name}」を削除します。${hasHistory?'この口座の過去の残高履歴も完全に消去されます。':'この口座の登録が消去されます。'}よろしいですか？`))return;if(hasHistory&&!confirm('過去の履歴を含めて削除します。取り消せません。実行しますか？'))return;state.accounts=state.accounts.filter(item=>item.id!==a.id);for(const entries of Object.values(state.records))delete entries[a.id];persist();resetAccountForm();renderAccounts();renderView();notify('口座を削除しました');};append(controls,btn,del);append(r,info,controls);list.append(r);});}
function resetAccountForm(){$('account-form').reset();$('account-id').value='';}
function newId(){return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;}
function saveAccount(event){event.preventDefault();const id=$('account-id').value;const name=$('account-name').value.trim(),category=$('account-category').value,start=$('account-start').value,end=$('account-end').value;if(!name||name.length>80||!catInfo(category)){notify('口座名と分類を確認してください。');return;}if(start&&!isMonth(start)||end&&!isMonth(end)||start&&end&&end<start){notify('記録開始月・終了月を確認してください。');return;}if(id){const a=state.accounts.find(a=>a.id===id);if(!a)return;if(a.category!==category&&Object.values(state.records).some(entries=>entries[id])&&!confirm('分類を変更すると、過去の記録も新しい分類として集計されます。変更しますか？'))return;Object.assign(a,{name,category,start,end});}else{state.accounts.push({id:newId(),name,category,start,end});}persist();resetAccountForm();renderAccounts();renderView();notify('口座を保存しました');}
function validateImport(raw){if(!raw || raw.version!==1 || !Array.isArray(raw.accounts)||!raw.records||typeof raw.records!=='object'||Array.isArray(raw.records))throw Error('対応していないJSON形式です。');if(raw.accounts.length>500)throw Error('口座数が多すぎます。');const seen=new Set();const accounts=raw.accounts.map(a=>{if(typeof a.id!=='string'||!a.id||seen.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>80||!catInfo(a.category))throw Error('口座データが不正です。');seen.add(a.id);const start=a.start||'',end=a.end||'';if(start&&!isMonth(start)||end&&!isMonth(end)||start&&end&&end<start)throw Error('口座の期間が不正です。');return {id:a.id,name:a.name.trim(),category:a.category,start,end};});const records={};const months=Object.entries(raw.records);if(months.length>600)throw Error('記録月数が多すぎます。');for(const [m,entries] of months){if(!isMonth(m)||!entries||typeof entries!=='object'||Array.isArray(entries))throw Error('年月または記録データが不正です。');records[m]={};for(const [id,e] of Object.entries(entries)){if(!seen.has(id))continue;if(!e||typeof e!=='object')throw Error('残高情報が不正です。');if(e.status==='recorded'){if(!Number.isSafeInteger(e.amount)||e.amount<0)throw Error('残高は0以上の整数である必要があります。');records[m][id]={status:'recorded',amount:e.amount};}else if(e.status==='missing'){records[m][id]={status:'missing'};}else if(e.status==='draft'&&typeof e.text==='string'&&e.text.length<=32){records[m][id]={status:'draft',text:e.text};}else throw Error('残高の状態が不正です。');}}return {version:1,accounts,records,updatedAt:typeof raw.updatedAt==='string'?raw.updatedAt:null};}
async function exportJSON(){await persistQueue.catch(()=>{});const data=JSON.stringify(state,null,2);const blob=new Blob([data],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='aspria.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);notify('JSONを保存しました。Google Driveへの移動は手動で行ってください。');}
async function importJSON(file){if(!file)return;try{if(file.size>15*1024*1024)throw Error('ファイルが大きすぎます。');const imported=validateImport(JSON.parse(await file.text()));if(!confirm(`「${file.name}」を読み込みます。端末内の現在データ（${state.accounts.length}口座）を全て置き換えます。よろしいですか？`))return;state=imported;await persist();resetAccountForm();renderAccounts();renderView();notify('JSONを読み込みました');$('settings-dialog').close();}catch(e){notify(`読み込みに失敗しました：${e.message}`);}finally{$('import-file').value='';}}
function loadDemo(){if(state.accounts.length||Object.keys(state.records).length){if(!confirm('現在のすべてのデータを架空のサンプルに置き換えます。よろしいですか？'))return;}const samples=[['A銀行 普通預金','bank',2800000],['B銀行 定期預金','bank',650000],['一般財形','savings',1550000],['C証券','investment',3300000],['自動車','physical',1200000]];const accounts=samples.map(([name,category])=>({id:newId(),name,category,start:'2025-01',end:''}));const records={};const end=offsetMonth(localMonth(),-1);for(let i=11;i>=0;i--){const month=offsetMonth(end,-i);records[month]={};accounts.forEach((a,j)=>{const base=samples[j][2];const step=11-i;const amount=Math.max(0,Math.round(base+step*[11000,900,6000,40000,-17000][j]+(j===3?Math.sin(step*1.2)*120000:0)));records[month][a.id]={status:'recorded',amount};});}state={version:1,accounts,records,updatedAt:null};selectedMonth=end;$('record-month').value=selectedMonth;persist();renderView();renderAccounts();if($('settings-dialog').open)$('settings-dialog').close();notify('架空のサンプルデータを設定しました');}
function clearAll(){if(!confirm('すべての口座と残高の記録を削除します。JSONバックアップはありますか？'))return;if(!confirm('本当に初期化しますか？ この操作は取り消せません。'))return;state=DEFAULT_STATE();selectedMonth=localMonth();persist();resetAccountForm();renderAccounts();renderView();$('settings-dialog').close();notify('端末内データを初期化しました');}
/* v0.2: Excel import UI and safe merge/replace. User-picked files are processed in memory. */
let excelWorkbook = null;
function excelPreviewMessage(message,warning=false){
  const node=$('excel-month-result');node.textContent=message;node.classList.toggle('excel-warning',warning);
}
function getExcelMonths(){
  if(!excelWorkbook)throw Error('Excelを先に選択してください。');
  return AspriaExcel.resolveMonths(excelWorkbook.headers,$('excel-first-month').value);
}
function guessCategory(name){
  if(/財形/.test(name))return 'savings';
  if(/証券|投信|投資|株式|ETF|NISA/i.test(name))return 'investment';
  if(/車|自動車|不動産|有形/.test(name))return 'physical';
  if(/銀行|預金|信用金庫|ゆうちょ/.test(name))return 'bank';
  return '';
}
function excelMappingRows(){return [...document.querySelectorAll('#excel-account-mapping .excel-map')];}
function createOption(value,label){const opt=el('option','',label);opt.value=value;return opt;}
function showExcelMapping(){
  const root=$('excel-account-mapping');
  const prior=new Map([...root.querySelectorAll('.excel-map')].map(holder=>[
    Number(holder.dataset.index),{
      name:holder.querySelector('.excel-map-name').value,
      category:holder.querySelector('.excel-map-category').value,
      target:holder.querySelector('.excel-map-target').value
    }
  ]));
  root.replaceChildren();
  if(!excelWorkbook)return;
  const mode=$('excel-mode').value;
  for(let i=0;i<excelWorkbook.rows.length;i++){
    const source=excelWorkbook.rows[i], priorValue=prior.get(i);const holder=el('div','excel-map');holder.dataset.index=String(i);
    holder.append(el('div','excel-map-heading',`Excel ${source.excelRow}行目：${source.name}`));
    const nameLabel=el('label','','登録名');nameLabel.classList.add('wide');
    const nameInput=el('input');nameInput.value=priorValue?.name||source.name;nameInput.maxLength=80;nameInput.className='excel-map-name';nameLabel.append(nameInput);
    const targetLabel=el('label','','取り込み先');targetLabel.classList.add('wide');
    const target=el('select','excel-map-target');target.append(createOption('new','新しい口座・資産として登録'));
    if(mode==='merge')state.accounts.forEach(a=>target.append(createOption(a.id,`${a.name}（${catInfo(a.category).label}）`)));
    const auto=mode==='merge'?state.accounts.find(a=>a.name===source.name):null;
    if(auto)target.value=auto.id;
    if(priorValue?.target && [...target.options].some(o=>o.value===priorValue.target))target.value=priorValue.target;
    targetLabel.append(target);
    const catLabel=el('label','','分類');catLabel.classList.add('wide');catLabel.classList.add('excel-map-cat-wrap');
    const category=el('select','excel-map-category');category.append(createOption('','-- 分類を選んでください --'));
    CATEGORIES.forEach(c=>category.append(createOption(c.key,c.label)));
    category.value=priorValue?.category||guessCategory(source.name);catLabel.append(category);
    const refresh=()=>{
      const isNew=target.value==='new';
      catLabel.classList.toggle('hidden',!isNew);
      nameInput.disabled=!isNew;
    };
    target.addEventListener('change',refresh);refresh();
    holder.append(nameLabel,targetLabel,catLabel);root.append(holder);
  }
}
function showExcelPreviewMonths(){
  try{
    const months=getExcelMonths(), skipped=(monthIndex(months.at(-1))-monthIndex(months[0])+1)-months.length;
    excelPreviewMessage(`${monthLabel(months[0])} ～ ${monthLabel(months.at(-1))} ／ ${months.length}列の記録${skipped?`（途中に未記録の月が${skipped}か月あります）`:''}`);
    $('excel-apply').disabled=false;
  }catch(e){excelPreviewMessage(e.message,true);$('excel-apply').disabled=true;}
}
function excelStatus(message, kind='info'){
  const node=$('excel-status');
  node.textContent=message;
  node.hidden=!message;
  node.className='excel-status'+(kind==='error'?' excel-error':kind==='success'?' excel-success':'');
}
async function onExcelSelected(file){
  if(!file){excelStatus('ファイルが選択されていません。Excelファイルをもう一度選んでください。','error');return;}
  excelWorkbook=null;
  $('excel-preview').hidden=true;
  excelStatus(`「${file.name}」を読み込んでいます…`);
  try{
    if(!window.JSZip)throw Error('jszip.min.js が読み込まれていません。GitHubに jszip.min.js がアップロードされているか確認し、アプリを再読み込みしてください。');
    if(!window.AspriaExcel)throw Error('excel-import.js が読み込まれていません。GitHubに excel-import.js がアップロードされているか確認し、アプリを再読み込みしてください。');
    const book=await AspriaExcel.readWorkbook(file);excelWorkbook=book;
    $('excel-account-mapping').replaceChildren();
    $('excel-preview').hidden=false;
    const summary=$('excel-file-summary');
    summary.textContent=`${book.fileName}／${book.sheetName}：${book.rows.length}口座、${book.headers.length}か月、残高あり ${book.amounts}件・空欄 ${book.missing}件。`;
    summary.classList.add('excel-summary');
    $('excel-first-month').value='2024-12';
    $('excel-mode').value='merge';
    showExcelMapping();showExcelPreviewMonths();
    $('excel-import-note').textContent=!book.amounts
      ?'このExcelは金額がすべて空欄です。口座と年月のみ取り込めますが、グラフのデータにはなりません。'
      :'空欄は未記録として扱います。口座未開設などの期間は、取り込み後に口座設定の「記録開始月」で調整できます。';
    $('excel-import-note').classList.toggle('excel-warning',!book.amounts);
    excelStatus(`読み込み成功：${book.rows.length}口座・${book.headers.length}か月を検出しました。下の分類設定を確認してください。`,'success');
  }catch(e){
    console.error('Aspria Excel import error:',e);
    excelWorkbook=null;
    $('excel-preview').hidden=true;
    excelStatus(`読み込みに失敗しました（${file.name}）：${e?.message||String(e)} ファイルがExcel形式（.xlsx）であること、GitHubに必要なファイルがそろっていることをご確認ください。`,'error');
  }finally{$('excel-file').value='';}
}
function planExcelImport(){
  const months=getExcelMonths(), mode=$('excel-mode').value;
  const next=mode==='replace'?DEFAULT_STATE():structuredClone(state);
  const mappings=[];const ids=new Set();const newNames=new Set();
  let newAccounts=0;
  for(const holder of excelMappingRows()){
    const i=Number(holder.dataset.index), source=excelWorkbook.rows[i];
    const target=holder.querySelector('.excel-map-target').value;
    let a;
    if(target==='new'){
      const name=holder.querySelector('.excel-map-name').value.trim();
      const cat=holder.querySelector('.excel-map-category').value;
      if(!name||name.length>80)throw Error(`${source.excelRow}行目の口座名を確認してください。`);
      if(!catInfo(cat))throw Error(`「${name}」の分類を選んでください。`);
      if(newNames.has(name)||next.accounts.some(ex=>ex.name===name))throw Error(`「${name}」が重複しています。既存口座を選ぶか名称を変更してください。`);
      newNames.add(name);
      a={id:newId(),name,category:cat,start:months[0],end:''};
      next.accounts.push(a);newAccounts++;
    }else{
      a=next.accounts.find(ex=>ex.id===target);
      if(!a)throw Error('選択された取り込み先がありません。');
    }
    if(ids.has(a.id))throw Error('複数のExcel行を同じ口座に紐づけています。取り込み先を分けてください。');
    ids.add(a.id);mappings.push({source,account:a});
  }
  let added=0,skipped=0,filled=0;
  for(let j=0;j<months.length;j++){
    const month=months[j];if(!next.records[month])next.records[month]={};
    for(const {source,account} of mappings){
      const value=source.values[j],old=next.records[month][account.id];
      if(mode==='merge' && old){
        if(value===null)continue;
        if(old.status==='recorded'){skipped++;continue;}
        if(old.status==='draft'){skipped++;continue;}
        if(old.status==='missing'){next.records[month][account.id]={status:'recorded',amount:value};filled++;continue;}
      }
      if(value===null){
        if(!old)next.records[month][account.id]={status:'missing'};
      }else{
        next.records[month][account.id]={status:'recorded',amount:value};added++;
      }
    }
  }
  const checked=validateImport(next);
  return {next:checked,months,newAccounts,added,skipped,filled,mode};
}
function downloadLocalBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`aspria_before_excel_${new Date().toISOString().slice(0,10)}.json`;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),20000);
}
async function applyExcelImport(){
  try{
    const plan=planExcelImport(), accountTotal=plan.next.accounts.length;
    const overview=`${plan.months.length}か月／${excelWorkbook.rows.length}口座（新規 ${plan.newAccounts}）\n残高：追加 ${plan.added}件、未記録の補完 ${plan.filled}件、既存優先のスキップ ${plan.skipped}件。`;
    const hasData=state.accounts.length>0||Object.keys(state.records).length>0;
    const modeNotice=plan.mode==='replace'?'現在の口座・残高はすべて置き換わります。':'既存データを保持し、追加・補完します。';
    if(!confirm(`${overview}\n${modeNotice}\n\nこの内容で取り込みますか？`))return;
    if(hasData){
      if(!confirm('取り込み前に現在のJSONバックアップをダウンロードします。保存後に続行してください。よろしいですか？'))return;
      downloadLocalBackup();
      if(!confirm('バックアップJSONが端末へ保存されたことを確認しましたか？ 未確認の場合はキャンセルして保存先を確認してください。'))return;
    }
    $('excel-apply').disabled=true;
    await persistQueue.catch(()=>{});
    plan.next.updatedAt=new Date().toISOString();
    await writeLocal(structuredClone(plan.next)); // One IndexedDB transaction; no partial state replacement.
    state=plan.next;
    selectedMonth=plan.months.at(-1);$('record-month').value=selectedMonth;
    excelWorkbook=null;$('excel-preview').hidden=true;
    resetAccountForm();renderAccounts();renderView();
    $('settings-dialog').close();
    notify(`Excel取り込み完了：${accountTotal}口座、${plan.added+plan.filled}件の残高を反映しました。`);
  }catch(e){notify('取り込みできません：'+e.message);}
  finally{$('excel-apply').disabled=false;}
}
function setupExcelImport(){
  $('excel-file').addEventListener('change',e=>onExcelSelected(e.target.files?.[0]));
  $('excel-first-month').addEventListener('change',showExcelPreviewMonths);
  $('excel-mode').addEventListener('change',showExcelMapping);
  $('excel-apply').addEventListener('click',applyExcelImport);
  $('excel-cancel').addEventListener('click',()=>{excelWorkbook=null;$('excel-preview').hidden=true;$('excel-file').value='';excelStatus('');});
}

async function start(){try{const stored=await loadLocal();if(stored)state=validateImport(stored);$('save-state').textContent='✓ この端末に保存されています';}catch(err){$('save-state').textContent='⚠ データの保存領域を読み込めませんでした';notify('ブラウザの保存領域が使えません。通常モードで開いてください。');}
  $('record-month').value=selectedMonth;$('record-month').addEventListener('change',e=>{if(isMonth(e.target.value)){selectedMonth=e.target.value;renderInput();}});
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('chart-type').addEventListener('change',renderAnalysis);$('chart-range').addEventListener('change',renderAnalysis);
  $('open-settings').addEventListener('click',openSettings);$('close-settings').addEventListener('click',()=>$('settings-dialog').close());
  $('settings-dialog').addEventListener('click',e=>{if(e.target===$('settings-dialog'))$('settings-dialog').close();});
  $('account-form').addEventListener('submit',saveAccount);$('cancel-account').addEventListener('click',resetAccountForm);
  $('export-json').addEventListener('click',exportJSON);$('import-json').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',e=>importJSON(e.target.files?.[0]));
  $('load-demo').addEventListener('click',loadDemo);$('clear-all').addEventListener('click',clearAll);
  setupExcelImport();
  renderView();
  if('serviceWorker'in navigator && location.protocol==='https:'){navigator.serviceWorker.register('./sw.js').catch(()=>{});}
}
start();
