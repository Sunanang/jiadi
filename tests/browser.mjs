import {execFileSync, spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';

function chromeBinary(){
  if(process.env.CHROME_PATH)return process.env.CHROME_PATH;
  const absolute=[
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for(const path of absolute) if(existsSync(path)) return path;
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser','chrome']){
    try{
      const found=execFileSync(process.platform==='win32'?'where':'command',process.platform==='win32'?[name]:['-v',name],{encoding:'utf8'}).trim().split(/\r?\n/)[0];
      if(found) return found;
    }catch{}
  }
  throw new Error('未找到 Chrome/Chromium。请设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
}

// Dependency-free, isolated Chrome session. Never opens the user's browser profile.
export async function browser(file = resolve('jiadi-ui.html'), fixedDate) {
  const server=createServer(async (req,res)=>{
    const path=req.url.split('?')[0],name=path==='/jiadi-ui.html'?file: ['/shared-client.js','/ledger-domain.mjs'].includes(path)?join(dirname(file),path.slice(1)):null;
    if(!name){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.html')?'text/html;charset=utf-8':'text/javascript;charset=utf-8');
    res.end(await readFile(name));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const profile=await mkdtemp(join(tmpdir(),'jiadi-test-'));
  const chrome=spawn(chromeBinary(),[
    '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-component-update','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
  ],{stdio:['ignore','ignore','pipe']});
  let stderr='';
  const endpoint=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Chrome startup timed out: '+stderr)),15000);
    chrome.once('error',e=>{clearTimeout(timer);reject(e);});
    chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  const connections=[];
  async function connect(url){
    const ws=new WebSocket(url), pending=new Map(), listeners=new Map();let seq=0;
    await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
    ws.addEventListener('message',e=>{
      const m=JSON.parse(e.data);
      if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}
      else for(const fn of listeners.get(m.method)||[]) fn(m.params);
    });
    connections.push(ws);
    return {send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});},on(method,fn){if(!listeners.has(method))listeners.set(method,[]);listeners.get(method).push(fn);}};
  }
  const control=await connect(endpoint);
  const {targetId}=await control.send('Target.createTarget',{url:'about:blank'});
  const cdp=await connect(endpoint.replace(/\/devtools\/browser\/.*$/,'/devtools/page/'+targetId));
  const errors=[];
  cdp.on('Runtime.exceptionThrown',e=>errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text));
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:'window.JIADI_TEST_LOCAL=true;'});
  async function evaluate(expression){
    const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    await cdp.send('Runtime.evaluate',{expression:'new Promise(r=>setTimeout(r,0))',awaitPromise:true});
    return r.result.value;
  }
  async function ready(){
    for(let i=0;i<80;i++){
      if(await evaluate("typeof S!=='undefined' && document.querySelector('.view.is-active')!==null")){await evaluate("localStorage.setItem('jiadi.onboarded.v1','1'); hideOnb()");return;}
      await new Promise(r=>setTimeout(r,50));
    }
    throw new Error('App did not initialize: '+errors.join('\n'));
  }
  if(fixedDate){
    await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'});
    await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date;const now=${JSON.stringify(fixedDate)};window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return new NativeDate(now).getTime();}};}`});
  }
  await cdp.send('Page.navigate',{url:origin+'/jiadi-ui.html'});await ready();
  return {cdp,evaluate,errors,origin,
    async navigate(url){await cdp.send('Page.navigate',{url});await new Promise(r=>setTimeout(r,100));await ready();},
    async reload(){await cdp.send('Page.reload');await new Promise(r=>setTimeout(r,100));await ready();},
    async screenshot(path,width=1440,height=1050){await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await new Promise(r=>setTimeout(r,100));const shot=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path,Buffer.from(shot.data,'base64'));},
    async close(){try{await control.send('Browser.close');}catch{}for(const ws of connections)ws.close();if(chrome.exitCode===null){chrome.kill();await new Promise(r=>chrome.once('exit',r));}await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});}
  };
}
