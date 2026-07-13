import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8399/study-planner/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
const T = await page.evaluate(() => new Date().toLocaleDateString('sv'));

// 直接データを注入(順調な本A と 大幅に遅れた本B)
await page.evaluate(({ T, aDl, bStart, bDl }) => {
  const s = { books: [], logs: {}, settings: { github: {}, defaultRest: [] }, timer: null };
  // A: 予定どおり。総量90 / 締切+9日 / ペース 3分/問 → 1日9問=27分
  s.books.push({ id: 'A', name: '順調な本', subject: '数学', unit: '問', total: 90, startDone: 0, deadline: aDl, startDate: T, weekdays: [0,1,2,3,4,5,6], paceUnits: 10, paceMin: 30, createdAt: 1 });
  // B: 20日前開始・締切+20日・総量100・未着手・ペース 6分/問 → 遅れて必要ペースが増加
  s.books.push({ id: 'B', name: 'サボった本', subject: '英語', unit: '問', total: 100, startDone: 0, deadline: bDl, startDate: bStart, weekdays: [0,1,2,3,4,5,6], paceUnits: 1, paceMin: 6, createdAt: 2 });
  localStorage.setItem('studyPlanner.v1', JSON.stringify(s));
}, { T, aDl: addDays(T, 9), bStart: addDays(T, -20), bDl: addDays(T, 20) });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

const paceA = await page.locator('.tbook[data-b="A"] .pace').innerText();
const paceB = await page.locator('.tbook[data-b="B"] .pace').innerText();
console.log('  A pace:', JSON.stringify(paceA));
console.log('  B pace:', JSON.stringify(paceB));

console.log('\n[1] 順調な本: 「予定どおり終えるには 今日から毎日 ◯」を表示');
ok(paceA.includes('予定どおり終えるには') && paceA.includes('毎日'), '文言が出る');
ok(paceA.includes('27分'), '必要時間=27分(90問÷10日×3分) 実際:' + paceA);
ok(!paceA.includes('サボる前'), '順調なら「サボる前は」は出ない');

console.log('\n[2] 遅れた本: 必要ペースが増え、「↑ サボる前は ◯」の比較が出る');
ok(paceB.includes('サボる前は') && paceB.includes('↑'), 'サボり前との比較を表示 実際:' + paceB);
ok((await page.locator('.tbook[data-b="B"] .tag.warn').count()) >= 1, '状態が「遅れぎみ」');

console.log('\n[3] ヒーローに合計の必要時間(遅れ時)');
ok((await page.locator('#todayHero').innerText()).includes('今日から毎日'), 'ヒーローに追い上げ時間の総合表示');

console.log('\n[4] 計画タブの「1日のノルマ」に ≈◯/日 の時間が付く');
await page.locator('.tabbtn', { hasText: '計画' }).click();
await page.waitForTimeout(300);
ok((await page.locator('.pbook[data-b="A"] .meta').innerText()).match(/≈.*\/日/), 'ノルマに時間サブ表示');
ok((await page.locator('.pbook[data-b="B"] .pace').count()) === 1, '計画カードにも必要ペース行');

console.log('\n[5] テストモードUIが撤去されている');
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.waitForTimeout(150);
ok((await page.locator('#testPanel').count()) === 0 && (await page.locator('#testBanner').count()) === 0, 'テストモードのUIが無い');
ok((await page.locator('#streakBadge').innerText()).includes('🔥'), 'バッジは通常の連続表示に戻っている');
ok(await page.evaluate(() => localStorage.getItem('studyPlanner.session') === null), 'session キーが掃除されている');

ok(errors.length === 0, 'JSエラー無し 実際:' + JSON.stringify(errors.slice(0, 5)));
console.log(`\n==== ${pass} passed / ${fail} failed ====`);
await browser.close();
process.exit(fail ? 1 : 0);
