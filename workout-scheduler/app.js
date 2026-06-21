/* 筋トレ割り当てルーレット
   - その日・その週のメニューを、部位ごとの回復時間を考慮して自動生成
   - やった部位/種目は localStorage に保存し、カレンダーで一覧
   外部ライブラリ・ビルド不要のバニラ構成 */
'use strict';

/* ===== 部位データ ============================================================
   recoveryH … 科学的な目安となる回復時間(時間)。
   大きい筋群ほど回復に時間がかかる。週2回前後の頻度がベストとされるため、
   この時間を空けて再び割り当てる。
   - 脚 72h / 背中・胸 48h(大きいが頻度を上げやすい) / 肩・腕 48h / 腹 24h
   参考: 1部位あたり中2〜3日(48〜72時間)空けるのが一般的な推奨。 */
const MUSCLES = {
  chest:     { name:'胸',   emoji:'🫀', color:'var(--c-chest)',     recoveryH:48,
    ex:['ベンチプレス','ダンベルフライ','腕立て伏せ','インクラインプレス','ディップス','ケーブルクロスオーバー'] },
  back:      { name:'背中', emoji:'🦅', color:'var(--c-back)',      recoveryH:48,
    ex:['懸垂','ラットプルダウン','ベントオーバーロウ','デッドリフト','シーテッドロウ','ダンベルロウ'] },
  legs:      { name:'脚',   emoji:'🦵', color:'var(--c-legs)',      recoveryH:72,
    ex:['スクワット','レッグプレス','ランジ','レッグカール','レッグエクステンション','カーフレイズ','ルーマニアンデッドリフト'] },
  shoulders: { name:'肩',   emoji:'🏔️', color:'var(--c-shoulders)', recoveryH:48,
    ex:['ショルダープレス','サイドレイズ','フロントレイズ','リアレイズ','アップライトロウ'] },
  arms:      { name:'腕',   emoji:'💪', color:'var(--c-arms)',      recoveryH:48,
    ex:['アームカール','トライセプスエクステンション','ハンマーカール','ナローベンチプレス','ケーブルプッシュダウン','コンセントレーションカール'] },
  core:      { name:'腹',   emoji:'🔥', color:'var(--c-core)',      recoveryH:24,
    ex:['クランチ','プランク','レッグレイズ','ロシアンツイスト','アブローラー','バイシクルクランチ'] },
};
const GROUP_KEYS = Object.keys(MUSCLES);

/* セッション種別 → 鍛える部位。週スケジュールで使用。
   同じ部位が連続日に来ないよう並びを工夫したテンプレート。 */
const SESSION_TYPES = {
  push:  { label:'プッシュ(胸・肩・腕)', groups:['chest','shoulders','arms'] },
  pull:  { label:'プル(背中・腕)',       groups:['back','arms'] },
  legs:  { label:'脚・腹',               groups:['legs','core'] },
  upper: { label:'上半身',               groups:['chest','back','shoulders','arms'] },
  lower: { label:'下半身・腹',           groups:['legs','core'] },
  fullA: { label:'全身A',                groups:['chest','back','legs'] },
  fullB: { label:'全身B',                groups:['shoulders','arms','core'] },
  fullC: { label:'全身C',                groups:['back','legs','chest'] },
};

/* 週あたり日数 → 訓練する曜日(月=0..日=6)と、その並び順のセッション種別。
   48〜72時間あくように曜日を配置している。 */
const WEEK_PLANS = {
  3: { days:[0,2,4],         seq:['fullA','fullB','fullC'] },
  4: { days:[0,1,3,4],       seq:['upper','lower','upper','lower'] },
  5: { days:[0,1,2,3,4],     seq:['push','pull','legs','upper','lower'] },
  6: { days:[0,1,2,3,4,5],   seq:['push','pull','legs','push','pull','legs'] },
};

/* ===== ストレージ ===========================================================
   log: { 'YYYY-MM-DD': { groups:[...], ex:[{group,name,sets}], done:true } }
   plan: 直近に割り当てた週スケジュール { 'YYYY-MM-DD': {type, groups, ex} } */
const KEY = 'workout-scheduler-v1';
let store = load();

function load(){
  try{ const s = JSON.parse(localStorage.getItem(KEY)); if(s&&s.log) return s; }catch(e){}
  return { log:{}, plan:{} };
}
function save(){ localStorage.setItem(KEY, JSON.stringify(store)); }

