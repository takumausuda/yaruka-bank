/* ============================================================
 * やる価バンク 2.0 — アプリ本体(骨格段階)
 * タブ切替 + 各画面のレンダリング
 * 報酬ループ(1タップ計上)は手順2、AI連携は手順3で実装
 * ============================================================ */

const App = (() => {

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  const yen = n => n.toLocaleString('ja-JP');

  /* ---------- タブ切替 ---------- */

  function initTabs() {
    $$('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.screen').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        $('#screen-' + tab.dataset.screen).classList.add('active');
        render();
      });
    });
  }

  /* ---------- レンダリング ---------- */

  function render() {
    renderHome();
    renderHabits();
    renderGauges();
    renderProjects();
    renderClose();
    renderSettings();
  }

  function renderHome() {
    const day = Storage.getDay();
    const streak = Storage.getStreak();
    const totals = Storage.dayTotal(day);

    $('#streak-days').textContent = streak.current;
    $('#today-total').textContent = yen(totals.total);

    // メインゲージ(週末軍資金)— 骨格段階は目標値表示のみ
    const gauges = Storage.getGauges();
    const main = gauges.allocations.find(a => a.main);
    const balance = gauges.balances[main.id] ?? 0;
    const remaining = Math.max(0, main.weeklyTarget - balance);
    $('#gauge-remaining').textContent = yen(remaining);
    $('#gauge-fill').style.width = Math.min(100, (balance / main.weeklyTarget) * 100) + '%';

    // クエスト一覧
    const list = $('#quest-list');
    if (day.quests.length === 0) {
      list.innerHTML = `<li class="empty-state">「生成」ボタンで今日のクエストを作成<br><small>(AI生成は手順3で実装予定)</small></li>`;
    } else {
      const projects = Storage.getProjects();
      list.innerHTML = day.quests.map(q => {
        const pj = projects.find(p => p.id === q.projectId);
        return `
          <li class="quest-item ${q.done ? 'done' : ''}" data-quest-id="${q.id}">
            <button class="quest-check">${q.done ? '✓' : ''}</button>
            <div class="quest-body">
              <div class="quest-title">${escapeHtml(q.title)}</div>
              ${pj ? `<div class="quest-project">${escapeHtml(pj.name)}</div>` : ''}
            </div>
            <div class="quest-amount">${yen(q.amount)}円</div>
          </li>`;
      }).join('');
    }

    // コンボボタンの状態
    $('#btn-morning-combo').classList.toggle('done', day.morningCombo);
    $('#btn-night-combo').classList.toggle('done', day.nightCombo);
  }

  function renderHabits() {
    const habits = Storage.getHabits();
    const day = Storage.getDay();
    $('#habit-list').innerHTML = habits.map(h => `
      <li class="habit-item" data-habit-id="${h.id}">
        <div class="habit-body">
          <div class="habit-name">${escapeHtml(h.name)}</div>
          <div class="habit-unit">${escapeHtml(h.unit)} = ${yen(h.price)}円</div>
        </div>
        <div class="habit-count">${day.habitCounts[h.id] ?? 0}</div>
        <button class="habit-plus">+</button>
      </li>`).join('');
  }

  function renderGauges() {
    const gauges = Storage.getGauges();
    const typeLabel = { weekly: '週次', monthly: '月次', pool: '累積プール' };
    $('#gauge-list').innerHTML = gauges.allocations.map(a => {
      const balance = gauges.balances[a.id] ?? 0;
      const target = a.type === 'weekly' ? a.weeklyTarget : a.monthly;
      const pct = Math.min(100, (balance / target) * 100);
      return `
        <div class="card gauge-item">
          <div class="gauge-name">${a.main ? '⭐ ' : ''}${escapeHtml(a.name)} <small>(${typeLabel[a.type]})</small></div>
          <div class="gauge-numbers"><strong>${yen(balance)}円</strong> / ${yen(target)}円</div>
          <div class="gauge-bar"><div class="gauge-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');

    $('#hall-of-fame-list').innerHTML = gauges.hallOfFame.map(g => `
      <div class="card gauge-item">
        <div class="gauge-name">🏆 ${escapeHtml(g.name)}</div>
        <div class="gauge-numbers"><strong>${yen(g.pool)}円</strong> 積立中</div>
      </div>`).join('');
  }

  function renderProjects() {
    const projects = Storage.getProjects();
    $('#project-list').innerHTML = projects.map(p => {
      let meta = [];
      if (p.deadline) {
        const days = Math.ceil((new Date(p.deadline) - new Date(Storage.today())) / 86400000);
        meta.push(`<span class="${days <= 7 ? 'project-deadline-near' : ''}">期限: ${p.deadline}(あと${days}日)</span>`);
      }
      if (p.progress) meta.push(escapeHtml(p.progress));
      return `
        <li class="project-item" data-project-id="${p.id}">
          <div class="project-name">${escapeHtml(p.name)}</div>
          ${meta.length ? `<div class="project-meta">${meta.join(' / ')}</div>` : ''}
        </li>`;
    }).join('');
  }

  function renderClose() {
    const day = Storage.getDay();
    const totals = Storage.dayTotal(day);
    const streak = Storage.getStreak();
    const settings = Storage.getSettings();

    $('#close-total').textContent = yen(totals.total) + '円';
    $('#close-breakdown').innerHTML = [
      ['クエスト', totals.quests],
      ['固定給(コンボ)', totals.combo],
      ['初トライ', totals.firstTry],
      ['ラッキー', totals.lucky],
      ['習慣', totals.habits],
      ['ボーナス', totals.bonus],
    ].map(([label, v]) => `<li><span>${label}</span><span>${yen(v)}円</span></li>`).join('');

    $('#piggy-amount').textContent = yen(totals.total);
    $('#btn-piggy-done').textContent = day.closed ? '✓ 確認済み' : '貯金箱に入れた!';
    $('#btn-piggy-done').disabled = day.closed;

    // ストリークと次のボーナス
    const bonusDays = Object.keys(settings.streakBonus).map(Number).sort((a, b) => a - b);
    const next = bonusDays.find(d => d > streak.current);
    $('#close-streak-card').innerHTML = `
      🔥 ストリーク <strong>${streak.current}日</strong>
      ${next ? ` — 次のボーナス(+${yen(settings.streakBonus[next])}円)まであと <strong>${next - streak.current}日</strong>` : ''}`;

    // ゲージ進捗サマリ
    const gauges = Storage.getGauges();
    const main = gauges.allocations.find(a => a.main);
    const remaining = Math.max(0, main.weeklyTarget - (gauges.balances[main.id] ?? 0));
    $('#close-gauges-card').innerHTML = `🎁 週末軍資金まであと <strong>${yen(remaining)}円</strong>`;

    // 日曜夜はバックアップリマインド
    $('#backup-reminder').classList.toggle('hidden', new Date().getDay() !== 0);
  }

  function renderSettings() {
    const settings = Storage.getSettings();
    $('#input-api-key').value = settings.apiKey;

    const rows = ['低', '中', '高'];
    $('#price-table tbody').innerHTML = settings.priceMatrix.map((row, i) => `
      <tr><th>${rows[i]}</th>${row.map(v => `<td>${yen(v)}</td>`).join('')}</tr>`).join('');
  }

  /* ---------- イベント(骨格段階の最小限) ---------- */

  function initEvents() {
    // APIキー保存
    $('#btn-save-api-key').addEventListener('click', () => {
      const settings = Storage.getSettings();
      settings.apiKey = $('#input-api-key').value.trim();
      Storage.saveSettings(settings);
      alert('APIキーを保存しました(端末内にのみ保存されます)');
    });

    // バックアップ書き出し(クリップボードコピー)
    $('#btn-export').addEventListener('click', async () => {
      const text = Storage.exportAll();
      try {
        await navigator.clipboard.writeText(text);
        alert('全データをクリップボードにコピーしました');
      } catch {
        prompt('コピーできない場合は以下を手動でコピーしてください', text);
      }
    });

    // 復元
    $('#btn-import').addEventListener('click', () => {
      const text = prompt('バックアップテキストを貼り付けてください');
      if (!text) return;
      try {
        Storage.importAll(text);
        alert('復元しました');
        render();
      } catch (e) {
        alert('復元に失敗しました: ' + e.message);
      }
    });

    // 以下は手順2以降で実装するボタン(現段階では案内のみ)
    const notYet = msg => () => alert(msg + '(次の段階で実装します)');
    $('#btn-generate-quests').addEventListener('click', notYet('AIクエスト生成'));
    $('#btn-add-quest').addEventListener('click', notYet('手動クエスト追加'));
    $('#btn-add-habit').addEventListener('click', notYet('習慣の追加'));
    $('#btn-add-project').addEventListener('click', notYet('プロジェクトの追加'));
    $('#btn-morning-combo').addEventListener('click', notYet('コンボ計上'));
    $('#btn-night-combo').addEventListener('click', notYet('コンボ計上'));
    $('#btn-piggy-done').addEventListener('click', notYet('夜の締め確認'));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ---------- 起動 ---------- */

  function init() {
    initTabs();
    initEvents();
    render();
  }

  return { init, render };
})();

document.addEventListener('DOMContentLoaded', App.init);
