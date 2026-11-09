import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,readFile,writeFile,rm,mkdir,rename,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {createLedgerApp,decryptBackup,encryptBackup} from '../server.mjs';

const ledger=(amount=10)=>({v:1,accounts:[{id:'cash',name:'现金',cat:'现金',member:'我',amount,prev:amount,date:'2026-11-06'}],members:[{name:'我'}],snapshots:[],archived:[]});
async function fixture(t,config={}){
  const dataDir=await mkdtemp(join(tmpdir(),'jiadi-service-'));
  let app=await createLedgerApp({...config,dataDir});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  async function request(method,path,body,client={},extra={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method,url:path,headers:{host:'ledger.test',origin:'http://ledger.test','content-type':'application/json',...(client.cookie?{cookie:client.cookie}:{}),...(client.csrf?{'x-jiadi-csrf':client.csrf}:{}),...extra},socket:{remoteAddress:'127.0.0.1'}});
    let status,headers,content='';
    const res={writeHead(code,values){status=code;headers=values;},end(value){if(value)content+=value.toString();}};
    await app.handler(req,res);
    let data;try{data=JSON.parse(content);}catch{data=content;}
    return {status,headers,data};
  }
  async function login(password='abc1',setup=false){
    const response=await request('POST',setup?'/api/setup':'/api/login',{password});assert.equal(response.status,200,JSON.stringify(response.data));
    const client={cookie:response.headers['Set-Cookie'].split(';')[0]};
    client.csrf=(await request('GET','/api/session',undefined,client)).data.csrf;return client;
  }
  return {dataDir,request,login,async restart(){await app.close();app=await createLedgerApp({...config,dataDir});}};
}

