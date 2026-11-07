/* Shared ledger bootstrap. No asset data or password hash is cached in a browser. */
(async()=>{
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
    let csrf='',started=false,polling=false,authMode=null,nasUser=null;
    async function request(path,{method='GET',body,auth=true}={}){
      let response;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
      try{response=await fetch(api(path),{method,credentials:'same-origin',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Jiadi-CSRF':csrf}:{})},body:body?JSON.stringify(body):undefined});}
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
    async function enter(){
      const status=await request('/api/session');csrf=status.csrf;authMode=status.authMode;nasUser=status.user||null;
      const initial=await request('/api/ledger');
      const shared=window.JIADI_SHARED={...initial,
        request,
        async save(ledger,clearLogs=false){
          const result=await request('/api/ledger',{method:'PUT',body:{revision:this.revision,ledger,clearLogs}});
          this.revision=result.revision;this.ledger=result.ledger;this.logs=result.logs;return result;
        },
        async log(act,obj){try{this.logs=(await request('/api/log',{method:'POST',body:{act,obj}})).logs;}catch(e){statusText('操作日志未保存：'+e.message);}},
        async clearLogs(){this.logs=(await request('/api/log',{method:'DELETE',body:{}})).logs;},
        async verify(password){try{await request('/api/verify',{method:'POST',body:{password}});return true;}catch(e){if(e.status===401)return false;throw e;}},
        async password(password,oldPassword){return request('/api/password',{method:'POST',body:{password,oldPassword}});},
        async export(content,name,password,ledgerBackup=false){return request('/api/export',{method:'POST',body:{content:ledgerBackup?'':content,name,password,ledgerBackup,revision:this.revision}});},
        async decrypt(backup,password){return request('/api/decrypt',{method:'POST',body:{backup,password}});}
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
      const script=document.createElement('script');script.textContent=document.getElementById('ledgerApp').textContent;document.body.appendChild(script);started=true;
      statusText('共享账本已连接 · 版本 '+shared.revision+(authMode==='gateway'?' · 飞牛统一登录':''));
      async function sync(force=false){
        if(polling||window.JIADI_BUSY)return;polling=true;
        if(force){window.JIADI_BUSY=true;document.body.classList.add('saving-ledger');}
        try{
          const result=await request('/api/ledger');shared.logs=result.logs;
          if(force||result.revision!==shared.revision){
            if(!force&&window.jiadiHasDraft?.()){statusText('其他设备已更新；请先处理当前输入，再刷新共享账本');return;}
            window.jiadiApplyRemote(result);shared.revision=result.revision;shared.ledger=result.ledger;
          }
          statusText('共享账本已连接 · 版本 '+shared.revision+(authMode==='gateway'?' · 飞牛统一登录':''));
        }finally{polling=false;if(force){window.JIADI_BUSY=false;document.body.classList.remove('saving-ledger');}}
      }
      const tick=()=>{if(!document.hidden&&!document.querySelector('.app').hidden)sync().catch(e=>statusText(e.message));};
      setInterval(tick,5000);addEventListener('focus',tick);document.addEventListener('visibilitychange',tick);
    }
    function statusText(text){window.jiadiStatus?.(text);}
    const status=await request('/api/session',{auth:false});
    authMode=status.authMode;nasUser=status.user||null;csrf=status.csrf||'';
    if(status.authenticated){
      if(status.authMode==='gateway'&&!status.initialized){
        screen('设置备份与遮罩密码','已通过飞牛 NAS 登录。请设置备份/遮罩密码（4–8 位，含字母和数字）。日常打开应用不再要求此密码。',[['password','备份与遮罩密码'],['confirm','再输入一次']],'保存并进入',async({password,confirm})=>{
          if(password!==confirm)throw new Error('两次输入的密码不一致');
          await request('/api/setup',{method:'POST',body:{password},auth:false});await enter();
        });
        return;
      }
      await enter();return;
    }
    const setup=!status.initialized;
    screen(setup?'建立共享账本':'打开共享账本',setup?'设置一个账本密码。遮罩解锁和加密导出均使用此密码。':'使用账本密码登录。',setup?[['password','密码（4–8 位，含字母和数字）'],['confirm','再输入一次']]:[['password','账本密码']],setup?'创建并进入':'登录',async({password,confirm})=>{
      if(setup&&password!==confirm)throw new Error('两次输入的密码不一致');
      await request(setup?'/api/setup':'/api/login',{method:'POST',body:{password},auth:false});await enter();
    });
  }catch(e){gate.hidden=false;screen('共享账本暂不可用',e.message,[],'重新连接',async()=>location.reload());}
})();
