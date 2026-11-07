export function todayStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
export function normalizeData(o){
  const fail = msg=>{throw new Error(msg);};
  const text = (v,label,max=1000)=>{ if(typeof v!=='string' || v.length>max) fail(label+' 必须是文本且不超过 '+max+' 字'); return v; };
  const money = (v,label,max=1e12)=>{ if(typeof v!=='number' || !Number.isFinite(v) || v<0 || v>max || Math.round(v*100)/100!==v) fail(label+' 必须是范围内的有效非负金额（最多两位小数）'); return v; };
  const date = (v,label,empty=false)=>{
    if(empty && v==='') return v;
    const parsed=typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v+'T00:00:00Z') : null;
    if(!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10)!==v) fail(label+' 不是有效日期');
    return v;
  };
  if(!o || typeof o!=='object' || Array.isArray(o)) fail('不是合法的 JSON 对象');
  if(o.v!==undefined && o.v!==1) fail('不支持的数据版本');
  if(!Array.isArray(o.accounts)) fail('文件里没有 accounts 数组');
  for(const k of ['members','archived','snapshots']) if(o[k]!==undefined && !Array.isArray(o[k])) fail(k+' 必须是数组');
  const names=new Set(), ids=new Set(), cats=['现金','存款','投资','固定资产','负债'];
  const palette=['#2F4B6E','#5B8CB8','#6E9A72','#9CA3AF','#7A5C3E','#4E6B4F'];
  const members=(o.members||[]).map((m,i)=>{
    if(typeof m==='string') m={name:m};
    if(!m || typeof m!=='object') fail('成员格式无效');
    const name=text(m.name,'成员名称',80).trim();
    if(!name || names.has(name)) fail('成员名称为空或重复'); names.add(name);
    const color=(v,fallback)=>{ if(v===undefined) return fallback; if(typeof v!=='string' || !/^#[0-9a-f]{6}$/i.test(v)) fail('成员颜色须为六位十六进制颜色'); return v; };
    return {name,color:color(m.color,palette[i%palette.length]),colorDark:color(m.colorDark,m.color||palette[i%palette.length]),shared:name==='共同'};
  });
  const accounts=o.accounts.map((a,i)=>{
    if(!a || typeof a!=='object' || Array.isArray(a)) fail('账户格式无效');
    const id=text(a.id===undefined?'import-'+i:a.id,'账户 ID',100);
    if(!id || ids.has(id)) fail('账户 ID 为空或重复'); ids.add(id);
    const name=text(a.name,'账户名称',120).trim(); if(!name) fail('账户名称为空');
    const cat=a.cat===undefined?(a.isDebt?'负债':'现金'):a.cat; if(!cats.includes(cat)) fail('未知账户类别');
    const member=text(a.member===undefined?'共同':a.member,'账户成员',80).trim(); if(!member) fail('账户成员为空');
    if(!names.has(member)){ if(o.members!==undefined && o.members.length) fail('账户归属不存在的成员：'+member); names.add(member); members.push({name:member,color:palette[members.length%palette.length],colorDark:palette[members.length%palette.length],shared:member==='共同'}); }
    for(const k of ['inNet','remind','closed','isDebt','closedInNet']) if(a[k]!==undefined && typeof a[k]!=='boolean') fail(k+' 必须为布尔值');
    if(a.isDebt!==undefined && a.isDebt!==(cat==='负债')) fail('账户类别与是否负债不一致');
    const amount=money(a.amount,'账户余额'), dt=date(a.date===undefined?todayStr():a.date,'数据日期');
    if(a.history!==undefined && !Array.isArray(a.history)) fail('账户历史必须为数组');
    const history=(a.history||[]).map(h=>{ if(!h || typeof h!=='object') fail('历史记录格式无效'); return {date:date(h.date,'历史日期'),amount:money(h.amount,'历史余额')}; }).sort((a,b)=>a.date.localeCompare(b.date));
    if(history.some(h=>h.date>dt)) fail('历史记录日期晚于账户数据日期');
    if(a.months!==undefined && (!Number.isInteger(a.months) || a.months<0)) fail('记录期数无效');
    return {id,name,cat,member,amount,prev:money(a.prev===undefined?amount:a.prev,'上次余额'),date:dt,opened:date(a.opened===undefined?dt:a.opened,'开户日'),due:date(a.due===undefined?'':a.due,'到期日',true),note:text(a.note===undefined?'':a.note,'备注'),inNet:a.inNet!==false,remind:a.remind!==false,isDebt:cat==='负债',closed:!!a.closed,closedAt:date(a.closedAt===undefined?'':a.closedAt,'关闭日',true),closedInNet:a.closedInNet!==false,months:a.months===undefined?new Set(history.map(h=>h.date.slice(0,7))).size:a.months,history};
  });
  const snapshots=(o.snapshots||[]).map(sn=>{
    if(!sn || typeof sn!=='object' || typeof sn.month!=='string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(sn.month)) fail('快照月份无效');
    const out={month:sn.month,A:money(sn.A,'快照资产',Number.MAX_SAFE_INTEGER/100),L:money(sn.L,'快照负债',Number.MAX_SAFE_INTEGER/100)};
    if(sn.date!==undefined){out.date=date(sn.date,'快照日期'); if(out.date.slice(0,7)!==out.month) fail('快照日期与月份不符');}
    if(sn.categories!==undefined){
      if(!sn.categories || typeof sn.categories!=='object') fail('快照分类无效');
      out.categories=Object.fromEntries(cats.slice(0,4).map(c=>[c,money(sn.categories[c],'分类资产',Number.MAX_SAFE_INTEGER/100)]));
      if(Object.values(out.categories).reduce((a,b)=>a+Math.round(b*100),0)!==Math.round(out.A*100)) fail('快照分类合计不等于总资产');
    }
    return out;
  });
  const archived=(o.archived||[]).map((a,i)=>{
    if(!a || typeof a!=='object') fail('归档成员格式无效');
    if(!Number.isInteger(a.accounts) || a.accounts<0 || typeof a.net!=='number') fail('归档成员金额或账户数无效');
    money(Math.abs(a.net),'归档成员净额',Number.MAX_SAFE_INTEGER/100);
    return {id:text(a.id===undefined?'archived-'+i:a.id,'归档 ID',100),name:text(a.name,'归档成员名称',80),accounts:a.accounts,net:a.net,note:text(a.note===undefined?'':a.note,'归档备注')};
  });
  return {v:1,accounts,members,archived,snapshots};
}