test('fresh service requires setup/login and never exposes unauthenticated assets or vault hashes',async t=>{
  const f=await fixture(t);
  const fresh=await f.request('GET','/api/session');
  assert.equal(fresh.data.initialized,false);
  assert.equal(fresh.data.authenticated,false);
  assert.equal(fresh.data.authMode,null);
  assert.equal((await f.request('GET','/api/ledger')).status,401);
  assert.equal((await f.request('POST','/api/setup',{password:'1234'})).status,400);
  const client=await f.login('abc1',true);
  assert.equal((await f.request('POST','/api/setup',{password:'def2'})).status,409);
  const state=await f.request('GET','/api/ledger',undefined,client);
  assert.equal(state.data.revision,0);assert.deepEqual(state.data.ledger.accounts,[]);assert.equal(state.data.vault,undefined);
});
test('gateway prefix without trailing slash redirects instead of serving a page whose scripts 404',async t=>{
  const f=await fixture(t,{trustGateway:true,gatewayPrefix:'/app/jiadi'});
  const trim={'x-trim-userid':'7'};
  const bare=await f.request('GET','/app/jiadi',undefined,{},trim);
  assert.equal(bare.status,301,'裸前缀必须重定向，不能直接吐 HTML（否则 ./shared-client.js 会解析到 /app/ 而 404）');
  assert.equal(bare.headers.Location,'/app/jiadi/');
  const query=await f.request('GET','/app/jiadi?x=1',undefined,{},trim);
  assert.equal(query.status,301);
  assert.equal(query.headers.Location,'/app/jiadi/?x=1','重定向要保留查询串');
  const page=await f.request('GET','/app/jiadi/',undefined,{},trim);
  assert.equal(page.status,200);
  assert.match(page.headers['Content-Type'],/text\/html/);
  assert.equal((await f.request('GET','/app/jiadi/shared-client.js',undefined,{},trim)).status,200);
  assert.equal((await f.request('GET','/',undefined,{},trim)).status,200,'非网关前缀模式（Docker/本地）的根路径不能被重定向');
  assert.equal((await f.request('GET','/app/jiadi/api/session',undefined,{},trim)).status,200,'重定向不能吃掉 API');
});
test('reinstall that keeps the data adopts the password typed in the install wizard and retires the old one',async t=>{
  const f=await fixture(t);
  const first=await f.login('abc1',true);
  // 先制造一点真实账本内容，验证换密码不会碰数据
  const saved=await f.request('PUT','/api/ledger',{revision:0,ledger:ledger(1234)},first);
  assert.equal(saved.status,200,JSON.stringify(saved.data));
  const before=(await f.request('GET','/api/ledger',undefined,first)).data;
  // 重装：安装向导把新密码写进 data/.pwseed
  await writeFile(join(f.dataDir,'.pwseed'),'xyz9');
  await f.restart();
  const oldPassword=await f.request('POST','/api/login',{password:'abc1'});
  assert.notEqual(oldPassword.status,200,'重装后旧密码必须失效，否则用户会以为自己设了新密码');
  const login=await f.request('POST','/api/login',{password:'xyz9'});
  assert.equal(login.status,200,'安装向导里新设的密码必须有效');
  const client={cookie:login.headers['Set-Cookie'].split(';')[0]};
  client.csrf=(await f.request('GET','/api/session',undefined,client)).data.csrf;
  const after=(await f.request('GET','/api/ledger',undefined,client)).data;
  assert.deepEqual(after.ledger,before.ledger,'换密码不能动账本内容');
  assert.equal(after.revision,before.revision,'换密码不该产生新的账本版本');
  await assert.rejects(readFile(join(f.dataDir,'.pwseed')),'seed 用完必须删除');
});
test('gateway trust uses X-Trim identity without a ledger login password',async t=>{
  const f=await fixture(t,{trustGateway:true,gatewayPrefix:'/app/jiadi'});
  const trim={'x-trim-userid':'7','x-trim-username':'Lando','x-trim-isadmin':'true'};
  const session=await f.request('GET','/app/jiadi/api/session',undefined,{},trim);
  assert.equal(session.status,200);
  assert.equal(session.data.authenticated,true);
  assert.equal(session.data.authMode,'gateway');
  assert.equal(session.data.user.username,'Lando');
  const client={cookie:session.headers['Set-Cookie'].split(';')[0],csrf:session.data.csrf};
  assert.equal((await f.request('GET','/app/jiadi/api/ledger',undefined,client,trim)).status,200);
  assert.equal((await f.request('POST','/api/login',{password:'abc1'},{},trim)).status,400);
  // Gateway rewrites Host; browser Origin stays on the NAS URL — must not be treated as CSRF.
  const mismatched={...trim,origin:'http://nas.example:9527',host:'localhost','sec-fetch-site':'same-origin'};
  const setup=await f.request('POST','/app/jiadi/api/setup',{password:'abc1'},client,mismatched);
  assert.equal(setup.status,200,JSON.stringify(setup.data));
  assert.equal((await f.request('GET','/app/jiadi/api/session',undefined,client,trim)).data.initialized,true);
  assert.equal((await f.request('PUT','/app/jiadi/api/ledger',{revision:0,ledger:ledger(88)},client,mismatched)).status,200);
});
test('two clients read one ledger; stale and concurrent writers cannot overwrite the latest revision',async t=>{
  const f=await fixture(t),one=await f.login('abc1',true),two=await f.login();
  const writes=await Promise.all([f.request('PUT','/api/ledger',{revision:0,ledger:ledger(10)},one),f.request('PUT','/api/ledger',{revision:0,ledger:ledger(20)},two)]);
  assert.deepEqual(writes.map(r=>r.status).sort(),[200,409]);
  const a=(await f.request('GET','/api/ledger',undefined,one)).data,b=(await f.request('GET','/api/ledger',undefined,two)).data;
  assert.deepEqual(a,b);assert.equal(a.revision,1);
  const next=await f.request('PUT','/api/ledger',{revision:a.revision,ledger:ledger(30)},two);assert.equal(next.status,200);
  assert.equal(JSON.parse(await readFile(join(f.dataDir,'ledger.json'),'utf8')).ledger.accounts[0].amount,30);
});
test('data and shared password persist after restart, previous sessions do not',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true);
  await f.request('PUT','/api/ledger',{revision:0,ledger:ledger(1234.56)},client);
  await f.restart();assert.equal((await f.request('GET','/api/ledger',undefined,client)).status,401);
  const again=await f.login();assert.equal((await f.request('GET','/api/ledger',undefined,again)).data.ledger.accounts[0].amount,1234.56);
  assert.equal((await readFile(join(f.dataDir,'ledger.json'),'utf8')).includes('abc1'),false);
});
test('cross-origin mutations and missing CSRF are refused even with a session cookie',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true);
  for(const headers of [{origin:'http://evil.test'},{origin:'null'},{'x-jiadi-csrf':''},{'sec-fetch-site':'cross-site'}])assert.equal((await f.request('PUT','/api/ledger',{revision:0,ledger:ledger()},client,headers)).status,403);
  assert.equal((await f.request('GET','/api/ledger',undefined,client)).data.revision,0);
});
test('invalid data is rejected atomically by the authoritative server',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true),bad=ledger();bad.accounts[0].amount=-1;
  assert.equal((await f.request('PUT','/api/ledger',{revision:0,ledger:bad},client)).status,400);
  assert.equal((await f.request('GET','/api/ledger',undefined,client)).data.revision,0);
});
test('a disk write failure does not change the in-memory revision or report success',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true),file=join(f.dataDir,'ledger.json');
  await rename(file,file+'.original');await mkdir(file);
  try{
    assert.equal((await f.request('PUT','/api/ledger',{revision:0,ledger:ledger()},client)).status,500);
    assert.equal((await f.request('GET','/api/ledger',undefined,client)).data.revision,0);
  }finally{await rm(file,{recursive:true});await rename(file+'.original',file);}
});
test('export always rechecks the same password and returns authenticated encrypted content',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true),content=JSON.stringify(ledger(9876.54));
  assert.equal((await f.request('POST','/api/export',{password:'wrong',content,name:'backup.json',revision:0},client)).status,401);
  const response=await f.request('POST','/api/export',{password:'abc1',content,name:'backup.json',revision:0},client);assert.equal(response.status,200);
  assert.equal(JSON.stringify(response.data).includes('9876.54'),false);
  const decrypted=await f.request('POST','/api/decrypt',{password:'abc1',backup:response.data},client);assert.equal(decrypted.data.content,content);
  assert.equal((await f.request('POST','/api/decrypt',{password:'wrong',backup:response.data},client)).status,400);
});
test('encrypted CSV is reversible; random nonces and authentication reject tampering',async()=>{
  const a=await encryptBackup('名称,余额\n现金,12.34','abc1','accounts.csv'),b=await encryptBackup('名称,余额\n现金,12.34','abc1','accounts.csv');
  assert.notEqual(a.data,b.data);assert.equal((await decryptBackup(a,'abc1')).name,'accounts.csv');
  const tampered={...a,tag:Buffer.alloc(16).toString('base64')};await assert.rejects(decryptBackup(tampered,'abc1'),/密码不正确|损坏/);
  await assert.rejects(decryptBackup({...a,kdf:'scrypt-billion'},'abc1'),/格式/);
});
test('old backup passwords still decrypt after password rotation; other sessions are revoked',async t=>{
  const f=await fixture(t),one=await f.login('abc1',true),two=await f.login();
  const backup=(await f.request('POST','/api/export',{password:'abc1',content:JSON.stringify(ledger()),name:'backup.json',revision:0},one)).data;
  assert.equal((await f.request('POST','/api/password',{oldPassword:'wrong',password:'new2'},one)).status,401);
  assert.equal((await f.request('POST','/api/password',{oldPassword:'abc1',password:'new2'},one)).status,200);
  assert.equal((await f.request('GET','/api/ledger',undefined,two)).status,401);
  assert.equal((await f.request('POST','/api/verify',{password:'new2'},one)).status,200);
  assert.equal((await f.request('POST','/api/export',{password:'abc1',content:'{}',name:'x.json'},one)).status,401);
  assert.equal((await f.request('POST','/api/decrypt',{password:'abc1',backup},one)).status,200);
});
test('ledger backups always use current server data; stale CSV exports cannot succeed',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true);
  await f.request('PUT','/api/ledger',{revision:0,ledger:ledger(99)},client);
  const exported=await f.request('POST','/api/export',{password:'abc1',name:'backup.json',content:JSON.stringify(ledger(1)),ledgerBackup:true,revision:0},client);
  assert.equal(exported.status,200);assert.equal(JSON.parse((await decryptBackup(exported.data,'abc1')).content).accounts[0].amount,99);
  const csv=await f.request('POST','/api/export',{password:'abc1',name:'accounts.csv',content:'余额,1',revision:0},client);assert.equal(csv.status,409);
});
test('legacy file migration encryption interoperates with WebCrypto PBKDF2 / AES-GCM',async()=>{
  const salt=webcrypto.getRandomValues(new Uint8Array(16)),iv=webcrypto.getRandomValues(new Uint8Array(12)),password='abc1';
  const material=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
  const bytes=new Uint8Array(await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('jiadi.encrypted.v1')},key,new TextEncoder().encode(JSON.stringify({content:JSON.stringify(ledger()),name:'old.json'}))));
  const b64=b=>Buffer.from(b).toString('base64');
  const backup={format:'jiadi.encrypted',v:1,kdf:'pbkdf2-sha256-210000',cipher:'aes-256-gcm',salt:b64(salt),iv:b64(iv),tag:b64(bytes.slice(-16)),data:b64(bytes.slice(0,-16))};
  assert.equal(JSON.parse((await decryptBackup(backup,password)).content).accounts[0].amount,10);
});
test('logs are shared and wipe clears them with the ledger in one transaction',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true);
  await f.request('POST','/api/log',{act:'盘点',obj:'测试'},client);
  assert.equal((await f.request('GET','/api/ledger',undefined,client)).data.logs.length,1);
  assert.equal((await f.request('PUT','/api/ledger',{revision:0,ledger:{accounts:[],members:[],snapshots:[]},clearLogs:true},client)).status,200);
  assert.deepEqual((await f.request('GET','/api/ledger',undefined,client)).data.logs,[]);
});
test('password verification has a bounded attempt budget',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true);
  for(let i=0;i<8;i++)assert.equal((await f.request('POST','/api/verify',{password:'bad'},client)).status,401);
  assert.equal((await f.request('POST','/api/verify',{password:'abc1'},client)).status,429);
});
test('repeated correct password checks do not consume the failure budget',async t=>{
  const f=await fixture(t),client=await f.login('abc1',true);
  for(let i=0;i<10;i++)assert.equal((await f.request('POST','/api/verify',{password:'abc1'},client)).status,200,'correct password check #'+(i+1)+' must succeed');
  assert.equal((await f.request('POST','/api/verify',{password:'bad'},client)).status,401);
  assert.equal((await f.request('POST','/api/verify',{password:'abc1'},client)).status,200);
});
test('logout revokes the current cookie and clears it without affecting another device',async t=>{
  const f=await fixture(t),one=await f.login('abc1',true),two=await f.login();
  const result=await f.request('POST','/api/logout',{},one);assert.equal(result.status,200);assert.match(result.headers['Set-Cookie'],/Max-Age=0/);
  assert.equal((await f.request('GET','/api/ledger',undefined,one)).status,401);
  assert.equal((await f.request('GET','/api/ledger',undefined,two)).status,200);
});
test('expired sessions cannot read or export the ledger',async t=>{
  let clock=Date.now();const f=await fixture(t,{now:()=>clock}),client=await f.login('abc1',true);clock+=13*3600*1000;
  assert.equal((await f.request('GET','/api/ledger',undefined,client)).status,401);
  assert.equal((await f.request('POST','/api/export',{password:'abc1',name:'x.json',content:'{}'},client)).status,401);
});
test('private files are never served and the app is framed only by itself',async t=>{
  const f=await fixture(t);
  for(const path of ['/data/ledger.json','/README.md','/server.mjs','/../data/ledger.json'])assert.equal((await f.request('GET',path)).status,404);
  const page=await f.request('GET','/');assert.equal(page.status,200);assert.equal(page.headers['X-Frame-Options'],'DENY');
});
test('a second process cannot own the same ledger directory',async t=>{
  const f=await fixture(t);
  /* 必须用真进程验证：锁文件里记的是 PID，同进程再取一次会被当成「僵尸锁」接管（设计如此）。 */
  const {execFile}=await import('node:child_process');
  const child=`import(process.env.SRV).then(async m=>{try{const app=await m.createLedgerApp({dataDir:process.env.DIR});process.stdout.write('OPENED');await app.close();}catch(e){process.stdout.write('REFUSED:'+e.message);}})`;
  const output=await new Promise(resolve=>{
    execFile(process.execPath,['-e',child],{env:{...process.env,SRV:new URL('../server.mjs',import.meta.url).href,DIR:f.dataDir}},(err,stdout)=>{resolve(String(stdout||''));});
  });
  assert.match(output,/REFUSED:.*已被占用/,'second process must be refused, got: '+output);
  assert.equal((await f.request('GET','/api/session')).status,200,'the original owner keeps working');
});
test('corrupt server storage fails closed and preserves the original file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'jiadi-corrupt-'));
  try{await writeFile(join(dir,'ledger.json'),'{broken');await assert.rejects(createLedgerApp({dataDir:dir}),/原始文件未覆盖/);assert.equal(await readFile(join(dir,'ledger.json'),'utf8'),'{broken');}
  finally{await rm(dir,{recursive:true,force:true});}
});

