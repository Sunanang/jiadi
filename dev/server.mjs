import {createServer} from 'node:http';
import {readFile, mkdir, open, rename, unlink, rm, chmod, writeFile, readdir} from 'node:fs/promises';
import {existsSync, unlinkSync, mkdirSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes, scrypt as scryptCallback, pbkdf2 as pbkdf2Callback, timingSafeEqual, createCipheriv, createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {normalizeData} from './ledger-domain.mjs';

const scrypt=promisify(scryptCallback),pbkdf2=promisify(pbkdf2Callback), root=dirname(fileURLToPath(import.meta.url));
const empty=()=>({v:1,accounts:[],members:[],archived:[],snapshots:[]});
const pinRule=/^(?=.*[A-Za-z])(?=.*\d)\S{4,8}$/;
const MAX_BODY=24*1024*1024, MAX_CONTENT=10*1024*1024;
/* 账本备份是唯一的整库备份通道：它由服务端自行序列化 disk.ledger，比客户端拼的内容更紧凑。
   账本本身能存进来（PUT 上限 MAX_BODY），就必须能备份出去 —— 否则大账本无法迁移/回滚。 */
const MAX_LEDGER_EXPORT=20*1024*1024;

/* 进程级兜底：fnOS 的 start.sh 是单次 nohup 启动、没有守护循环，
   一旦有未捕获异常把进程带走，应用就会卡在「未运行」直到人工重启。
   这里记录并吞掉，让服务继续对外；真正的启动致命错误仍走原有 exitCode 路径。 */
process.on('uncaughtException',e=>{console.error('[未捕获异常] '+((e&&e.stack)||e));});
process.on('unhandledRejection',e=>{console.error('[未处理拒绝] '+((e&&e.stack)||e));});
const fail=(status,message)=>Object.assign(new Error(message),{status});
const token=()=>randomBytes(32).toString('hex');
const derive=(password,salt)=>scrypt(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
async function makeVault(password){const salt=randomBytes(16).toString('hex');return {salt,hash:(await derive(password,salt)).toString('hex')};}
async function matches(password,vault){
  if(typeof password!=='string' || password.length>128 || !vault)return false;
  const hash=await derive(password,vault.salt);
  return timingSafeEqual(hash,Buffer.from(vault.hash,'hex'));
}
function base64(value,length,max=MAX_BODY){
  if(typeof value!=='string'||value.length>max*2||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw fail(400,'加密文件格式无效');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>max||(length!==undefined&&bytes.length!==length))throw fail(400,'加密文件格式无效');
  return bytes;
}
export async function encryptBackup(content,password,name){
  const salt=randomBytes(16),iv=randomBytes(12),key=await derive(password,salt);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('jiadi.encrypted.v1'));
  const payload=JSON.stringify({name,content});
  const ciphertext=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
  return {format:'jiadi.encrypted',v:1,kdf:'scrypt-N32768-r8-p1',cipher:'aes-256-gcm',salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:ciphertext.toString('base64')};
}
export async function decryptBackup(backup,password){
  if(!backup||backup.format!=='jiadi.encrypted'||backup.v!==1||!['scrypt-N32768-r8-p1','pbkdf2-sha256-210000'].includes(backup.kdf)||backup.cipher!=='aes-256-gcm'||typeof password!=='string'||password.length>128)throw fail(400,'不支持的加密备份格式');
  const salt=base64(backup.salt,16),iv=base64(backup.iv,12),tag=base64(backup.tag,16),data=base64(backup.data);
  try{
    const key=backup.kdf==='scrypt-N32768-r8-p1'?await derive(password,salt):await pbkdf2(password,salt,210000,32,'sha256'),cipher=createDecipheriv('aes-256-gcm',key,iv);
    cipher.setAAD(Buffer.from('jiadi.encrypted.v1'));cipher.setAuthTag(tag);
    const payload=JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));
    if(typeof payload.content!=='string'||typeof payload.name!=='string')throw new Error();
    return payload;
  }catch{throw fail(400,'备份密码不正确，或文件已损坏');}
}

