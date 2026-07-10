// 勉強サーチ E2E検証: 実アプリを起動し、Google API(Gemini/YouTube)だけネットワーク層でモックする
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8399/study-search/';
const SHOT = p => `shots/${p}`;

const failures = [];
let stepNo = 0;
function check(name, cond, extra) {
  stepNo++;
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`[${String(stepNo).padStart(2, '0')}] ${mark}  ${name}${extra ? '  |  ' + extra : ''}`);
  if (!cond) failures.push(name);
}

// ---- モックの状態(テスト途中で切り替える) ----
const mode = { judgeFail: false, filterFail: false, ytQuota: false };
const counters = { judge: 0, filter: 0, ytSearch: 0, ytVideos: 0 };

const THUMB_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='180'><rect width='320' height='180' fill='#1c2330'/><text x='160' y='95' fill='#8b97a8' font-size='18' text-anchor='middle' font-family='sans-serif'>thumbnail</text></svg>`;

// YouTube search.list のモック(タイトルはAPI実物と同じくHTMLエスケープ済みで返す)
const SEARCH_PAYLOAD = {
  items: [
    { id: { videoId: 'vid00001' }, snippet: { title: '【高校数学】二次関数の最大・最小 完全マスター', channelTitle: '数学チャンネル', description: '高校数学Iの二次関数を基礎から解説します', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/vid00001/mqdefault.jpg' } }, publishedAt: '2026-05-01T00:00:00Z', liveBroadcastContent: 'none' } },
    { id: { videoId: 'vid00002' }, snippet: { title: '二次関数 グラフの描き方 &amp; 平方完成【中学数学】', channelTitle: '学びラボ', description: '平方完成のコツ', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/vid00002/mqdefault.jpg' } }, publishedAt: '2026-07-09T00:00:00Z', liveBroadcastContent: 'none' } },
    { id: { videoId: 'vidXSS00' }, snippet: { title: '&lt;img src=x onerror=window.__xss=1&gt; 二次関数テスト', channelTitle: 'セキュ確認', description: 'x', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/vidXSS00/mqdefault.jpg' } }, publishedAt: '2025-01-01T00:00:00Z', liveBroadcastContent: 'none' } },
    { id: { videoId: 'vidGAME0' }, snippet: { title: 'フォートナイト神プレイ集www', channelTitle: 'ゲーム実況ch', description: '最強キル集', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/vidGAME0/mqdefault.jpg' } }, publishedAt: '2026-06-01T00:00:00Z', liveBroadcastContent: 'none' } },
  ],
};
const VIDEOS_PAYLOAD = {
  items: [
    { id: 'vid00001', contentDetails: { duration: 'PT12M34S' }, statistics: { viewCount: '123456' } },
    { id: 'vid00002', contentDetails: { duration: 'PT1H2M3S' }, statistics: { viewCount: '9876' } },
    { id: 'vidXSS00', contentDetails: { duration: 'PT4M5S' }, statistics: { viewCount: '42' } },
    { id: 'vidGAME0', contentDetails: { duration: 'PT10M' }, statistics: { viewCount: '55555555' } },
  ],
};

const geminiBody = obj => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

async function main() {
  const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 414, height: 880 } });

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8399')) return route.continue();

    if (url.includes('generativelanguage.googleapis.com')) {
      const body = route.request().postDataJSON();
      const prompt = body.contents[0].parts[0].text;
      const isJudge = prompt.includes('検索キーワード: 「');
      await new Promise(r => setTimeout(r, 150)); // 実APIっぽい遅延(busy状態の確認用)
      if (isJudge) {
        counters.judge++;
        if (mode.judgeFail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'mock internal error', status: 'INTERNAL' } }) });
        const q = (prompt.match(/検索キーワード: 「(.+)」/) || [])[1] || '';
        const blocked = /フォートナイト|ゲーム/.test(q);
        return route.fulfill({ contentType: 'application/json', body: geminiBody(blocked
          ? { allowed: false, reason: 'ゲームの実況や攻略は勉強に関係ないから、今はガマンしよう。' }
          : { allowed: true, reason: '数学の学習に役立つキーワードだね。' }) });
      }
      counters.filter++;
      if (mode.filterFail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'mock filter error', status: 'INTERNAL' } }) });
      return route.fulfill({ contentType: 'application/json', body: geminiBody({ ng: ['vidGAME0'] }) });
    }

    if (url.includes('/youtube/v3/search')) {
      counters.ytSearch++;
      if (mode.ytQuota) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, message: 'quota exceeded', errors: [{ reason: 'quotaExceeded' }] } }) });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(SEARCH_PAYLOAD) });
    }
    if (url.includes('/youtube/v3/videos')) {
      counters.ytVideos++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(VIDEOS_PAYLOAD) });
    }
    if (url.includes('i.ytimg.com')) return route.fulfill({ contentType: 'image/svg+xml', body: THUMB_SVG });
    if (url.includes('youtube-nocookie.com')) return route.fulfill({ contentType: 'text/html', body: `<body style="margin:0;background:#000;color:#fff;display:grid;place-items:center;height:100vh;font:16px sans-serif"><div>▶ mock player: ${url.split('/embed/')[1]?.split('?')[0] || ''}</div></body>` });
    return route.abort();
  });

  const doSearch = async q => {
    await page.fill('#q', q);
    await page.click('#searchBtn');
  };

  // ---------- 1. 初回起動: セットアップカード ----------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('初回起動でAPIキー設定カードが表示される', await page.isVisible('#setupCard'));
  check('初回起動で進行ステップは非表示', await page.isHidden('#steps'));
  await page.screenshot({ path: SHOT('shot-01-setup.png'), fullPage: true });

  // ---------- 2. 設定モーダルでキー保存 ----------
  await page.click('#setupOpenBtn');
  check('設定モーダルが開く', await page.isVisible('#settingsModal .mpanel'));
  await page.fill('#inGmKey', 'TEST_GEMINI_KEY');
  await page.fill('#inYtKey', 'TEST_YOUTUBE_KEY');
  check('キー入力欄はデフォルトでpassword型', await page.getAttribute('#inGmKey', 'type') === 'password');
  await page.check('#showKeys');
  check('「キーを表示」でtext型に切替', await page.getAttribute('#inGmKey', 'type') === 'text');
  await page.screenshot({ path: SHOT('shot-02-settings.png') });
  await page.click('#settingsSave');
  check('保存後にセットアップカードが消える', await page.isHidden('#setupCard'));

  // ---------- 3. 勉強系の検索 → 許可され結果表示、娯楽動画1件除外 ----------
  await doSearch('数学 二次関数');
  const busyDuringSearch = await page.isDisabled('#searchBtn');
  await page.waitForSelector('.vcard', { timeout: 10000 });
  check('検索中は検索ボタンが無効化される', busyDuringSearch);
  check('許可バー(✅)が表示される', await page.isVisible('.allowbar'));
  check('検索完了後に進行ステップが消える', await page.isHidden('#steps'));
  const cardCount = await page.locator('.vcard').count();
  check('動画カードが3件(4件中ゲーム1件をGeminiが除外)', cardCount === 3, `count=${cardCount}`);
  const noteText = await page.textContent('.note').catch(() => '');
  check('「1件除外しました」ノートが出る', /1 件除外/.test(noteText || ''), JSON.stringify(noteText));
  const gameVisible = await page.locator('.vcard', { hasText: 'フォートナイト' }).count();
  check('ゲーム動画は結果に出ない', gameVisible === 0);
  const title2 = await page.locator('.vtitle').nth(1).textContent();
  check('HTMLエンティティ(&amp;)がデコードされて表示される', title2.includes('描き方 & 平方完成'), JSON.stringify(title2));
  const sub1 = await page.locator('.vsub').first().textContent();
  check('再生時間・視聴回数・日付が表示される(12万回視聴)', /12万回視聴/.test(sub1), JSON.stringify(sub1));
  const dur1 = await page.locator('.dur').first().textContent();
  check('再生時間バッジ 12:34', dur1 === '12:34', dur1);
  // XSS: タイトル中のHTMLがテキストとして表示され、実行されない
  const xssFired = await page.evaluate(() => window.__xss);
  const xssTitle = await page.locator('.vtitle').nth(2).textContent();
  check('タイトル内のHTMLは実行されずテキスト表示(XSS安全)', xssFired === undefined && xssTitle.includes('<img'), JSON.stringify(xssTitle));
  await page.screenshot({ path: SHOT('shot-03-results.png'), fullPage: true });

  // ---------- 4. 動画カードをタップ → アプリ内プレイヤー ----------
  await page.click('.vcard >> nth=0');
  await page.waitForSelector('#playerModal.open');
  const frameSrc = await page.getAttribute('#pmVideo iframe', 'src');
  check('プレイヤーが開き youtube-nocookie 埋め込みになる', frameSrc.includes('youtube-nocookie.com/embed/vid00001'), frameSrc);
  check('プレイヤーにタイトル表示', (await page.textContent('#pmTitle')).includes('二次関数の最大・最小'));
  await page.screenshot({ path: SHOT('shot-04-player.png') });
  await page.click('#pmClose');
  check('「閉じる」でプレイヤーが閉じ、iframeが破棄される(再生停止)', !(await page.locator('#playerModal.open').count()) && (await page.locator('#pmVideo iframe').count()) === 0);

  // 🔍 スマホの「戻る」でも閉じる(popstate)
  await page.click('.vcard >> nth=1');
  await page.waitForSelector('#playerModal.open');
  await page.evaluate(() => history.back()); // pushState間の戻りはload無しなのでgoBack()ではなく直接
  await page.waitForTimeout(300);
  check('🔍 ブラウザの「戻る」でプレイヤーが閉じる', !(await page.locator('#playerModal.open').count()));

  // 🔍 Escキーでも閉じる
  await page.click('.vcard >> nth=0');
  await page.waitForSelector('#playerModal.open');
  await page.keyboard.press('Escape');
  check('🔍 Escキーでプレイヤーが閉じる', !(await page.locator('#playerModal.open').count()));

  // ---------- 5. ゲーム系の検索 → ブロック ----------
  const ytBefore = counters.ytSearch;
  await doSearch('フォートナイト 実況');
  await page.waitForSelector('.blockcard');
  check('ブロックカード(⛔)が表示される', await page.isVisible('.blockcard'));
  const reason = await page.textContent('.blockcard .reason');
  check('Geminiの理由が表示される', reason.includes('ゲームの実況や攻略は勉強に関係ない'), JSON.stringify(reason));
  check('ブロック時はYouTube APIを呼ばない', counters.ytSearch === ytBefore, `ytSearch=${counters.ytSearch}`);
  await page.screenshot({ path: SHOT('shot-05-blocked.png'), fullPage: true });

  // 🔍 同じNGワードを再検索 → キャッシュで即ブロック(Gemini呼び出し回数が増えない)
  const judgeBefore = counters.judge;
  await doSearch('フォートナイト 実況');
  await page.waitForSelector('.blockcard');
  check('🔍 2回目の同じNGワードはキャッシュで即ブロック(Gemini再呼び出しなし)', counters.judge === judgeBefore, `judge=${counters.judge}`);

  // ---------- 6. リロード後の永続化と最近の検索 ----------
  await page.reload({ waitUntil: 'networkidle' });
  check('リロード後もキーが保存されている(設定カード非表示)', await page.isHidden('#setupCard'));
  const chips = await page.locator('.chip').allTextContents();
  check('最近の検索に許可ワードだけ残る', chips.includes('数学 二次関数') && !chips.some(c => c.includes('フォートナイト')), JSON.stringify(chips));

  // 🔍 チップをタップして再検索できる
  await page.click('.chip >> nth=0');
  await page.waitForSelector('.vcard');
  check('🔍 最近の検索チップから再検索できる', (await page.locator('.vcard').count()) === 3);

  // ---------- 7. 🔍 異常系 ----------
  // 空検索 → 何も起きない
  const judgeBeforeEmpty = counters.judge;
  await page.fill('#q', '   ');
  await page.click('#searchBtn');
  await page.waitForTimeout(300);
  check('🔍 空白だけの検索は無視される(API呼び出しなし)', counters.judge === judgeBeforeEmpty);

  // Gemini障害 → 安全側に倒して検索させない(YouTubeも呼ばない)
  mode.judgeFail = true;
  const ytBeforeFail = counters.ytSearch;
  await doSearch('英語 リスニング');
  await page.waitForSelector('.errcard');
  const errText1 = await page.textContent('.errcard');
  check('🔍 Gemini障害時はエラー表示して検索しない(フェイルクローズ)', errText1.includes('Geminiの判定ができませんでした') && counters.ytSearch === ytBeforeFail, JSON.stringify(errText1.trim().slice(0, 80)));
  mode.judgeFail = false;

  // YouTubeクォータ切れ → わかりやすいメッセージ
  mode.ytQuota = true;
  await doSearch('英語 リスニング');
  await page.waitForSelector('.errcard');
  const errText2 = await page.textContent('.errcard');
  check('🔍 YouTubeクォータ切れの専用メッセージ', errText2.includes('無料枠を使い切りました'), JSON.stringify(errText2.trim().slice(0, 80)));
  mode.ytQuota = false;

  // 結果フィルタだけ失敗 → 結果は出す+注意書き(フェイルオープン)
  mode.filterFail = true;
  await doSearch('物理 力学');
  await page.waitForSelector('.vcard');
  const warnNote = await page.locator('.note').allTextContents();
  check('🔍 動画フィルタ失敗時は結果を表示しつつ注意書き', (await page.locator('.vcard').count()) === 4 && warnNote.some(t => t.includes('追加チェックに失敗')), JSON.stringify(warnNote));
  mode.filterFail = false;
  await page.screenshot({ path: SHOT('shot-06-filter-warn.png'), fullPage: true });

  // ---------- 8. JSエラーが出ていないこと ----------
  check('ページ内JSエラーなし', pageErrors.length === 0, JSON.stringify(pageErrors));
  const realConsoleErrors = consoleErrors.filter(t => !t.includes('Failed to load resource'));
  check('コンソールエラーなし(リソース404除く)', realConsoleErrors.length === 0, JSON.stringify(realConsoleErrors));

  await browser.close();

  console.log('\n---- counters:', JSON.stringify(counters));
  if (failures.length) {
    console.log(`\nRESULT: FAIL (${failures.length} failed)`);
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('\nRESULT: ALL PASS');
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