test('early rejections drain the request body so large uploads get the real error instead of a reset',async t=>{
  /* 锁定时保存 10 MB 级账本：服务端在读 body 之前就 423 拒绝。若此时直接回包并关连接，
     客户端拿到的是 ECONNRESET（前端显示"保存结果未确认"），真正的「账本已锁定」文案丢失，
     还会污染 keep-alive 连接池。要求：拒绝后先把请求体排空。 */
  const dataDir=await mkdtemp(join(tmpdir(),'jiadi-drain-'));
  const app=await createLedgerApp({dataDir,trustGateway:true});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const trim={'x-trim-userid':'1','x-trim-username':'Lando'};
  const send=async(method,path,body,client={})=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method,url:path,headers:{host:'ledger.test',origin:'http://ledger.test','content-type':'application/json',...(client.cookie?{cookie:client.cookie}:{}),...(client.csrf?{'x-jiadi-csrf':client.csrf}:{}),...trim},socket:{remoteAddress:'127.0.0.1'}});
    let status,headers,content='';
    const res={writeHead(code,values){status=code;headers=values;},end(value){if(value)content+=value.toString();}};
    await app.handler(req,res);
    let data;try{data=JSON.parse(content);}catch{data=content;}
    return {status,headers,data,req};
  };
  const session=await send('GET','/api/session');
  const client={cookie:session.headers['Set-Cookie'].split(';')[0],csrf:session.data.csrf};
  assert.equal((await send('POST','/api/setup',{password:'abc1'},client)).status,200);
  assert.equal((await send('POST','/api/unlock',{password:'abc1'},client)).status,200);
  assert.equal((await send('POST','/api/lock',{},client)).status,200);
  // 4 MB ×2 = 8 MB 上传，锁定态应当在读 body 之前就拒绝
  const chunk=Buffer.from(JSON.stringify({revision:0,ledger:ledger(1),pad:'x'.repeat(2*1024*1024)}));
  const req=Readable.from([chunk,chunk]);
  Object.assign(req,{method:'PUT',url:'/api/ledger',headers:{host:'ledger.test',origin:'http://ledger.test','content-type':'application/json',cookie:client.cookie,'x-jiadi-csrf':client.csrf,...trim},socket:{remoteAddress:'127.0.0.1'}});
  let status,content='';
  const res={writeHead(code){status=code;},end(v){if(v)content+=v.toString();}};
  await app.handler(req,res);
  assert.equal(status,423,'锁定态应回 423，实际 '+status+' '+content.slice(0,80));
  assert.match(content,/账本已锁定/);
  await new Promise(r=>setTimeout(r,120));
  assert.equal(req.readableEnded,true,'拒绝后必须排空请求体，否则客户端看到的是连接重置而不是这条错误');
  // 排空不影响后续请求：解锁后同一客户端仍能正常保存
  assert.equal((await send('POST','/api/unlock',{password:'abc1'},client)).status,200);
  assert.equal((await send('PUT','/api/ledger',{revision:0,ledger:ledger(5)},client)).status,200);
});

