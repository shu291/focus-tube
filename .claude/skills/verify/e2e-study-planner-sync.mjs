import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8399/study-planner/index.html';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

// --- GitHub API モック ---
let store = null;        // Gist内容(=保存されたJSON文字列)
const reqLog = [];
await ctx.route('https://api.github.com/**', async route => {
  const req = route.request();
  const method = req.method();
  reqLog.push(method + ' ' + req.url());
  // 認証ヘッダ確認
  const auth = req.headers()['authorization'] || '';
  if (!auth.startsWith('Bearer ')) { await route.fulfill({ status: 401, body: '{}' }); return; }
  if (method === 'POST') {
    const body = JSON.parse(req.postData());
    store = body.files['study-planner-data.json'].content;
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'gistMOCK123' }) });
  } else if (method === 'PATCH') {
    const body = JSON.parse(req.postData());
    store = body.files['study-planner-data.json'].content;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'gistMOCK123' }) });
  } else if (method === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'gistMOCK123', files: { 'study-planner-data.json': { content: store, truncated: false } } }) });
  } else { await route.fulfill({ status: 204, body: '' }); }
});

const future = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('sv'); };

console.log('\n[A] データを作ってアップロード(POST→gistId保存)');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', '英文法ポラリス');
await page.fill('#bkTotal', '80');
await page.fill('#bkDeadline', future(20));
await page.locator('#bkSave').click();
await page.waitForTimeout(200);
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.fill('#ghToken', 'ghp_testtoken');
await page.locator('#ghUp').click();
await page.waitForTimeout(600);
ok(reqLog.some(r => r.startsWith('POST')), 'POST /gists が呼ばれた');
ok(await page.locator('#ghGist').inputValue() === 'gistMOCK123', '返ってきたGist IDが保存される');
ok(store && JSON.parse(store).books.length === 1, 'Gistに1冊保存された');
ok((await page.locator('#syncStatus').innerText()).includes('最終同期'), '最終同期が表示される');

console.log('\n[B] 自動同期(変更 → PATCH)');
await page.locator('#ghAuto').click();       // 自動同期ON
await page.waitForTimeout(100);
reqLog.length = 0;
// 参考書を追加して変更を起こす
await page.locator('.tabbtn', { hasText: '今日' }).click();
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', '一問一答');
await page.fill('#bkTotal', '200');
await page.fill('#bkDeadline', future(30));
await page.locator('#bkSave').click();
await page.waitForTimeout(5000);             // debounce(4s)を待つ
ok(reqLog.some(r => r.startsWith('PATCH')), '変更後にPATCHで自動同期');
ok(store && JSON.parse(store).books.length === 2, 'Gist内容が2冊に更新');

console.log('\n[C] 別端末想定: ローカル全消去 → 取得(GET)で復元');
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('studyPlanner.v1')); s.books = []; s.logs = {}; localStorage.setItem('studyPlanner.v1', JSON.stringify(s)); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(200);
ok(await page.locator('.tbook').count() === 0, '消去後は0冊');
await page.locator('.tabbtn', { hasText: '設定' }).click();
page.once('dialog', d => d.accept());        // confirm()を承認
await page.locator('#ghDown').click();
await page.waitForTimeout(600);
ok(reqLog.some(r => r.startsWith('GET')), 'GET /gists が呼ばれた');
const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')).books.length);
ok(restored === 2, '取得で2冊に復元 実際:' + restored);

console.log('\n[D] 不正トークン → 401エラー処理');
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('studyPlanner.v1')); s.settings.github.token = ''; localStorage.setItem('studyPlanner.v1', JSON.stringify(s)); });
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.fill('#ghToken', '');             // 空トークン
await page.locator('#ghUp').click();
await page.waitForTimeout(300);
ok((await page.locator('#toast').innerText()).includes('トークン'), '空トークンはトースト警告');

ok(errors.length === 0, 'JSエラー無し 実際:' + JSON.stringify(errors.slice(0, 5)));
console.log(`\n==== ${pass} passed / ${fail} failed ====`);
await browser.close();
process.exit(fail ? 1 : 0);
