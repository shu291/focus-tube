"use strict";

/* =========================================================
 * きょうの献立ルーレット
 * 難易度 → 4つのルーレット → Gemini API で具体的なレシピ生成
 * ========================================================= */

// 難易度ごとのルーレット候補
const DATA = {
  easy: {
    label: "簡単",
    genre:      ["和食", "洋食", "中華"],
    staple:     ["ご飯", "麺", "パン", "丼"],
    ingredient: ["鶏肉", "豚肉", "卵", "ひき肉", "野菜", "ツナ缶"],
    method:     ["炒める", "焼く", "和える", "レンジ加熱"],
    keyword: "簡単 時短",
  },
  normal: {
    label: "普通",
    genre:      ["和食", "洋食", "中華", "イタリアン", "韓国料理"],
    staple:     ["ご飯", "麺", "パスタ", "パン", "丼"],
    ingredient: ["鶏肉", "豚肉", "牛肉", "魚", "卵", "豆腐", "きのこ"],
    method:     ["焼く", "煮る", "炒める", "揚げる", "蒸す"],
    keyword: "定番 おかず",
  },
  hard: {
    label: "凝った料理",
    genre:      ["フレンチ", "イタリアン", "本格中華", "エスニック", "スペイン料理", "創作料理"],
    staple:     ["リゾット", "手打ちパスタ", "パエリア", "ご飯", "バゲット"],
    ingredient: ["牛肉", "魚介(エビ・貝)", "ラム肉", "鴨肉", "旬の野菜", "きのこ"],
    method:     ["煮込む", "ロースト", "低温調理", "ソース仕立て", "オーブン焼き"],
    keyword: "本格 おもてなし",
  },
};

const REEL_KEYS = ["genre", "staple", "ingredient", "method"];
const REEL_JP = { genre: "ジャンル", staple: "主食", ingredient: "メイン食材", method: "調理法" };

const state = {
  people: 2,
  difficulty: null,
  result: {}, // { genre, staple, ingredient, method }
};

/* ---------- DOM ヘルパー ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $("#" + id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* =========================================================
 * 画面1：スタート
 * ========================================================= */
