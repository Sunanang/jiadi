import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Build a local browser runner when loopback sockets / remote debugging are unavailable.
// The iframe reloads a fresh document and keeps only this run's namespaced test storage.
const dir=await mkdtemp(join(tmpdir(),'jiadi-regression-'));
const namespace='jiadi.test-'+Date.now()+'.';
const domain=(await readFile(resolve('ledger-domain.mjs'),'utf8')).replaceAll('export ','');
const bootstrap=await readFile(resolve('shared-client.js'),'utf8');
// srcdoc under file:// cannot replace its history URL. URL routing is covered by
// the CDP runner; here the shim only skips that browser-specific URL write.
const html='<script>window.JIADI_TEST_LOCAL=true;window.JIADI_DOMAIN=(()=>{'+domain+';return {normalizeData};})();{const NativeDate=Date;const now=new NativeDate(2026,10,6,0,30).getTime();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};}history.replaceState=()=>{};addEventListener("error",e=>parent.recordTestError(e.message));</script>'+
  (await readFile(resolve('jiadi-ui.html'),'utf8')).replace('<script src="./shared-client.js"></script>','<script>'+bootstrap+'</script>').replaceAll('jiadi.',namespace);
let suite=await readFile(new URL('./regression.mjs',import.meta.url),'utf8');
suite=suite.slice(suite.indexOf('const ev=app.evaluate;'));
const runner=`
const output=document.querySelector('pre'), frame=document.querySelector('iframe');
const runNamespace=${JSON.stringify(namespace)}+Math.random().toString(36).slice(2)+'.';
const html=${JSON.stringify(html)}.replaceAll(${JSON.stringify(namespace)},runNamespace);
const errors=[];
window.recordTestError=message=>errors.push(message);
const log=(...args)=>{const row=document.createElement('div');row.textContent=args.join(' ');output.appendChild(row);};
const console={log,error:log};
const assert={
  equal(a,b,message=''){if(a!==b)throw new Error(message+' '+JSON.stringify(a)+' !== '+JSON.stringify(b));},
  deepEqual(a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(JSON.stringify(a)+' != '+JSON.stringify(b));},
  match(a,b){if(!b.test(a))throw new Error(a+' does not match '+b);},
  doesNotMatch(a,b){if(b.test(a))throw new Error(a+' unexpectedly matches '+b);}
};
const load=()=>new Promise((resolve,reject)=>{
  frame.onload=()=>{try{frame.contentWindow.addEventListener('error',e=>errors.push(e.message));frame.contentWindow.eval("markOnboarded();hideOnb()");resolve();}catch(e){reject(e);}};
  frame.srcdoc=html;
});
const app={errors,
  async evaluate(code){const result=await frame.contentWindow.eval(code);await new Promise(r=>setTimeout(r,0));return result;},
  reload:load,
  async screenshot(path,width=1440,height=1050){frame.style.width=width+'px';frame.style.height=height+'px';await new Promise(r=>setTimeout(r,100));},
  async close(){for(const key of Object.keys(localStorage))if(key.startsWith(runNamespace))localStorage.removeItem(key);}
};
await load();
${suite.replace('if(failed)process.exitCode=1;',"document.title=failed?'FAIL: '+failed+' tests':'PASS: '+passed+' tests';")}
`;
const path=join(dir,'runner.html');
await writeFile(path,`<!doctype html><meta charset="utf-8"><title>家底回归测试</title><style>body{font:14px monospace;margin:16px}pre{white-space:pre-wrap}iframe{border:1px solid #aaa;width:1440px;height:1050px}</style><h1>家底浏览器回归</h1><pre></pre><iframe></iframe><script type="module">${runner.replaceAll('</script','<\\/script')}</script>`);
console.log(path);