test('an app password collected by the install wizard is turned into a vault once, then the seed is deleted',async t=>{
  /* 安装向导把 wizard_app_password 交给 cmd/install_callback，它只写 data/.pwseed（0600）。
     服务端首次启动要：生成加盐哈希 → 落盘 → 删除 seed（不留明文）。 */
  const dataDir=await mkdtemp(join(tmpdir(),'jiadi-seed-'));
  let app=null;
  t.after(async()=>{if(app)await app.close();await rm(dataDir,{recursive:true,force:true});});
  await writeFile(join(dataDir,'.pwseed'),'abc1',{mode:0o600});
  app=await createLedgerApp({dataDir,trustGateway:true});
  const disk=JSON.parse(await readFile(join(dataDir,'ledger.json'),'utf8'));
  assert.ok(disk.vault&&/^[a-f0-9]{32}$/.test(disk.vault.salt)&&/^[a-f0-9]{64}$/.test(disk.vault.hash),'应生成合法 vault');
  assert.equal(JSON.stringify(disk).includes('abc1'),false,'明文密码不能落到 ledger.json');
  await assert.rejects(readFile(join(dataDir,'.pwseed'),'utf8'),/ENOENT/,'seed 用完必须删除');
  // 再放一个「相同密码」的 seed：不该产生任何改动，seed 也要清掉
  await writeFile(join(dataDir,'.pwseed'),'abc1',{mode:0o600});
  await app.close(); app=null;
  app=await createLedgerApp({dataDir,trustGateway:true});
  const diskSame=JSON.parse(await readFile(join(dataDir,'ledger.json'),'utf8'));
  assert.equal(diskSame.vault.hash,disk.vault.hash,'密码没变时不该重写 vault');
  await assert.rejects(readFile(join(dataDir,'.pwseed'),'utf8'),/ENOENT/,'残留 seed 必须清掉');
  // 重装时安装向导新设的密码必须生效（旧密码作废）：见「reinstall that keeps the data…」用例
  await writeFile(join(dataDir,'.pwseed'),'zz99',{mode:0o600});
  await app.close(); app=null;
  app=await createLedgerApp({dataDir,trustGateway:true});
  const disk2=JSON.parse(await readFile(join(dataDir,'ledger.json'),'utf8'));
  assert.notEqual(disk2.vault.hash,disk.vault.hash,'换密码时 vault 必须更新，否则新密码无效');
  assert.equal(disk2.revision,diskSame.revision,'换密码不应改变账本版本');
  await assert.rejects(readFile(join(dataDir,'.pwseed'),'utf8'),/ENOENT/,'残留 seed 必须清掉');
});
test('an install-wizard password that breaks the rule is ignored and never leaves a seed behind',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'jiadi-seed2-'));
  let app=null;
  t.after(async()=>{if(app)await app.close();await rm(dataDir,{recursive:true,force:true});});
  await writeFile(join(dataDir,'.pwseed'),'abcdefgh',{mode:0o600});   // 8 位但没有数字
  app=await createLedgerApp({dataDir,trustGateway:true});
  const req={method:'GET',url:'/api/session',headers:{host:'ledger.test',origin:'http://ledger.test'},socket:{remoteAddress:'127.0.0.1'}};
  let content='';
  await app.handler(req,{writeHead(){},end(v){if(v)content+=v.toString();}});
  const session=JSON.parse(content);
  assert.equal(session.initialized,false,'不合规密码不得生成 vault（仍属未初始化）');
  await assert.rejects(readFile(join(dataDir,'.pwseed'),'utf8'),/ENOENT/,'不合规也要清掉 seed');
});

