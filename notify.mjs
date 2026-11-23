/**
 * 家底 · 提醒推送（渠道与参数名对齐「日志推送 / FnMessageBot」，方便一键导入它的配置）
 *
 * 只发纯文本，不带具体金额明细，避免推到群里等于公开账目。
 * 配置存在数据目录的 notify.json（0600），不进账本——账本会下发给每个客户端。
 */

export const CHANNELS = [
  { key: 'wechat',    name: '企业微信（群机器人）', kind: 'url',  env: 'WECHAT_WEBHOOK_URL' },
  { key: 'dingtalk',  name: '钉钉（群机器人）',     kind: 'url',  env: 'DINGTALK_WEBHOOK_URL' },
  { key: 'feishu',    name: '飞书（群机器人）',     kind: 'url',  env: 'FEISHU_WEBHOOK_URL' },
  { key: 'bark',      name: 'Bark（iOS 推送）',     kind: 'url',  env: 'BARK_URL' },
  { key: 'pushplus',  name: 'PushPlus',             kind: 'json', env: 'PUSHPLUS_PARAMS', need: ['token'] },
  { key: 'magicpush', name: '魔法推送',             kind: 'json', env: 'MAGIC_PUSH_PARAMS', need: ['base_url', 'token'] },
  { key: 'smtp',      name: 'SMTP 邮件',            kind: 'json', env: 'SMTP_PARAMS', need: ['host', 'to'] },
  { key: 'wecomapp',  name: '企业微信应用',         kind: 'json', env: 'WECOM_APP_PARAMS', need: ['corp_id', 'corp_secret', 'agent_id'] },
  { key: 'webhook',   name: '通用 Webhook',         kind: 'json', env: 'WEBHOOK_PARAMS', need: ['url'] },
  { key: 'meow',      name: 'MeoW',                 kind: 'json', env: 'MEOW_PARAMS', need: ['api_base', 'nickname'] },
];
const BY_KEY = new Map(CHANNELS.map(c => [c.key, c]));

export const DEFAULT_NOTIFY = { enabled: false, cron: '0 9 * * *', channels: {}, lastRun: null };

/* ---------------- cron（5 段：分 时 日 月 周） ---------------- */

const CRON_FIELD = {
  minute: [0, 59], hour: [0, 23], dom: [1, 31], month: [1, 12], dow: [0, 7],
};

function parseField(raw, name, min, max) {
  const out = new Set();
  for (const part of String(raw).split(',')) {
    const text = part.trim();
    if (!text) throw new Error(name + ' 段有空项');
    const [rangeText, stepText] = text.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1 || step > max) throw new Error(name + ' 段的步长不合法');
    let from, to;
    if (rangeText === '*') { from = min; to = max; }
    else if (rangeText.includes('-')) {
      const [a, b] = rangeText.split('-').map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(name + ' 段范围不合法');
      from = Math.min(a, b); to = Math.max(a, b);
    } else {
      const v = Number(rangeText);
      if (!Number.isInteger(v)) throw new Error(name + ' 段出现非数字');
      from = to = v;
    }
    if (from < min || to > max) throw new Error(name + ' 段超出 ' + min + '–' + max);
    for (let v = from; v <= to; v += step) out.add(name === 'dow' && v === 7 ? 0 : v);
  }
  return out;
}

export function parseCron(expr) {
  const fields = String(expr || '').trim().split(/\s+/);
  if (fields.length !== 5) throw new Error('cron 必须是 5 段：分 时 日 月 周');
  const [m, h, dom, mon, dow] = fields;
  return {
    minute: parseField(m, 'minute', ...CRON_FIELD.minute),
    hour: parseField(h, 'hour', ...CRON_FIELD.hour),
    dom: parseField(dom, 'dom', ...CRON_FIELD.dom),
    month: parseField(mon, 'month', ...CRON_FIELD.month),
    dow: parseField(dow, 'dow', ...CRON_FIELD.dow),
  };
}