function initStart() {
  const countEl = $("#peopleCount");
  $("#peopleMinus").addEventListener("click", () => {
    state.people = Math.max(1, state.people - 1);
    countEl.textContent = state.people;
  });
  $("#peoplePlus").addEventListener("click", () => {
    state.people = Math.min(12, state.people + 1);
    countEl.textContent = state.people;
  });

  $$(".diff-card").forEach((card) => {
    card.addEventListener("click", () => {
      $$(".diff-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      state.difficulty = card.dataset.diff;
      $("#toRouletteBtn").disabled = false;
    });
  });

  $("#toRouletteBtn").addEventListener("click", () => {
    if (!state.difficulty) return;
    prepareRoulette();
    showScreen("screen-roulette");
  });
}

/* =========================================================
 * 画面2：ルーレット
 * ========================================================= */
function prepareRoulette() {
  const d = DATA[state.difficulty];
  $("#recap").textContent = `${d.label}・${state.people}人分 — 4つのルーレットを回そう！`;
  state.result = {};
  $("#toRecipeBtn").disabled = true;
  // リールをリセット
  $$("#reels .reel").forEach((reel) => {
    reel.classList.remove("done");
    reel.querySelector(".reel-strip").innerHTML = '<span class="reel-item">？</span>';
  });
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// 1つのリールを回す（スロット風に上から流れて止まる）
function spinReel(reel, options, finalValue) {
  return new Promise((resolve) => {
    const strip = reel.querySelector(".reel-strip");
    // ダミーを並べて最後に確定値
    const sequence = [];
    const spinCount = 18 + Math.floor(Math.random() * 8);
    for (let i = 0; i < spinCount; i++) sequence.push(pickRandom(options));
    sequence.push(finalValue);

    strip.innerHTML = sequence
      .map((v) => `<span class="reel-item">${v}</span>`)
      .join("");

    const itemHeight = 64;
    const totalShift = (sequence.length - 1) * itemHeight;
    strip.style.transition = "none";
    strip.style.transform = "translateY(0)";

    // 次フレームでアニメーション開始
    requestAnimationFrame(() => {
      const duration = 1.4 + Math.random() * 0.8;
      strip.style.transition = `transform ${duration}s cubic-bezier(0.15, 0.85, 0.25, 1)`;
      strip.style.transform = `translateY(-${totalShift}px)`;
      setTimeout(() => {
        reel.classList.add("done");
        resolve();
      }, duration * 1000);
    });
  });
}

async function spinAll() {
  const d = DATA[state.difficulty];
  const spinBtn = $("#spinBtn");
  spinBtn.disabled = true;
  $("#toRecipeBtn").disabled = true;

  // 確定値を先に決める
  REEL_KEYS.forEach((key) => {
    state.result[key] = pickRandom(d[key]);
  });

  // 全リールを一斉スタート（少しずつ止まる時間をずらす）
  const reels = $$("#reels .reel");
  reels.forEach((r) => r.classList.remove("done"));
  const promises = reels.map((reel) => {
    const key = reel.dataset.key;
    return spinReel(reel, d[key], state.result[key]);
  });

  await Promise.all(promises);
  spinBtn.textContent = "🎰 もう一回まわす";
  spinBtn.disabled = false;
  $("#toRecipeBtn").disabled = false;
}

function initRoulette() {
  $("#spinBtn").addEventListener("click", spinAll);
  $("#toRecipeBtn").addEventListener("click", () => {
    showScreen("screen-recipe");
    loadRecipe();
  });
  $("#backToStartBtn").addEventListener("click", () => showScreen("screen-start"));
}

/* =========================================================
 * 画面3：レシピ（Gemini API or 検索リンク）
 * ========================================================= */
function resultSummary() {
  const r = state.result;
  return `${r.genre} / ${r.staple} / ${r.ingredient} / ${r.method}`;
}

function getApiKey() {
  return (localStorage.getItem("gemini_api_key") || "").trim();
}

async function loadRecipe() {
  const d = DATA[state.difficulty];
  const r = state.result;
  $("#recipeRecap").textContent = `${d.label}・${state.people}人分 — ${resultSummary()}`;
  const area = $("#recipeArea");

  const key = getApiKey();
  if (!key) {
    renderSearchFallback(area, "AIレシピを使うには ⚙️ 設定で Gemini APIキーを登録してください。");
    return;
  }

  area.innerHTML = `<div class="loading"><div class="spinner"></div>AIがレシピを考えています…</div>`;

  try {
    const recipe = await fetchGeminiRecipe(key, d, r, state.people);
    renderRecipe(area, recipe);
  } catch (err) {
    console.error(err);
    renderSearchFallback(
      area,
      "AIレシピの取得に失敗しました（APIキーや通信をご確認ください）。代わりに検索で探せます。"
    );
  }
}

async function fetchGeminiRecipe(apiKey, d, r, people) {
  const prompt = `あなたはプロの料理研究家です。以下の条件に合う家庭料理を1品、日本語で考えてください。

# 条件
- ジャンル: ${r.genre}
- 主食/ベース: ${r.staple}
- メイン食材: ${r.ingredient}
- 主な調理法: ${r.method}
- 難易度: ${d.label}
- 人数: ${people}人分

# 出力（必ず次のJSON形式のみ。説明文やマークダウンは付けない）
{
  "title": "料理名",
  "description": "一言の紹介（30文字程度）",
  "time": "調理時間の目安（例: 約25分）",
  "ingredients": ["材料 分量（${people}人分）", "..."],
  "steps": ["手順1", "手順2", "..."],
  "tip": "おいしく作るコツを1つ"
}`;

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 1.0, responseMimeType: "application/json" },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error("Gemini API error: " + res.status + " " + t);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return JSON.parse(text);
}

function renderRecipe(area, recipe) {
  const ingredients = (recipe.ingredients || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("");
  const steps = (recipe.steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const tip = recipe.tip ? `<div class="recipe-tip">💡 <strong>コツ：</strong>${escapeHtml(recipe.tip)}</div>` : "";

  area.innerHTML = `
    <div class="recipe-card">
      <h3>${escapeHtml(recipe.title || "おすすめ料理")}</h3>
      <div class="recipe-meta">${escapeHtml(recipe.description || "")}${recipe.time ? " ・ ⏱ " + escapeHtml(recipe.time) : ""} ・ 👥 ${state.people}人分</div>
      <h4>🛒 材料</h4>
      <ul>${ingredients}</ul>
      <h4>👩‍🍳 作り方</h4>
      <ol>${steps}</ol>
      ${tip}
    </div>
    ${searchLinksHtml(recipe.title)}
  `;
}

function renderSearchFallback(area, message) {
  area.innerHTML = `
    <p class="notice">${escapeHtml(message)}</p>
    ${searchLinksHtml(null)}
  `;
}

function searchLinksHtml(dishTitle) {
  const d = DATA[state.difficulty];
  const r = state.result;
  const base = dishTitle
    ? dishTitle
    : `${r.genre} ${r.ingredient} ${r.staple} ${r.method} ${d.keyword} レシピ`;
  const q = encodeURIComponent(base.replace(/\(.*?\)/g, "").trim());
  return `
    <h4 style="color:var(--accent-dark);text-align:center;margin:18px 0 8px;">🔎 レシピを探す</h4>
    <div class="search-links">
      <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Googleで検索</a>
      <a href="https://cookpad.com/search/${q}" target="_blank" rel="noopener">クックパッドで探す</a>
      <a href="https://recipe.rakuten.co.jp/search/${q}/" target="_blank" rel="noopener">楽天レシピで探す</a>
      <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">YouTubeで作り方動画を見る</a>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initRecipe() {
  $("#reSpinBtn").addEventListener("click", () => {
    showScreen("screen-roulette");
    prepareRoulette();
  });
  $("#homeBtn").addEventListener("click", () => showScreen("screen-start"));
}

/* =========================================================
 * 設定モーダル
 * ========================================================= */
function initSettings() {
  const modal = $("#settingsModal");
  const input = $("#apiKeyInput");
  $("#settingsBtn").addEventListener("click", () => {
    input.value = getApiKey();
    modal.classList.add("open");
  });
  $("#closeSettingsBtn").addEventListener("click", () => modal.classList.remove("open"));
  $("#saveSettingsBtn").addEventListener("click", () => {
    localStorage.setItem("gemini_api_key", input.value.trim());
    modal.classList.remove("open");
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("open");
  });
}

/* ---------- 起動 ---------- */
initStart();
initRoulette();
initRecipe();
initSettings();
