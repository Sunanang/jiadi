import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Exercise the actual shared bootstrap and UI in two independent documents.
// Only the HTTP transport is replaced; real crypto / disk / auth are tested by
// server.test.mjs. No loopback socket or real browser storage is needed.
const domain=(await readFile('ledger-domain.mjs','utf8')).replaceAll('export ','');
const client=(await readFile('shared-client.js','utf8')).replace("location.protocol==='file:'",'false');
const source=await readFile('jiadi-ui.html','utf8');
const html=source.replace('<script src="./shared-client.js"></script>','<script>'+client+'</script>');
const runner=`
const output=document.querySelector('#results'), frames=[];let passed=0,failed=0;
const log=text=>{const row=document.createElement('div');row.textContent=text;output.appendChild(row);};
const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(JSON.stringify(a)+' != '+JSON.stringify(b));};
const check=(value,message)=>{if(!value)throw new Error(message);};
const clone=o=>JSON.parse(JSON.stringify(o));
let ledger={v:1,accounts:[{id:'cash',name:'共享现金',cat:'现金',member:'我',amount:100,prev:100,date:'2026-11-06'}],members:[{name:'我'}],archived:[],snapshots:[]},revision=0,logs=[],password='abc1',uncertain=false,denySave=false,exportCalls=0,expired=false;
window.transport=async(path,options={})=>{
  const input=options.body?JSON.parse(options.body):{},method=options.method||'GET';let status=200,data;
  if(expired)return {ok:false,status:401,async json(){return {error:'请登录共享账本'};}};
  if(path==='/api/session')data={initialized:true,authenticated:true,csrf:'test-csrf'};
  else if(path==='/api/ledger'&&method==='GET')data={ledger,revision,logs};
  else if(path==='/api/ledger'){
    if(denySave){status=500;data={error:'模拟磁盘写入失败'};}
    else if(input.revision!==revision){status=409;data={error:'账本已在其他设备修改，请刷新后重新录入'};}
    else{ledger=clone(input.ledger);revision++;if(input.clearLogs)logs=[];data={ledger,revision,logs};if(uncertain){uncertain=false;throw new Error('模拟响应中断');}}
  }else if(path==='/api/log'){logs=method==='DELETE'?[]:[{t:'测试',act:input.act,obj:input.obj},...logs];data={logs};}
  else if(['/api/verify','/api/export','/api/password'].includes(path)){
    if((path==='/api/password'?input.oldPassword:input.password)!==password){status=401;data={error:'密码不正确'};}
    else if(path==='/api/password'){password=input.password;data={ok:true};}
    else if(path==='/api/export'){exportCalls++;data={format:'jiadi.encrypted',v:1,testContent:input.ledgerBackup?JSON.stringify(ledger):input.content,testName:input.name};}
    else data={ok:true};
  }else if(path==='/api/decrypt'){
    if(input.password!=='backup1'){status=400;data={error:'备份密码不正确，或文件已损坏'};}
    else data={name:input.backup.name||'backup.json',content:input.backup.content||JSON.stringify(ledger)};
  }else{status=404;data={error:'未定义的测试接口 '+path};}
  return {ok:status<400,status,async json(){return clone(data);}};
};
const domain=${JSON.stringify(domain)},html=${JSON.stringify(html)};
async function create(){
  const frame=document.createElement('iframe');frame.style.cssText='width:720px;height:900px';document.querySelector('#frames').appendChild(frame);frames.push(frame);
  const header='<script>window.JIADI_DOMAIN=(()=>{'+domain+';return {normalizeData};})();window.fetch=(...args)=>parent.transport(...args);history.replaceState=()=>{};<'+'/script>';
  frame.srcdoc=header+html;
  for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,20));try{if(frame.contentWindow.eval('typeof S!=="undefined"'))break;}catch{}}
  const ev=async code=>{const value=await frame.contentWindow.eval(code);await new Promise(r=>setTimeout(r,0));return value;};
  await ev('markOnboarded();hideOnb()');return ev;
}
async function test(name,fn){try{await fn();passed++;log('PASS '+name);}catch(e){failed++;log('FAIL '+name+' '+e.stack);}}
const a=await create(),b=await create();
await test('independent clients start from the same authoritative ledger',async()=>{equal(await a('TOT().N'),100);equal(await b('TOT().N'),100);});
await test('asset writes never go into browser localStorage',async()=>{
  await a("window.testSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===DB_KEY)throw new Error('assets must not be local');return window.testSet.call(this,key,value);}");
  await a("(async()=>{accountDrawer('cash');$('#quickVal').value='120';await $('#quickSave').onclick();})()");equal(ledger.accounts[0].amount,120);equal(await a('TOT().N'),120);
});
await test('a stale client refuses to overwrite the newer shared balance',async()=>{
  await b("(async()=>{accountDrawer('cash');$('#quickVal').value='130';await $('#quickSave').onclick();})()");equal(ledger.accounts[0].amount,120);equal(await b('TOT().N'),100);check((await b("$('#toast').textContent")).includes('其他设备'),'missing conflict explanation');
});
await test('refresh replaces local state, then the other client can safely save',async()=>{
  await b("document.querySelector('#sharedStatus button').onclick()");equal(await b('TOT().N'),120);
  await b("(async()=>{accountDrawer('cash');$('#quickVal').value='140';await $('#quickSave').onclick();})()");equal(ledger.accounts[0].amount,140);
});
await test('server write errors roll back the UI and do not report success',async()=>{
  await a("document.querySelector('#sharedStatus button').onclick()");denySave=true;
  try{await a("(async()=>{accountDrawer('cash');$('#quickVal').value='999';await $('#quickSave').onclick();})()");equal(await a('TOT().N'),140);equal(ledger.accounts[0].amount,140);check((await a("$('#toast').textContent")).includes('保存失败'),'missing save failure');}finally{denySave=false;}
});
await test('a lost save response requires refresh and reconciles committed server data',async()=>{
  uncertain=true;await a("(async()=>{accountDrawer('cash');$('#quickVal').value='150';await $('#quickSave').onclick();})()");equal(ledger.accounts[0].amount,150);
  const result=await a("({amount:TOT().N,uncertain:uncertainSave,message:$('#toast').textContent,revision:SHARED.revision})");
  check(result.amount===140||(result.amount===150&&!result.uncertain&&result.revision===revision),JSON.stringify(result));
  check((await a("$('#toast').textContent")).includes('未确认'),'missing uncertain outcome');await a("document.querySelector('#sharedStatus button').onclick()");equal(await a('TOT().N'),150);
});
await test('export cancellation and wrong passwords create no downloadable plaintext',async()=>{
  await a("window.downloaded=[];saveDownload=(blob,name)=>downloaded.push({blob,name});void exportJSON()");equal(await a('downloaded.length'),0);
  await a("$('#modalCancel').click()");equal(exportCalls,0);equal(await a('downloaded.length'),0);
  await a("void exportCSV()");await a("(async()=>{$('#modalInput').value='wrong';await $('#modalOk').onclick();})()");equal(await a('downloaded.length'),0);check((await a("$('#modalErr').textContent")).includes('密码不正确'),'missing password error');await a("$('#modalCancel').click()");
});
await test('correct shared password creates only encrypted JSON and CSV envelopes',async()=>{
  for(const fn of ['exportJSON','exportCSV']){
    await a('void '+fn+'()');await a("(async()=>{$('#modalInput').value='abc1';await $('#modalOk').onclick();})()");
    check(await a("downloaded.at(-1).name.endsWith('.encrypted.json')"),'unencrypted file suffix');equal(await a("downloaded.at(-1).blob.text().then(JSON.parse).then(x=>x.format)"),'jiadi.encrypted');
  }equal(exportCalls,2);
});
await test('cancelling an in-flight export does not download after its response arrives',async()=>{
  const original=window.transport;let release;
  window.transport=async(path,options)=>{if(path==='/api/export')await new Promise(r=>release=r);return original(path,options);};
  const count=await a('downloaded.length');await a("void exportJSON();$('#modalInput').value='abc1';void $('#modalOk').onclick()");
  for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));
  check(!!release,'export request did not start');await a("$('#modalCancel').click()");release();await new Promise(r=>setTimeout(r,40));equal(await a('downloaded.length'),count);window.transport=original;
});
await test('encrypted ledger import validates password before presenting overwrite confirmation',async()=>{
  await a("window.backupPromise=unlockBackup({format:'jiadi.encrypted'});void 0");
  await a("(async()=>{$('#modalInput').value='wrong';await $('#modalOk').onclick();})()");check((await a("$('#modalErr').textContent")).includes('备份密码'),'missing decrypt error');
  await a("(async()=>{$('#modalInput').value='backup1';await $('#modalOk').onclick();})()");equal(await a('backupPromise.then(data=>data.accounts[0].amount)'),150);
});
await test('encrypted CSV decrypts to its original downloadable spreadsheet',async()=>{
  await a("window.backupPromise=unlockBackup({format:'jiadi.encrypted',name:'accounts.csv',content:'名称,余额'});void 0");
  await a("(async()=>{$('#modalInput').value='backup1';await $('#modalOk').onclick();})()");equal(await a('downloaded.at(-1).name'),'accounts.csv');equal(await a('backupPromise'),null);
});
await test('shared reports use encrypted export rather than bypassing the password with print',async()=>{
  await a("show('report');$('#rpPrint').click()");check((await a("$('#modalTitle').textContent")).includes('加密导出'),'report export bypassed password');await a("$('#modalCancel').click()");
});
await test('shared password verification and change are used for the privacy lock',async()=>{
  await a("(async()=>{await setPin('new2','abc1');lockOn();askUnlock();$('#modalInput').value='abc1';await $('#modalOk').onclick();})()");equal(await a('S.privacy'),true);
  await a("(async()=>{$('#modalInput').value='new2';await $('#modalOk').onclick();})()");equal(await a('S.privacy'),false);equal(password,'new2');
});
await test('session expiry hides the ledger and closes any amount-bearing drawer',async()=>{
  await a("accountDrawer('cash')");expired=true;await a("SHARED.request('/api/ledger').catch(()=>{})");
  equal(await a("document.querySelector('.app').hidden"),true);equal(await a("$('#drawer').classList.contains('on')"),false);equal(await a("getComputedStyle($('#tabbar')).display"),'none');
});
log(passed+' passed, '+failed+' failed');document.title=(failed?'FAIL: ':'PASS: ')+passed+' shared tests'+(failed?' / '+failed+' failed':'');
`;
const dir=await mkdtemp(join(tmpdir(),'jiadi-shared-browser-')),path=join(dir,'runner.html');
await writeFile(path,`<!doctype html><meta charset="utf-8"><title>共享账本回归</title><h1>共享账本浏览器测试</h1><pre id="results" style="white-space:pre-wrap"></pre><div id="frames"></div><script type="module">${runner.replaceAll('</script','<\\/script')}</script>`);
console.log(path);