/* ===== 日付ユーティリティ ===================================================*/
function ymd(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function parseYmd(s){ const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
const TODAY = ymd(new Date());
function hoursSince(dateStr){
  const ms = new Date().setHours(0,0,0,0) - parseYmd(dateStr).getTime();
  return ms/3600000;
}

/* 部位ごとの「最後にやった日」 */
function lastTrained(group){
  let latest=null;
  for(const date in store.log){
    if(store.log[date].groups.includes(group)){
      if(!latest || date>latest) latest=date;
    }
  }
  return latest;
}
/* 回復度 0..1+ (1以上=回復完了でやり頃) */
function readiness(group){
  const last = lastTrained(group);
  if(!last) return { ratio:1.4, last:null, hours:Infinity };
  const h = hoursSince(last);
  return { ratio: h / MUSCLES[group].recoveryH, last, hours:h };
}

/* ===== 乱数ヘルパ ===========================================================*/
const rand = n => Math.floor(Math.random()*n);
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=rand(i+1);[a[i],a[j]]=[a[j],a[i]];} return a; }
function pickN(arr,n){ return shuffle(arr).slice(0,n); }

/* 部位から種目を組み立てる */
function buildExercises(groups){
  const out=[];
  groups.forEach(g=>{
    const count = g==='legs'?3 : (g==='core'?2 : (Math.random()<.5?2:3));
    pickN(MUSCLES[g].ex, count).forEach(name=>{
      const sets = 3 + (Math.random()<.4?1:0);
      const reps = g==='core' ? [15,20,30][rand(3)] : [8,10,12][rand(3)];
      out.push({ group:g, name, sets:`${sets}×${reps}` });
    });
  });
  return out;
}

/* ===== きょうのメニュー割り当て =============================================
   回復済み(ratio>=1)の部位を、休んでいる順に優先して2〜3部位を選ぶ。
   ベスト＝いちばん回復している部位を必ず含める。 */
function generateToday(){
  const scored = GROUP_KEYS.map(g=>({ g, ...readiness(g) }))
    .sort((a,b)=> b.ratio - a.ratio);

  const ready = scored.filter(s=> s.ratio>=1);
  const pool = ready.length>=2 ? ready : scored; // 全部疲れていても上位から

  const size = Math.min(pool.length, 2 + (Math.random()<.5?1:0)); // 2〜3部位
  // いちばん回復している部位を軸に、上位からゆるくランダム選択
  const top = pool.slice(0, Math.min(pool.length, size+2));
  const chosen = [top[0].g, ...pickN(top.slice(1).map(s=>s.g), size-1)];

  return { date:TODAY, groups:chosen, ex:buildExercises(chosen) };
}

/* ===== 1週間のスケジュール割り当て =========================================*/
function generateWeek(daysPerWeek){
  const plan = WEEK_PLANS[daysPerWeek];
  const offset = rand(7); // 開始曜日をずらして毎回ちがう並びに
  const seq = shuffleKeepSpacing(plan.seq);

  // 今週の月曜を基準にする
  const now = new Date(); now.setHours(0,0,0,0);
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay()+6)%7));

  const result = [];
  for(let i=0;i<7;i++){
    const date = new Date(monday); date.setDate(monday.getDate()+i);
    const trainIdx = plan.days.indexOf(((i - offset)%7+7)%7);
    if(trainIdx>=0){
      const type = seq[trainIdx % seq.length];
      const groups = SESSION_TYPES[type].groups;
      result.push({ date:ymd(date), rest:false, type, label:SESSION_TYPES[type].label,
        groups, ex:buildExercises(groups) });
    }else{
      result.push({ date:ymd(date), rest:true });
    }
  }
  return result;
}
/* 同じ種別が連続しないように軽くシャッフル */
function shuffleKeepSpacing(seq){
  for(let tries=0;tries<20;tries++){
    const s = shuffle(seq);
    let ok=true;
    for(let i=1;i<s.length;i++) if(s[i]===s[i-1]) ok=false;
    if(ok) return s;
  }
  return seq;
}

/* ===== レンダリング:回復ぐあい =============================================*/
function renderReadiness(){
  const el = document.getElementById('readinessList');
  el.innerHTML = GROUP_KEYS.map(g=>{
    const M = MUSCLES[g];
    const r = readiness(g);
    const pct = Math.min(100, Math.round(r.ratio*100));
    const ready = r.ratio>=1;
    const col = ready?'var(--ok)': pct>60?'var(--warn)':'var(--err)';
    let tag;
    if(r.last===null) tag='未記録';
    else if(ready) tag='ベスト';
    else { const left=Math.ceil((MUSCLES[g].recoveryH - r.hours)/24); tag=`あと約${left}日`; }
    return `<div class="rd-row">
      <span class="rd-name"><i class="rd-dot" style="background:${M.color}"></i>${M.emoji} ${M.name}</span>
      <div class="rd-bar"><i style="width:${pct}%;background:${col}"></i></div>
      <span class="rd-tag ${ready?'ready':''}">${tag}</span>
    </div>`;
  }).join('');
}

