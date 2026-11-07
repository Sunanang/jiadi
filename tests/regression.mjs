import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browser} from './browser.mjs';
const app=await browser(process.env.JIADI_HTML?resolve(process.env.JIADI_HTML):undefined,'2026-11-05T16:30:00Z');
const ev=app.evaluate;
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
const account=(id,amount,extra={})=>({id,name:id,cat:'现金',member:'我',amount,prev:amount,date:'2026-10-05',opened:'2026-01-01',inNet:true,remind:true,...extra});
const fixture=()=>({v:1,accounts:[account('cash',100,{prev:80}),account('debt',20,{cat:'负债',isDebt:true,prev:30}),account('excluded',9999,{inNet:false}),account('closed',8888,{closed:true,inNet:false})],members:[{name:'我',color:'#2F4B6E'}],archived:[],snapshots:[{month:'2026-09',A:60,L:30},{month:'2026-10',A:100,L:20}]});
async function seed(data=fixture()){
  assert.equal(await ev(`S.privacy=false; closeDrawer(); $('#modalMask').classList.remove('on'); applyImport(${JSON.stringify(data)})`),true);
  await ev("PREF.dupCheckin='保留多条'; PREF.range='全部'; PREF.multiPoint='取当月最后一个'; clearCheckin(); show('home')");
}
try{
await test('fresh installations start empty and use the local date near midnight',async()=>{assert.equal(await ev('ACCOUNTS.length'),0);assert.deepEqual(await ev('getSnapshots()'),[]);assert.equal(await ev('todayStr()'),'2026-11-06');});
await test('all seven routes render without exceptions',async()=>{for(const route of ['home','trend','people','detail','checkin','settings','report']) assert.equal(await ev(`show('${route}'); S.view`),route);assert.deepEqual(app.errors,[]);});
await test('JSON backup round-trip preserves snapshots, members and account histories',async()=>{
  await seed(); const data=await ev(`(()=>{let out;const old=downloadBlob;downloadBlob=b=>out=b;exportJSON();downloadBlob=old;return out.text().then(JSON.parse);})()`);
  assert.equal(data.snapshots.length,2);await seed({v:1,accounts:[],members:[],archived:[],snapshots:[]});
  assert.equal(await ev(`applyImport(${JSON.stringify(data)})`),true);assert.equal(await ev('getSnapshots().length'),2);
});
await test('empty backups remain empty after refresh without resurrecting demo history',async()=>{await seed({v:1,accounts:[],members:[],archived:[],snapshots:[]});await app.reload();assert.deepEqual(await ev('dataState().snapshots'),[]);assert.equal(await ev('ACCOUNTS.length'),0);});
await test('first account creates a valid member and remains valid on reload',async()=>{
  await ev("accountFormDrawer(null);$('#f_name').value='新账户';$('#f_amount').value='0';$('#f_save').click()");
  assert.equal(await ev('ACCOUNTS.length'),1);assert.equal(await ev('MEMBERS[0].name===ACCOUNTS[0].member'),true);await app.reload();assert.equal(await ev('ACCOUNTS.length'),1);
});
await test('malformed imports rejected atomically',async()=>{
  await seed();const before=await ev('JSON.stringify(dataState())');
  const invalid=[{accounts:[null]}, {accounts:[{}]}, {accounts:[account('x','100')]},{accounts:[account('x',-1)]},{accounts:[account('x',100),account('x',200)]},{accounts:[account('x',1,{date:'2026-02-30'})]},{accounts:[account('x',1,{history:[{date:null,amount:1}]})]},{accounts:[account('x',1,{isDebt:true})]},{accounts:[account('x',1)],members:[{name:'other'}]},{accounts:[],snapshots:[{month:'2026-13',A:1,L:0}]},{accounts:[],members:[{name:'a',color:'red;position:fixed'}]},{accounts:[],members:[{name:'a'},{name:'a'}]},{accounts:[],archived:[null]},{v:99,accounts:[]},{accounts:[],snapshots:[{month:'2026-10',A:1,L:0,categories:{现金:0.99,存款:0,投资:0,固定资产:0}}]}];
  invalid.push({accounts:[],snapshots:[{month:'2026-10',A:100.01,L:0,categories:{现金:100,存款:0,投资:0,固定资产:0}}]}, {accounts:[account('x',1,{closedInNet:'false'})]});
  for(const data of invalid){assert.equal(await ev(`applyImport(${JSON.stringify(data)})`),false);assert.equal(await ev('JSON.stringify(dataState())'),before);}
});
await test('user names, notes and IDs render as literal text in all views and drawers',async()=>{
  const name='<img src=x onerror="window.injected=1">';const member='家人" <svg onload="window.injected=2">';const id='x" onclick="window.injected=3';
  const data={accounts:[account(id,100,{name,member,note:'<img src=x onerror="window.injected=4">'})],members:[{name:member}]};await seed(data);
  for(const route of ['home','people','detail','report']) await ev(`show('${route}')`);
  await ev(`accountDrawer(${JSON.stringify(id)})`);assert.equal(await ev('document.querySelector("#drawerTitle").textContent'),name);
  await ev(`accountFormDrawer(${JSON.stringify(id)})`);assert.equal(await ev("$('#f_name').value"),name);
  await new Promise(r=>setTimeout(r,80));assert.equal(await ev('window.injected||0'),0);assert.equal(await ev('document.querySelectorAll(".view img,.drawer img,.view svg[onload]").length'),0);
});
await test('strict money input accepts zero/cents and rejects invalid, negative or infinite values',async()=>{
  await seed();assert.deepEqual(await ev("['0','1,234.56','-1','1e3','abc','1.234','9'.repeat(400)].map(parseAmount)"),[0,1234.56,null,null,null,null,null]);
  await ev("accountDrawer('cash');$('#quickVal').value='0';$('#quickSave').click()");assert.equal(await ev("ACCOUNTS.find(a=>a.id==='cash').amount"),0);
});
await test('checkin carries CURRENT balances, excludes closed accounts, respects net-worth flags',async()=>{
  await seed();await ev("show('checkin');$('#markAll').click()");assert.equal(await ev('S.checkin.values.cash'),100);assert.equal(await ev('checkinTotal()'),80);assert.equal(await ev("document.querySelector('#v-checkin input[data-id=closed]')===null"),true);
  await ev("document.querySelector('#v-checkin input[data-id=cash]').value='wrong';document.querySelector('#v-checkin input[data-id=cash]').dispatchEvent(new Event('input'))");assert.equal(await ev("$('#nextStep').disabled"),true);
});
await test('unchanged checkin refreshes dates and history; real undo restores full data and saved storage',async()=>{
  await seed();const before=await ev('JSON.stringify(dataState())');
  await ev("show('checkin');$('#markAll').click();$('#nextStep').click();$('#submitStep').click()");
  assert.equal(await ev('S.checkin.step'),3);assert.equal(await ev("ACCOUNTS.find(a=>a.id==='cash').date===todayStr()"),true);assert.equal(await ev("ACCOUNTS.find(a=>a.id==='cash').prev"),100);
  await ev('undoCheckin()');assert.equal(await ev('JSON.stringify(dataState())'),before);await app.reload();assert.equal(await ev('JSON.stringify(dataState())'),before);
});
await test('changed checkin preview matches saved result and updates debt with correct sign',async()=>{
  await seed();await ev("S.checkin.values={cash:125,debt:10};S.checkin.jumpsOk=true;show('checkin');$('#nextStep').click();$('#submitStep').click()");
  assert.equal(await ev('TOT().N'),115);assert.equal(await ev('S.checkin.result.total'),115);assert.equal(await ev('byMember()[0].chg'),35);
  await ev("(async()=>{accountDrawer('cash');$('#quickVal').value='130';await $('#quickSave').onclick();await undoCheckin();})()");assert.equal(await ev('TOT().N'),120);assert.match(await ev("$('#toast').textContent"),/无法安全撤销/);
});
await test('storage write failure rolls back account values and never reports success',async()=>{
  await seed();const before=await ev('JSON.stringify(dataState())');
  await ev("window.originalSet=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new Error('quota test')};accountDrawer('cash');$('#quickVal').value='200';$('#quickSave').click()");
  assert.equal(await ev('JSON.stringify(dataState())'),before);assert.match(await ev("$('#toast').textContent"),/保存失败/);await ev('Storage.prototype.setItem=window.originalSet');
});
await test('stale second-tab writes cannot overwrite newer persisted data',async()=>{
  await seed();await ev("localStorage.setItem(DB_KEY,JSON.stringify({...dataState(),savedAt:'external'}));accountDrawer('cash');$('#quickVal').value='300';$('#quickSave').click()");assert.equal(await ev("ACCOUNTS.find(a=>a.id==='cash').amount"),100);assert.match(await ev("$('#toast').textContent"),/其他页面修改/);await app.reload();
});
await test('close/reopen preserves history, excludes ordinary list and checkin, restores inclusion flag',async()=>{
  await seed();await ev("accountDrawer('cash');$('#drawerFoot [data-act=close]').click();$('#modalOk').click();show('detail')");
  assert.equal(await ev("document.querySelector('#v-detail .table-scroll [data-acct=cash]')===null"),true);assert.equal(await ev('TOT().N'),-20);
  await ev("$('#closedFold').click();accountDrawer('cash');$('#drawerFoot [data-act=reopen]').click()");assert.equal(await ev('TOT().N'),80);
});
await test('member creation really persists and debt decreases increase member net change',async()=>{
  await seed();await ev("show('people');$('#addMember').click();$('#modalInput').value='新成员';$('#modalOk').click()");assert.equal(await ev("MEMBERS.some(m=>m.name==='新成员')"),true);assert.equal(await ev('byMember()[0].chg'),30);await app.reload();assert.equal(await ev("MEMBERS.some(m=>m.name==='新成员')"),true);
});
await test('asset-only filter, table columns, and zero-asset/negative-net states stay consistent',async()=>{
  await seed();await ev("PREF.detailCat='仅资产';applyPrefs();show('detail')");assert.equal(await ev("ACCOUNTS.filter(detailFilters()).some(a=>a.isDebt||a.closed)"),false);
  for(const columns of ['基础 7 列','含到期日','含备注','全部列']){await ev(`PREF.columns='${columns}';show('detail')`);assert.equal(await ev("(()=>{const root=$('#v-detail');return root.querySelector('.lrow.head').children.length===root.querySelector('.table-scroll [data-acct]').children.length})()"),true);}
  await seed({accounts:[account('debt',50,{cat:'负债',isDebt:true})],members:[{name:'我'}]});for(const route of ['home','people','detail','trend','report']){await ev(`show('${route}')`);assert.doesNotMatch(await ev("$('.view.is-active').textContent"),/NaN|Infinity/);}
});
await test('natural quarters/years, sparse monthly ranges and imported snapshot labels use real dates',async()=>{
  const data={accounts:[account('cash',200)],members:[{name:'我'}],snapshots:[{month:'2024-12',A:10,L:0},{month:'2025-01',A:20,L:0},{month:'2025-03',A:30,L:0},{month:'2025-04',A:40,L:0},{month:'2025-12',A:50,L:0},{month:'2026-01',A:60,L:0},{month:'2026-10',A:70,L:0}]};await seed(data);
  assert.deepEqual(await ev("agg('quarter').labels"),['2024 Q4','2025 Q1','2025 Q2','2025 Q4','2026 Q1','2026 Q4']);
  assert.deepEqual(await ev("agg('year').labels"),['2024 年','2025 年','2026 年']);
  await ev("PREF.range='近 6 月'");assert.equal(await ev("agg('month').labels[0]"),'2026-10');
  await ev("PREF.range='全部';show('trend')");assert.equal(await ev("$('#fromSel').options[0].textContent"),'2024-12');assert.equal(await ev("$('#v-trend [data-month]').dataset.month"),'2024-12');
});
await test('same-month selection is chronological and honors first/average/last policies',async()=>{
  await seed({accounts:[account('cash',200)],members:[{name:'我'}],snapshots:[{month:'2026-10',date:'2026-10-20',A:300,L:0},{month:'2026-10',date:'2026-10-01',A:100,L:0}]});
  for(const [policy,value] of [['取第一个',100],['取平均',200],['取当月最后一个',300]]){assert.equal(await ev(`PREF.multiPoint='${policy}';series().A[0]`),value);}
});
await test('privacy hover, chart redraw, navigation and exports do not expose amounts; unlock rerenders',async()=>{
  await seed();await ev("PREF.peopleMode='强制显示';show('home');setPin('abc1');lockOn();document.querySelector('#v-home [data-mi]').dispatchEvent(new MouseEvent('mouseenter'))");
  assert.doesNotMatch(await ev("$('#donutL').textContent"),/\d/);await ev("drawChart('homeChart','all','month','homeTip')");assert.doesNotMatch(await ev("$('#homeChart').textContent"),/\d/);
  assert.doesNotMatch(await ev("Array.from(document.querySelectorAll('#v-home .group-h .sub')).map(x=>x.textContent).join('')"),/\d/);
  assert.equal(await ev("document.querySelector('#v-home [title]')===null"),true);
  await ev("show('detail');exportJSON()");assert.equal(await ev('S.view'),'home');assert.match(await ev("$('#toast').textContent"),/遮挡中|请先解锁/);   // 0.4.7 起文案为「遮挡中，请先输入应用密码解除」
  await ev("askUnlock();$('#modalInput').value='abc1';$('#modalOk').click()");assert.equal(await ev('S.privacy'),false);assert.match(await ev("$('#v-home .eq-val').textContent"),/\d/);
});
await test('server ISO log times render as local minutes, legacy local strings pass through',async()=>{
  assert.equal(await ev("fmtLogTime('2026-11-07T03:18:10.627Z')"),'2026-11-07 11:18');
  assert.equal(await ev("fmtLogTime('2026-11-07 10:41')"),'2026-11-07 10:41');
  assert.equal(await ev("fmtLogTime('not-a-date')"),'not-a-date');
  assert.equal(await ev("fmtLogTime('')"),'');
});
await test('calendar reminders use local current date; stale link applies filter',async()=>{
  await seed();const result=await ev("(()=>{const a=ACCOUNTS[0];a.due=todayStr();a.date='2020-01-01';show('home');const days=dueSoon().find(x=>x.id===a.id).days;document.querySelector('[data-stale]').click();return {days,view:S.view,stale:S.detail.stale};})()");assert.deepEqual(result,{days:0,view:'detail',stale:true});
});
await test('wipe removes snapshots and data stays empty after refresh',async()=>{
  await seed();await ev("show('settings');$('#v-settings [data-act=wipe]').click();$('#modalInput').value='家底';$('#modalOk').click()");assert.deepEqual(await ev('getSnapshots()'),[]);await app.reload();assert.equal(await ev('ACCOUNTS.length'),0);assert.deepEqual(await ev('getSnapshots()'),[]);
});
await test('corrupt stored data fails visibly without overwriting the original',async()=>{
  await ev("localStorage.setItem(DB_KEY,'{bad json')");await app.reload();assert.equal(await ev('ACCOUNTS.length'),0);assert.match(await ev('storageError'),/读取本地账本失败/);assert.equal(await ev('localStorage.getItem(DB_KEY)'),'{bad json');
  await ev('localStorage.removeItem(DB_KEY)');await app.reload();
});
await test('corrupt storage rejects ordinary edits and only explicit replacement recovers it',async()=>{
  await ev("localStorage.setItem(DB_KEY,'{broken ledger')");await app.reload();
  await ev("accountFormDrawer(null);$('#f_name').value='不要覆盖';$('#f_save').click()");
  assert.equal(await ev('localStorage.getItem(DB_KEY)'),'{broken ledger');assert.equal(await ev('ACCOUNTS.length'),0);
  assert.match(await ev("$('#toast').textContent"),/原始数据|读取失败/);
  await seed();assert.equal(await ev('storageError'),'');await app.reload();assert.equal(await ev('ACCOUNTS.length'),4);
});
await test('prototype-like imported account IDs accept and persist checkin inputs',async()=>{
  await seed({accounts:['__proto__','constructor','hasOwnProperty'].map(id=>account(id,10)),members:[{name:'我'}]});
  await ev("show('checkin');for(const input of document.querySelectorAll('#v-checkin input[data-id]')){input.value='11';input.dispatchEvent(new Event('input'));}");
  assert.equal(await ev('checkinTotal()'),33);
  await ev("$('#nextStep').click();$('#submitStep').click()");assert.deepEqual(await ev('ACCOUNTS.map(a=>a.amount)'),[11,11,11]);
});
await test('cent amounts remain exact in totals, deltas, checkin previews and display',async()=>{
  await seed({accounts:[account('one',0.1,{prev:0}),account('two',0.2,{prev:0}),account('debt',0.3,{prev:0,cat:'负债',isDebt:true})],members:[{name:'我'}]});
  assert.deepEqual(await ev('TOT()'),{A:0.3,L:0.3,N:0});assert.equal(await ev('byMember()[0].chg'),0);assert.equal(await ev('delta().chg'),0);
  await ev("show('checkin');$('#nextStep').click()");assert.equal(await ev('checkinTotal()'),0);assert.equal(await ev('fmtY(1234.56)'),'1,234.56');
  await ev("$('#submitStep').click()");assert.equal(await ev('S.checkin.step'),3);
});
await test('valid aggregate snapshots can exceed the individual account amount limit',async()=>{
  await seed({accounts:[account('large1',1e12),account('large2',1e12)],members:[{name:'我'}]});
  await ev("show('checkin');$('#nextStep').click();$('#submitStep').click()");
  assert.equal(await ev('S.checkin.step'),3);assert.equal(await ev('getSnapshots().at(-1).A'),2e12);
  await app.reload();assert.equal(await ev('getSnapshots().at(-1).A'),2e12);
});
await test('malformed thousands separators and fractional cents are rejected',async()=>{
  assert.deepEqual(await ev("['1,234.56','12,345,678','1,23','1,,000',',12','12,','1.2,3'].map(parseAmount)"),[1234.56,12345678,null,null,null,null,null]);
  await seed();const before=await ev('JSON.stringify(dataState())');
  assert.equal(await ev(`applyImport(${JSON.stringify({accounts:[account('fraction',1.00001)],members:[{name:'我'}]})})`),false);
  assert.equal(await ev('JSON.stringify(dataState())'),before);
});
await test('closed account inclusion edits survive reopening',async()=>{
  await seed({accounts:[account('closed',100,{closed:true,inNet:false,closedInNet:false})],members:[{name:'我'}]});
  await ev("accountFormDrawer('closed');$('#f_innet').click();$('#f_save').click();accountDrawer('closed');$('#drawerFoot [data-act=reopen]').click()");
  assert.equal(await ev('TOT().N'),100);
});
await test('PIN write failure preserves the previous persisted password and reports failure',async()=>{
  await seed();await ev("setPin('old1');window.originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('vault quota')}");
  try{assert.equal(await ev("setPin('new2')"),false);assert.equal(await ev("verifyPin('old1')"),true);assert.equal(await ev("verifyPin('new2')"),false);}finally{await ev('Storage.prototype.setItem=window.originalSet');}
  await app.reload();assert.equal(await ev("verifyPin('old1')"),true);
});
await test('empty member names render literally and never create markup',async()=>{
  const name='<b data-injected="yes">成员</b>';
  await seed({accounts:[account('cash',1)],members:[{name:'我'},{name}]});await ev(`memberDrawer(${JSON.stringify(name)})`);
  assert.equal(await ev("$('#drawerBody [data-injected]')===null"),true);assert.match(await ev("$('#drawerBody').textContent"),/data-injected/);
});
await test('cent-precision balances are displayed and summed without currency drift',async()=>{
  await seed({accounts:[account('a',0.1),account('b',0.2),account('d',0.2,{isDebt:true,cat:'负债'})],members:[{name:'我'}]});
  assert.equal(await ev('TOT().A'),0.3);assert.equal(await ev('TOT().N'),0.1);assert.equal(await ev('checkinTotal()'),0.1);assert.equal(await ev('fmtY(1234.56)'),'1,234.56');
  await ev("S.checkin.values={a:0.15};show('checkin');$('#nextStep').click();if($('#jumpOk'))$('#jumpOk').click();$('#submitStep').click()");assert.equal(await ev('TOT().N'),0.15);
});
await test('JSON file input uses FileReader, asks before replacement, and accepts an empty backup',async()=>{
  await seed();const data={v:1,accounts:[],members:[],archived:[],snapshots:[]};
  await ev(`window.fileClick=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(data))}],'backup.json',{type:'application/json'}));this.files=dt.files;this.onchange();}else window.fileClick.call(this)};importJSON();HTMLInputElement.prototype.click=window.fileClick;`);
  for(let i=0;i<30 && !await ev("$('#modalMask').classList.contains('on')");i++)await new Promise(r=>setTimeout(r,20));
  assert.equal(await ev('ACCOUNTS.length'),4);assert.equal(await ev("$('#modalMask').classList.contains('on')"),true);
  await ev("$('#modalOk').click()");assert.equal(await ev('ACCOUNTS.length'),0);assert.deepEqual(await ev('getSnapshots()'),[]);
});
await test('duplicate checkin forbid/overwrite/append policies persist the expected snapshot counts',async()=>{
  for(const [policy,expected] of [['禁止',1],['覆盖并提示',1],['保留多条',2]]){
    const data=fixture();data.snapshots=[{month:'2026-11',date:'2026-11-01',A:100,L:20}];await seed(data);
    await ev(`PREF.dupCheckin='${policy}';show('checkin');$('#nextStep').click();$('#submitStep').click()`);
    if(policy==='覆盖并提示'){assert.equal(await ev('S.checkin.step'),2);await ev("$('#modalOk').click()");}
    assert.equal(await ev('getSnapshots().length'),expected);assert.equal(await ev('S.checkin.step'),policy==='禁止'?2:3);
    if(policy!=='禁止')assert.equal(await ev('getSnapshots().at(-1).date'),'2026-11-06');
  }
});
await test('CSV neutralizes spreadsheet formulas and trend export contains the selected periods',async()=>{
  await seed({accounts:[account('cash',100,{name:'=1+1',note:'  =2+2'})],members:[{name:'我'}],snapshots:[{month:'2026-09',A:20,L:0},{month:'2026-10',A:40,L:0}]});
  const csv=await ev("(()=>{let out;const old=downloadBlob;downloadBlob=b=>out=b;exportCSV();downloadBlob=old;return out.text();})()");assert.match(csv,/'=1\+1/);assert.match(csv,/'  =2\+2/);
  await ev("S.trend.grain='month';S.trend.from=0;S.trend.to=1;show('trend')");
  const trend=await ev("(()=>{let out;const old=downloadBlob;downloadBlob=b=>out=b;$('#exportBtn').click();downloadBlob=old;return out.text();})()");assert.match(trend,/周期,总资产,总负债,净资产/);assert.match(trend,/2026-09,20,0,20/);assert.doesNotMatch(trend,/2026-11/);
});
await test('classification charts use real category snapshots and state when history is missing',async()=>{
  await seed();await ev("drawChart('homeChart','stack','month','homeTip')");assert.match(await ev("$('#homeChart').textContent"),/缺少历史分类快照/);
  const data=fixture();data.snapshots=[{month:'2026-10',A:100,L:20,categories:{现金:10,存款:20,投资:30,固定资产:40}}];await seed(data);await ev("drawChart('homeChart','stack','month','homeTip')");assert.equal(await ev("$('#homeChart').querySelectorAll('path').length"),5);assert.doesNotMatch(await ev("$('#homeChart').innerHTML"),/NaN|Infinity/);
});
await test('reminder months honor exact anniversaries and current date after midnight rollover',async()=>{
  await seed();assert.equal(await ev("PREF.staleMonths='2 个月';isStale({date:'2026-09-06'})"),false);assert.equal(await ev("isStale({date:'2026-09-05'})"),true);
  assert.equal(await ev("isStale({date:'2026-09-30'})"),false);
});
await test('settings confirmation cancellation never persists a calculation preference',async()=>{
  await seed();await ev("show('settings');window.oldStale=PREF.staleMonths;const sel=$('#v-settings [data-key=staleMonths]');sel.value='1 个月';sel.dispatchEvent(new Event('change'))");
  assert.equal(await ev('PREF.staleMonths===window.oldStale'),true);await ev("$('#modalCancel').click()");assert.equal(await ev('PREF.staleMonths===window.oldStale'),true);
  await ev("const sel2=$('#v-settings [data-key=staleMonths]');sel2.value='1 个月';sel2.dispatchEvent(new Event('change'));$('#modalOk').click()");assert.equal(await ev('PREF.staleMonths'),'1 个月');
});
await test('password hashing matches SHA-256 and failed password persistence cannot report success',async()=>{
  for(const value of ['','abc','中文']){
    const expected=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
    assert.equal(await ev(`sha256Hex(${JSON.stringify(value)})`),expected);
  }
  await seed();await ev("(async()=>{S.privacy=false;window.setBackup=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('denied')};try{askSetPin();$('#modalInput').value='abc2';await $('#modalOk').onclick();}finally{Storage.prototype.setItem=window.setBackup;}})()");assert.equal(await ev('S.privacy'),false);assert.match(await ev("$('#toast').textContent"),/密码保存失败/);
});
await test('first-run onboarding collects the app password, refuses invalid input and cannot be skipped',async()=>{
  await ev("localStorage.removeItem('jiadi.onboarded.v1'); window.JIADI_NEEDS_PASSWORD=true; window.__setup=[]; window.JIADI_SHARED={request:async(p,o)=>{window.__setup.push([p,o&&o.body]);}}; hideOnb(); showOnb()");
  assert.equal(await ev("$('#onbTitle').textContent"),'先设一个应用密码');
  assert.equal(await ev("$('#onbSkip').style.display"),'none','密码步不允许跳过');
  assert.equal(await ev("$('#onbNext').textContent"),'保存并继续');
  assert.equal(await ev("document.querySelector('#onbPw').type"),'password');
  await ev("$('#onbPw').value='abc';$('#onbPw2').value='abc';$('#onbNext').click()");
  await new Promise(r=>setTimeout(r,40));
  const diag=await ev("({err:($('#onbPwErr')||{}).textContent,title:(document.querySelector('#onbTitle')||{}).textContent,needs:String(window.JIADI_NEEDS_PASSWORD),step:onbStep,total:onbSteps().length})");
  assert.match(String(diag.err),/包含字母和数字/,'格式错误必须给出提示，实际：'+JSON.stringify(diag));
  assert.equal(await ev('window.__setup.length'),0,'非法密码不得提交');
  await ev("$('#onbPw').value='Ab12';$('#onbPw2').value='Ab34';$('#onbNext').click()");
  await new Promise(r=>setTimeout(r,40));
  assert.match(await ev("$('#onbPwErr').textContent"),/不一致/);
  assert.equal(await ev('window.__setup.length'),0);
  await ev("$('#onbPw').value='Ab12';$('#onbPw2').value='Ab12';$('#onbNext').click()");
  await new Promise(r=>setTimeout(r,60));
  assert.deepEqual(await ev('window.__setup'),[['/api/setup',{password:'Ab12'}]]);
  assert.equal(await ev('window.JIADI_NEEDS_PASSWORD'),false);
  assert.equal(await ev("$('#onbTitle').textContent"),'这是你的家底','设完之后进入引导正文');
  assert.equal(await ev("$('#onbSkip').style.display"),'','后续步骤恢复可跳过');
  assert.equal(await ev('needOnboarding()'),true,'引导还没完成');
  await ev("delete window.JIADI_SHARED; delete window.__setup; delete window.JIADI_NEEDS_PASSWORD; hideOnb(); markOnboarded()");
  assert.equal(await ev('needOnboarding()'),false);
});
await test('onboarding blocks the app behind it and the password step survives read errors',async()=>{
  await ev("localStorage.removeItem('jiadi.onboarded.v1'); window.JIADI_NEEDS_PASSWORD=true; window.JIADI_SHARED={request:async()=>({})}; hideOnb(); showOnb()");
  assert.equal(await ev("!!document.querySelector('.app').inert"),true,'引导打开时应用区必须 inert');
  assert.equal(await ev("(()=>{const b=document.querySelector('#v-home button');b.focus();return document.activeElement===b;})()"),false,'焦点不能跑到遮罩后面');
  assert.equal(await ev("$('#onbTitle').textContent"),'先设一个应用密码');
  await ev('hideOnb()');
  assert.equal(await ev("!!document.querySelector('.app').inert"),false,'关闭引导后要恢复可交互');
  await ev("storageError='模拟读盘失败'; hideOnb(); openOnb()");
  assert.equal(await ev("document.getElementById('onb').classList.contains('on')"),true,'读盘失败也不能把密码步吞掉');
  assert.equal(await ev("$('#onbTitle').textContent"),'先设一个应用密码');
  await ev("storageError=''; window.JIADI_NEEDS_PASSWORD=false; delete window.JIADI_SHARED; hideOnb(); markOnboarded()");
  assert.equal(await ev("!!document.querySelector('.app').inert"),false);
});
await test('onboarding password step stays reachable on short landscape viewports',async()=>{
  await ev("localStorage.removeItem('jiadi.onboarded.v1'); window.JIADI_NEEDS_PASSWORD=true; window.JIADI_SHARED={request:async()=>({}),markVaultReady(){}}; hideOnb(); showOnb()");
  await app.cdp.send('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true});
  await new Promise(r=>setTimeout(r,150));
  const box=await ev("(()=>{const o=document.querySelector('.onb');const b=document.querySelector('#onbNext').getBoundingClientRect();return {overflowY:getComputedStyle(o).overflowY,btnBottom:Math.round(b.bottom),vh:innerHeight,scrollable:o.scrollHeight>o.clientHeight};})()");
  assert.equal(box.overflowY,'auto','引导层必须可滚：否则横屏下按钮被裁且滚不到');
  assert.equal(box.scrollable,true);
  const reached=await ev("(()=>{const o=document.querySelector('.onb');o.scrollTop=o.scrollHeight;const b=document.querySelector('#onbNext').getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight;})()");
  assert.equal(reached,true,'滚到底后「保存并继续」必须落在视口内');
  await app.cdp.send('Emulation.clearDeviceMetricsOverride');
  await ev("delete window.JIADI_SHARED; delete window.JIADI_NEEDS_PASSWORD; hideOnb(); markOnboarded()");
});
await test('modal dismissal clears password input and underlying callback; closed drawers are inert',async()=>{
  await seed();await ev("askSetPin();$('#modalInput').value='secret1';document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");assert.equal(await ev("$('#modalInput').value"),'');assert.equal(await ev("$('#modalOk').onclick===null"),true);assert.equal(await ev("$('#modalMask').inert"),true);
  await ev("accountDrawer('cash');closeDrawer()");assert.equal(await ev("$('#drawer').inert"),true);
});
await test('archiving establishes the shared pool and shared management works when hidden from charts',async()=>{
  await seed();await ev("memberDrawer('我');$('#drawerFoot [data-act=archive]').click();$('#modalOk').click()");assert.equal(await ev("MEMBERS.some(m=>m.name==='共同'&&m.shared)"),true);assert.equal(await ev("ACCOUNTS.every(a=>a.member==='共同')"),true);
  await ev("PREF.sharedPool='隐藏';membersDrawer();$('#drawerBody [data-manage-member]').click()");assert.match(await ev("$('#drawerTitle').textContent"),/共同/);assert.equal(await ev("$('#drawerFoot [data-act=renameMember]')===null"),true);
});
if(app.navigate) await test('direct file opening shows migration gate and does not start a local shared ledger',async()=>{
  try{
    // Product file:// path must not use the local test bootstrap.
    await app.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.JIADI_TEST_LOCAL=false;'});
    await app.cdp.send('Page.navigate',{url:pathToFileURL(resolve('jiadi-ui.html')).href});
    for(let i=0;i<40;i++){
      if(await ev("!!document.getElementById('connectionGate')"))break;
      await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(await ev('location.protocol'),'file:');
    assert.equal(await ev("!!document.getElementById('connectionGate')"),true);
    assert.match(await ev("document.getElementById('connectionGate').textContent"),/共享服务|旧账本|请通过共享服务打开/);
    assert.equal(await ev("typeof S==='undefined'"),true);
  }finally{
    await app.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.JIADI_TEST_LOCAL=true;'});
    await app.navigate(app.origin+'/jiadi-ui.html');
  }
});
else console.log('SKIP direct-file navigation (requires the CDP browser runner)');
await test('new account IDs remain unique even within the same clock tick',async()=>{
  await seed({accounts:[],members:[],archived:[],snapshots:[]});
  for(const name of ['first','second'])await ev(`accountFormDrawer(null);$('#f_name').value='${name}';$('#f_amount').value='1';$('#f_save').click()`);
  assert.equal(await ev('ACCOUNTS.length'),2);assert.equal(await ev('new Set(ACCOUNTS.map(a=>a.id)).size'),2);
});
await test('wipe clears historical operation logs along with ledger data',async()=>{
  await seed();await ev("logIt('测试','私密金额 123');show('settings');$('#v-settings [data-act=wipe]').click();$('#modalInput').value='家底';$('#modalOk').click()");assert.deepEqual(await ev('readLog()'),[]);assert.equal(await ev('PREF.lastExport'),'');
});
await test('archived net worth excludes closed and uncounted accounts and supports aggregate amounts',async()=>{
  await seed();await ev("memberDrawer('我');$('#drawerFoot [data-act=archive]').click();$('#modalOk').click()");
  assert.equal(await ev('ARCHIVED.at(-1).net'),80);
  await seed({accounts:[account('one',1e12),account('two',1e12)],members:[{name:'我'}]});
  await ev("memberDrawer('我');$('#drawerFoot [data-act=archive]').click();$('#modalOk').click()");
  assert.equal(await ev('ARCHIVED.at(-1).net'),2e12);await app.reload();assert.equal(await ev('ARCHIVED.at(-1).net'),2e12);
});
await test('member names matching filter keywords select only their own accounts',async()=>{
  const names=['all','shared','member:all','共同'];
  await seed({accounts:names.map((name,i)=>account('member-'+i,10,{member:name})),members:names.map(name=>({name}))});
  for(const name of names){
    await ev(`show('detail');Array.from(document.querySelectorAll('#v-detail [data-f=member]')).find(b=>b.textContent===${JSON.stringify(name)}).click()`);
    assert.deepEqual(await ev('ACCOUNTS.filter(detailFilters()).map(a=>a.member)'),[name]);
  }
});
await test('historical trends and member management remain accessible with no accounts',async()=>{
  await seed({accounts:[],members:[{name:'保留成员'}],snapshots:[{month:'2026-09',A:100,L:0}]});
  await ev("show('trend')");assert.equal(await ev("$('#fromSel')!==null"),true);assert.match(await ev("$('#v-trend').textContent"),/2026-09/);
  await ev("show('people')");assert.equal(await ev("$('#addMember')!==null"),true);assert.match(await ev("$('#v-people').textContent"),/保留成员/);
});
await test('an empty selected time range offers historical recovery without NaN',async()=>{
  await seed({accounts:[],members:[],snapshots:[{month:'2020-01',A:10,L:0}]});
  await ev("PREF.range='近 12 月';show('trend')");assert.doesNotMatch(await ev("$('#v-trend').textContent"),/NaN|Infinity/);assert.equal(await ev("$('#trendAllHistory')!==null"),true);
  await ev("$('#trendAllHistory').click()");assert.equal(await ev("$('#fromSel').options[0].textContent"),'2020-01');
});
await test('demo replacement confirmation preserves corrupt data when cancelled',async()=>{
  await ev("localStorage.setItem(DB_KEY,'{keep me')");await app.reload();
  await ev("$('#emptySeed').click()");assert.equal(await ev('localStorage.getItem(DB_KEY)'),'{keep me');assert.equal(await ev("$('#modalMask').classList.contains('on')"),true);
  await ev("$('#modalCancel').click()");assert.equal(await ev('localStorage.getItem(DB_KEY)'),'{keep me');await seed();
});
await test('trend ranges reset to available periods after import and grain changes',async()=>{
  await seed({accounts:[account('cash',100)],members:[{name:'我'}],snapshots:[{month:'2024-01',A:10,L:0},{month:'2025-01',A:20,L:0},{month:'2026-01',A:30,L:0}]});
  await ev("show('trend')");assert.equal(await ev('S.trend.from'),0);assert.equal(await ev('S.trend.to'),3);
  await ev("S.trend.from=2;S.trend.to=3;show('trend');$('#trendGrain').value='year';$('#trendGrain').dispatchEvent(new Event('change'))");
  assert.equal(await ev('S.trend.from'),0);assert.equal(await ev('S.trend.to'),2);assert.match(await ev("$('#v-trend .topbar').textContent"),/2024 年/);
});
await test('desktop/mobile render and SVG coordinates remain finite',async()=>{
  await seed();await ev("resetDB();setTheme('light');show('home');$('#toast').classList.remove('on')");await app.screenshot(resolve('audit/desktop.png'));await app.screenshot(resolve('audit/mobile.png'),390,844);
  for(const route of ['home','trend','detail','checkin','settings','people','report']){await ev(`show('${route}')`);const widths=await ev('({page:document.documentElement.scrollWidth,viewport:innerWidth})');assert.equal(widths.page<=widths.viewport,true,route+' '+JSON.stringify(widths));assert.doesNotMatch(await ev("$('.view.is-active').innerHTML"),/NaN|Infinity/);}
  assert.deepEqual(app.errors,[]);
});
}finally{await app.close();}
console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
