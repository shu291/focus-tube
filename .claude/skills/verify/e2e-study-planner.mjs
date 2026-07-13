import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8399/study-planner/index.html';
const shots = 'shots';
import { mkdirSync, readFileSync } from 'fs';
mkdirSync(shots, { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

// 未来日を作る
const future = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toLocaleDateString('sv'); };

console.log('\n[1] 初回起動 / 空状態');
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
ok(await page.locator('#v-today.on').count() === 1, '今日タブが表示される');
ok((await page.locator('#todayList').innerText()).includes('参考書を登録'), '空状態メッセージ');
ok(await page.locator('.tabbtn').count() === 4, '下タブ4つ');

console.log('\n[2] 参考書を追加(総量100 / 締切=今日+9日 / 全曜日 → 今日のノルマ=10)');
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', 'システム英単語');
await page.fill('#bkTotal', '100');
await page.fill('#bkUnit', '単語');
await page.fill('#bkDeadline', future(9));
await page.locator('#bkSave').click();
await page.waitForTimeout(300);
ok(await page.locator('#bookSheet.on').count() === 0, 'シートが閉じる');
ok(await page.locator('.tbook').count() === 1, '今日タブに参考書カード1枚');
const goalQ = await page.locator('.tbook .goal .q').first().innerText();
ok(goalQ === '10', '今日のノルマ = 10単語(逆算) 実際:' + goalQ);
ok((await page.locator('.tbook').innerText()).includes('単語'), '単位が表示される');
await page.screenshot({ path: shots + '/01-today.png' });

console.log('\n[3] バッジ(今日=未達1)');
ok(await page.locator('#badgeToday').innerText() === '1', '今日タブに未達バッジ1');

console.log('\n[4] ✓できた → ノルマ達成');
await page.locator('.tbook button.ok', { hasText: 'できた' }).click();
await page.waitForTimeout(250);
ok((await page.locator('.tbook').innerText()).includes('達成'), 'ノルマ達成表示');
const doneU = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('studyPlanner.v1')); const b = s.books[0]; const k = new Date().toLocaleDateString('sv'); return s.logs[k][b.id].u; });
ok(doneU === 10, 'localStorageに今日=10単語が記録される 実際:' + doneU);
ok(await page.locator('#badgeToday').count() === 0 || await page.locator('#badgeToday').isHidden(), '未達バッジが消える');

console.log('\n[5] 記入シート(量を25・時間を40分に修正)');
await page.locator('.tbook button', { hasText: '修正' }).click();
await page.waitForSelector('#logSheet.on');
await page.fill('#logUnits', '25');
await page.fill('#logMin', '40');
await page.locator('#logSave').click();
await page.waitForTimeout(250);
const after = await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('studyPlanner.v1')); const b = s.books[0]; const k = new Date().toLocaleDateString('sv'); return s.logs[k][b.id]; });
ok(after.u === 25 && after.m === 40, '記入が反映(25単語/40分) 実際:' + JSON.stringify(after));

console.log('\n[6] ストップウォッチ計測');
await page.locator('.tbook button', { hasText: '計測' }).click();
await page.waitForTimeout(300);
ok(await page.evaluate(() => !!(JSON.parse(localStorage.getItem('studyPlanner.v1')).timer)), '計測中(timerが保存)');
ok(await page.locator('.runbadge').count() === 1, '計測バッジ表示');
await page.locator('.tbook button.ok', { hasText: '■' }).click();
await page.waitForTimeout(200);
ok(await page.evaluate(() => !JSON.parse(localStorage.getItem('studyPlanner.v1')).timer), '計測停止でtimerが消える');

console.log('\n[7] 計画タブ(進捗・状態・バーンダウン)');
await page.locator('.tabbtn', { hasText: '計画' }).click();
await page.waitForTimeout(300);
ok(await page.locator('.pbook').count() === 1, '参考書カード');
ok(await page.locator('.pbook .spark svg').count() === 1, 'バーンダウンSVGが描画される');
ok(/\d+%/.test(await page.locator('.pbook .pv').first().innerText()), '進捗%表示');
ok((await page.locator('#planSummary').innerText()).includes('全体の進捗'), '全体サマリ');
await page.screenshot({ path: shots + '/02-plan.png' });

