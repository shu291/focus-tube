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

// GitHub API が呼ばれたら記録(テスト中は呼ばれてはいけない)
let ghCalls = 0;
await ctx.route('https://api.github.com/**', async route => { ghCalls++; await route.fulfill({ status: 201, contentType: 'application/json', body: '{"id":"x"}' }); });

const LS = () => page.evaluate(() => ({
  real: JSON.parse(localStorage.getItem('studyPlanner.v1') || '{"books":[]}').books.length,
  test: JSON.parse(localStorage.getItem('studyPlanner.test') || '{"books":[]}').books.length,
  mode: (JSON.parse(localStorage.getItem('studyPlanner.session') || '{}').mode) || 'real',
}));

console.log('\n[A] 本番データを1冊作る(total100 / 締切=実際の今日+10)');
await page.goto(BASE, { waitUntil: 'networkidle' });
const realToday = await page.evaluate(() => new Date().toLocaleDateString('sv'));
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', '本番の英単語');
await page.fill('#bkTotal', '100');
await page.fill('#bkDeadline', addDays(realToday, 10));
await page.locator('#bkSave').click();
await page.waitForTimeout(200);
ok((await page.locator('.tbook .goal .q').first().innerText()) === '10', '本番の今日のノルマ=10(100÷11日)');
ok((await LS()).real === 1, '本番(v1)に1冊');

console.log('\n[B] テストモードに入る → 本番はそのまま、サンドボックスにコピー');
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.locator('#tEnter').click();
await page.waitForTimeout(300);
ok(await page.locator('#testBanner').isVisible(), 'テストバナー表示');
ok((await page.locator('#streakBadge').innerText()).includes('テスト'), 'ヘッダーがテスト中表示');
let ls = await LS();
ok(ls.mode === 'test', 'セッションがtestモード');
ok(ls.real === 1 && ls.test === 1, '本番1冊は保持・サンドボックスに1冊コピー 実際:' + JSON.stringify(ls));

console.log('\n[C] 仮の今日を+5日 → ノルマが再計算(締切が近づく)');
await page.fill('#tDate', addDays(realToday, 5));
await page.dispatchEvent('#tDate', 'change');
await page.waitForTimeout(200);
await page.locator('.tabbtn', { hasText: '今日' }).click();
await page.waitForTimeout(200);
const q = await page.locator('.tbook .goal .q').first().innerText();
ok(q === '17', '仮の今日+5でノルマ=17(残100÷残6日) 実際:' + q);
ok((await page.locator('#todayHero').innerText()).includes(String(new Date(addDays(realToday, 5)).getMonth() + 1) + '月'), 'ヒーローの日付も仮の今日');

console.log('\n[D] サンプル「3科目セット」を追加 → サンドボックスのみ増える');
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.locator('#tSeed3').click();
await page.waitForTimeout(300);
ls = await LS();
ok(ls.test === 4 && ls.real === 1, 'サンドボックス4冊・本番は1冊のまま 実際:' + JSON.stringify(ls));

console.log('\n[E] テスト中はGitHub同期しない');
await page.locator('#ghToken').fill('ghp_dummy');
await page.locator('#ghUp').click();
await page.waitForTimeout(500);
ok(ghCalls === 0, 'アップロードしてもGitHub APIは呼ばれない 実際:' + ghCalls);
ok((await page.locator('#toast').innerText()).includes('テスト中'), 'テスト中の警告トースト');

console.log('\n[F] 本番に戻る → 本番データが復元、仮の今日リセット');
await page.locator('#tExit').click();
await page.waitForTimeout(300);
ok(await page.locator('#testBanner').isHidden(), 'バナーが消える');
ls = await LS();
ok(ls.mode === 'real', 'realモードに戻る');
await page.locator('.tabbtn', { hasText: '今日' }).click();
await page.waitForTimeout(150);
ok((await page.locator('.tbook').count()) === 1, '本番は1冊');
ok((await page.locator('.tbook .goal .q').first().innerText()) === '10', 'ノルマが実際の今日基準(10)に戻る');

console.log('\n[G] 再度テストへ → リロードしてもテストモード維持(サンドボックス永続)');
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.locator('#tEnter').click();
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok(await page.locator('#testBanner').isVisible(), 'リロード後もテストモード');
ls = await LS();
ok(ls.test === 4 && ls.real === 1, 'サンドボックス4冊は永続・本番1冊 実際:' + JSON.stringify(ls));

console.log('\n[H] サンドボックスを空に → 本番は無傷');
await page.locator('.tabbtn', { hasText: '設定' }).click();
page.once('dialog', d => d.accept());
await page.locator('#wipeBtn').click();
await page.waitForTimeout(300);
ls = await LS();
ok(ls.test === 0 && ls.real === 1, 'サンドボックス0・本番1のまま(共有写真も本番も無傷) 実際:' + JSON.stringify(ls));
await page.locator('#tExit').click();
await page.waitForTimeout(200);
ok((await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')).books[0].name)) === '本番の英単語', '本番の書名が保持');

ok(errors.length === 0, 'JSエラー無し 実際:' + JSON.stringify(errors.slice(0, 5)));
console.log(`\n==== ${pass} passed / ${fail} failed ====`);
await browser.close();
process.exit(fail ? 1 : 0);