export function validCron(expr) {
  try { parseCron(expr); return true; } catch { return false; }
}

/** 分钟级匹配；日与周同时受限时按 cron 惯例取「或」 */
export function cronMatches(expr, date) {
  const c = parseCron(expr);
  const minute = date.getMinutes(), hour = date.getHours();
  const dom = date.getDate(), month = date.getMonth() + 1, dow = date.getDay();
  if (!c.minute.has(minute) || !c.hour.has(hour) || !c.month.has(month)) return false;
  const domAll = c.dom.size === 31, dowAll = c.dow.size === 7;
  const domOk = c.dom.has(dom), dowOk = c.dow.has(dow);
  if (domAll && dowAll) return true;
  if (domAll) return dowOk;
  if (dowAll) return domOk;
  return domOk || dowOk;
}

export function nextRuns(expr, from = new Date(), count = 3, limitMinutes = 60 * 24 * 366) {
  const out = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let i = 0; i < limitMinutes && out.length < count; i++) {
    if (cronMatches(expr, cursor)) out.push(new Date(cursor.getTime()));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}

export function describeCron(expr) {
  try { parseCron(expr); } catch (e) { return e.message; }
  const [m, h, dom, mon, dow] = String(expr).trim().split(/\s+/);
  const at = (h === '*' || m === '*') ? '每小时第 ' + m + ' 分' : h + ':' + String(m).padStart(2, '0');
  if (h === '*' || m === '*') return '每隔 ' + (m === '*' ? 1 : m) + ' 分钟';
  if (mon === '*' && dom === '*' && dow === '*') return '每天 ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  if (mon === '*' && dom === '*' && dow !== '*') return '每周 ' + ['日', '一', '二', '三', '四', '五', '六'][Number(dow)] + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  if (mon === '*' && dow === '*' && dom !== '*') return '每月 ' + dom + ' 日 ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  if (dow === '*' && dom === '*') return '每年 ' + mon + ' 月每天 ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  return at;
}

/* ---------------- 渠道配置 ---------------- */

const SENSITIVE = /key|secret|token|password|pass|webhook|url|corp/i;

export function splitMulti(value) {
  return String(value || '').split('|').map(s => s.trim()).filter(Boolean);
}

export function maskConfig(channels = {}) {
  const out = {};
  for (const [key, raw] of Object.entries(channels)) {
    if (!raw) continue;
    if (BY_KEY.get(key)?.kind === 'url') {
      out[key] = splitMulti(raw).map(maskUrl).join(' | ');
    } else {
      const parts = splitMulti(raw).map(s => {
        try { return JSON.stringify(maskObject(JSON.parse(s))); } catch { return '（格式无效）'; }
      });
      out[key] = parts.join(' | ');
    }
  }
  return out;
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').filter(Boolean).pop() || '';
    const head = tail ? tail.slice(-4) : '';
    return u.origin + '/…' + (head ? head : '');
  } catch { return '…'; }
}

function maskObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'string' && SENSITIVE.test(k) && v.length > 4) out[k] = v.slice(0, 2) + '…' + v.slice(-2);
    else out[k] = v;
  }
  return out;
}

export function isMasked(value) {
  return typeof value === 'string' && value.includes('…');
}