console.log('\n[8] 2冊目(締切なし)を追加 → 締切設定を促す');
await page.locator('#fab').click();
await page.waitForSelector('#bookSheet.on');
await page.fill('#bkName', '青チャート数学');
await page.fill('#bkTotal', '300');
await page.fill('#bkUnit', '問');
// 教科=数学
await page.locator('#bkSubj .chip', { hasText: '数学' }).click();
await page.fill('#bkDeadline', '');
await page.locator('#bkSave').click();
await page.waitForTimeout(250);
ok(await page.locator('.pbook').count() === 2, '2冊になった');

console.log('\n[9] 記録タブ(グラフ / ヒートマップ / 教科別)');
await page.locator('.tabbtn', { hasText: '記録' }).click();
await page.waitForTimeout(300);
ok(await page.locator('#chart .col').count() === 7, '日別グラフ7本');
ok(await page.locator('#heat .cell').count() > 100, 'ヒートマップのセル(18週間分)');
ok((await page.locator('#subjTotals').innerText()).includes('英語'), '教科別合計に英語');
ok((await page.locator('#statTop').innerText()).includes('連続'), '連続記録表示');
await page.screenshot({ path: shots + '/03-stats.png' });

console.log('\n[10] 設定タブ / バックアップJSON生成');
await page.locator('.tabbtn', { hasText: '設定' }).click();
await page.waitForTimeout(200);
ok(await page.locator('#ghToken').count() === 1, 'GitHubトークン欄');
// トークンを入れてから書き出し → JSONにトークンが含まれないことを確認
await page.fill('#ghToken', 'ghp_dummyTOKEN1234567890');
await page.locator('#ghToken').blur();
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#expBtn').click()]);
const backup = JSON.parse(readFileSync(await download.path(), 'utf8'));
ok(backup.app === 'study-planner' && backup.books.length === 2, '書き出しJSONに2冊 実際:' + backup.books.length);
ok(!JSON.stringify(backup).includes('ghp_dummy'), '書き出しJSONにトークンが含まれない');
await page.screenshot({ path: shots + '/04-settings.png' });

console.log('\n[11] リロードで永続化');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
ok(await page.locator('.tbook').count() === 2, 'リロード後も2冊(今日タブ)');
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('studyPlanner.v1')).books.length);
ok(persisted === 2, 'localStorage永続 実際:' + persisted);

console.log('\n[12] サボり再計算の検証(1日サボると翌日のノルマが増える)');
const recalc = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('studyPlanner.v1'));
  const b = s.books.find(x => x.name === 'システム英単語');
  // 昨日サボった想定: startDoneを0, 締切を今日+9, 記録は今日のみ25。昨日の記録なし。
  // 逆算: remainingStart(今日開始) = 100 - 0 = 100, daysLeft(今日含む)=10 → 10/日
  // ここで「もし昨日やるはずだった10をサボって残ってる」状況を作るため、締切を today+4 に縮めて確認
  b.deadline = new Date(Date.now() + 4 * 86400000).toLocaleDateString('sv'); // 5日(今日含む)
  b.startDone = 0;
  // 今日の記録を消す(まだ何もしていない状態)
  const k = new Date().toLocaleDateString('sv'); if (s.logs[k]) delete s.logs[k][b.id];
  localStorage.setItem('studyPlanner.v1', JSON.stringify(s));
  return true;
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
const q2 = await page.locator('.tbook .goal .q').first().innerText();
// 100/5 = 20
ok(q2 === '20', '締切が近いとノルマが増える(100÷5日=20) 実際:' + q2);

console.log('\n[13] コンソールエラーが無いこと');
ok(errors.length === 0, 'JSエラー無し 実際:' + JSON.stringify(errors.slice(0, 5)));

console.log(`\n==== ${pass} passed / ${fail} failed ====`);
await browser.close();
process.exit(fail ? 1 : 0);
