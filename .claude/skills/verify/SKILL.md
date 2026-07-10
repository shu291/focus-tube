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
