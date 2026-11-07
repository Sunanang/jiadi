import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {browser} from './browser.mjs';

/* 飞牛网关模式下的首次使用流程：一个只负责注入 X-Trim 身份头的反向代理，
   让浏览器像在 NAS 里一样访问，验证「引导页第一步设置应用密码」真的能跑通。 */
async function gatewayProxy(target){
  const server=createServer(async(req,res)=>{
    const chunks=[];
    for await(const c of req) chunks.push(c);
    const body=chunks.length?Buffer.concat(chunks):undefined;
    const headers={...req.headers};
    delete headers.host; delete headers['content-length']; delete headers.connection;
    headers['accept-encoding']='identity';
    headers['x-trim-userid']='1000';
    headers['x-trim-username']='Lando';
    if(body) headers['content-length']=String(body.length);
    let upstream;
    try{
      upstream=await fetch(target+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body,redirect:'manual'});
    }catch(e){ res.writeHead(502,{'content-type':'text/plain'}); res.end('upstream failed'); return; }
    const out={};
    upstream.headers.forEach((v,k)=>{ if(k.toLowerCase()!=='set-cookie' && k.toLowerCase()!=='content-length' && k.toLowerCase()!=='content-encoding') out[k]=v; });
    const cookies=upstream.headers.getSetCookie?upstream.headers.getSetCookie():[];
    if(cookies.length) out['set-cookie']=cookies;
    const buf=Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status,out);
    res.end(buf);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {port:server.address().port, close:()=>new Promise(r=>server.close(r))};
}