/** 校验 + 生成待存配置：把每个渠道的原始值规整成字符串（多套用 | 分隔） */
export function normalizeNotifyConfig(input = {}) {
  const cfg = {
    enabled: !!input.enabled,
    cron: String(input.cron || DEFAULT_NOTIFY.cron).trim(),
    channels: {},
  };
  parseCron(cfg.cron);
  const channels = input.channels || {};
  for (const [key, value] of Object.entries(channels)) {
    const meta = BY_KEY.get(key);
    if (!meta) continue;
    const text = String(value == null ? '' : value).trim();
    if (!text) continue;
    for (const piece of splitMulti(text)) {
      if (meta.kind === 'url') {
        let u;
        try { u = new URL(piece); } catch { throw new Error(meta.name + ' 的地址不是合法 URL'); }
        if (!/^https?:$/.test(u.protocol)) throw new Error(meta.name + ' 只支持 http/https 地址');
      } else {
        let obj;
        try { obj = JSON.parse(piece); } catch { throw new Error(meta.name + ' 的参数必须是 JSON 对象'); }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error(meta.name + ' 的参数必须是 JSON 对象');
        for (const need of meta.need || []) {
          if (!obj[need]) throw new Error(meta.name + ' 缺少 ' + need);
        }
      }
    }
    cfg.channels[key] = text;
  }
  if (cfg.enabled && !Object.keys(cfg.channels).length) throw new Error('至少配置一个推送渠道');
  return cfg;
}

/** 保存时遇到界面回传的掩码值就保留旧值 */
export function mergeMaskedChannels(previous = {}, incoming = {}) {
  const out = { ...previous };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (isMasked(value)) continue;
    if (String(value || '').trim() === '') delete out[key];
    else out[key] = String(value).trim();
  }
  return out;
}

/* ---------------- 报文 ---------------- */

export function buildPayload(key, params, message) {
  const text = message.content ? message.title + '\n' + message.content : message.title;
  const title = message.title || '家底';
  switch (key) {
    case 'wechat':
    case 'dingtalk':
      return { url: params, body: { msgtype: 'text', text: { content: text } } };
    case 'feishu':
      return { url: params, body: { msg_type: 'text', content: { text } } };
    case 'bark': {
      const u = new URL(params);
      const device = u.pathname.split('/').filter(Boolean).pop() || '';
      const body = { device_key: device, title, body: message.content || title };
      return { url: u.origin + '/push', body };
    }
    case 'pushplus':
      return { url: 'https://www.pushplus.plus/send', body: { ...params, title, content: text } };
    case 'magicpush': {
      const base = String(params.base_url || '').replace(/\/+$/, '');
      const path = params.use_inbound ? 'inbound' : 'push';
      return { url: base + '/api/' + path + '/' + encodeURIComponent(params.token), body: { title, content: message.content || text, type: 'text' } };
    }
    case 'webhook': {
      const values = { title, content: message.content || '', text, time: message.time };
      const render = v => String(v == null ? '' : v).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
      const body = params.body ? render(typeof params.body === 'string' ? params.body : JSON.stringify(params.body)) : JSON.stringify(values);
      const headers = { 'content-type': 'application/json', ...(params.headers || {}) };
      return { url: params.url, method: params.method || 'POST', headers, body };
    }
    case 'meow':
      return { url: String(params.api_base).replace(/\/+$/, '') + '/' + encodeURIComponent(params.nickname), body: { title, msg: message.content || title } };
    case 'wecomapp':
    case 'smtp':
      return null;   // 单独实现
    default:
      throw new Error('未知渠道 ' + key);
  }
}

const isOkBody = (key, status, body) => {
  if (status >= 300) return false;
  if (!body || typeof body !== 'object') return true;
  if (key === 'feishu' && body.code !== undefined && body.code !== 0) return false;
  if ((key === 'wechat' || key === 'dingtalk') && body.errcode !== undefined && body.errcode !== 0) return false;
  if (key === 'pushplus' && body.code !== undefined && body.code !== 200) return false;
  if (key === 'magicpush' && body.success === false) return false;
  if (key === 'meow' && body.status !== undefined && body.status !== 'success' && body.status !== 'ok') return false;
  return true;
};

async function postJson(fetchImpl, url, body, headers) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let parsed = null;
  try { parsed = await res.json(); } catch {}
  return { status: res.status, body: parsed };
}

