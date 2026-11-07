/* Shared ledger bootstrap. No asset data or password hash is cached in a browser. */
(async()=>{
  /* 密码/解锁页在应用启动前就要跟随用户主题，否则首次设置密码时是浅色、进去后变暗色 */
  try{
    const t=localStorage.getItem('jiadi.theme')||'auto';
    const dark=t==='dark'||(t==='auto'&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';
  }catch{}
  const gate=document.createElement('section');gate.id='connectionGate';
  gate.style.cssText='max-width:460px;margin:10vh auto;padding:28px;font:14px/1.7 system-ui;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:12px';
  document.body.appendChild(gate);
  const BASE=(()=>{const m=location.pathname.match(/^(.*?\/app\/jiadi)(?=\/|$)/);return m?m[1]:'';})();
  const api=path=>BASE+path;
  function screen(title,description,fields,button,submit){
    gate.replaceChildren();
    const h=document.createElement('h1');h.textContent=title;gate.appendChild(h);
    const p=document.createElement('p');p.textContent=description;gate.appendChild(p);
    const form=document.createElement('form'),error=document.createElement('p');error.setAttribute('role','alert');error.style.color='var(--debt)';
    for(const [name,label] of fields){const wrap=document.createElement('label');wrap.textContent=label;wrap.style.display='block';const input=document.createElement('input');input.name=name;input.type='password';input.autocomplete=name==='confirm'?'new-password':'current-password';input.required=true;input.style.cssText='display:block;width:100%;padding:10px;margin:6px 0 14px';wrap.appendChild(input);form.appendChild(wrap);}
    const b=document.createElement('button');b.textContent=button;b.className='btn primary';form.append(b,error);gate.appendChild(form);
    form.onsubmit=async e=>{e.preventDefault();b.disabled=true;error.textContent='';try{await submit(Object.fromEntries(new FormData(form)));}catch(e){error.textContent=e.message;}finally{b.disabled=false;}};
  }
  if(!window.JIADI_TEST_LOCAL&&location.protocol==='file:'){
    let raw=null;try{raw=localStorage.getItem('jiadi.data.v1');}catch{}
    screen('请通过飞牛应用或共享服务打开','在飞牛 NAS 应用中心打开「家底」，或运行 node server.mjs。旧浏览器数据不会自动覆盖共享账本。',raw?[['password','旧遮罩密码（未设过密码则为备份设置密码）']]:[],raw?'下载旧账本加密迁移备份':'知道了',async({password})=>{
      if(!raw)return;
      if(!/^(?=.*[A-Za-z])(?=.*\d)\S{4,8}$/.test(password||''))throw new Error('密码需 4–8 位，包含字母和数字');
      let vault;try{vault=JSON.parse(localStorage.getItem('jiadi.privacy.vault'));}catch{throw new Error('旧密码记录损坏，请使用保留的旧版本恢复');}
      if(vault){
        if(!/^[a-f0-9]{32}$/.test(vault.salt)||!Number.isInteger(vault.iter)||vault.iter<1||vault.iter>100000)throw new Error('旧密码记录无效');
        const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
        let hash=await sha(vault.salt+':'+password);for(let i=1;i<vault.iter;i++)hash=await sha(hash+':'+vault.salt);
        if(hash!==vault.hash)throw new Error('旧遮罩密码不正确');
      }
      const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
      const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
      const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt']);
      const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('jiadi.encrypted.v1')},key,new TextEncoder().encode(JSON.stringify({name:'jiadi-migration.json',content:raw}))));
      const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
      const backup={format:'jiadi.encrypted',v:1,kdf:'pbkdf2-sha256-210000',cipher:'aes-256-gcm',salt:b64(salt),iv:b64(iv),tag:b64(data.slice(-16)),data:b64(data.slice(0,-16))};
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='jiadi-migration.encrypted.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    });return;
  }
  try{
    window.JIADI_DOMAIN ||= await import(api('/ledger-domain.mjs'));
    if(window.JIADI_TEST_LOCAL){
      gate.remove();document.body.dataset.ledgerReady='1';document.querySelector('.app').hidden=false;
      const script=document.createElement('script');script.textContent=document.getElementById('ledgerApp').textContent;document.body.appendChild(script);return;
    }
    let csrf='',started=false,polling=false,authMode=null,nasUser=null,vaultReady=false;   // vaultReady：是否已设过应用密码（没密码就不存在上锁这回事）
    async function request(path,{method='GET',body,auth=true,headers={}}={}){
      let response;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{response=await fetch(api(path),{method,credentials:'same-origin',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Jiadi-CSRF':csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});}
      catch{const e=new Error(method==='PUT'?'保存结果未确认，请刷新核对后再操作':'无法连接共享服务，请检查服务是否运行');e.uncertain=method==='PUT';throw e;}
      finally{clearTimeout(timer);}
      let data;try{data=await response.json();}catch{const e=new Error(method==='PUT'?'保存结果未确认，请刷新核对后再操作':'服务响应无效，请重试');e.uncertain=method==='PUT';throw e;}
      if(!response.ok){const e=new Error(data.error||'请求失败');e.status=response.status;if(auth&&response.status===401&&(data.error==='请登录共享账本'||data.error==='请先登录飞牛 NAS'||!['/api/verify','/api/export','/api/password','/api/decrypt'].includes(path)))expire();throw e;}
      return data;
    }
    function expire(){
      if(!started)return;
      window.jiadiEndSession?.();delete document.body.dataset.ledgerReady;
      document.querySelector('.app').hidden=true;
      gate.hidden=false;
      if(authMode==='gateway'){
        screen('飞牛登录已失效','请重新登录飞牛 NAS 后再打开「家底」。未提交的输入不会自动写入。',[],'重新连接',async()=>location.reload());
        return;
      }
      screen('会话已结束','重新登录后读取共享账本。未提交的输入不会自动写入。',[['password','账本密码']],'重新登录',async({password})=>{await request('/api/login',{method:'POST',body:{password},auth:false});location.reload();});
    }
    /* 解锁页：既是首次进入的门，也是自动上锁后的回退页 */
    function showLockScreen(){
      screen('家底已锁定','为保护账本，已自动锁定。请输入应用密码解锁。注意：锁定前未提交的输入不会保留。',[['password','应用密码']],'解锁',async({password})=>{
        await request('/api/unlock',{method:'POST',body:{password}});
        /* 用户明确输密码解锁了，「上次没锁成的补锁」这条意图就该作废：
           否则 enter() 会立刻再锁一次并弹回本页，表现成"密码对了却又回到锁定页"，要输两遍才能进。 */
        try{localStorage.removeItem('jiadi.lockPending');}catch{}
        await enter();
      });
    }
    async function enter(){
      const status=await request('/api/session');csrf=status.csrf;authMode=status.authMode;nasUser=status.user||null;
      vaultReady=status.initialized===true;
      if(status.locked){showLockScreen();return;}
      /* 服务端还没锁、但上一轮 lockNow 的 /api/lock 失败了：这里补一刀再显示锁定页。
         还没设过应用密码时不走这条路：那时既没有可锁的东西，也会把人卡在「输入应用密码解锁」页而根本无密码可解。 */
      if(localStorage.getItem('jiadi.lockPending')){
        try{localStorage.removeItem('jiadi.lockPending');}catch{}
        if(vaultReady){try{await request('/api/lock',{method:'POST',body:{}});}catch{}showLockScreen();return;}
      }
      let initial;
      try{ initial=await request('/api/ledger'); }
      catch(e){
        if(e.status===423){ showLockScreen(); return; }   // 拉数据瞬间被锁，回到解锁页而不是报错页
        throw e;
      }
      const shared=window.JIADI_SHARED={...initial,
        request,
        async save(ledger,clearLogs=false,reason=''){
          const result=await request('/api/ledger',{method:'PUT',body:reason?{revision:this.revision,ledger,clearLogs,reason}:{revision:this.revision,ledger,clearLogs}});
          this.revision=result.revision;this.ledger=result.ledger;this.logs=result.logs;return result;
        },
        async log(act,obj){try{this.logs=(await request('/api/log',{method:'POST',body:{act,obj}})).logs;}catch(e){statusText('操作日志未保存：'+e.message);}},
        async clearLogs(){this.logs=(await request('/api/log',{method:'DELETE',body:{}})).logs;},
        async verify(password){try{await request('/api/verify',{method:'POST',body:{password}});return true;}catch(e){if(e.status===401)return false;throw e;}},
        async password(password,oldPassword){return request('/api/password',{method:'POST',body:{password,oldPassword}});},
        async export(content,name,password,ledgerBackup=false){return request('/api/export',{method:'POST',body:{content:ledgerBackup?'':content,name,password,ledgerBackup,revision:this.revision}});},
        async decrypt(backup,password){return request('/api/decrypt',{method:'POST',body:{backup,password}});},
        markVaultReady(){vaultReady=true;return vaultReady;}            // 引导页设完应用密码后调用：从这一刻起空闲锁才生效
      };
      gate.hidden=true;document.body.dataset.ledgerReady='1';document.querySelector('.app').hidden=false;
      const statusBar=document.createElement('div');statusBar.id='sharedStatus';statusBar.setAttribute('role','status');statusBar.style.cssText='position:sticky;top:0;z-index:12;padding:8px 16px;background:var(--raised);color:var(--ink-2);font:12px/1.6 system-ui;display:flex;gap:12px;flex-wrap:wrap;align-items:center';
      const label=document.createElement('span');label.id='sharedStatusText';
      const refresh=document.createElement('button');refresh.className='btn sm';refresh.textContent='刷新共享账本';refresh.onclick=async()=>{
        if(window.JIADI_BUSY)return;
        if(window.jiadiHasDraft?.()&&!confirm('刷新会放弃当前未提交的输入，继续吗？'))return;
        try{await sync(true);}catch(e){statusText(e.message);}
      };
      statusBar.append(label,refresh);
      if(authMode==='gateway'){
        const who=document.createElement('span');
        who.textContent=nasUser?.username?`飞牛用户 ${nasUser.username}`:'已通过飞牛登录';
        statusBar.append(who);
      }else{
        const logout=document.createElement('button');logout.className='btn sm';logout.textContent='退出登录';logout.onclick=async()=>{try{await request('/api/logout',{method:'POST',body:{}});location.reload();}catch(e){statusText(e.message);}};
        statusBar.append(logout);
      }
      document.body.prepend(statusBar);
      function statusText(text){label.textContent=text;}
      window.jiadiStatus=statusText;
      /* 清理旧版本遗留的本机副本：共享模式下账本只在服务端，本地存一份（含账户名与金额）
         等于给 F12/Application 留了后门；fnOS 微应用同源，其他应用理论上也读得到。 */
      try{
        const stale=['jiadi.data.v1','jiadi.log.v1','jiadi.privacy.vault','jiadi.privacy.pin'];
        let purged=0;
        for(const k of stale){ if(localStorage.getItem(k)!==null){localStorage.removeItem(k);purged++;} }
        if(purged) setTimeout(()=>{try{statusText('已清理旧版本遗留在本机的账本副本 · 数据在服务端，不受影响');}catch{}},1200);
      }catch{}
      const script=document.createElement('script');script.textContent=document.getElementById('ledgerApp').textContent;document.body.appendChild(script);started=true;
      /* 解锁后取回上次锁定前存的草稿 */
      request('/api/draft').then(r=>{
        if(r&&r.draft) setTimeout(()=>{ try{ window.jiadiSetDraft?.(r.draft); }catch{} }, 600);
      }).catch(()=>{});
      statusText('共享账本已连接 · 版本 '+shared.revision+(authMode==='gateway'?' · 飞牛统一登录':''));
      async function sync(force=false){
        if(polling||window.JIADI_BUSY)return;polling=true;
        if(force){window.JIADI_BUSY=true;document.body.classList.add('saving-ledger');}
        try{
          const result=await request('/api/ledger',{headers:{'X-Jiadi-Background':'1'}});shared.logs=result.logs;
          if(force||result.revision!==shared.revision){
            if(!force&&window.jiadiHasDraft?.()){statusText('其他设备已更新；请先处理当前输入，再刷新共享账本');return;}
            window.jiadiApplyRemote(result);shared.revision=result.revision;shared.ledger=result.ledger;
          }
          statusText('共享账本已连接 · 版本 '+shared.revision+(authMode==='gateway'?' · 飞牛统一登录':''));
        }finally{polling=false;if(force){window.JIADI_BUSY=false;document.body.classList.remove('saving-ledger');}}
      }
      const tick=()=>{if(!document.hidden&&!document.querySelector('.app').hidden)sync().catch(e=>{
        if(e.status===423){lockNow();return;}
        statusText(e.message);
      });};
      setInterval(tick,5000);addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);

      /* 空闲锁：与页面的交互刷新计时；后台轮询用的是 X-Jiadi-Background，不会续期。
         到点后先请服务端上锁（数据立即不再下发），再重载页面回到解锁页。 */
      const IDLE_MS=Number(status.idleLockMs)||15*60*1000;
      let idleTimer=null,locking=false;
      async function lockNow(){
        if(locking)return;
        if(!vaultReady)return;          // 还没设过应用密码：没有可锁的东西，也别把正在填的密码步刷掉
        locking=true;
        /* 锁定前把未提交草稿交给服务端暂存（内存、锁定态不可读），解锁后自动取回 */
        try{ const d=window.jiadiGetDraft?.(); if(d) await request('/api/draft',{method:'PUT',body:{draft:d}}); }catch{}
        try{await request('/api/lock',{method:'POST',body:{}});}
        catch(e){try{localStorage.setItem('jiadi.lockPending','1');}catch{}}   // 没锁成也要在下次加载时补上
        location.reload();
      }
      let deferrals=0;
      function armIdle(reset){
        if(reset===true)deferrals=0;            // 只有真人操作才清零顺延计数
        clearTimeout(idleTimer);
        idleTimer=setTimeout(()=>{
          /* 有未提交输入时顺延，但最多顺延 2 次（累计 3 倍空闲时长），否则停在盘点页会永不锁定 */
          if(window.jiadiHasDraft?.() && deferrals<2){deferrals++;armIdle(false);return;}
          lockNow();
        },IDLE_MS);
      }
      ['mousedown','keydown','touchstart','wheel','scroll'].forEach(ev=>addEventListener(ev,()=>armIdle(true),{passive:true}));
      armIdle(true);
    }
    function statusText(text){window.jiadiStatus?.(text);}
    const status=await request('/api/session',{auth:false});
    authMode=status.authMode;nasUser=status.user||null;csrf=status.csrf||'';
    if(status.authenticated){
      /* 首次使用（还没设过应用密码）：不再单独弹一个密码页，直接进应用，
         由首次引导页的第一步负责设置密码（该步不可跳过，见 jiadi-ui.html 的 onbSteps）。
         vault 为空时服务端不会上锁，所以能先读到空账本再设密码。 */
      if(status.authMode==='gateway'&&!status.initialized) window.JIADI_NEEDS_PASSWORD=true;
      if(status.locked){ showLockScreen(); return; }
      await enter();return;
    }
    const setup=!status.initialized;
    screen(setup?'建立共享账本':'打开共享账本',setup?'设置应用密码（4–8 位，含字母和数字）。打开账本、空闲 15 分钟后重新解锁、以及加密导出都需要它。':'请输入应用密码。',setup?[['password','应用密码（4–8 位，含字母和数字）'],['confirm','再输入一次']]:[['password','应用密码']],setup?'创建并进入':'解锁',async({password,confirm})=>{
      if(setup&&password!==confirm)throw new Error('两次输入的密码不一致');
      await request(setup?'/api/setup':'/api/login',{method:'POST',body:{password},auth:false});await enter();
    });
  }catch(e){gate.hidden=false;screen('共享账本暂不可用',e.message,[],'重新连接',async()=>location.reload());}
})();