/* セッションカードのHTML */
function sessionCardHTML(sess, opts={}){
  const chips = sess.groups.map(g=>{
    const M=MUSCLES[g];
    return `<span class="chip" style="background:${M.color}">${M.emoji} ${M.name}</span>`;
  }).join('');
  const exs = sess.ex.map(e=>`
    <div class="ex-item">
      <div><span class="ex-name">${e.name}</span> <span class="ex-group">/ ${MUSCLES[e.group].name}</span></div>
      <span class="ex-sets">${e.sets}</span>
    </div>`).join('');
  return `<div class="session-card" style="border-left-color:${MUSCLES[sess.groups[0]].color}">
    <div class="s-head"><h3>${opts.title||'今日のメニュー'}</h3><span class="s-date">${opts.date||''}</span></div>
    <div class="s-groups">${chips}</div>
    <div class="ex-list">${exs}</div>
  </div>`;
}

/* ===== きょうタブ ===========================================================*/
let currentToday=null;
function showTodayResult(sess){
  currentToday=sess;
  const done = store.log[TODAY] && store.log[TODAY].done;
  const el=document.getElementById('todayResult');
  el.classList.remove('hidden');
  el.innerHTML = sessionCardHTML(sess,{title:'今日のメニュー',date:'きょう'}) + `
    <div class="result-actions">
      <button class="primary-btn" id="logTodayBtn" style="margin:0">${done?'✓ 記録ずみ(上書き)':'✅ これをやった！記録'}</button>
      <button class="ghost-btn" id="reGenBtn">🎲 引き直す</button>
    </div>`;
  document.getElementById('logTodayBtn').onclick=()=>{
    store.log[TODAY]={ groups:sess.groups, ex:sess.ex, done:true };
    save(); renderAll();
    document.getElementById('logTodayBtn').textContent='✓ 記録しました';
  };
  document.getElementById('reGenBtn').onclick=()=>showTodayResult(generateToday());
}

/* ===== 週タブ ===============================================================*/
let weekDays=4;
function showWeekResult(list){
  const el=document.getElementById('weekResult');
  el.classList.remove('hidden');
  const WD=['月','火','水','木','金','土','日'];
  const cards = list.map((s,i)=>{
    if(s.rest) return `<div class="session-card rest-day">${WD[i]} ・ 休養日 😴</div>`;
    return sessionCardHTML(s,{title:`${WD[i]} ・ ${s.label}`, date:s.date});
  }).join('');
  el.innerHTML = cards + `
    <div class="result-actions">
      <button class="primary-btn" id="saveWeekBtn" style="margin:0">📌 この予定をカレンダーに反映</button>
      <button class="ghost-btn" id="reWeekBtn">🎲 組み直す</button>
    </div>`;
  document.getElementById('saveWeekBtn').onclick=()=>{
    list.forEach(s=>{ if(!s.rest) store.plan[s.date]={ type:s.type, label:s.label, groups:s.groups, ex:s.ex }; });
    save(); renderCalendar();
    document.getElementById('saveWeekBtn').textContent='✓ 反映しました';
    switchTab('calendar');
  };
  document.getElementById('reWeekBtn').onclick=()=>showWeekResult(generateWeek(weekDays));
}

/* ===== カレンダー ===========================================================*/
let calYear, calMonth;
(function initCal(){ const d=new Date(); calYear=d.getFullYear(); calMonth=d.getMonth(); })();

function renderCalendar(){
  document.getElementById('calTitle').textContent=`${calYear}年${calMonth+1}月`;
  const first=new Date(calYear,calMonth,1);
  const startCol=(first.getDay()+6)%7; // 月曜始まり
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const grid=document.getElementById('calGrid');
  let html='';
  for(let i=0;i<startCol;i++) html+='<div class="cal-cell empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const date=ymd(new Date(calYear,calMonth,d));
    const log=store.log[date];
    const plan=store.plan[date];
    const groups = log ? log.groups : (plan? plan.groups: null);
    const dots = groups ? groups.map(g=>`<i style="background:${MUSCLES[g].color}"></i>`).join('') : '';
    const cls=['cal-cell'];
    if(date===TODAY) cls.push('today');
    if(log) cls.push('has');
    else if(plan) cls.push('planned');
    html+=`<div class="${cls.join(' ')}" data-date="${date}">
      <span class="dnum">${d}</span>
      <div class="cal-dots">${dots}</div>
    </div>`;
  }
  grid.innerHTML=html;
  grid.querySelectorAll('.cal-cell[data-date]').forEach(c=>{
    c.onclick=()=>showDayDetail(c.dataset.date);
  });
  // 凡例
  document.getElementById('calLegend').innerHTML = GROUP_KEYS.map(g=>
    `<span><i style="background:${MUSCLES[g].color}"></i>${MUSCLES[g].name}</span>`).join('')
    + `<span>● 実施　◌ 予定(点線枠)</span>`;
  renderStats();
}