const dataDir=await mkdtemp(join(tmpdir(),'jiadi-gw-'));
const port=18391;
const child=spawn(process.execPath,[resolve('server.mjs')],{
  env:{...process.env,JIADI_DATA_DIR:dataDir,PORT:String(port),HOST:'127.0.0.1',JIADI_TRUST_GATEWAY:'1'},
  stdio:['ignore','pipe','pipe'],cwd:resolve('.')
});
await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('server start timeout')),10000);child.stdout.on('data',c=>{if(String(c).includes('已启动')){clearTimeout(t);res(null);}});child.once('error',rej);});
const proxy=await gatewayProxy('http://127.0.0.1:'+port);
const origin='http://127.0.0.1:'+proxy.port;
const app=await browser();
const ev=app.evaluate;
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
async function waitFor(expr,ms=6000){
  const until=Date.now()+ms;
  while(Date.now()<until){ if(await ev(expr)) return true; await new Promise(r=>setTimeout(r,50)); }
  return false;
}
try{
  await app.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.JIADI_TEST_LOCAL=false;'});
  await app.cdp.send('Page.navigate',{url:origin+'/'});
  await test('gateway first run goes straight into the app with the password step inside onboarding',async()=>{
    assert.equal(await waitFor("document.body.dataset.ledgerReady==='1'"),true,'app should boot in gateway mode');
    assert.equal(await ev('window.JIADI_NEEDS_PASSWORD'),true);
    assert.equal(await ev("document.getElementById('connectionGate').hidden"),true,'不再有单独的密码页');
    assert.equal(await waitFor("document.getElementById('onb')!==null && document.getElementById('onb').classList.contains('on')"),true);
    assert.equal(await ev("document.querySelector('#onbTitle').textContent"),'先设一个应用密码');
    assert.equal(await ev("document.querySelector('#onbSkip').style.display"),'none');
  });
  await test('invalid passwords are refused in the wizard without calling the server',async()=>{
    const before=await ev("(async()=>{const r=await fetch('/api/session');return (await r.json()).initialized;})()");
    assert.equal(before,false);
    await ev("document.querySelector('#onbPw').value='1234';document.querySelector('#onbPw2').value='1234';document.querySelector('#onbNext').click()");
    await new Promise(r=>setTimeout(r,150));
    assert.match(await ev("document.querySelector('#onbPwErr').textContent"),/包含字母和数字/);
    assert.equal(await ev("(async()=>{const r=await fetch('/api/session');return (await r.json()).initialized;})()"),false,'没设密码前服务端不应有 vault');
  });
  await test('setting the password from the wizard creates the vault and continues into the guide',async()=>{
    await ev("document.querySelector('#onbPw').value='Ab12';document.querySelector('#onbPw2').value='Ab12';document.querySelector('#onbNext').click()");
    const ok=await waitFor("document.querySelector('#onbTitle').textContent==='这是你的家底'");
    assert.equal(ok,true,'仍停在密码步，错误提示：'+await ev("(document.querySelector('#onbPwErr')||{}).textContent"));
    assert.equal(await ev('window.JIADI_NEEDS_PASSWORD'),false);
    const session=await ev("(async()=>{const r=await fetch('/api/session');return await r.json();})()");
    assert.equal(session.initialized,true);
    assert.equal(session.locked,false);
    assert.equal(await ev("localStorage.getItem('jiadi.onboarded.v1')"),null,'引导未结束前不应记为已完成');
  });
  await test('after finishing the guide the app is usable and the ledger persists through a reload',async()=>{
    await ev("document.querySelector('#onbSkip').click()");
    assert.equal(await waitFor("document.getElementById('onb').classList.contains('on')===false"),true);
    await ev("accountFormDrawer(null);document.querySelector('#f_name').value='网关验收';document.querySelector('#f_amount').value='1234.56';document.querySelector('#f_save').click()");
    assert.equal(await waitFor("ACCOUNTS.length===1"),true);
    assert.equal(await ev('TOT().N'),1234.56);
    await app.reload();
    assert.equal(await waitFor("typeof S!=='undefined' && ACCOUNTS.length===1"),true,'reload 后应直接进入账本');
    assert.equal(await ev("document.getElementById('onb').classList.contains('on')"),false,'引导已完成，不再弹出');
    assert.equal(await ev('window.JIADI_NEEDS_PASSWORD===undefined||window.JIADI_NEEDS_PASSWORD===false'),true);
    assert.equal(await ev("document.body.dataset.ledgerReady"),'1');
  });
  await test('CSV export in shared mode downloads an encrypted JSON envelope and says so',async()=>{
    await ev("window.__dl=[]; window.saveDownload=function(b,n){b.text().then(t=>window.__dl.push({name:n,type:b.type,head:t.slice(0,40)}));};");
    await ev("(()=>{exportCSV();return 'started';})()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true,'导出必须先验证密码');
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor("window.__dl.length>0"),true,'应产出一个下载文件');
    const dl=await ev('window.__dl[0]');
    assert.match(dl.name,/^jiadi-accounts-\d{4}-\d{2}-\d{2}\.csv\.encrypted\.json$/,'文件名要能看出是加密信封，实际：'+dl.name);
    assert.equal(dl.type,'application/json');
    assert.match(dl.head,/\{\s*"format": "jiadi\.encrypted"/,'内容应是加密信封而不是明文 CSV');
    const msg=await ev("document.querySelector('#toast').textContent");
    assert.match(msg,/已加密导出/,'提示必须说清楚是加密文件，实际：'+msg);
    assert.match(msg,/解密下载/,'提示要告诉用户怎么拿明文，实际：'+msg);
    assert.doesNotMatch(msg,/^已导出 CSV/);
  });
  await test('导入账本 and 解密下载 are separate: import overwrites, decrypt only downloads',async()=>{
    // 1) 先导出一份账本备份（加密信封）
    await ev("window.__dl=[]; window.saveDownload=function(b,n){b.text().then(t=>window.__dl.push({name:n,text:t}));};");
    await ev("(()=>{exportJSON();return 'go';})()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true);
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor('window.__dl.length>0'),true);
    const backupEnv=await ev("window.__dl[0].text");
    assert.match(await ev("window.__dl[0].name"),/\.json\.encrypted\.json$/);
    // 2) 再导出一份 CSV 信封（用于"导入时选错文件"的用例）
    await ev("window.__dl=[];");
    await ev("(()=>{exportCSV();return 'go';})()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true);
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor('window.__dl.length>0'),true);
    const csvEnv=await ev("window.__dl[0].text");
    // 3) 造出差异：多一个账户
    await ev("accountFormDrawer(null);document.querySelector('#f_name').value='导入前新增';document.querySelector('#f_amount').value='9';document.querySelector('#f_save').click()");
    assert.equal(await waitFor('ACCOUNTS.length===2'),true);
    // 注入文件选择器（真 File + FileReader）
    await ev("window.__fileText="+JSON.stringify(backupEnv)+";");
    await ev("window.__origClick=HTMLInputElement.prototype.click; window.__injectFile=function(name){HTMLInputElement.prototype.click=function(){if(this.type==='file'){const dt=new DataTransfer();dt.items.add(new File([window.__fileText],name,{type:'application/json'}));this.files=dt.files;this.onchange();}else{window.__origClick.call(this);}};}; window.__restoreClick=function(){HTMLInputElement.prototype.click=window.__origClick;};");
    // 4) 解密下载：只下载明文，不改账本
    await ev("window.__dl=[]; (()=>{ __injectFile('backup.json'); decryptFile(); __restoreClick(); return 'go'; })()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true,'解密下载要输密码');
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor('window.__dl.length>0'),true,'解密下载应产出明文文件');
    assert.match(await ev("window.__dl[0].name"),/^jiadi-\d{4}-\d{2}-\d{2}\.json$/,'明文应还原成原文件名');
    assert.equal(await ev('ACCOUNTS.length'),2,'解密下载不得改动现有账本');
    // 5) 导入账本：加密备份 → 输密码 → 确认 → 覆盖
    await ev("(async()=>{ __injectFile('backup.json'); importLedger(); __restoreClick(); return true; })()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true);
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor("(document.querySelector('#modalTitle')||{}).textContent==='导入账本？'"),true,'导入前必须二次确认');
    await ev("document.querySelector('#modalOk').click()");
    assert.equal(await waitFor('ACCOUNTS.length===1'),true,'导入后应覆盖回 1 个账户');
    assert.equal(await ev('ACCOUNTS[0].name'),'网关验收');
    // 6) 导入时选到 CSV 导出件：明确拒绝，不下载也不改账本
    await ev("window.__fileText="+JSON.stringify(csvEnv)+"; window.__dl=[];");
    await ev("(()=>{ __injectFile('accounts.json'); importLedger(); __restoreClick(); return 'go'; })()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true,'加密文件仍要先解密');
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor("/这不是账本备份/.test((document.querySelector('#toast')||{}).textContent||'')"),true,'选到 CSV 应明确拒绝');
    assert.equal(await ev('ACCOUNTS.length'),1,'拒绝时不得改动账本');
    assert.equal(await ev("document.querySelector('#modalMask').classList.contains('on')"),false,'拒绝时不应弹导入确认');
    // 7) 解密下载作用在 CSV 信封上：拿到明文 CSV，账本一点不动
    await ev("window.__fileText="+JSON.stringify(csvEnv)+"; window.__dl=[];");
    await ev("(()=>{ __injectFile('accounts.json'); decryptFile(); __restoreClick(); return 'go'; })()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true);
    await ev("document.querySelector('#modalInput').value='Ab12';document.querySelector('#modalOk').click()");
    assert.equal(await waitFor('window.__dl.length>0'),true,'解密下载应产出明文 CSV');
    assert.match(await ev('window.__dl[0].name'),/^jiadi-accounts-\d{4}-\d{2}-\d{2}\.csv$/,'CSV 明文应还原原文件名');
    assert.match(await ev('window.__dl[0].text'),/"名称","类别","成员"/,'内容应是明文 CSV 表头（含引号）');
    assert.equal(await ev('ACCOUNTS.length'),1,'解密下载不得改动账本');
  });
  await test('export while the ledger is still saving is blocked with a clear message',async()=>{
    await ev("window.__dl=[]; window.saveDownload=function(b,n){window.__dl.push(n);}; window.JIADI_BUSY=true;");
    await ev("(()=>{exportCSV();return 'go';})()");
    await new Promise(r=>setTimeout(r,250));
    assert.equal(await ev("document.querySelector('#toast').textContent"),'正在保存账本，请稍候再导出','保存中导出要明确拦住');
    assert.equal(await ev('window.__dl.length'),0,'被拦住时不得产出下载');
    assert.equal(await ev("document.querySelector('#modalMask').classList.contains('on')"),false,'被拦住时不应弹密码框');
    await ev('window.JIADI_BUSY=false');
    await ev("(()=>{exportCSV();return 'go';})()");
    assert.equal(await waitFor("!!document.querySelector('#modalMask.on')"),true,'松开后应能正常导出');
    await ev("document.querySelector('#modalCancel').click()");
  });
  await test('idle lock still works after the password was created in the wizard',async()=>{
    await ev("(async()=>{await window.JIADI_SHARED.request('/api/lock',{method:'POST',body:{}});return true;})()");
    await app.cdp.send('Page.navigate',{url:origin+'/'});   // 上锁后应用脚本不执行，不能走 app.reload()
    assert.equal(await waitFor("!!document.getElementById('connectionGate') && document.getElementById('connectionGate').hidden===false"),true,'上锁后应回到解锁页');
    assert.match(await ev("document.getElementById('connectionGate').textContent"),/已锁定/);
    assert.doesNotMatch(await ev("document.getElementById('connectionGate').textContent"),/设置应用密码/);
  });

  await test('one unlock attempt is enough when a previous lock never reached the server',async()=>{
    /* 复现：上一次 lockNow 的 /api/lock 没成功 → localStorage 留下 jiadi.lockPending。
       用户输一次正确密码就应当进应用；修复前 enter() 会拿这个残留标记再把自己锁一次，
       表现成「密码对了又弹回锁定页」，要输两遍。 */
    await ev("localStorage.setItem('jiadi.lockPending','1')");
    assert.equal(await ev("localStorage.getItem('jiadi.lockPending')"),'1');
    await app.cdp.send('Page.navigate',{url:origin+'/'});
    assert.equal(await waitFor("!!document.getElementById('connectionGate') && document.getElementById('connectionGate').hidden===false && /解锁/.test(document.getElementById('connectionGate').textContent)"),true,'应显示解锁页');
    assert.equal(await ev("(()=>{const f=document.querySelector('#connectionGate form');if(!f)return 'no form';f.querySelector('input').value='Ab12';f.querySelector('button').click();return 'clicked';})()"),'clicked');
    assert.equal(await waitFor("document.getElementById('connectionGate').hidden===true",15000),true,'一次解锁就应进入应用，不能被残留的补锁标记顶回锁定页');
    assert.equal(await ev("localStorage.getItem('jiadi.lockPending')"),null,'解锁成功后补锁标记应被清掉');
    assert.equal(await ev("typeof ACCOUNTS==='object' && ACCOUNTS.length>=1"),true,'解锁后应读到账本');
  });
}finally{
  await app.close();
  await proxy.close();
  child.kill('SIGTERM');
  await new Promise(r=>child.once('exit',r));
  await rm(dataDir,{recursive:true,force:true});
}
console.log(`
${passed} passed, ${failed} failed`);
if(failed) process.exitCode=1;
