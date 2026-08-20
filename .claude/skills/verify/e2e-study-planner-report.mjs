import { chromium } from 'playwright';

// 学習報告の書き出し / 過去日へのさかのぼり記録 / 壊れたデータ・連打への耐性
const BASE = 'http://127.0.0.1:8399/study-planner/index.html';
const shots = 'shots';
import { mkdirSync } from 'fs';
mkdirSync(shots, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8399' });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

console.log('\n[1] 壊れたデータでも起動できる(サニタイズ)');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem('studyPlanner.v1', JSON.stringify({
    books: { bad: 1 },                                   // 配列であるべき所がオブジェクト
    logs: { garbage: 5, '2026-13-99': { A: { u: 1 } }, '2026-08-10': { 'A': { u: 'x', m: '10' }, '<img>': { u: 1, m: 1 } }, '2026-08-11': null },
    timer: { bookId: 'nope', startedAt: 'x' },
    settings: 7
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok(await page.locator('#v-today.on').count() === 1, '今日タブが表示される(白画面にならない)');
const cleaned = await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')));
ok(Array.isArray(cleaned.books) && cleaned.books.length === 0, 'booksが配列に直る');
ok(!cleaned.logs.garbage && !cleaned.logs['2026-13-99'] && !cleaned.logs['2026-08-11'], '不正な日付キーが消える');
ok(cleaned.logs['2026-08-10'] && cleaned.logs['2026-08-10']['A'] && cleaned.logs['2026-08-10']['A'].m === 10 && cleaned.logs['2026-08-10']['A'].u === 0, '数値化できる記録は残る(u:"x"→0, m:"10"→10)');
ok(!cleaned.logs['2026-08-10']['<img>'], '不正なIDの記録は消える');
ok(cleaned.timer === null, '壊れたタイマーは破棄される');

console.log('\n[2] まっさらにして参考書追加(総量100 / 締切+9日 → ノルマ10)');
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
const T = await page.evaluate(() => new Date().toLocaleDateString('sv'));
const YESTERDAY = addDays(T, -1);
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', 'システム英単語');
await page.fill('#bkTotal', '100');
await page.fill('#bkUnit', '単語');
await page.fill('#bkDeadline', addDays(T, 9));
await page.locator('#bkSave').click();
await page.waitForTimeout(250);
ok(await page.locator('.tbook .goal .q').first().innerText() === '10', '今日のノルマ=10');

console.log('\n[3] 保存ボタンを連打しても1冊しか増えない');
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', '連打テスト');
await page.fill('#bkTotal', '50');
await page.evaluate(() => { const b = document.getElementById('bkSave'); b.click(); b.click(); b.click(); });
await page.waitForTimeout(300);
const nBooks = await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')).books.length);
ok(nBooks === 2, '3連打しても2冊のまま 実際:' + nBooks);

console.log('\n[4] 過去の日にさかのぼって記録(昨日=20単語/30分)');
await page.locator('.tbook[data-b]').filter({ hasText: 'システム英単語' }).locator('button', { hasText: '記入' }).click();
await page.waitForSelector('#logSheet.on');
ok(await page.locator('#logDate').inputValue() === T, '日付の初期値は今日');
ok(await page.locator('#logDate').getAttribute('max') === T, '未来の日付は選べない(max=今日)');
await page.fill('#logDate', YESTERDAY);
await page.waitForTimeout(150);
ok(await page.locator('#logUnits').inputValue() === '0', '昨日に切り替えるとフォームは0から');
await page.fill('#logUnits', '20');
await page.fill('#logMin', '30');
await page.locator('#logSave').click();
await page.waitForTimeout(300);
const st = await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')));
const book = st.books.find(b => b.name === 'システム英単語');
ok(st.logs[YESTERDAY] && st.logs[YESTERDAY][book.id] && st.logs[YESTERDAY][book.id].u === 20 && st.logs[YESTERDAY][book.id].m === 30, '昨日のキーに20単語/30分が入る');
ok(book.startDate === YESTERDAY, '開始日がさかのぼった日まで伸びる(グラフ・ペース計算に反映)');
const q = await page.locator('.tbook').filter({ hasText: 'システム英単語' }).locator('.goal .q').innerText();
ok(q === '8', '昨日の分を引いて今日のノルマが再計算される((100-20)÷10日=8) 実際:' + q);

console.log('\n[5] 日付を戻すと既存の記録が読み込まれる');
await page.locator('.tbook').filter({ hasText: 'システム英単語' }).locator('button', { hasText: '記入' }).click();
await page.waitForSelector('#logSheet.on');
await page.fill('#logDate', YESTERDAY);
await page.waitForTimeout(150);
ok(await page.locator('#logUnits').inputValue() === '20' && await page.locator('#logMin').inputValue() === '30', '昨日の記録(20/30)がフォームに出る');
ok(await page.locator('#logClear').isVisible(), '「この日の記録を消す」が出る');
// 今日に戻して今日の分を記録(8単語/25分+メモ)
await page.fill('#logDate', T);
await page.waitForTimeout(150);
await page.fill('#logUnits', '8');
await page.fill('#logMin', '25');
await page.fill('#logNote', '発音アクセントが難しい');
await page.locator('#logSave').click();
await page.waitForTimeout(250);
await page.screenshot({ path: shots + '/10-backfill.png' });

console.log('\n[6] 学習報告(今日)');
ok((await page.locator('#todayHero').innerText()).includes('学習報告'), 'ヒーローに報告ボタン');
await page.locator('#todayHero button', { hasText: '学習報告' }).click();
await page.waitForSelector('#reportSheet.on');
let rep = await page.locator('#repText').inputValue();
console.log('  ---\n' + rep.split('\n').map(l => '  | ' + l).join('\n') + '\n  ---');
ok(rep.startsWith('【学習報告 '), '見出しに日付');
ok(rep.includes('英語:システム英単語'), '教科:参考書名');
ok(rep.includes('8単語') && rep.includes('25分'), 'やった量と時間');
ok(rep.includes('※発音アクセントが難しい'), 'メモも入る');
ok(rep.includes('合計 25分'), '合計時間');
ok(!rep.includes('連打テスト'), '記録のない本は入らない');
await page.screenshot({ path: shots + '/11-report.png' });

console.log('\n[7] 学習報告(昨日に切り替え)');
await page.fill('#repDate', YESTERDAY);
await page.waitForTimeout(150);
rep = await page.locator('#repText').inputValue();
ok(rep.includes('20単語') && rep.includes('30分') && rep.includes('合計 30分'), '昨日の内容に変わる');

console.log('\n[8] コピー / 共有');
await page.locator('#repCopy').click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
ok(clip === rep, 'クリップボードに報告文が入る');
ok((await page.locator('.toast').innerText()).includes('コピー'), 'コピーのトースト');
ok(await page.locator('#repShare').isHidden(), '共有非対応の環境では共有ボタンが隠れる');

console.log('\n[9] 未来の日付は今日に丸められる');
await page.locator('#reportSheet .x').click();
await page.locator('.tbook').filter({ hasText: 'システム英単語' }).locator('button', { hasText: '修正' }).click();
await page.waitForSelector('#logSheet.on');
await page.fill('#logDate', addDays(T, 3));
await page.waitForTimeout(150);
ok(await page.locator('#logDate').inputValue() === T, '記入シート: 未来日→今日に戻る');
await page.locator('#logSheet .x').click();

console.log('\n[10] リロード後も記録が残る');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')));
ok(st2.books.length === 2 && st2.logs[YESTERDAY] && st2.logs[T], '2冊+昨日と今日の記録が永続化');

ok(errors.length === 0, 'JSエラー無し 実際:' + JSON.stringify(errors.slice(0, 5)));
console.log(`\n==== ${pass} passed / ${fail} failed ====`);
await browser.close();
process.exit(fail ? 1 : 0);