/* 企业微信自建应用：gettoken → message/send */
async function sendWecomApp(fetchImpl, params, message) {
  const api = String(params.api_base || 'https://qyapi.weixin.qq.com').replace(/\/+$/, '');
  const tokenRes = await fetchImpl(api + '/cgi-bin/gettoken?corpid=' + encodeURIComponent(params.corp_id) + '&corpsecret=' + encodeURIComponent(params.corp_secret), { signal: AbortSignal.timeout(10000) });
  const tokenBody = await tokenRes.json().catch(() => null);
  const token = tokenBody && tokenBody.access_token;
  if (!token) return { ok: false, detail: '取 access_token 失败', response: tokenBody };
  const text = message.content ? message.title + '\n' + message.content : message.title;
  const send = await postJson(fetchImpl, api + '/cgi-bin/message/send?access_token=' + encodeURIComponent(token), {
    touser: params.to_user || '@all', toparty: params.to_party || '', totag: params.to_tag || '',
    msgtype: 'text', agentid: Number(params.agent_id), text: { content: text.slice(0, 2000) },
  });
  return { ok: send.status < 300 && !(send.body && send.body.errcode), response: send.body, detail: send.body && send.body.errmsg };
}

/* ---------------- 入口 ---------------- */

export async function sendToChannel(key, value, message, { fetchImpl = globalThis.fetch } = {}) {
  const meta = BY_KEY.get(key);
  if (!meta) return [{ channel: key, ok: false, detail: '未知渠道' }];
  const results = [];
  for (const piece of splitMulti(value)) {
    let params;
    if (meta.kind === 'url') params = piece;
    else {
      try { params = JSON.parse(piece); } catch { results.push({ channel: meta.name, ok: false, detail: '参数不是合法 JSON' }); continue; }
    }
    try {
      if (key === 'wecomapp') {
        const r = await sendWecomApp(fetchImpl, params, message);
        results.push({ channel: meta.name, ok: !!r.ok, detail: r.detail || '', response: r.response });
        continue;
      }
      if (key === 'smtp') {
        const r = await sendMail(params, message);
        results.push({ channel: meta.name, ok: !!r.ok, detail: r.detail || '' });
        continue;
      }
      const req = buildPayload(key, params, message);
      const { status, body } = await postJson(fetchImpl, req.url, req.body, req.headers);
      const ok = isOkBody(key, status, body);
      results.push({ channel: meta.name, ok, detail: ok ? '' : 'HTTP ' + status + (body && body.errmsg ? ' ' + body.errmsg : ''), response: body });
    } catch (e) {
      results.push({ channel: meta.name, ok: false, detail: String((e && e.message) || e).slice(0, 160) });
    }
  }
  return results;
}

export async function sendAll(channels, message, opts = {}) {
  const results = [];
  for (const [key, value] of Object.entries(channels || {})) {
    if (!value) continue;
    results.push(...await sendToChannel(key, value, message, opts));
  }
  return { ok: results.some(r => r.ok), results };
}