function normalizePrefix(prefix){
  if(!prefix)return '';
  const text=String(prefix).trim();
  if(!text)return '';
  return text.endsWith('/')?text.slice(0,-1):text;
}
function stripGatewayPrefix(pathname,prefix){
  const p=normalizePrefix(prefix);
  if(!p)return pathname;
  if(pathname===p)return '/';
  if(pathname.startsWith(p+'/'))return pathname.slice(p.length)||'/';
  return pathname;
}
function readGatewayIdentity(headers,trustGateway){
  if(!trustGateway)return null;
  const h=Object.fromEntries(Object.entries(headers||{}).map(([k,v])=>[String(k).toLowerCase(),v]));
  const uid=String(h['x-trim-userid']||'').trim();
  if(!uid)return null;
  return {
    uid,
    username:String(h['x-trim-username']||'').trim(),
    isAdmin:String(h['x-trim-isadmin']||'').trim().toLowerCase()==='true'
  };
}

// One process owns the file. The lock prevents a second server from silently
// creating a second writer; rename + fsync keeps a failed save off the live file.
export async function createLedgerApp({
  dataDir=resolve(root,'data'),
  secureCookie=false,
  now=Date.now,
  trustGateway=false,
  gatewayPrefix=''
}={}){
  await mkdir(dataDir,{recursive:true,mode:0o700});
  /* mkdir 的 mode 只在“新建”时生效：安装脚本已把 data 目录建成 755，这里再收紧一次（失败不致命）。 */
  try{ await chmod(dataDir,0o700); }catch(_){}
  const IDLE_LOCK_MS=Number(process.env.JIADI_IDLE_LOCK_MS)||15*60*1000;   // 无操作 15 分钟后自动上锁（可用环境变量覆盖以便测试）
  const lockPath=join(dataDir,'server.lock');
  // 取锁：文件已存在时先看持有者是否还活着。进程已死（异常退出 / NAS 重启留下的
  // 僵尸锁）就直接接管，不让用户手动删 server.lock。
  async function acquireLock(){
    try{
      const fh=await open(lockPath,'wx',0o600);
      await fh.writeFile(String(process.pid));
      return fh;
    }catch(e){
      if(e.code!=='EEXIST')throw e;
      let pid=0;
      try{pid=parseInt(String(await readFile(lockPath,'utf8')).trim(),10)||0;}catch(_){}
      let alive=false;
      if(pid>0&&pid!==process.pid){
        try{process.kill(pid,0);alive=true;}
        catch(err){alive=(err&&err.code==='EPERM');}
      }
      if(alive)throw new Error('数据目录已被占用（PID '+pid+' 仍在运行）；确认没有服务进程后再移除 server.lock');
      try{await unlink(lockPath);}catch(_){}
      const fh=await open(lockPath,'wx',0o600);
      await fh.writeFile(String(process.pid));
      return fh;
    }
  }
  const lock=await acquireLock();
  const path=join(dataDir,'ledger.json');
  let disk;
  try{
    try{
      disk=JSON.parse(await readFile(path,'utf8'));
      if(disk.v!==1||!Number.isSafeInteger(disk.revision)||disk.revision<0||(disk.vault!==null&&(!disk.vault||! /^[a-f0-9]{32}$/.test(disk.vault.salt)||! /^[a-f0-9]{64}$/.test(disk.vault.hash)))||!Array.isArray(disk.logs))throw new Error('服务端账本格式无效');
      disk.ledger=normalizeData(disk.ledger);
    }catch(e){if(e.code==='ENOENT')disk={v:1,revision:0,vault:null,ledger:empty(),logs:[]};else throw e;}
  }catch(e){await lock.close();await unlink(lockPath);throw new Error('无法读取共享账本，原始文件未覆盖：'+e.message);}
  /* 安装向导填了应用密码时，cmd/install_callback 只把密码写进 data/.pwseed（0600）。
     加盐哈希始终由这里生成（makeVault），保证哈希参数只有一份实现；seed 用完立即删除，
     不在磁盘上长期保留明文密码。已存在 vault 或密码不合规时也删掉 seed，避免残留。 */
  {
    const seedPath=join(dataDir,'.pwseed');
    let raw=null,readErr=null;
    try{ raw=await readFile(seedPath,'utf8'); }
    catch(e){
      if(e.code!=='ENOENT'){
        readErr=e;
        /* 安装脚本常以 root 运行、服务以应用用户运行：权限/属主不对时读不到。
           这种情况绝不能阻断启动（否则全新安装直接打不开），只记一条并清掉残留。 */
        console.error('[jiadi] 读取安装向导密码失败（'+(e.code||'?')+'）：'+((e&&e.message)||e)+'；已忽略，可在应用内设置应用密码');
      }
    }
    if(raw!==null){
      try{
        const password=String(raw).trim();
        if(!pinRule.test(password)) console.log('[jiadi] 安装向导里的应用密码格式不符，已忽略；可在应用内设置');
        else if(!disk.vault){
          await persist({...disk,vault:await makeVault(password)});
          console.log('[jiadi] 已按安装向导设置应用密码（首次打开时直接用它解锁）');
        }else if(await matches(password,disk.vault)){
          console.log('[jiadi] 安装向导里的应用密码与现有密码一致，无需改动');
        }else{
          /* 卸载后重装、而飞牛把应用数据保留下来时，旧账本连同旧密码一起还在。
             安装向导里让人新设的密码必须以新密码为准，否则用户会以为自己设了密码却只能用旧的。
             只换密码，账本内容一个字都不动。 */
          await persist({...disk,vault:await makeVault(password)});
          console.log('[jiadi] 已按安装向导更新应用密码（数据被保留、账本内容未改动；旧密码已失效）');
        }
      }catch(e){ console.error('[jiadi] 向导密码落地失败：'+((e&&e.message)||e)); }
      finally{ try{await unlink(seedPath);}catch(_){} }
    }else if(readErr){
      try{ await rm(seedPath,{recursive:true,force:true}); }catch(_){}
    }
  }
  let queue=Promise.resolve(),closed=false;
  const sessions=new Map(),attempts=new Map();
  /* 未提交盘点草稿：只在内存里按用户暂存，不落盘、不进 ledger.json。
     锁定态一律不下发（见下方 isLocked 检查），解锁后才能取回。 */
  const drafts=new Map();          // key=uid|'local' -> {payload,savedAt}
  const DRAFT_TTL=24*3600*1000;    // 超过 24 小时自动丢弃，避免内存堆积
  function draftKey(s){ return (s&&s.uid)||'local'; }
  /* 草稿字段级校验：只接受 {step:1|2, date:YYYY-MM-DD, jumpsOk:bool, values:{账户id:非负有限数}}。
     任何一项不合格就整份拒绝，不猜、不修——避免脏数据在解锁后被恢复进盘点页。 */
  function sanitizeDraft(d){
    if(!d||typeof d!=='object'||Array.isArray(d))return null;
    const step=Number(d.step);
    if(!Number.isInteger(step)||step<1||step>2)return null;
    if(typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date))return null;
    const y=+d.date.slice(0,4),m=+d.date.slice(5,7),dd=+d.date.slice(8,10);
    const dt=new Date(y,m-1,dd);
    if(dt.getFullYear()!==y||dt.getMonth()!==m-1||dt.getDate()!==dd)return null;   // 2026-02-30 之类
    const raw=d.values;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const keys=Object.keys(raw);
    if(keys.length>500)return null;
    const values=Object.create(null);
    for(const k of keys){
      if(typeof k!=='string'||k.length<1||k.length>64)return null;
      const v=raw[k];
      if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1e15)return null;
      values[k]=v;
    }
    return {step,date:d.date,jumpsOk:d.jumpsOk===true,values};
  }
  function putDraft(s,payload){
    const clean=sanitizeDraft(payload);
    if(!clean)return false;
    drafts.set(draftKey(s),{payload:clean,savedAt:now()});
    for(const [k,v] of drafts)if(now()-v.savedAt>DRAFT_TTL)drafts.delete(k);
    return true;
  }
  const cookiePath=normalizePrefix(gatewayPrefix)||'/';
  const transact=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
  /* 覆盖式写入（导入账本 / 恢复演示 / 清空）前，把当前账本复制一份到 <卷根>/.jiadi-keep/。
     导入选错文件会把现有账本直接冲掉，事后无从回滚；这里留一份「覆盖前」快照。 */
  async function snapshotBeforeReplace(reason){
    try{
      const keepDir=join(dataDir,'..','..','..','.jiadi-keep');   // dataDir=<卷>/@appdata/<app>/data → 三级到卷根
      await mkdir(keepDir,{recursive:true,mode:0o700});
      const stamp=new Date().toISOString().replace(/[-:T.]/g,'').slice(0,14);
      const tag=String(reason||'replace').replace(/[^a-z0-9-]/gi,'').slice(0,12)||'replace';
      const current=await readFile(path);
      const dest=join(keepDir,`ledger-before-${tag}-${stamp}.json`);
      await writeFile(dest,current,{mode:0o600});
      try{const names=(await readdir(keepDir)).filter(n=>n.startsWith('ledger-before-'));
        if(names.length>20){names.sort();for(const n of names.slice(0,names.length-20))await unlink(join(keepDir,n)).catch(()=>{});}}catch{}
      console.log('[jiadi] 覆盖前已备份当前账本：'+dest);
    }catch(e){ console.error('[jiadi] 覆盖前自动备份失败：'+((e&&e.message)||e)); }
  }
  async function persist(next){
    const tmp=join(dataDir,'.ledger-'+token()+'.tmp');let file;
    try{
      file=await open(tmp,'wx',0o600);await file.writeFile(JSON.stringify(next));await file.sync();await file.close();file=null;
      await rename(tmp,path);
      disk=next;
      try{const dir=await open(dataDir,'r');try{await dir.sync();}finally{await dir.close();}}catch{}
    }finally{if(file)await file.close();await unlink(tmp).catch(()=>{});}
  }
  const reply=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));};
  const state=()=>({revision:disk.revision,ledger:disk.ledger,logs:disk.logs});
  function session(req){
    const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jiadi_session='))?.slice(14);
    const s=sessions.get(value);
    if(!s||s.until<now()){if(value)sessions.delete(value);return null;}
    /* 空闲锁：超过 IDLE_LOCK_MS 没有「用户操作」就自动上锁，数据不再下发。
       客户端每 5 秒的后台轮询带 X-Jiadi-Background 头，只保活会话、不续期空闲计时，
       否则轮询会把空闲时间一直刷新成 0，永远锁不上。 */
    if(s.unlocked && now()-s.lastActive>IDLE_LOCK_MS) s.unlocked=false;
    if(!req.headers['x-jiadi-background']) s.lastActive=now();
    return s;
  }
  /* 账本是否处于锁定状态（只有设过密码才谈得上锁） */
  function isLocked(s){ return !!disk.vault && !(s&&s.unlocked); }
  function setSession(extra={}){
    for(const [key,s] of sessions)if(s.until<now())sessions.delete(key);
    if(sessions.size>=1000)sessions.delete(sessions.keys().next().value);
    const value=token(),s={csrf:token(),until:now()+12*3600*1000,unlocked:false,lastActive:now(),...extra};sessions.set(value,s);
    return {
      session:s,
      headers:{'Set-Cookie':`jiadi_session=${value}; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=43200${secureCookie?'; Secure':''}`}
    };
  }
  function login(res,extra={}){
    return setSession(extra).headers;
  }
  function clearSessionCookie(){
    return {'Set-Cookie':`jiadi_session=; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=0${secureCookie?'; Secure':''}`};
  }
  function checkOrigin(req,identity=null){
    // fnOS gateway rewrites Host to the Unix upstream; Origin stays the browser NAS URL.
    // Mutations are still protected by CSRF + X-Trim identity, not Origin===Host.
    if(trustGateway&&identity)return;
    let origin;
    try{origin=new URL(req.headers.origin);}catch{throw fail(403,'请求来源无效，请从账本页面操作');}
    if(!['http:','https:'].includes(origin.protocol)||origin.host!==req.headers.host||['cross-site','none'].includes(req.headers['sec-fetch-site']))throw fail(403,'拒绝跨站请求');
  }
  async function passwordOK(req,password){
    const address=req.socket?.remoteAddress||'local';
    for(const [key,row] of attempts)if(row.until<now())attempts.delete(key);
    const row=attempts.get(address)||{count:0,until:now()+60000};
    if(row.count>=8)throw fail(429,'密码尝试过多，请一分钟后再试');
    /* 只有失败才计入尝试预算：此前连正常解锁/导出/验证 8 次都会被 429 挡住 */
    if(disk.vault&&await matches(password,disk.vault)){attempts.delete(address);return;}
    row.count++;attempts.set(address,row);
    throw fail(401,'密码不正确');
  }
  async function body(req){
    if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail(415,'请使用 JSON 请求');
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw fail(413,'文件过大');chunks.push(chunk);}
    try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw fail(400,'JSON 格式无效');}
  }
  function ensureGatewaySession(req,identity){
    let s=session(req);
    if(s&&s.uid&&s.uid!==identity.uid){
      for(const [key,value] of sessions)if(value===s)sessions.delete(key);
      s=null;
    }
    if(!s)return setSession({uid:identity.uid,username:identity.username,authMode:'gateway'});
    return {session:s,headers:{}};
  }
  async function handler(req,res){
    try{
      if(closed)throw fail(503,'服务正在关闭');
      const url=new URL(req.url,'http://localhost');
      // 少了结尾斜杠时，页面里的 ./shared-client.js 会解析到上一级目录（/app/shared-client.js）而 404，
      // 表现为整页白屏。这里把裸前缀重定向到带斜杠的地址，别指望上游网关替我们补。
      const gwPrefix=normalizePrefix(gatewayPrefix);
      if(gwPrefix && url.pathname===gwPrefix){
        res.writeHead(301,{Location:gwPrefix+'/'+(url.search||''),'Cache-Control':'no-store','Content-Length':'0'});
        res.end();
        return;
      }
      const route=stripGatewayPrefix(url.pathname,gatewayPrefix);
      const identity=readGatewayIdentity(req.headers,trustGateway);
      if(route==='/api/session'&&req.method==='GET'){
        if(identity){
          const ensured=ensureGatewaySession(req,identity);
          reply(res,200,{
            initialized:!!disk.vault,
            authenticated:true,
            authMode:'gateway',
            locked:isLocked(ensured.session),
            idleLockMs:IDLE_LOCK_MS,
            user:{uid:identity.uid,username:identity.username,isAdmin:identity.isAdmin},
            csrf:ensured.session.csrf
          },ensured.headers);
          return;
        }
        const s=session(req);
        reply(res,200,{initialized:!!disk.vault,authenticated:!!s,authMode:s?'password':null,locked:!!s&&isLocked(s),idleLockMs:IDLE_LOCK_MS,csrf:s?.csrf});
        return;
      }
      if(!route.startsWith('/api/')){
        if(!['GET','HEAD'].includes(req.method))throw fail(405,'不支持的方法');
        const files={'/':'jiadi-ui.html','/jiadi-ui.html':'jiadi-ui.html','/shared-client.js':'shared-client.js','/ledger-domain.mjs':'ledger-domain.mjs','/probe.html':'probe.html'};
        const name=files[route];if(!name)throw fail(404,'文件不存在');
        const html=name.endsWith('.html');
        const headers={
          'Content-Type':html?'text/html;charset=utf-8':'text/javascript;charset=utf-8',
          'Cache-Control':'no-store',
          'X-Content-Type-Options':'nosniff',
          'Referrer-Policy':'same-origin',
          'Content-Security-Policy':trustGateway
            ?"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
            :"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"
        };
        if(!trustGateway)headers['X-Frame-Options']='DENY';
        res.writeHead(200,headers);
        res.end(req.method==='HEAD'?undefined:await readFile(join(root,name)));return;
      }
      if(req.method!=='GET')checkOrigin(req,identity);
      if(route==='/api/setup'&&req.method==='POST'){
        const input=await body(req);
        let headers={},gwSession=null;
        if(identity){
          const ensured=ensureGatewaySession(req,identity);
          if(req.headers['x-jiadi-csrf']!==ensured.session.csrf)throw fail(403,'会话校验失败，请刷新页面');
          headers=ensured.headers;gwSession=ensured.session;
        }
        await transact(async()=>{
          if(disk.vault)throw fail(409,'密码已经设置，请登录');
          if(typeof input.password!=='string'||!pinRule.test(input.password))throw fail(400,'密码需 4–8 位，包含字母和数字');
          await persist({...disk,vault:await makeVault(input.password)});
        });
        if(gwSession){gwSession.unlocked=true;gwSession.lastActive=now();}
        if(!identity)headers=login(res,{authMode:'password',unlocked:true});
        reply(res,200,{ok:true},headers);return;
      }
      if(route==='/api/login'&&req.method==='POST'){
        if(trustGateway)throw fail(400,'请通过飞牛 NAS 统一登录打开应用');
        const input=await body(req);await passwordOK(req,input.password);reply(res,200,{ok:true},login(res,{authMode:'password',unlocked:true}));return;
      }
      let s=session(req);
      let authHeaders={};
      if(!s&&identity){
        const ensured=ensureGatewaySession(req,identity);
        s=ensured.session;authHeaders=ensured.headers;
      }
      if(!s)throw fail(401,trustGateway?'请先登录飞牛 NAS':'请登录共享账本');
      if(req.method!=='GET'&&req.headers['x-jiadi-csrf']!==s.csrf)throw fail(403,'会话校验失败，请刷新页面');
      if(route==='/api/logout'&&req.method==='POST'){
        for(const [key,value] of sessions)if(value===s)sessions.delete(key);
        reply(res,200,{ok:true,...(trustGateway?{hint:'gateway'}:{})},{...authHeaders,...clearSessionCookie()});return;
      }
      if(route==='/api/unlock'&&req.method==='POST'){
        const input=await body(req);
        if(!disk.vault)throw fail(409,'尚未设置密码，请先设置');
        await passwordOK(req,input.password);
        await transact(async()=>{ s.unlocked=true;s.lastActive=now(); });
        reply(res,200,{ok:true,revision:disk.revision},authHeaders);return;
      }
      if(route==='/api/lock'&&req.method==='POST'){
        await transact(async()=>{ s.unlocked=false; });
        reply(res,200,{ok:true},authHeaders);return;
      }
      if(route==='/api/draft'){
        /* 草稿同样属于财务数据：锁定态一律不给 */
        if(isLocked(s))throw fail(423,'账本已锁定，请输入密码解锁');
        if(req.method==='GET'){
          const row=drafts.get(draftKey(s));
          const fresh=row&&now()-row.savedAt<=DRAFT_TTL;
          reply(res,200,{draft:fresh?row.payload:null,savedAt:fresh?row.savedAt:null},authHeaders);return;
        }
        if(req.method==='PUT'){
          const input=await body(req);
          if(!input.draft||typeof input.draft!=='object'||Array.isArray(input.draft))throw fail(400,'草稿格式无效');
          if(Buffer.byteLength(JSON.stringify(input.draft))>256*1024)throw fail(413,'草稿过大');
          if(!putDraft(s,input.draft))throw fail(400,'草稿字段不合法');
          reply(res,200,{ok:true},authHeaders);return;
        }
        if(req.method==='DELETE'){
          drafts.delete(draftKey(s));
          reply(res,200,{ok:true},authHeaders);return;
        }
        throw fail(405,'不支持的方法');
      }
      if(route==='/api/ledger'&&req.method==='GET'){
        if(isLocked(s))throw fail(423,'账本已锁定，请输入密码解锁');
        reply(res,200,state(),authHeaders);return;
      }
      if(route==='/api/ledger'&&req.method==='PUT'){
        if(isLocked(s))throw fail(423,'账本已锁定，请输入密码解锁');
        const input=await body(req);
        const output=await transact(async()=>{
          if(input.revision!==disk.revision)throw fail(409,'账本已在其他设备修改，请刷新后重新录入');
          let ledger;try{ledger=normalizeData(input.ledger);}catch(e){throw fail(400,e.message);}
          if(input.reason==='import'||input.reason==='demo'||input.reason==='clear')await snapshotBeforeReplace(input.reason);
          await persist({...disk,revision:disk.revision+1,ledger,logs:input.clearLogs===true?[]:disk.logs});return state();
        });reply(res,200,output,authHeaders);return;
      }
      if(route==='/api/verify'&&req.method==='POST'){
        const input=await body(req);await passwordOK(req,input.password);reply(res,200,{ok:true},authHeaders);return;
      }
      if(route==='/api/password'&&req.method==='POST'){
        const input=await body(req);
        await transact(async()=>{
          if(disk.vault)await passwordOK(req,input.oldPassword);
          else if(!identity)throw fail(401,'请先设置账本密码');
          if(typeof input.password!=='string'||!pinRule.test(input.password))throw fail(400,'密码需 4–8 位，包含字母和数字');
          await persist({...disk,vault:await makeVault(input.password)});
          for(const [key,value] of sessions)if(value!==s)sessions.delete(key);
        });reply(res,200,{ok:true},authHeaders);return;
      }
      if(route==='/api/export'&&req.method==='POST'){
        const input=await body(req);await passwordOK(req,input.password);
        if(typeof input.content!=='string'||Buffer.byteLength(input.content)>MAX_CONTENT||typeof input.name!=='string'||input.name.length>200)throw fail(400,'导出内容无效或超过 10 MB');
        if(input.ledgerBackup!==true&&input.revision!==disk.revision)throw fail(409,'账本已更新，请刷新后重新导出');
        const content=input.ledgerBackup===true?JSON.stringify({...disk.ledger,exportedAt:new Date(now()).toISOString()}):input.content;
        const limit=input.ledgerBackup===true?MAX_LEDGER_EXPORT:MAX_CONTENT;
        if(Buffer.byteLength(content)>limit)throw fail(413,input.ledgerBackup===true
          ?'账本超过 20 MB，无法一次性导出备份：请先精简历史（例如减少已关闭账户的历史或快照）再导出'
          :'导出内容超过 10 MB');
        reply(res,200,await encryptBackup(content,input.password,input.name),authHeaders);return;
      }
      if(route==='/api/decrypt'&&req.method==='POST'){
        const input=await body(req);const address=req.socket?.remoteAddress||'local';
        const row=attempts.get(address);if(row&&row.until>now()&&row.count>=8)throw fail(429,'密码尝试过多，请一分钟后再试');
        attempts.set(address,{count:row&&row.until>now()?row.count+1:1,until:row&&row.until>now()?row.until:now()+60000});
        const payload=await decryptBackup(input.backup,input.password);   // 解密失败会计入预算，成功则清零
        attempts.delete(address);
        reply(res,200,payload,authHeaders);return;
      }
      if(route==='/api/log'&&['POST','DELETE'].includes(req.method)){
        if(isLocked(s))throw fail(423,'账本已锁定，请输入密码解锁');
        const input=await body(req);
        const logs=await transact(async()=>{
          const rows=req.method==='DELETE'?[]:[{t:new Date(now()).toISOString(),act:String(input.act||'').slice(0,100),obj:String(input.obj||'').slice(0,1000)},...disk.logs].slice(0,200);
          await persist({...disk,logs:rows});return rows;
        });reply(res,200,{logs},authHeaders);return;
      }
      throw fail(404,'接口不存在');
    }catch(e){
      /* 早拒绝（锁定 423、CSRF 403、路由 404 等）发生在读请求体之前：此时还有大量上传数据在途，
         直接 reply + 关闭连接会让客户端收到 ECONNRESET 而不是真正的错误码/文案（大账本 10 MB 级必现，
         并且会污染 keep-alive 连接池，导致后续不相关请求偶发失败）。先把请求体排空再回包。 */
      try{ if(!req.readableEnded) req.resume(); }catch{}
      reply(res,e.status||500,{error:e.status?e.message:'保存或读取失败，请检查服务端数据目录后重试'});
    }
  }
  return {handler,async close(){closed=true;await queue;await lock.close();await unlink(lockPath);}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const socketPath=process.env.FNOS_SOCKET_PATH||process.env.JIADI_GATEWAY_SOCKET||'';
  const gatewayPrefix=process.env.FNOS_GATEWAY_PREFIX||process.env.JIADI_GATEWAY_PREFIX||(socketPath?'/app/jiadi':'');
  const trustGateway=Boolean(socketPath)||process.env.JIADI_TRUST_GATEWAY==='1';
  const app=await createLedgerApp({
    dataDir:resolve(process.env.JIADI_DATA_DIR||join(root,'data')),
    secureCookie:process.env.JIADI_SECURE_COOKIE==='1',
    trustGateway,
    gatewayPrefix
  });
  const server=createServer(app.handler);
  server.on('error',async e=>{console.error('共享服务启动失败：'+e.message);await app.close();process.exitCode=1;});
  const stop=()=>{server.close(async()=>{await app.close();process.exit();});try{server.closeIdleConnections();}catch{}};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  if(socketPath){
    try{if(existsSync(socketPath))unlinkSync(socketPath);}catch{}
    try{mkdirSync(dirname(socketPath),{recursive:true});}catch{}
    server.listen(socketPath,()=>{
      import('node:fs').then(fs=>{try{fs.chmodSync(socketPath,0o777);}catch{}});
      console.log(`家底共享服务已启动（飞牛统一网关）socket=${socketPath} prefix=${gatewayPrefix||'/'}`);
    });
  }else{
    server.listen(Number(process.env.PORT||8080),process.env.HOST||'0.0.0.0',()=>console.log(`家底共享服务已启动，端口 ${server.address().port}；电脑和手机请访问同一服务地址。`));
  }
}
