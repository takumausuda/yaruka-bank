/* ============================================================
 * やる価バンク 2.0 — アプリ本体
 * 手順2: 報酬ループ(1タップ計上→残高→ゲージ配分→ストリーク→夜の締め)
 * AI連携(クエスト自動生成・初トライヒント)は手順3で実装
 * ============================================================ */

const App = (() => {

  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  const yen = n => n.toLocaleString('ja-JP');

  const DIFF_LABELS = ['低', '中', '高'];
  const IMPACT_LABELS = ['小', '中', '大'];

  /* ==================== 演出(4.4 即時報酬感) ==================== */

  let audioCtx = null;

  function playCoin() {
    if (!Storage.getSettings().soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, t + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.15);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t + i * 0.08);
        osc.stop(t + i * 0.08 + 0.15);
      });
    } catch { /* 音が出せない環境では無視 */ }
  }

  // タップ位置から「+〇〇円」が浮き上がる演出
  function rewardEffect(amount, ev) {
    const el = document.createElement('div');
    el.className = 'float-reward';
    el.textContent = `+${yen(amount)}円`;
    const x = ev?.clientX ?? window.innerWidth / 2;
    const y = ev?.clientY ?? window.innerHeight / 2;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    playCoin();
  }

  /* ==================== モーダル ==================== */

  function openModal(html) {
    closeModal();
    const root = $('#modal-root');
    root.classList.remove('hidden');
    $('#modal-card').innerHTML = html;
  }

  function closeModal() {
    $('#modal-root').classList.add('hidden');
    $('#modal-card').innerHTML = '';
  }

  // 3択セグメントボタンの選択状態を管理
  function initSegs(container) {
    container.querySelectorAll('.seg-group').forEach(group => {
      group.addEventListener('click', e => {
        const btn = e.target.closest('.seg-btn');
        if (!btn) return;
        group.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        group.dispatchEvent(new CustomEvent('segchange', { bubbles: true }));
      });
    });
  }

  function segValue(group) {
    const active = group.querySelector('.seg-btn.active');
    return active ? Number(active.dataset.value) : 0;
  }

  /* ==================== タブ切替 ==================== */

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

  /* ==================== レンダリング ==================== */

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
    const settings = Storage.getSettings();
    const streak = Storage.streakInfo();
    const totals = Storage.dayTotal(day);

    $('#streak-days').textContent = streak.current;
    $('#today-total').textContent = yen(totals.total);

    // メインゲージ: 週末軍資金まであと〇〇円(最重要UI)
    const gauges = Storage.rolloverGauges();
    const main = gauges.allocations.find(a => a.main);
    const balance = gauges.balances[main.id] ?? 0;
    const remaining = Math.max(0, main.weeklyTarget - balance);
    $('#gauge-remaining').textContent = yen(remaining);
    $('#gauge-fill').style.width = Math.min(100, (balance / main.weeklyTarget) * 100) + '%';

    // クエスト一覧
    const list = $('#quest-list');
    if (day.quests.length === 0) {
      list.innerHTML = `<li class="empty-state">クエストがありません。<br>「✨ 生成」でAIが今日のクエストを提案します<br><small>(「+ 手動でクエスト追加」もOK)</small></li>`;
    } else {
      const projects = Storage.getProjects();
      list.innerHTML = day.quests.map(q => {
        const pj = projects.find(p => p.id === q.projectId);
        return `
          <li class="quest-item ${q.done ? 'done' : ''}" data-quest-id="${q.id}">
            <button class="quest-check" aria-label="完了">${q.done ? '✓' : ''}</button>
            <div class="quest-body">
              <div class="quest-title">${escapeHtml(q.title)}</div>
              ${pj ? `<div class="quest-project">${escapeHtml(pj.name)}</div>` : ''}
            </div>
            <div class="quest-amount">${yen(q.amount)}円</div>
          </li>`;
      }).join('');
    }

    // コンボボタン
    $('#morning-combo-price').textContent = `+${yen(settings.morningCombo)}円`;
    $('#night-combo-price').textContent = `+${yen(settings.nightCombo)}円`;
    $('#btn-morning-combo').classList.toggle('done', day.morningCombo);
    $('#btn-night-combo').classList.toggle('done', day.nightCombo);

    // 初トライ
    const ft = day.firstTry;
    $('#first-try-body').innerHTML = ft.done
      ? `✓ ${escapeHtml(ft.custom || ft.hint || '初トライ')} <span class="mini-amount">+${yen(ft.amount)}円</span>`
      : (ft.hint ? `ヒント: ${escapeHtml(ft.hint)} — タップで計上` : 'タップで記録(「✨ 生成」でAIヒントが届きます)');
    $('#first-try-card').classList.toggle('done-card', ft.done);

    // ラッキーポスチャー
    $('#lucky-body').innerHTML = day.lucky.done
      ? `✓ ${escapeHtml(day.lucky.note)} <span class="mini-amount">+${yen(settings.luckyReward)}円</span>`
      : `タップで今日の気づきを一言記録 +${yen(settings.luckyReward)}円`;
    $('#lucky-card').classList.toggle('done-card', day.lucky.done);
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
        <button class="habit-minus" aria-label="1つ戻す">−</button>
        <div class="habit-count">${day.habitCounts[h.id] ?? 0}</div>
        <button class="habit-plus" aria-label="1カウント">+</button>
      </li>`).join('');
  }

  function renderGauges() {
    const gauges = Storage.rolloverGauges();
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
    const streak = Storage.streakInfo();
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

    $('#piggy-amount').textContent = yen(day.closed ? day.allocatedTotal : totals.total);
    const btn = $('#btn-piggy-done');
    btn.textContent = day.closed ? '✓ 確認済み' : '貯金箱に入れた!';
    btn.disabled = day.closed;

    // ストリークと次のボーナス
    const bonusDays = Object.keys(settings.streakBonus).map(Number).sort((a, b) => a - b);
    const next = bonusDays.find(d => d > streak.current);
    $('#close-streak-card').innerHTML = `
      🔥 ストリーク <strong>${streak.current}日</strong>(ベスト ${streak.best}日)
      ${next ? `<br>次のボーナス(+${yen(settings.streakBonus[next])}円)まであと <strong>${next - streak.current}日</strong>` : ''}`;

    // ゲージ進捗サマリ
    const gauges = Storage.rolloverGauges();
    const main = gauges.allocations.find(a => a.main);
    const remaining = Math.max(0, main.weeklyTarget - (gauges.balances[main.id] ?? 0));
    $('#close-gauges-card').innerHTML = `🎁 週末軍資金まであと <strong>${yen(remaining)}円</strong>`;

    // 配分結果の表示(締め済みの場合)
    const allocCard = $('#close-alloc-card');
    if (day.closed && day.allocResult?.length) {
      allocCard.classList.remove('hidden');
      allocCard.innerHTML = `<div class="card-title">本日の配分</div>` +
        day.allocResult.map(e => `<div class="alloc-row"><span>${escapeHtml(e.name)}</span><span>+${yen(e.amount)}円</span></div>`).join('');
    } else {
      allocCard.classList.add('hidden');
    }

    // 日曜夜はバックアップリマインド
    $('#backup-reminder').classList.toggle('hidden', new Date().getDay() !== 0);
  }

  function renderSettings() {
    const settings = Storage.getSettings();
    $('#input-api-key').value = settings.apiKey;
    $('#toggle-sound').checked = settings.soundOn;

    $('#price-table tbody').innerHTML = settings.priceMatrix.map((row, i) => `
      <tr><th>${DIFF_LABELS[i]}</th>${row.map((v, j) =>
        `<td class="price-cell" data-row="${i}" data-col="${j}">${yen(v)}</td>`).join('')}</tr>`).join('');
  }

  /* ==================== 計上アクション(1タップ) ==================== */

  // クエスト完了トグル
  function toggleQuest(questId, ev) {
    const day = Storage.getDay();
    const q = day.quests.find(x => x.id === questId);
    if (!q) return;
    q.done = !q.done;
    Storage.refreshBonus(day);
    Storage.saveDay(day);
    if (q.done) rewardEffect(q.amount, ev);
    render();
  }

  // コンボトグル
  function toggleCombo(key, ev) {
    const day = Storage.getDay();
    const settings = Storage.getSettings();
    day[key] = !day[key];
    Storage.saveDay(day);
    if (day[key]) rewardEffect(key === 'morningCombo' ? settings.morningCombo : settings.nightCombo, ev);
    render();
  }

  // 習慣カウンター
  function bumpHabit(habitId, delta, ev) {
    const day = Storage.getDay();
    const habit = Storage.getHabits().find(h => h.id === habitId);
    if (!habit) return;
    const current = day.habitCounts[habitId] ?? 0;
    const next = Math.max(0, current + delta);
    if (next === current) return;
    day.habitCounts[habitId] = next;
    Storage.saveDay(day);
    if (delta > 0) rewardEffect(habit.price, ev);
    render();
  }

  /* ==================== モーダル各種 ==================== */

  // クエスト追加/編集(金額は固定料金表から自動算出)
  function openQuestModal(questId = null) {
    const day = Storage.getDay();
    const settings = Storage.getSettings();
    const projects = Storage.getProjects();
    const editing = questId ? day.quests.find(q => q.id === questId) : null;

    const segRow = (label, cls, labels, selected) => `
      <div class="modal-label">${label}</div>
      <div class="seg-group ${cls}">
        ${labels.map((l, i) => `<button type="button" class="seg-btn ${i === selected ? 'active' : ''}" data-value="${i}">${l}</button>`).join('')}
      </div>`;

    openModal(`
      <h2 class="modal-title">${editing ? 'クエストを編集' : 'クエストを追加'}</h2>
      <div class="modal-label">内容</div>
      <input type="text" id="quest-title-input" class="text-input" placeholder="例: スコア画面のモック作成"
             value="${editing ? escapeHtml(editing.title) : ''}">
      <div class="modal-label">プロジェクト(任意)</div>
      <select id="quest-project-select" class="text-input">
        <option value="">なし</option>
        ${projects.map(p => `<option value="${p.id}" ${editing?.projectId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
      ${segRow('難易度', 'seg-diff', DIFF_LABELS, editing?.difficulty ?? 0)}
      ${segRow('インパクト', 'seg-impact', IMPACT_LABELS, editing?.impact ?? 0)}
      <div class="modal-amount">報酬: <strong id="quest-amount-preview"></strong></div>
      <button class="btn btn-primary" id="btn-quest-save">${editing ? '保存' : '追加'}</button>
      ${editing ? '<button class="btn btn-danger" id="btn-quest-delete">削除</button>' : ''}
      <button class="btn" id="btn-modal-cancel">キャンセル</button>
    `);

    const card = $('#modal-card');
    initSegs(card);
    const updateAmount = () => {
      const d = segValue(card.querySelector('.seg-diff'));
      const im = segValue(card.querySelector('.seg-impact'));
      $('#quest-amount-preview').textContent = yen(settings.priceMatrix[d][im]) + '円';
    };
    card.addEventListener('segchange', updateAmount);
    updateAmount();

    $('#btn-quest-save').addEventListener('click', () => {
      const title = $('#quest-title-input').value.trim();
      if (!title) { alert('内容を入力してください'); return; }
      const d = segValue(card.querySelector('.seg-diff'));
      const im = segValue(card.querySelector('.seg-impact'));
      const amount = settings.priceMatrix[d][im];
      const projectId = $('#quest-project-select').value || null;
      const dayNow = Storage.getDay();
      if (editing) {
        const q = dayNow.quests.find(x => x.id === questId);
        Object.assign(q, { title, projectId, difficulty: d, impact: im, amount });
      } else {
        dayNow.quests.push({
          id: Storage.newId('q'), projectId, title,
          difficulty: d, impact: im, amount, done: false, manual: true,
        });
      }
      Storage.refreshBonus(dayNow);
      Storage.saveDay(dayNow);
      closeModal();
      render();
    });

    $('#btn-quest-delete')?.addEventListener('click', () => {
      if (!confirm('このクエストを削除しますか?')) return;
      const dayNow = Storage.getDay();
      dayNow.quests = dayNow.quests.filter(q => q.id !== questId);
      Storage.refreshBonus(dayNow);
      Storage.saveDay(dayNow);
      closeModal();
      render();
    });

    $('#btn-modal-cancel').addEventListener('click', closeModal);
  }

  // 初トライ計上(4.6: 自由記入 + 金額は100〜500円)
  function openFirstTryModal() {
    const day = Storage.getDay();
    if (day.firstTry.done) return;
    const amounts = [100, 200, 300, 500];
    const defaultAmount = amounts.includes(day.firstTry.amount) ? day.firstTry.amount : 300;
    openModal(`
      <h2 class="modal-title">🚀 初トライを計上</h2>
      <div class="modal-label">何に初トライした?</div>
      <input type="text" id="first-try-input" class="text-input" placeholder="例: 食べたことのない食べ物を食べた"
             value="${escapeHtml(day.firstTry.hint)}">
      <div class="modal-label">金額</div>
      <div class="seg-group seg-amount">
        ${amounts.map(a => `<button type="button" class="seg-btn ${a === defaultAmount ? 'active' : ''}" data-value="${a}">${a}円</button>`).join('')}
      </div>
      <button class="btn btn-primary" id="btn-first-try-save">計上する</button>
      <button class="btn" id="btn-modal-cancel">キャンセル</button>
    `);
    const card = $('#modal-card');
    initSegs(card);
    $('#btn-first-try-save').addEventListener('click', ev => {
      const text = $('#first-try-input').value.trim();
      if (!text) { alert('内容を入力してください'); return; }
      const amount = segValue(card.querySelector('.seg-amount')) || 300;
      const dayNow = Storage.getDay();
      dayNow.firstTry = { ...dayNow.firstTry, custom: text, amount, done: true };
      Storage.saveDay(dayNow);
      closeModal();
      rewardEffect(amount, ev);
      render();
    });
    $('#btn-modal-cancel').addEventListener('click', closeModal);
  }

  // ラッキーポスチャー記録(4.7: 一言記録で報酬)
  function openLuckyModal() {
    const day = Storage.getDay();
    if (day.lucky.done) return;
    const settings = Storage.getSettings();
    openModal(`
      <h2 class="modal-title">🍀 ラッキーポスチャー</h2>
      <div class="modal-label">今日のラッキーな出来事・姿勢の気づき</div>
      <input type="text" id="lucky-input" class="text-input" placeholder="例: 立ち姿勢を意識したら集中できた">
      <button class="btn btn-primary" id="btn-lucky-save">記録する(+${yen(settings.luckyReward)}円)</button>
      <button class="btn" id="btn-modal-cancel">キャンセル</button>
    `);
    $('#btn-lucky-save').addEventListener('click', ev => {
      const note = $('#lucky-input').value.trim();
      if (!note) { alert('一言だけ記録してください'); return; }
      const dayNow = Storage.getDay();
      dayNow.lucky = { note, done: true };
      Storage.saveDay(dayNow);
      closeModal();
      rewardEffect(settings.luckyReward, ev);
      render();
    });
    $('#btn-modal-cancel').addEventListener('click', closeModal);
  }

  // 習慣の追加/編集
  function openHabitModal(habitId = null) {
    const habits = Storage.getHabits();
    const editing = habitId ? habits.find(h => h.id === habitId) : null;
    openModal(`
      <h2 class="modal-title">${editing ? '習慣を編集' : '習慣を追加'}</h2>
      <div class="modal-label">名前</div>
      <input type="text" id="habit-name-input" class="text-input" placeholder="例: 皿洗い" value="${editing ? escapeHtml(editing.name) : ''}">
      <div class="modal-label">単位(1タップあたり)</div>
      <input type="text" id="habit-unit-input" class="text-input" placeholder="例: 10分" value="${editing ? escapeHtml(editing.unit) : ''}">
      <div class="modal-label">単価(円)</div>
      <input type="number" id="habit-price-input" class="text-input" inputmode="numeric" placeholder="例: 100" value="${editing ? editing.price : ''}">
      <button class="btn btn-primary" id="btn-habit-save">${editing ? '保存' : '追加'}</button>
      ${editing ? '<button class="btn btn-danger" id="btn-habit-delete">削除</button>' : ''}
      <button class="btn" id="btn-modal-cancel">キャンセル</button>
    `);
    $('#btn-habit-save').addEventListener('click', () => {
      const name = $('#habit-name-input').value.trim();
      const unit = $('#habit-unit-input').value.trim();
      const price = Number($('#habit-price-input').value);
      if (!name || !unit || !(price > 0)) { alert('名前・単位・単価を入力してください'); return; }
      const list = Storage.getHabits();
      if (editing) {
        Object.assign(list.find(h => h.id === habitId), { name, unit, price });
      } else {
        list.push({ id: Storage.newId('h'), name, unit, price });
      }
      Storage.saveHabits(list);
      closeModal();
      render();
    });
    $('#btn-habit-delete')?.addEventListener('click', () => {
      if (!confirm('この習慣を削除しますか?(記録済みのカウントは残ります)')) return;
      Storage.saveHabits(Storage.getHabits().filter(h => h.id !== habitId));
      closeModal();
      render();
    });
    $('#btn-modal-cancel').addEventListener('click', closeModal);
  }

  // プロジェクトの追加/編集
  function openProjectModal(projectId = null) {
    const projects = Storage.getProjects();
    const editing = projectId ? projects.find(p => p.id === projectId) : null;
    openModal(`
      <h2 class="modal-title">${editing ? 'プロジェクトを編集' : 'プロジェクトを追加'}</h2>
      <div class="modal-label">名前</div>
      <input type="text" id="pj-name-input" class="text-input" value="${editing ? escapeHtml(editing.name) : ''}">
      <div class="modal-label">期限(任意)</div>
      <input type="date" id="pj-deadline-input" class="text-input" value="${editing?.deadline ?? ''}">
      <div class="modal-label">進捗状況(自由記述)</div>
      <input type="text" id="pj-progress-input" class="text-input" placeholder="例: モック作成中" value="${editing ? escapeHtml(editing.progress) : ''}">
      <div class="modal-label">メモ</div>
      <input type="text" id="pj-memo-input" class="text-input" value="${editing ? escapeHtml(editing.memo) : ''}">
      <button class="btn btn-primary" id="btn-pj-save">${editing ? '保存' : '追加'}</button>
      ${editing ? '<button class="btn btn-danger" id="btn-pj-delete">削除</button>' : ''}
      <button class="btn" id="btn-modal-cancel">キャンセル</button>
    `);
    $('#btn-pj-save').addEventListener('click', () => {
      const name = $('#pj-name-input').value.trim();
      if (!name) { alert('名前を入力してください'); return; }
      const list = Storage.getProjects();
      const fields = {
        name,
        deadline: $('#pj-deadline-input').value || null,
        progress: $('#pj-progress-input').value.trim(),
        memo: $('#pj-memo-input').value.trim(),
      };
      if (editing) {
        Object.assign(list.find(p => p.id === projectId), fields);
      } else {
        list.push({ id: Storage.newId('p'), ...fields, createdAt: Storage.today() });
      }
      Storage.saveProjects(list);
      closeModal();
      render();
    });
    $('#btn-pj-delete')?.addEventListener('click', () => {
      if (!confirm('このプロジェクトを削除しますか?')) return;
      Storage.saveProjects(Storage.getProjects().filter(p => p.id !== projectId));
      closeModal();
      render();
    });
    $('#btn-modal-cancel').addEventListener('click', closeModal);
  }

  /* ==================== AIクエスト生成(4.2 / 4.6) ==================== */

  async function generateQuests() {
    const settings = Storage.getSettings();
    if (!settings.apiKey) {
      alert('AI生成には Anthropic APIキーが必要です。\n設定タブで登録してください(手動クエスト追加はキーなしで使えます)');
      return;
    }

    const day = Storage.getDay();
    // 完了済み・手動追加のクエストは残し、未完了のAI生成分だけを差し替える
    const keep = day.quests.filter(q => q.done || q.manual);
    if (day.quests.length > keep.length || day.quests.some(q => !q.manual)) {
      if (day.quests.some(q => !q.manual) && !confirm('生成済みの未完了クエストを差し替えます。よろしいですか?')) return;
    }

    const btn = $('#btn-generate-quests');
    btn.disabled = true;
    btn.textContent = '生成中…';
    try {
      const result = await AI.generateQuests();
      const dayNow = Storage.getDay();
      dayNow.quests = [...dayNow.quests.filter(q => q.done || q.manual), ...result.quests];
      // 初トライヒント: まだ計上していなければ反映
      if (!dayNow.firstTry.done) {
        dayNow.firstTry.hint = result.firstTry.hint;
        dayNow.firstTry.amount = result.firstTry.amount;
      }
      Storage.saveDay(dayNow);
      render();
    } catch (e) {
      if (e.message === 'NO_API_KEY') {
        alert('AI生成には Anthropic APIキーが必要です。設定タブで登録してください');
      } else {
        alert(e.message);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ 生成';
      render();
    }
  }

  /* ==================== 夜の締め(4.12) ==================== */

  function closeDay(ev) {
    const day = Storage.getDay();
    if (day.closed) return;
    const totals = Storage.dayTotal(day);
    const result = Storage.allocate(totals.total); // ゲージへ自動配分
    day.closed = true;
    day.allocatedTotal = totals.total;
    day.allocResult = result.entries;
    Storage.saveDay(day);
    rewardEffect(totals.total, ev);
    render();
  }

  /* ==================== イベント ==================== */

  function initEvents() {
    // --- ホーム: クエスト(イベント委任) ---
    $('#quest-list').addEventListener('click', e => {
      const item = e.target.closest('.quest-item');
      if (!item) return;
      if (e.target.closest('.quest-check')) {
        toggleQuest(item.dataset.questId, e);
      } else {
        openQuestModal(item.dataset.questId); // 本体タップで編集
      }
    });
    $('#btn-add-quest').addEventListener('click', () => openQuestModal());
    $('#btn-generate-quests').addEventListener('click', generateQuests);

    // --- ホーム: コンボ・初トライ・ラッキー ---
    $('#btn-morning-combo').addEventListener('click', e => toggleCombo('morningCombo', e));
    $('#btn-night-combo').addEventListener('click', e => toggleCombo('nightCombo', e));
    $('#first-try-card').addEventListener('click', openFirstTryModal);
    $('#lucky-card').addEventListener('click', openLuckyModal);

    // --- 習慣 ---
    $('#habit-list').addEventListener('click', e => {
      const item = e.target.closest('.habit-item');
      if (!item) return;
      if (e.target.closest('.habit-plus')) bumpHabit(item.dataset.habitId, 1, e);
      else if (e.target.closest('.habit-minus')) bumpHabit(item.dataset.habitId, -1, e);
      else openHabitModal(item.dataset.habitId);
    });
    $('#btn-add-habit').addEventListener('click', () => openHabitModal());

    // --- プロジェクト ---
    $('#project-list').addEventListener('click', e => {
      const item = e.target.closest('.project-item');
      if (item) openProjectModal(item.dataset.projectId);
    });
    $('#btn-add-project').addEventListener('click', () => openProjectModal());

    // --- 夜の締め ---
    $('#btn-piggy-done').addEventListener('click', closeDay);

    // --- 設定 ---
    $('#btn-save-api-key').addEventListener('click', () => {
      const settings = Storage.getSettings();
      settings.apiKey = $('#input-api-key').value.trim();
      Storage.saveSettings(settings);
      alert('APIキーを保存しました(端末内にのみ保存されます)');
    });

    $('#toggle-sound').addEventListener('change', e => {
      const settings = Storage.getSettings();
      settings.soundOn = e.target.checked;
      Storage.saveSettings(settings);
    });

    // 料金表: セルタップで編集
    $('#price-table').addEventListener('click', e => {
      const cell = e.target.closest('.price-cell');
      if (!cell) return;
      const { row, col } = cell.dataset;
      const settings = Storage.getSettings();
      const current = settings.priceMatrix[row][col];
      const input = prompt(`難易度${DIFF_LABELS[row]} × インパクト${IMPACT_LABELS[col]} の金額(円)`, current);
      if (input === null) return;
      const value = Number(input);
      if (!(value >= 0)) { alert('数値を入力してください'); return; }
      settings.priceMatrix[row][col] = value;
      Storage.saveSettings(settings);
      render();
    });

    // バックアップ
    $('#btn-export').addEventListener('click', async () => {
      const text = Storage.exportAll();
      try {
        await navigator.clipboard.writeText(text);
        alert('全データをクリップボードにコピーしました');
      } catch {
        prompt('コピーできない場合は以下を手動でコピーしてください', text);
      }
    });

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

    // モーダルの背景タップで閉じる
    $('#modal-root').addEventListener('click', e => {
      if (e.target.classList.contains('modal-overlay')) closeModal();
    });
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
