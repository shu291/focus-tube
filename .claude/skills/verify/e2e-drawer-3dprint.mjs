import { chromium } from 'playwright';
import fs from 'fs';

const URL = 'http://127.0.0.1:8399/drawer-planner/';
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗ FAIL:', name); } };
fs.mkdirSync('shots', { recursive: true });
const OUT = 'shots/stl';
fs.mkdirSync(OUT, { recursive: true });

/* ---- バイナリSTLパーサ + 検証 ---- */
function parseSTL(buf){
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const n = dv.getUint32(80, true);
  const tris = [];
  for (let i = 0; i < n; i++){
    const o = 84 + i * 50;
    const nrm = [dv.getFloat32(o,true), dv.getFloat32(o+4,true), dv.getFloat32(o+8,true)];
    const v = [];
    for (let k = 0; k < 3; k++){ const p = o+12+k*12; v.push([dv.getFloat32(p,true), dv.getFloat32(p+4,true), dv.getFloat32(p+8,true)]); }
    tris.push({ nrm, v });
  }
  return { n, expected: 84 + n*50, size: buf.byteLength, tris };
}
const key = p => p.map(c => Math.round(c*1000)/1000).join(',');
// STLの健全性チェック。dims=[w,d,h] を渡すとバウンディングボックスも照合
function validateSTL(buf, label, dims){
  const stl = parseSTL(buf);
  ok(stl.size === stl.expected, `${label}: ファイルサイズ整合(${stl.size}=${stl.expected})`);
  ok(stl.n > 0 && stl.n % 12 === 0, `${label}: 三角形数 ${stl.n} が12の倍数(=${stl.n/12}ボックス)`);

  // 法線: 単位長 & 軸並行
  let normOK = true;
  for (const t of stl.tris){
    const L = Math.hypot(...t.nrm);
    const axis = t.nrm.filter(c => Math.abs(c) > 0.001).length;
    if (Math.abs(L - 1) > 0.01 || axis !== 1) { normOK = false; break; }
  }
  ok(normOK, `${label}: 全法線が単位長かつ軸並行`);

  // バウンディングボックス
  let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
  for (const t of stl.tris) for (const p of t.v) for (let a=0;a<3;a++){ mn[a]=Math.min(mn[a],p[a]); mx[a]=Math.max(mx[a],p[a]); }
  ok(Math.abs(mn[0])<0.01 && Math.abs(mn[1])<0.01 && Math.abs(mn[2])<0.01, `${label}: 最小座標が原点(0,0,0)`);
  if (dims){
    ok(Math.abs(mx[0]-dims[0])<0.05 && Math.abs(mx[1]-dims[1])<0.05 && Math.abs(mx[2]-dims[2])<0.05,
      `${label}: 最大座標=表示サイズ ${dims.join('×')}mm (実測 ${mx.map(v=>Math.round(v*10)/10).join('×')})`);
  }

  // 各ボックス(12三角形)が閉じている: 有向エッジの逆が必ず存在(整合ワインディング)
  let watertight = true;
  for (let g = 0; g < stl.n/12 && watertight; g++){
    const de = new Map();
    for (let i = 0; i < 12; i++){
      const t = stl.tris[g*12+i];
      for (let k = 0; k < 3; k++){ const e = key(t.v[k])+'>'+key(t.v[(k+1)%3]); de.set(e,(de.get(e)||0)+1); }
    }
    for (const [e,c] of de){
      const [a,b] = e.split('>'); const rev = b+'>'+a;
      if (c !== 1 || de.get(rev) !== 1){ watertight = false; break; }
    }
  }
  ok(watertight, `${label}: 各ボックスが水密(有向エッジが逆向きと1対1)`);

  // 底面(z=0)と上面が存在
  const hasBottom = stl.tris.some(t => t.v.every(p => Math.abs(p[2])<0.001));
  ok(hasBottom, `${label}: 底面(z=0)の三角形が存在`);
  return { mx, n: stl.n };
}
async function grab(page){ // ダウンロードを待って Buffer で返す
  const dl = await page.waitForEvent('download');
  const fn = dl.suggestedFilename();
  const path = OUT + '/' + fn;
  await dl.saveAs(path);
  return { buf: fs.readFileSync(path), name: fn };
}
const dimsFromMeta = async page => {
  const t = await page.locator('#pmeta').textContent();
  const m = t.match(/([\d.]+)×([\d.]+)×([\d.]+)/);
  return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => { fail++; console.log('  ✗ pageerror:', e.message); });

