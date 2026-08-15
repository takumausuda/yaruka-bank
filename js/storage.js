/* ============================================================
 * やる価バンク 2.0 — データモデル & localStorage ラッパー
 * 全データは端末内 localStorage に保存(サーバー不要)
 * ============================================================ */

const Storage = (() => {
  const KEYS = {
    settings: 'yaruka_settings',
    projects: 'yaruka_projects',
    habits:   'yaruka_habits',
    days:     'yaruka_days',     // 日別レコード { 'YYYY-MM-DD': DayRecord }
    gauges:   'yaruka_gauges',
    streak:   'yaruka_streak',
  };

  /* ---------- デフォルト値(要件定義書 4章準拠) ---------- */

  const DEFAULT_SETTINGS = {
    apiKey: '',                        // Anthropic APIキー(端末外に送信しない)
    // 固定料金表: priceMatrix[難易度][インパクト](低中高 × 小中大)
    priceMatrix: [
      [100, 200, 300],   // 難易度低
      [200, 300, 500],   // 難易度中
      [300, 500, 1000],  // 難易度高
    ],
    morningCombo: 300,                 // モーニングコンボ固定給
    nightCombo: 300,                   // ナイトコンボ固定給
    luckyReward: 100,                  // ラッキーポスチャー記録の報酬
    streakBonus: { 7: 500, 30: 3000 }, // 連続日数 → ボーナス額
    soundOn: true,                     // 完了演出の効果音
    monthlyTarget: 50000,              // 月間目標
  };

  // ご褒美ゲージ配分(4.11 月次予算モデル)
  // allocations の並び順 = 配分の優先順位
  const DEFAULT_GAUGES = {
    allocations: [
      { id: 'weekend',  name: '週末家族軍資金',            monthly: 20000, type: 'weekly',  weeklyTarget: 5000, main: true },
      { id: 'waseiza',  name: 'サークルWASEIZA飲み会費',   monthly: 5000,  type: 'monthly' },
      { id: 'drink',    name: '個人的な飲み代',            monthly: 5000,  type: 'monthly' },
      { id: 'travel',   name: '海外旅行資金',              monthly: 10000, type: 'pool' },
      { id: 'travelSv', name: '海外旅行積立',              monthly: 10000, type: 'pool' },
    ],
    // 殿堂ゴール(登録のみ。月間目標超過分の自動積立先は先頭)
    hallOfFame: [
      { id: 'house', name: '新居',       pool: 0 },
      { id: 'car',   name: '車+維持費', pool: 0 },
      { id: 'trip',  name: 'プチ旅行',   pool: 0 },
    ],
    balances: {},        // 各配分先の現在残高 { allocationId: 円 }
    monthAllocated: {},  // 今月の配分済み額 { allocationId: 円 }(プールの月上限判定用)
    week: null,          // 現在の週(週初め月曜の日付)。変わったら週次ゲージをリセット
    month: null,         // 現在の月 'YYYY-MM'。変わったら月次ゲージをリセット
  };

  // 初期登録想定のプロジェクト(4.1)
  const DEFAULT_PROJECTS = [
    { name: '姿勢のマネタイズ化' },
    { name: 'アプリ開発' },
    { name: '講演会資料作成' },
    { name: 'AIDrivenスクール課題' },
    { name: '姿勢ゲーム完成' },
  ].map((p, i) => ({
    id: 'p' + (i + 1),
    name: p.name,
    deadline: null,      // 期限(任意, 'YYYY-MM-DD')
    memo: '',
    progress: '',        // 現在の進捗状況(自由記述)
    createdAt: today(),
  }));

  // 習慣タブ初期登録(4.8 カウンター式)
  const DEFAULT_HABITS = [
    { id: 'h1', name: '掃除', unit: '15分',   price: 300 },
    { id: 'h2', name: '家事', unit: '5分',    price: 100 },
    { id: 'h3', name: '読書', unit: '1ページ', price: 10 },
  ];

  const DEFAULT_STREAK = {
    current: 0,        // 連続日数(日別レコードから再計算して保持)
    best: 0,
  };

  /* ---------- 日別レコードのひな形 ---------- */

  function newDayRecord(date) {
    return {
      date,
      // クエスト: { id, projectId, title, difficulty(0-2), impact(0-2), amount, done, manual }
      quests: [],
      morningCombo: false,
      nightCombo: false,
      firstTry: { hint: '', amount: 0, done: false, custom: '' }, // 初トライ(1日1件)
      lucky: { note: '', done: false },                            // ラッキーポスチャー記録
      habitCounts: {},   // { habitId: 回数 }
      bonus: 0,          // ストリークボーナス(到達日に自動加算)
      bankedTotal: 0,    // 即時貯金でゲージへ配分済みの額(その日の獲得額と一致させる)
      allocMap: {},      // 配分先ごとの本日の累計 { 配分先名: 円 }
      closed: false,     // 実物の貯金箱に現金を入れた確認済み
      allocatedTotal: 0, // 現金を貯金箱に入れたと確認した額
    };
  }

  /* ---------- 日付ヘルパー ---------- */

  function fmt(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function today() { return fmt(new Date()); }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return fmt(d);
  }

  // 週の起点(月曜)の日付を返す
  function weekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // 月曜=0
    d.setDate(d.getDate() - dow);
    return fmt(d);
  }

  /* ---------- 低レベル入出力 ---------- */

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  /* ---------- 公開API(取得・保存) ---------- */

  function getSettings()      { return { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) }; }
  function saveSettings(s)    { save(KEYS.settings, s); }

  function getProjects()      { return load(KEYS.projects, null) ?? seed(KEYS.projects, DEFAULT_PROJECTS); }
  function saveProjects(p)    { save(KEYS.projects, p); }

  function getHabits()        { return load(KEYS.habits, null) ?? seed(KEYS.habits, DEFAULT_HABITS); }
  function saveHabits(h)      { save(KEYS.habits, h); }

  function getGauges()        { return { ...DEFAULT_GAUGES, ...(load(KEYS.gauges, null) ?? seed(KEYS.gauges, DEFAULT_GAUGES)) }; }
  function saveGauges(g)      { save(KEYS.gauges, g); }

  function getStreak()        { return { ...DEFAULT_STREAK, ...load(KEYS.streak, {}) }; }
  function saveStreak(s)      { save(KEYS.streak, s); }

  function getAllDays()       { return load(KEYS.days, {}); }
  function getDay(date = today()) {
    const days = getAllDays();
    const stored = days[date] ?? {};
    const record = { ...newDayRecord(date), ...stored };
    // 旧データ(締め時に一括配分していた頃)の移行:
    // 締め済みの日はその額がすでにゲージへ入っているので配分済みとして扱う
    if (stored.bankedTotal === undefined) {
      record.bankedTotal = stored.closed ? (stored.allocatedTotal ?? 0) : 0;
    }
    if (stored.allocMap === undefined && Array.isArray(stored.allocResult)) {
      record.allocMap = Object.fromEntries(stored.allocResult.map(e => [e.name, e.amount]));
    }
    return record;
  }
  function saveDay(record) {
    const days = getAllDays();
    days[record.date] = record;
    save(KEYS.days, days);
  }

  /* 前日までの未完了クエストを今日へ持ち越す。
   * 過去の日別レコードから未完了クエストを取り除き、carried 印を付けて今日へ移す。
   * 移動後の過去レコードには未完了が残らないため、何度呼んでも二重には持ち越されない
   * (render のたびに呼んでよい)。未完了は金額に影響しないので貯金・ストリークは動かない。 */
  function rolloverQuests() {
    const days = getAllDays();
    const t = today();
    const moved = [];
    for (const [date, rec] of Object.entries(days)) {
      if (date >= t) continue;
      const unfinished = (rec.quests ?? []).filter(q => !q.done);
      if (unfinished.length === 0) continue;
      rec.quests = rec.quests.filter(q => q.done);
      moved.push(...unfinished.map(q => ({ ...q, carried: true })));
    }
    if (moved.length === 0) return false;
    // 今日のレコード(旧データ移行込み)に追加し、過去の変更ごと1回で保存する
    const todayRec = getDay(t);
    todayRec.quests = [...todayRec.quests, ...moved];
    days[t] = todayRec;
    save(KEYS.days, days);
    return true;
  }

  function seed(key, value) { save(key, value); return value; }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- 集計 ---------- */

  // 1日の獲得合計と内訳を計算
  function dayTotal(record, habits = getHabits(), settings = getSettings()) {
    const quests = record.quests.filter(q => q.done).reduce((s, q) => s + q.amount, 0);
    const combo = (record.morningCombo ? settings.morningCombo : 0)
                + (record.nightCombo ? settings.nightCombo : 0);
    const firstTry = record.firstTry.done ? record.firstTry.amount : 0;
    const lucky = record.lucky.done ? settings.luckyReward : 0;
    const habitTotal = Object.entries(record.habitCounts).reduce((s, [id, count]) => {
      const h = habits.find(x => x.id === id);
      return s + (h ? h.price * count : 0);
    }, 0);
    const bonus = record.bonus;
    return {
      quests, combo, firstTry, lucky, habits: habitTotal, bonus,
      total: quests + combo + firstTry + lucky + habitTotal + bonus,
    };
  }

  /* ---------- ストリーク(4.10) ----------
   * 日別レコードから毎回逆算する(状態のズレを防ぐ)。
   * 「1日1クエスト以上達成」で継続。今日未達成でも昨日までの連続は維持。 */

  function computeStreak() {
    const days = getAllDays();
    const questDone = d => (days[d]?.quests ?? []).some(q => q.done);
    let cursor = today();
    if (!questDone(cursor)) cursor = addDays(cursor, -1); // 今日はまだ猶予
    let count = 0;
    while (questDone(cursor)) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  // ストリークを再計算し、ベスト更新も保存して返す
  function streakInfo() {
    const s = getStreak();
    s.current = computeStreak();
    if (s.current > s.best) s.best = s.current;
    saveStreak(s);
    return s;
  }

  // 今日のボーナスを再計算して日別レコードに反映(クエスト達成状況が変わるたびに呼ぶ)
  // ストリークが 7 / 30 にちょうど到達した日に加算される
  function refreshBonus(record, settings = getSettings()) {
    const doneToday = record.quests.some(q => q.done);
    const streak = computeStreak();
    record.bonus = (doneToday && settings.streakBonus[streak]) ? settings.streakBonus[streak] : 0;
    return record;
  }

  /* ---------- ゲージ配分(4.11) ---------- */

  // 週替わり・月替わりのリセット処理
  function rolloverGauges() {
    const g = getGauges();
    const wk = weekStart(today());
    const mo = today().slice(0, 7);
    let changed = false;
    if (g.week !== wk) {
      g.week = wk;
      g.allocations.filter(a => a.type === 'weekly').forEach(a => { g.balances[a.id] = 0; });
      changed = true;
    }
    if (g.month !== mo) {
      g.month = mo;
      g.allocations.filter(a => a.type === 'monthly').forEach(a => { g.balances[a.id] = 0; });
      g.monthAllocated = {};
      changed = true;
    }
    if (changed) saveGauges(g);
    return g;
  }

  /* 獲得額を優先順位順(allocations の並び順)に配分する。
   * - weekly: 週次目標まで(週が変わるとゲージリセット)
   * - monthly: 月額まで(月が変わるとゲージリセット)
   * - pool: 残高は累積、ただし月の配分は月額まで
   * 全枠が埋まった超過分は殿堂ゴール先頭へ自動積立。
   * 戻り値: { entries: [{name, amount}], overflow } */
  function allocate(amount) {
    const g = rolloverGauges();
    let rest = amount;
    const entries = [];
    for (const a of g.allocations) {
      if (rest <= 0) break;
      const balance = g.balances[a.id] ?? 0;
      const allocatedThisMonth = g.monthAllocated[a.id] ?? 0;
      const room = a.type === 'weekly'
        ? Math.max(0, a.weeklyTarget - balance)
        : Math.max(0, a.monthly - allocatedThisMonth);
      const take = Math.min(rest, room);
      if (take > 0) {
        g.balances[a.id] = balance + take;
        g.monthAllocated[a.id] = allocatedThisMonth + take;
        entries.push({ name: a.name, amount: take });
        rest -= take;
      }
    }
    let overflow = 0;
    if (rest > 0 && g.hallOfFame.length > 0) {
      g.hallOfFame[0].pool += rest;
      overflow = rest;
      entries.push({ name: g.hallOfFame[0].name + '(殿堂積立)', amount: rest });
      rest = 0;
    }
    saveGauges(g);
    return { entries, overflow };
  }

  /* 配分を巻き戻す(クエストの完了取り消し・削除・減額に対応)。
   * allocate と逆の順序(最後に入った殿堂積立 → 優先順位の低い枠へ)で差し戻す。
   * 週替わり・月替わりでゲージがリセットされていた場合は、残っている分までしか戻せない。
   * 戻り値: { entries: [{name, amount}] }(amount は戻した額、正の数) */
  function unallocate(amount) {
    const g = rolloverGauges();
    let rest = amount;
    const entries = [];

    if (rest > 0 && g.hallOfFame.length > 0) {
      const take = Math.min(rest, g.hallOfFame[0].pool);
      if (take > 0) {
        g.hallOfFame[0].pool -= take;
        entries.push({ name: g.hallOfFame[0].name + '(殿堂積立)', amount: take });
        rest -= take;
      }
    }

    for (let i = g.allocations.length - 1; i >= 0 && rest > 0; i--) {
      const a = g.allocations[i];
      const balance = g.balances[a.id] ?? 0;
      const allocatedThisMonth = g.monthAllocated[a.id] ?? 0;
      // 残高と今月の配分実績の両方から引ける分までを戻す
      const take = Math.min(rest, balance, allocatedThisMonth);
      if (take > 0) {
        g.balances[a.id] = balance - take;
        g.monthAllocated[a.id] = allocatedThisMonth - take;
        entries.push({ name: a.name, amount: take });
        rest -= take;
      }
    }

    saveGauges(g);
    return { entries };
  }

  /* その日の獲得額とゲージへ配分済みの額のズレを解消する(即時貯金の中核)。
   * 増えた分はゲージへ配分し、減った分は差し戻すので、
   * 1タップ計上・取り消し・編集・削除のどれでも残高が必ず一致する。
   * 戻り値: { delta }(プラス=貯金した額 / マイナス=戻した額) */
  function syncBanking(record) {
    const total = dayTotal(record).total;
    const banked = record.bankedTotal ?? 0;
    const delta = total - banked;
    if (delta === 0) return { delta: 0 };

    const { entries } = delta > 0 ? allocate(delta) : unallocate(-delta);
    const sign = delta > 0 ? 1 : -1;
    const map = { ...(record.allocMap ?? {}) };
    for (const e of entries) {
      map[e.name] = (map[e.name] ?? 0) + sign * e.amount;
      if (map[e.name] <= 0) delete map[e.name];
    }
    record.allocMap = map;
    record.bankedTotal = total;
    return { delta };
  }

  /* ---------- バックアップ(2章: 書き出し/復元) ---------- */

  function exportAll() {
    const dump = {};
    Object.values(KEYS).forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw !== null) dump[k] = JSON.parse(raw);
    });
    return JSON.stringify({ app: 'yaruka-bank', version: 2, exportedAt: new Date().toISOString(), data: dump });
  }

  function importAll(text) {
    const parsed = JSON.parse(text);
    if (parsed.app !== 'yaruka-bank' || !parsed.data) throw new Error('やる価バンクのバックアップ形式ではありません');
    Object.entries(parsed.data).forEach(([k, v]) => save(k, v));
  }

  return {
    KEYS, today, addDays, weekStart, newDayRecord, newId,
    getSettings, saveSettings,
    getProjects, saveProjects,
    getHabits, saveHabits,
    getGauges, saveGauges,
    getStreak, saveStreak,
    getAllDays, getDay, saveDay, rolloverQuests,
    dayTotal, computeStreak, streakInfo, refreshBonus,
    rolloverGauges, allocate, unallocate, syncBanking,
    exportAll, importAll,
  };
})();