test('an unreadable install-wizard seed never blocks startup and leaves no residue',async t=>{
  /* 安装脚本多以 root 运行、服务以应用用户运行：.pwseed 属主/权限不对时读不到（EACCES），
     甚至路径被占成目录（EISDIR）。这类情况绝不能让服务起不来——全新安装会直接打不开。 */
  const dataDir=await mkdtemp(join(tmpdir(),'jiadi-seedbad-'));
  let app=null;
  t.after(async()=>{if(app)await app.close();await rm(dataDir,{recursive:true,force:true});});
  await mkdir(join(dataDir,'.pwseed'),{recursive:true});
  app=await createLedgerApp({dataDir,trustGateway:true});
  const req={method:'GET',url:'/api/session',headers:{host:'ledger.test',origin:'http://ledger.test','x-trim-userid':'1','x-trim-username':'L'},socket:{remoteAddress:'127.0.0.1'}};
  let content='';
  await app.handler(req,{writeHead(){},end(v){if(v)content+=v.toString();}});
  assert.equal(JSON.parse(content).authenticated,true,'读不到 seed 也要正常启动');
  await assert.rejects(readFile(join(dataDir,'.pwseed'),'utf8'),/EISDIR|ENOENT/,'读不到时也要尽力清掉残留');
});

test('import-style replace snapshots the previous ledger before overwriting',async t=>{
  /* 「导入账本」是覆盖式写入：选错文件会把现有账本直接冲掉。
     服务端在 reason=import / demo / clear 的 PUT 前，把当前 ledger.json 复制到 <卷根>/.jiadi-keep/。 */
  const root=await mkdtemp(join(tmpdir(),'jiadi-snap-'));
  const dataDir=join(root,'@appdata','jiadi','data');
  await mkdir(dataDir,{recursive:true,mode:0o700});
  let app=await createLedgerApp({dataDir});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  async function request(method,path,body,client={}){
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method,url:path,headers:{host:'ledger.test',origin:'http://ledger.test','content-type':'application/json',...(client.cookie?{cookie:client.cookie}:{}),...(client.csrf?{'x-jiadi-csrf':client.csrf}:{})},socket:{remoteAddress:'127.0.0.1'}});
    let status,headers,content='';
    const res={writeHead(code,values){status=code;headers=values;},end(value){if(value)content+=value.toString();}};
    await app.handler(req,res);
    let data;try{data=JSON.parse(content);}catch{data=content;}
    return {status,headers,data};
  }
  const setup=await request('POST','/api/setup',{password:'abc1'});
  assert.equal(setup.status,200,JSON.stringify(setup.data));
  const client={cookie:setup.headers['Set-Cookie'].split(';')[0]};
  client.csrf=(await request('GET','/api/session',undefined,client)).data.csrf;
  const keep=join(root,'.jiadi-keep');
  const snapshots=async()=>(await readdir(keep).catch(()=>[])).filter(n=>n.startsWith('ledger-before-'));
  const first={v:1,accounts:[{id:'a1',name:'甲账户',cat:'现金',member:'我',amount:100,prev:100,date:'2026-11-01'}],members:[{name:'我'}],archived:[],snapshots:[]};
  const r1=await request('PUT','/api/ledger',{revision:0,ledger:first},client);
  assert.equal(r1.status,200,JSON.stringify(r1.data));
  assert.deepEqual(await snapshots(),[],'普通保存不应该产生快照');
  const second={v:1,accounts:[{id:'a1',name:'乙账户',cat:'现金',member:'我',amount:200,prev:200,date:'2026-11-02'}],members:[{name:'我'}],archived:[],snapshots:[]};
  const r2=await request('PUT','/api/ledger',{revision:r1.data.revision,ledger:second,reason:'import'},client);
  assert.equal(r2.status,200,JSON.stringify(r2.data));
  const names=await snapshots();
  assert.equal(names.length,1,'导入式覆盖必须留下覆盖前快照');
  const snap=JSON.parse(await readFile(join(keep,names[0]),'utf8'));
  assert.equal(snap.ledger.accounts[0].name,'甲账户','快照里应该是被覆盖前的那份账本');
  assert.equal(snap.revision,1);
  assert.equal(((await stat(join(keep,names[0]))).mode&0o777).toString(8),'600');
  assert.equal((await request('GET','/api/ledger',undefined,client)).data.ledger.accounts[0].name,'乙账户');
});