console.log('--- 1. 3Dプリントモーダルを開く ---');
await page.goto(URL);
await page.evaluate(() => localStorage.removeItem('drawerPlanner.v1'));
await page.reload();
await page.waitForSelector('#canvas .item');
ok((await page.locator('#canvas .item').count()) === 3, '初期サンプル3アイテム');
await page.click('#openPrint');
await page.waitForSelector('#printModalBack:not([hidden])');
ok(!(await page.locator('#prev').isHidden()), 'プレビューcanvas表示');
ok((await page.locator('#pmeta').textContent()).includes('仕切り'), 'メタ情報に仕切り数');
ok((await page.locator('#pmeta').textContent()).includes('3'), '仕切り3個(=アイテム3)');
ok(await page.locator('#scopeRow').isHidden(), '未選択時は範囲切替を隠す');
ok(!(await page.locator('#pmDownload').isDisabled()), 'ダウンロード有効');
await page.screenshot({ path: 'shots/3d-01-fit.png' });

console.log('--- 2. STLダウンロード & バイナリ検証(fitベース) ---');
// アプリが設定する download 属性を捕捉(headlessの suggestedFilename は非ASCIIで信頼できない)
await page.evaluate(() => {
  window.__dl = null;
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function(){ if (this.download) window.__dl = this.download; return orig.apply(this, arguments); };
});
let dims = await dimsFromMeta(page);
let dlP = grab(page);
await page.click('#pmDownload');
let { buf } = await dlP;
const dlName = await page.evaluate(() => window.__dl);
ok(/_tray\.stl$/.test(dlName), `ファイル名が *_tray.stl (${dlName})`);
ok(buf.length > 84, 'STLに中身がある');
validateSTL(buf, 'fit', dims);

console.log('--- 3. ベースを「引き出しサイズ」に ---');
await page.click('#baseSeg button[data-v="drawer"]');
await page.waitForTimeout(100);
dims = await dimsFromMeta(page);
ok(Math.abs(dims[0]-330)<0.5 && Math.abs(dims[1]-420)<0.5, `引き出しサイズ 330×420 に一致(${dims[0]}×${dims[1]})`);
dlP = grab(page); await page.click('#pmDownload'); buf = (await dlP).buf;
validateSTL(buf, 'drawer', dims);
await page.screenshot({ path: 'shots/3d-02-drawer.png' });

console.log('--- 4. 仕切り高さ「アイテムごと」+ 壁/すき間変更 ---');
await page.click('#baseSeg button[data-v="fit"]');
await page.click('#heightSeg button[data-v="item"]');
const before = await dimsFromMeta(page);
await page.fill('#pWall', '3');
await page.fill('#pClear', '2.5');
await page.waitForTimeout(100);
const after = await dimsFromMeta(page);
ok(after[0] > before[0] && after[1] > before[1], `壁/すき間を増やすと外形が大きくなる(${before[0]}→${after[0]})`);
dlP = grab(page); await page.click('#pmDownload'); buf = (await dlP).buf;
validateSTL(buf, 'item-height', after);
// 元に戻す
await page.fill('#pWall', '2'); await page.fill('#pClear', '1.5');
await page.click('#heightSeg button[data-v="uniform"]');

console.log('--- 5. 選択中アイテムだけ(このアイテム専用ホルダー) ---');
await page.click('#pmCancel');
await page.click('#canvas .item'); // 先頭アイテム選択
await page.waitForSelector('#selPanel:not([hidden])');
await page.click('#openPrint');
await page.waitForSelector('#printModalBack:not([hidden])');
ok(!(await page.locator('#scopeRow').isHidden()), '選択中は範囲切替を表示');
await page.click('#scopeSeg button[data-v="sel"]');
await page.waitForTimeout(100);
ok((await page.locator('#pmeta').textContent()).includes('仕切り 1'), '選択のみ=仕切り1個');
dims = await dimsFromMeta(page);
dlP = grab(page); await page.click('#pmDownload'); buf = (await dlP).buf;
const r = validateSTL(buf, 'single', dims);
ok(r.n === 60, '単一アイテムは5ボックス=60三角形(床+壁4枚)');
await page.screenshot({ path: 'shots/3d-03-single.png' });
await page.click('#pmCancel');

console.log('--- 6. 空の引き出しではダウンロード不可 ---');
page.on('dialog', d => d.accept());
await page.click('#addDrawer');
await page.waitForSelector('#drawerModalBack:not([hidden])');
await page.click('#dmSave'); // 空の新規引き出し
await page.waitForTimeout(100);
ok((await page.locator('#canvas .item').count()) === 0, '新規引き出しは空');
await page.click('#openPrint');
await page.waitForSelector('#printModalBack:not([hidden])');
ok(await page.locator('#pmDownload').isDisabled(), '空ならダウンロード無効');
ok(!(await page.locator('#prevEmpty').isHidden()), '空の案内メッセージ表示');
ok((await page.locator('#prevEmpty').textContent()).includes('アイテムを追加'), '案内文言');
await page.screenshot({ path: 'shots/3d-04-empty.png' });

console.log('--- 7. Escで閉じる ---');
await page.keyboard.press('Escape');
ok(await page.locator('#printModalBack').isHidden(), 'Escでモーダルが閉じる');

await browser.close();
console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