function showDayDetail(date){
  const el=document.getElementById('dayDetail');
  const log=store.log[date], plan=store.plan[date];
  const data=log||plan;
  if(!data){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const status = log? '実施済み ✅' : '予定 📌';
  const exs=(data.ex||[]).map(e=>`<div class="detail-ex"><span>${e.name} <span class="ex-group">/${MUSCLES[e.group].name}</span></span><span class="ex-sets">${e.sets}</span></div>`).join('');
  el.innerHTML=`<h2>${date.replaceAll('-','/')} ・ ${status}</h2>
    <div class="s-groups">${data.groups.map(g=>`<span class="chip" style="background:${MUSCLES[g].color}">${MUSCLES[g].name}</span>`).join('')}</div>
    ${exs}
    ${log?`<button class="del-link" id="delDay">この日の記録を削除</button>`
         :`<button class="ghost-btn small" id="doneDay">この予定を「実施済み」にする</button>`}`;
  const del=document.getElementById('delDay');
  if(del) del.onclick=()=>{ delete store.log[date]; save(); renderAll(); el.classList.add('hidden'); };
  const done=document.getElementById('doneDay');
  if(done) done.onclick=()=>{ store.log[date]={groups:plan.groups,ex:plan.ex,done:true}; save(); renderAll(); showDayDetail(date); };
}

/* ===== 統計・ストリーク =====================================================*/
function renderStats(){
  const counts={}; GROUP_KEYS.forEach(g=>counts[g]=0);
  let total=0;
  for(const date in store.log){ store.log[date].groups.forEach(g=>{ if(counts[g]!=null){counts[g]++; total++;} }); }
  const max=Math.max(1,...Object.values(counts));
  const el=document.getElementById('statList');
  if(total===0){ el.innerHTML=`<p class="empty-note">まだ記録がありません。「きょう」タブでメニューを割り当てて記録してみましょう。</p>`; return; }
  el.innerHTML=GROUP_KEYS.map(g=>{
    const c=counts[g];
    return `<div class="stat-row">
      <span>${MUSCLES[g].emoji} ${MUSCLES[g].name}</span>
      <div class="stat-bar"><i style="width:${Math.round(c/max*100)}%;background:${MUSCLES[g].color}"></i></div>
      <b>${c}回</b></div>`;
  }).join('');
}

function calcStreak(){
  let streak=0;
  const d=new Date(); d.setHours(0,0,0,0);
  // 今日やってなければ昨日から数える（連続が途切れていない範囲）
  if(!store.log[ymd(d)]) d.setDate(d.getDate()-1);
  while(store.log[ymd(d)]){ streak++; d.setDate(d.getDate()-1); }
  return streak;
}
function renderStreak(){ document.getElementById('streakNum').textContent=calcStreak(); }

/* ===== タブ切替 =============================================================*/
function switchTab(name){
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  document.querySelectorAll('.tabview').forEach(v=>v.classList.toggle('active',v.id==='tab-'+name));
}
document.getElementById('tabbar').addEventListener('click',e=>{
  const b=e.target.closest('.tab'); if(b) switchTab(b.dataset.tab);
});

/* ===== イベント =============================================================*/
document.getElementById('genTodayBtn').onclick=()=>showTodayResult(generateToday());

document.getElementById('freqGrid').addEventListener('click',e=>{
  const b=e.target.closest('.freq-btn'); if(!b) return;
  document.querySelectorAll('.freq-btn').forEach(x=>x.classList.remove('active'));
  b.classList.add('active'); weekDays=+b.dataset.days;
});
document.getElementById('genWeekBtn').onclick=()=>showWeekResult(generateWeek(weekDays));

document.getElementById('prevMonth').onclick=()=>{ if(--calMonth<0){calMonth=11;calYear--;} renderCalendar(); document.getElementById('dayDetail').classList.add('hidden'); };
document.getElementById('nextMonth').onclick=()=>{ if(++calMonth>11){calMonth=0;calYear++;} renderCalendar(); document.getElementById('dayDetail').classList.add('hidden'); };

document.getElementById('exportBtn').onclick=()=>{
  const blob=new Blob([JSON.stringify(store,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=`workout-log-${TODAY}.json`; a.click();
  URL.revokeObjectURL(a.href);
};

/* ===== 初期描画 =============================================================*/
function renderAll(){ renderReadiness(); renderCalendar(); renderStreak(); }
renderAll();

/* ===== Service Worker =======================================================*/
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
}
