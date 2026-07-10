import { chromium } from 'playwright';
import fs from 'fs';

const URL = 'http://127.0.0.1:8399/drawer-planner/';
let pass = 0, fail = 0;
const ok = (cond, name) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
};

fs.mkdirSync('shots', { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // iPhone相当
page.on('pageerror', e => { fail++; console.log('  ✗ pageerror:', e.message); });

console.log('--- 1. 初回起動(サンプル引き出し) ---');
await page.goto(URL);
await page.waitForSelector('#canvas .item');
ok(await page.locator('#dName').textContent() === '机の引き出し', 'サンプル引き出し名');
ok((await page.locator('#canvas .item').count()) === 3, '初期アイテム3個(ペン/ハサミ/ペンチ)');
ok((await page.locator('#dDim').textContent()).includes('330×420×高45mm'), '内寸表示');
ok((await page.locator('#stats').textContent()).includes('アイテム 3個'), '統計: アイテム数');
ok(!(await page.locator('#stats').textContent()).includes('重なり'), '初期状態で重なりなし');
await page.screenshot({ path: 'shots/01-initial.png' });

console.log('--- 2. カタログを開いて検索・追加 ---');
await page.click('#openCatalog');
await page.waitForSelector('#sheet:not([hidden])');
const totalCount = await page.locator('#catCount').textContent();
console.log('   カタログ件数:', totalCount);
ok(parseInt(totalCount) >= 150, 'カタログ150種類以上');
await page.fill('#catSearch', 'ペンチ');
const found = await page.locator('#catGrid .citem[data-i]').count();
ok(found >= 2, '「ペンチ」検索でヒット(ペンチ/ラジオペンチ)');
await page.screenshot({ path: 'shots/02-catalog-search.png' });

// カテゴリチップ絞り込み
await page.fill('#catSearch', '');
await page.click('#catChips .chip[data-c="tool"]');
ok((await page.locator('#catCount').textContent()).startsWith('25'), '工具カテゴリ絞り込み(25種)');

// ハサミを選んでサイズを自分用に変更して追加
await page.click('#catChips .chip[data-c="all"]');
await page.fill('#catSearch', 'キッチンばさみ');
await page.click('#catGrid .citem[data-i="0"]');
await page.waitForSelector('#itemModalBack:not([hidden])');
ok((await page.inputValue('#imW')) === '210', 'モーダルに標準サイズがプリセット(幅210)');
await page.fill('#imW', '195');  // 自分のハサミの実寸に変更
await page.fill('#imH', '14');
await page.click('#imAdd');
await page.waitForSelector('#sheet[hidden]', { state: 'attached' });
ok((await page.locator('#canvas .item').count()) === 4, '追加後アイテム4個');
ok(!(await page.locator('#selPanel').isHidden()), '追加後に選択パネル表示');
ok((await page.inputValue('#selW')) === '195', 'カスタムサイズ(幅195)が反映');
await page.screenshot({ path: 'shots/03-added.png' });

console.log('--- 3. 選択パネル: サイズ変更・回転・複製・削除 ---');
await page.fill('#selD', '90');
await page.locator('#selD').blur();
await page.waitForTimeout(100);
await page.click('#selRotate');
await page.waitForTimeout(100);
// 回転後: footprint が入れ替わる(幅90×奥行195相当の描画になる)
const selBox = await page.locator('#canvas .item.sel').boundingBox();
ok(selBox && selBox.height > selBox.width, '回転でfootprintが縦長に');
await page.click('#selDup');
await page.waitForTimeout(100);
ok((await page.locator('#canvas .item').count()) === 5, '複製で5個');
await page.click('#selDel');
await page.waitForTimeout(100);
ok((await page.locator('#canvas .item').count()) === 4, '削除で4個');

console.log('--- 4. ドラッグ移動 & 永続化 ---');
const item0 = page.locator('#canvas .item').first();
const b0 = await item0.boundingBox();
await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
await page.mouse.down();
// 右方向へ移動(下は他アイテムがいるので重ねない)
await page.mouse.move(b0.x + b0.width / 2 + 100, b0.y + b0.height / 2 + 8, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
const b1 = await page.locator('#canvas .item').first().boundingBox();
ok(Math.abs(b1.x - b0.x - 100) < 12 && Math.abs(b1.y - b0.y - 8) < 12, 'ドラッグで移動(5mmスナップ込み)');
await page.reload();
await page.waitForSelector('#canvas .item');
const b2 = await page.locator('#canvas .item').first().boundingBox();
ok(Math.abs(b2.x - b1.x) < 3 && Math.abs(b2.y - b1.y) < 3, 'リロード後も位置が保持(localStorage)');
ok((await page.locator('#canvas .item').count()) === 4, 'リロード後もアイテム4個');

console.log('--- 5. 重なり検知 ---');
// 1個目を2個目の上へドラッグして重ねる
const t1 = await page.locator('#canvas .item').nth(0).boundingBox();
const t2 = await page.locator('#canvas .item').nth(1).boundingBox();
await page.mouse.move(t1.x + t1.width / 2, t1.y + t1.height / 2);
await page.mouse.down();
await page.mouse.move(t2.x + t2.width / 2, t2.y + t2.height / 2, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);
ok((await page.locator('#canvas .item.bad').count()) >= 2, '重なった両方に赤枠(.bad)');
ok((await page.locator('#stats').textContent()).includes('重なり'), '統計に重なり警告');
await page.screenshot({ path: 'shots/04-overlap.png' });
// (重なったままでも以降のテストには影響しない)

console.log('--- 6. 高さ超過警告 ---');
await page.click('#openCatalog');
await page.fill('#catSearch', '計量カップ');   // 高さ90mm > 引き出し45mm
await page.click('#catGrid .citem[data-i="0"]');
await page.click('#imAdd');
await page.waitForTimeout(150);
ok((await page.locator('#canvas .item.tall').count()) === 1, '高さ超過アイテムに⚠マーク');
ok((await page.locator('#selWarn').textContent()).includes('高さ90mm'), '選択パネルに高さ超過の説明');
ok((await page.locator('#stats').textContent()).includes('高さ超過'), '統計に高さ超過');
await page.screenshot({ path: 'shots/05-tall.png' });
await page.click('#selDel');

console.log('--- 7. オリジナルアイテム登録(マイカタログ) ---');
await page.click('#openCatalog');
await page.waitForSelector('#sheet:not([hidden])');
await page.fill('#catSearch', '');
await page.click('#newCustom');
await page.waitForSelector('#itemModalBack:not([hidden])');
ok(await page.isChecked('#imSave'), 'オリジナルはデフォルトでマイカタログ保存ON');
await page.fill('#imName', '祖父の彫刻刀');
await page.fill('#imEmoji', '🗡');
await page.fill('#imW', '160');
await page.fill('#imD', '18');
await page.fill('#imH', '18');
await page.click('#imAdd');
await page.waitForTimeout(150);
ok((await page.locator('#selName').inputValue()) === '祖父の彫刻刀', 'オリジナルが追加され選択中');
await page.click('#openCatalog');
await page.click('#catChips .chip[data-c="my"]');
ok((await page.locator('#catGrid .citem.custom').count()) === 1, 'マイアイテムカテゴリに登録済み');
await page.screenshot({ path: 'shots/06-custom.png' });
await page.click('#closeSheet');

console.log('--- 8. 引き出しの追加・編集・削除 ---');
await page.click('#addDrawer');
await page.waitForSelector('#drawerModalBack:not([hidden])');
await page.selectOption('#dmPreset', '4');   // キッチン引き出し(上段) 400×450×100
ok((await page.inputValue('#dmW')) === '400', 'プリセットでサイズ自動入力');
await page.click('#dmSave');
await page.waitForTimeout(150);
ok((await page.locator('#dName').textContent()).includes('キッチン引き出し'), '新しい引き出しに切替');
ok((await page.locator('#canvas .item').count()) === 0, '新規引き出しは空');
ok((await page.locator('#drawerTabs .chip[data-id]').count()) === 2, 'タブが2個');
// タブで元に戻る
await page.click('#drawerTabs .chip[data-id="1"]');
ok((await page.locator('#canvas .item').count()) === 5, '元の引き出しに5アイテム');
// 編集(名前変更)
await page.click('#editDrawer');
await page.fill('#dmName', '勉強机の引き出し');
await page.click('#dmSave');
await page.waitForTimeout(100);
ok((await page.locator('#dName').textContent()) === '勉強机の引き出し', '引き出し名の変更');
// 削除(confirmを受理)
page.on('dialog', d => d.accept());
await page.click('#editDrawer');
await page.click('#dmDelete');
await page.waitForTimeout(150);
ok((await page.locator('#drawerTabs .chip[data-id]').count()) === 1, '削除でタブ1個');
ok((await page.locator('#dName').textContent()).includes('キッチン引き出し'), '残った引き出しへ切替');
await page.screenshot({ path: 'shots/07-drawers.png' });

console.log('--- 9. リロード後の総合永続化 ---');
await page.reload();
await page.waitForSelector('#canvas');
ok((await page.locator('#drawerTabs .chip[data-id]').count()) === 1, 'リロード後: 引き出し構成保持');
await page.click('#openCatalog');
await page.click('#catChips .chip[data-c="my"]');
ok((await page.locator('#catGrid .citem.custom').count()) === 1, 'リロード後: マイカタログ保持');

await browser.close();
console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
