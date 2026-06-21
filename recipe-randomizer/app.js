"use strict";

/* =========================================================
 * きょうの献立ルーレット
 * 難易度 → 4つのルーレット → 決まった組み合わせで料理を検索
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
 * 画面3：レシピ（検索リンク）
 * ========================================================= */
function resultSummary() {
  const r = state.result;
  return `${r.genre} / ${r.staple} / ${r.ingredient} / ${r.method}`;
}

function loadRecipe() {
  const d = DATA[state.difficulty];
  $("#recipeRecap").textContent = `${d.label}・${state.people}人分 — ${resultSummary()}`;
  const area = $("#recipeArea");
  area.innerHTML = `
    <p class="notice">この組み合わせで作れる料理を探そう！</p>
    ${searchLinksHtml()}
  `;
}

function searchLinksHtml() {
  const d = DATA[state.difficulty];
  const r = state.result;
  const base = `${r.genre} ${r.ingredient} ${r.staple} ${r.method} ${d.keyword} レシピ`;
  const q = encodeURIComponent(base.replace(/\(.*?\)/g, "").trim());
  return `
    <h4 style="color:var(--accent-dark);text-align:center;margin:18px 0 8px;">🔎 レシピを探す</h4>
    <div class="search-links">
      <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Googleで検索</a>
      <a href="https://recipe.rakuten.co.jp/search/${q}/" target="_blank" rel="noopener">楽天レシピで探す</a>
      <a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">YouTubeで作り方動画を見る</a>
    </div>
  `;
}

function initRecipe() {
  $("#reSpinBtn").addEventListener("click", () => {
    showScreen("screen-roulette");
    prepareRoulette();
  });
  $("#homeBtn").addEventListener("click", () => showScreen("screen-start"));
}

/* ---------- 起動 ---------- */
initStart();
initRoulette();
initRecipe();
