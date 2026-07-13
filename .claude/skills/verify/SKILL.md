---
name: verify
description: このリポジトリ(GitHub Pages配信の静的ミニアプリ集)の変更をブラウザで実際に駆動して検証する手順
---

# focus-tube の検証手順

このリポジトリはビルド不要の静的サイト。各アプリはサブディレクトリの自己完結 `index.html`
(例: `study-search/`, `study-notebook/`)。検証は「ローカルHTTPサーバー + Playwright(Chromium)」で行う。

## 起動

```bash
# リポジトリルートを配信(file:// はlocalStorage等が不安定なので必ずHTTP)
python3 -m http.server 8399 --bind 127.0.0.1 &   # 対象: http://127.0.0.1:8399/<app-dir>/

# Playwright は作業用ディレクトリに npm install playwright
# リモート実行環境ではブラウザDLは不要・禁止。プリインストール版を使う:
#   chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
#   (バージョン不一致で「Executable doesn't exist」が出たときの対処)
```

## 外部APIのモック

`study-search` は Gemini API と YouTube Data API を呼ぶ。実キーなしで全コードパスを通すには
`page.route('**/*', ...)` でネットワーク層をモックする(アプリ側にテスト用コードは入れない):

- `generativelanguage.googleapis.com` … prompt に `検索キーワード: 「` を含めば判定呼び出し、
  それ以外は動画フィルタ呼び出し。`{candidates:[{content:{parts:[{text: JSON文字列}]}}]}` を返す
- `www.googleapis.com/youtube/v3/search` / `/videos` … search.list は**タイトルをHTMLエスケープ済み**で返すのが実API仕様(`&amp;` など)。モックも合わせること
- `i.ytimg.com` はSVG、`youtube-nocookie.com` は簡易HTMLでよい
- 完成済みスクリプト: `.claude/skills/verify/e2e-study-search.mjs`(37チェック。
  `node e2e-study-search.mjs` で実行、スクリーンショットは `shots/` に出力)

## 必ず踏む導線(study-search)

