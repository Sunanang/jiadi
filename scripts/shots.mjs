// 生成 README 用截图：只在浏览器里用内置 SEED 演示数据渲染，不碰任何真实账本。
// 用法：node scripts/shots.mjs      （输出到 docs/screenshots/）
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {browser} from '../tests/browser.mjs';

const OUT = resolve('docs/screenshots');
await mkdir(OUT, {recursive: true});

const app = await browser(resolve('jiadi-ui.html'), '2026-11-07T10:00:00Z');
const ev = app.evaluate;
const shot = (name, w = 1440, h = 1050) => app.screenshot(resolve(OUT, name), w, h);

// 固定使用内置演示数据 + 关闭所有提示层
await ev(`(async()=>{
  localStorage.setItem('jiadi.onboarded.v1','1'); hideOnb();
  PREF.dupCheckin='保留多条'; PREF.range='全部'; PREF.multiPoint='取当月最后一个';
  PREF.lastExport='2026-11-05';
  await resetDB();
  $('#toast').classList.remove('on'); $('#mask').classList.remove('on');
  $('#drawer').classList.remove('on'); $('#modalMask').classList.remove('on'); closeDrawer();
  return true;
})()`);

try {
  await ev("setTheme('dark'); show('home')");
  await shot('01-home-dark.png');

  await ev("setTheme('light'); show('home')");
  await shot('02-home-light.png');

  await ev("setTheme('dark'); show('trend'); S.trend.mode='net'");
  await shot('03-trend.png');

  await ev("show('people')");
  await shot('04-people.png');

  await ev("show('detail')");
  await shot('05-detail.png');

  await ev("show('checkin')");
  await shot('06-checkin.png');

  await ev("show('report')");
  await shot('07-report.png');

  await ev("show('settings')");
  await shot('08-settings.png');

  await ev("show('home'); accountDrawer(ACCOUNTS[0].id)");
  await shot('09-drawer.png');

  await ev("closeDrawer(); setTheme('dark'); show('home')");
  await shot('10-mobile-home.png', 390, 844);

  console.log('截图已写入', OUT);
  if (app.errors.length) console.error('页面错误：', app.errors);
} finally {
  await app.close();
}
