import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm, writeFile, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {browser} from './browser.mjs';

const dataDir=await mkdtemp(join(tmpdir(),'jiadi-http-'));
const port=18181;
const server=spawn(process.execPath,[resolve('server.mjs')],{
  env:{...process.env,JIADI_DATA_DIR:dataDir,PORT:String(port),HOST:'127.0.0.1'},
  stdio:['ignore','pipe','pipe']
});
await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('server start timeout')),10000);
  server.stdout.on('data',chunk=>{if(String(chunk).includes('已启动')){clearTimeout(timer);resolve();}});
  server.once('error',reject);
});
const origin=`http://127.0.0.1:${port}`;
const app=await browser();
const ev=app.evaluate;
let passed=0,failed=0;
async function test(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+'\n'+e.stack);}}
try{
  await app.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.JIADI_TEST_LOCAL=false;'});
  await app.cdp.send('Page.navigate',{url:origin+'/'});
  for(let i=0;i<80;i++){
    if(await ev("!!document.getElementById('connectionGate')"))break;
    await new Promise(r=>setTimeout(r,50));
  }
  await test('HTTP setup screen is shown for a fresh shared service',async()=>{
    /* connectionGate 元素在脚本一开始就创建、内容要等 /api/session 回来才填，直接读会偶发拿到空串 → 轮询等文案出现 */
    let gateText='';
    for(let i=0;i<80;i++){
      gateText=await ev("document.getElementById('connectionGate').textContent");
      if(/建立共享账本|设置一个账本密码/.test(gateText)) break;
      await new Promise(r=>setTimeout(r,50));
    }
    assert.match(gateText,/建立共享账本|设置一个账本密码/);
  });
  await test('setup password creates the shared session and loads the app',async()=>{
    await ev(`(()=>{const f=document.querySelector('#connectionGate form');f.password.value='Ab12';f.confirm.value='Ab12';})()`);
    await ev(`document.querySelector('#connectionGate form').requestSubmit()`);
    for(let i=0;i<80;i++){
      if(await ev("typeof S!=='undefined' && document.querySelector('.view.is-active')"))break;
      await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(await ev("typeof S!=='undefined'"),true);
    assert.equal(await ev('ACCOUNTS.length'),0);
    assert.match(await ev("document.getElementById('sharedStatusText').textContent"),/共享账本已连接/);
  });
  await test('creating an account persists through HTTP reload',async()=>{
    await ev("accountFormDrawer(null);$('#f_name').value='验收现金';$('#f_amount').value='1234.56';$('#f_save').click()");
    for(let i=0;i<40;i++){if(await ev('ACCOUNTS.length===1'))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await ev('ACCOUNTS.length'),1);
    assert.equal(await ev('TOT().N'),1234.56);
    await app.cdp.send('Page.reload');
    for(let i=0;i<80;i++){if(await ev("typeof S!=='undefined' && ACCOUNTS.length===1"))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(await ev('ACCOUNTS[0].name'),'验收现金');
    assert.equal(await ev('TOT().N'),1234.56);
  });
  await test('about panel shows the version pinned in package.json',async()=>{
    const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
    await ev("$('#sideFoot').click()");
    const text=await ev("$('#drawer').textContent");
    assert.ok(text.includes('v'+version),'about panel should show v'+version+', got: '+text.slice(0,200));
    await ev('closeDrawer()');
  });
  await test('operation log shows local time, not the raw ISO/UTC string the server stores',async()=>{
    await ev("show('settings')");
    await ev("logIt('自检','日志时间渲染')");
    for(let i=0;i<40;i++){if(await ev("(window.JIADI_SHARED.logs||[]).length>0"))break;await new Promise(r=>setTimeout(r,50));}
    const raw=await ev("(window.JIADI_SHARED.logs||[]).map(r=>r.t)");
    assert.ok(raw.length>0,'a log entry should exist after logging an action');
    assert.match(raw[0],/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await ev("logDrawer()");
    const shown=await ev("document.querySelector('#drawer .lrow .nm').textContent");
    assert.match(shown,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,'log drawer must localize the timestamp, got: '+shown);
    const stamp=await ev("(()=>{const c=document.querySelector('#drawer .lrow .nm');return {scroll:c.scrollWidth,client:c.clientWidth};})()");
    assert.equal(stamp.scroll<=stamp.client,true,'time column must not overflow: '+JSON.stringify(stamp));
    await ev('closeDrawer()');
  });
  await mkdir(resolve('audit'),{recursive:true});
  await app.screenshot(resolve('audit/http-desktop.png'));
  await app.screenshot(resolve('audit/http-mobile.png'),390,844);
  await test('desktop and mobile HTTP screenshots are finite and non-overflowing at 390px',async()=>{
    for(const route of ['home','trend','detail','checkin','settings','people','report']){
      await ev(`show('${route}')`);
      const widths=await ev('({page:document.documentElement.scrollWidth,viewport:innerWidth})');
      assert.equal(widths.page<=widths.viewport,true,route+' '+JSON.stringify(widths));
    }
  });
}finally{
  await app.close();
  server.kill('SIGTERM');
  await new Promise(r=>server.once('exit',r));
  await rm(dataDir,{recursive:true,force:true});
}
console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exitCode=1;