1. 初回起動 → セットアップカード表示 → 設定モーダルでキー保存(localStorage永続化)
2. 勉強系ワード検索 → 許可バー+結果グリッド+「n件除外」ノート
3. ゲーム系ワード検索 → ⛔ブロックカード(このとき YouTube API が呼ばれないこと)
4. カードタップ → アプリ内プレイヤー → 閉じる/Esc/**ブラウザ「戻る」**の3通りで閉じる
5. 異常系: Gemini 500(フェイルクローズ)、YouTube 403 quotaExceeded、空白検索

## ハマりどころ(実際に踏んだもの)

- **iframe の src 書き換えは親ページの履歴を汚す**。プレイヤーは iframe を毎回
  createElement して閉じるとき remove する実装(戻るボタン1回で閉じるための前提)。
  回帰確認には `history.length` が開閉で増えないことを見る
- `hidden` 属性は要素に `display:flex` 指定があると効かない → `#steps[hidden]{display:none}` が必要
- pushState 間の「戻る」は load イベントが無いので Playwright の `page.goBack()` はタイムアウトする。
  `page.evaluate(() => history.back())` を使う

## drawer-planner(引き出しプランナー)

- 外部API依存なし。モック不要で `node e2e-drawer-planner.mjs` がそのまま通る(36チェック)
- 必ず踏む導線: 初回サンプル引き出し → カタログ検索/カテゴリ絞り込み → サイズ変更して追加 →
  回転・複製・削除 → ドラッグ移動 → リロードで永続化 → 重なり/高さ超過の警告 →
  オリジナル登録(マイカタログ) → 引き出しの追加/編集/削除
- ハマりどころ: **重なったアイテム同士のドラッグは最前面(DOM後方)が掴まれる**。
  テストで狙ったアイテムを掴むときは、掴む座標に他アイテムが被っていないことを先に保証する

### 3Dプリント(仕切りトレーSTL書き出し)

- `node e2e-drawer-3dprint.mjs`(46チェック)。外部依存なし。**バイナリSTLを実際に
  ダウンロードして中身を検証する**: ファイルサイズ整合、法線が単位長かつ軸並行、
  バウンディングボックス=表示サイズ、各ボックス(12三角形)が水密(有向エッジが
  逆向きと1対1)、底面(z=0)の存在。fit/drawerベース・uniform/itemの高さ・壁/すき間変更・
  scope=選択のみ(=5ボックス/60三角形)・空の引き出し(DL無効)・Escを網羅
- 生成方式は **軸並行ボックスのunion**(床スラブ + ポケットごとの囲い壁4枚 +
  引き出しサイズ時は外周壁)。隣接する壁は重なって共有壁になる。これは意図した
  設計でスライサーがunionする ―― 「グローバルには非多様体」でも各ボックスが閉じて
  いれば印刷可。検証は**ボックス単位の水密性**で見る(全体の多様体性は見ない)
- ハマりどころ: headless Chromium の `download.suggestedFilename()` は download属性が
  **非ASCII(日本語の引き出し名)だと "download" を返す**。ファイル名検証は
  `HTMLAnchorElement.prototype.click` を差し替えて実際の `download` 属性を捕捉する
- ハマりどころ: Playwright の `download.suggestedFilename` は**メソッド**(要 `()`)

## study-planner(逆算プランナー)

参考書の「いつまでに・どれだけ」から1日のノルマを逆算する学習計画アプリ。外部API依存は
GitHub Gist(同期)のみで、通常操作の検証にはネットワーク不要。

- `node e2e-study-planner.mjs`(31チェック)。空状態 → 参考書追加 → 今日のノルマ逆算
  (総量100/締切+9日=10単語)→ ✓できた/記入/計測 → 計画タブ(進捗・状態・バーンダウンSVG)→
  記録タブ(日別グラフ7本・ヒートマップ・教科別)→ 書き出しJSON → リロード永続化 →
  **サボり再計算**(締切を縮めるとノルマが増える)を網羅
- `node e2e-study-planner-sync.mjs`(11チェック)。`api.github.com` を `ctx.route` でモックし、
  アップロード(POST→gistId保存)→ 自動同期(変更でPATCH、**debounce 4s** を待つ)→
  取得(GET→復元)→ 空トークンのトースト警告 を検証
- **必ず踏む逆算の検証**: `今日のノルマ = ⌈今日開始時点の残量 ÷ 今日から締切までの勉強日数⌉`。
  日を跨がずに確認するには localStorage を直接編集して `deadline` を縮め、リロード後の
  `.tbook .goal .q` を見る(例: 残量100・締切today+4=5日 → 20)
- ハマりどころ: `hidden` 属性は `.fab`/`.cnt`/`.btn` の `display:flex/inline-flex` に負ける。
  グローバルに `[hidden]{display:none!important}` を入れてある(バッジ・FAB・シート内ボタンの
  出し分けがこれに依存)。E2Eの「未達バッジが消える」がこの回帰を踏む
- 相対 `shots/` に出力。`node_modules` はこのディレクトリに無いので、実行時だけ
  `ln -sfn /opt/node22/lib/node_modules node_modules`(グローバルにplaywright有り)を張って走らせ、
  後片付けする
- **HTTPサーバーはBashの `run_in_background:true` で起動する**。`(python3 ... &)` はセッションを
  跨ぐと回収されて `curl` が `000` になる(ハマった)

### 「今日から毎日 あと何時間」指標

- `node e2e-study-planner-pace.mjs`(12チェック)。`calcBook` の `reqMinPerDay`(=残量÷残り勉強日数×
  1単位あたりの分)を検証:順調な本は「予定どおり終えるには 今日から毎日 27分」、
  **大幅に遅れた本は必要時間が増え「↑ サボる前は ◯」**(`origMinPerDay`)を併記、ヒーローに合計時間、
  計画カードのノルマに `≈◯/日` サブ表示が出ること
- データは `localStorage.studyPlanner.v1` を直接注入してリロードで組む。日付は node 側 `Date.UTC` で
  `+N日` を作る(TZずれ回避)。「遅れ」を作るには `startDate` を過去・`deadline` を未来にして未着手にする
  (`origPerDay` は現在の締切基準なので、締切を縮めるだけでは behind にならない点に注意)
- 併せて **テストモードが撤去済み**であること(`#testPanel`/`#testBanner` が無い・
  旧 `studyPlanner.session`/`.test` キーが起動時に掃除される)も確認する

> 旧「テストモード(サンドボックス+仮の今日)」は廃止済み。関連E2E `e2e-study-planner-testmode.mjs`
> は削除した。`todayKey()` は `dayKey()` に戻っている。