/* ---------------- 最小 SMTP（无依赖） ---------------- */
async function sendMail(params, message) {
  const net = await import('node:net');
  const tls = await import('node:tls');
  const host = String(params.host || '');
  const port = Number(params.port || (params.secure === false ? 587 : 465));
  const secure = params.secure !== false && port === 465;
  const user = String(params.user || params.username || '');
  const pass = String(params.password || params.pass || '');
  const from = String(params.from || user);
  const to = Array.isArray(params.to) ? params.to : splitMulti(String(params.to || '').replace(/,/g, '|'));
  if (!host || !to.length) return { ok: false, detail: 'SMTP 缺少 host 或 to' };
  const subject = '=?UTF-8?B?' + Buffer.from(message.title || '家底').toString('base64') + '?=';
  const bodyText = (message.content || message.title || '').replace(/\r?\n/g, '\r\n');
  const mail = [
    'From: ' + from, 'To: ' + to.join(', '), 'Subject: ' + subject, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(bodyText, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');

  let socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  const expect = (code) => new Promise((resolve, reject) => {
    let buf = '';
    const onData = chunk => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        socket.removeListener('data', onData);
        buf = '';
        String(last).startsWith(String(code)) ? resolve(last) : reject(new Error('SMTP 期待 ' + code + '，得到 ' + last));
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
    setTimeout(() => reject(new Error('SMTP 超时')), 15000).unref?.();
  });
  const write = line => new Promise(r => socket.write(line + '\r\n', r));
  try {
    await new Promise((res, rej) => { socket.once(secure ? 'secureConnect' : 'connect', res); socket.once('error', rej); });
    await expect(220);
    await write('EHLO jiadi'); await expect(250);
    if (!secure) { await write('STARTTLS'); await expect(220); socket = tls.connect({ socket, servername: host }); await expect(220).catch(() => {}); await write('EHLO jiadi'); await expect(250); }
    if (user) {
      await write('AUTH LOGIN'); await expect(334);
      await write(Buffer.from(user).toString('base64')); await expect(334);
      await write(Buffer.from(pass).toString('base64')); await expect(235);
    }
    await write('MAIL FROM:<' + from + '>'); await expect(250);
    for (const rcpt of to) { await write('RCPT TO:<' + rcpt + '>'); await expect(250); }
    await write('DATA'); await expect(354);
    await write(mail + '\r\n.'); await expect(250);
    await write('QUIT');
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: String((e && e.message) || e).slice(0, 160) };
  } finally {
    try { socket.destroy(); } catch {}
  }
}

/* ---------------- 摘要内容（纯文本，不带具体金额） ---------------- */

export function buildDigest(ledger, now = new Date(), opts = {}) {
  const accounts = Array.isArray(ledger && ledger.accounts) ? ledger.accounts : [];
  const snapshots = Array.isArray(ledger && ledger.snapshots) ? ledger.snapshots : [];
  const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const checkinMissing = !snapshots.some(s => s.month === ym);
  const staleDays = Number(opts.staleDays || 45);
  const stale = accounts.filter(a => {
    if (a.closed || a.remind === false) return false;
    const t = Date.parse(String(a.date || '') + 'T00:00:00');
    return Number.isFinite(t) && (now.getTime() - t) / 86400000 > staleDays;
  }).length;
  const lead = Number(opts.dueLeadDays || 30);
  const dueSoon = accounts.filter(a => {
    if (!a.due) return false;
    const d = Date.parse(a.due + 'T00:00:00');
    if (!Number.isFinite(d)) return false;
    const days = (d - Date.parse(now.toISOString().slice(0, 10) + 'T00:00:00')) / 86400000;
    return days >= 0 && days <= lead;
  }).length;
  const counted = accounts.filter(a => !a.closed && a.inNet !== false);
  const net = counted.reduce((sum, a) => sum + Math.round((a.isDebt ? -1 : 1) * a.amount * 100), 0) / 100;
  const last = snapshots.slice().sort((a, b) => String(a.month).localeCompare(String(b.month))).pop();
  const delta = last ? net - (last.A - last.L) : null;

  const lines = [];
  lines.push(ym + ' 盘点：' + (checkinMissing ? '还没盘' : '已盘点'));
  if (stale) lines.push('超过 ' + staleDays + ' 天没更新的账户：' + stale + ' 个');
  if (dueSoon) lines.push('未来 ' + lead + ' 天内到期：' + dueSoon + ' 个');
  if (delta !== null) lines.push('净值较上期：' + (delta >= 0 ? '+' : '') + (Math.round(delta * 100) / 100));
  lines.push('（登录家底查看明细）');
  const nothing = !checkinMissing && !stale && !dueSoon;
  return {
    title: '家底 · ' + (nothing ? '账本状态正常' : '盘点与到期提醒'),
    content: lines.join('\n'),
    nothingToDo: nothing,
    facts: { checkinMissing, stale, dueSoon },
  };
}
