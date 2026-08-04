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
  const DEFAULT_GAUGES = {
    allocations: [
      { id: 'weekend',  name: '週末家族軍資金',            monthly: 20000, type: 'weekly',  weeklyTarget: 5000, main: true },
      { id: 'waseiza',  name: 'サークルWASEIZA飲み会費',   monthly: 5000,  type: 'monthly' },
      { id: 'drink',    name: '個人的な飲み代',            monthly: 5000,  type: 'monthly' },
      { id: 'travel',   name: '海外旅行資金',              monthly: 10000, type: 'pool' },
      { id: 'travelSv', name: '海外旅行積立',              monthly: 10000, type: 'pool' },
    ],
    // 殿堂ゴール(登録のみ。余剰・配分変更でいつでも切替可能)
    hallOfFame: [
      { id: 'house', name: '新居',       pool: 0 },
      { id: 'car',   name: '車+維持費', pool: 0 },
      { id: 'trip',  name: 'プチ旅行',   pool: 0 },
    ],
    // 各配分先の現在残高 { allocationId: 円 }
    balances: {},
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
    current: 0,        // 連続日数
    best: 0,
    lastDate: null,    // 最後にクエスト達成した日 'YYYY-MM-DD'
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
      bonus: 0,          // ストリークボーナス等の自動加算
      closed: false,     // 夜の締め「貯金箱に入れた」確認済み
    };
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

  /* ---------- 公開API ---------- */

  function today() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function getSettings()      { return { ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) }; }
  function saveSettings(s)    { save(KEYS.settings, s); }

  function getProjects()      { return load(KEYS.projects, null) ?? seed(KEYS.projects, DEFAULT_PROJECTS); }
  function saveProjects(p)    { save(KEYS.projects, p); }

  function getHabits()        { return load(KEYS.habits, null) ?? seed(KEYS.habits, DEFAULT_HABITS); }
  function saveHabits(h)      { save(KEYS.habits, h); }

  function getGauges()        { return load(KEYS.gauges, null) ?? seed(KEYS.gauges, DEFAULT_GAUGES); }
  function saveGauges(g)      { save(KEYS.gauges, g); }

  function getStreak()        { return load(KEYS.streak, DEFAULT_STREAK); }
  function saveStreak(s)      { save(KEYS.streak, s); }

  function getAllDays()       { return load(KEYS.days, {}); }
  function getDay(date = today()) {
    const days = getAllDays();
    return days[date] ?? newDayRecord(date);
  }
  function saveDay(record) {
    const days = getAllDays();
    days[record.date] = record;
    save(KEYS.days, days);
  }

  function seed(key, value) { save(key, value); return value; }

  /* ---------- 集計ヘルパー(骨格段階では簡易版) ---------- */

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
    KEYS, today, newDayRecord,
    getSettings, saveSettings,
    getProjects, saveProjects,
    getHabits, saveHabits,
    getGauges, saveGauges,
    getStreak, saveStreak,
    getAllDays, getDay, saveDay,
    dayTotal,
    exportAll, importAll,
  };
})();
