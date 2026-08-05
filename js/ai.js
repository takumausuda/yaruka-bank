/* ============================================================
 * やる価バンク 2.0 — Anthropic API 連携(手順3)
 * 朝のクエスト自動生成(4.2)+ 初トライヒント(4.6)
 *
 * - モデル: claude-sonnet-5(要件: claude-sonnet系、1回数円レベル)
 * - APIキーは localStorage の設定から読み、Anthropic API 以外へは送信しない
 * - 構造化出力(JSON Schema)で応答を固定し、パース失敗を防ぐ
 * ============================================================ */

const AI = (() => {

  const MODEL = 'claude-sonnet-5';
  const API_URL = 'https://api.anthropic.com/v1/messages';

  const DIFF_LABELS = ['低', '中', '高'];
  const IMPACT_LABELS = ['小', '中', '大'];

  // 応答スキーマ: クエスト3件 + 初トライヒント1件
  const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
      quests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            projectId: { type: 'string' },
            title: { type: 'string' },
            difficulty: { type: 'integer', enum: [0, 1, 2] },
            impact: { type: 'integer', enum: [0, 1, 2] },
          },
          required: ['projectId', 'title', 'difficulty', 'impact'],
          additionalProperties: false,
        },
      },
      firstTry: {
        type: 'object',
        properties: {
          hint: { type: 'string' },
          amount: { type: 'integer', enum: [100, 200, 300, 500] },
        },
        required: ['hint', 'amount'],
        additionalProperties: false,
      },
    },
    required: ['quests', 'firstTry'],
    additionalProperties: false,
  };

  function buildPrompt(projects, settings) {
    const today = Storage.today();
    const projectLines = projects.map(p => {
      const parts = [`id=${p.id}「${p.name}」`];
      if (p.deadline) parts.push(`期限:${p.deadline}`);
      if (p.progress) parts.push(`進捗:${p.progress}`);
      if (p.memo) parts.push(`メモ:${p.memo}`);
      return '- ' + parts.join(' / ');
    }).join('\n');

    const matrix = settings.priceMatrix.map((row, d) =>
      row.map((v, i) => `難易度${DIFF_LABELS[d]}×インパクト${IMPACT_LABELS[i]}=${v}円`).join(', ')
    ).join('\n');

    return `あなたは個人の仕事タスク管理を手伝うコーチです。今日は${today}です。

登録プロジェクト:
${projectLines}

以下を生成してください。

1. quests: 今日のクエストをちょうど3つ。
- 各クエストは今日1日で完了できる粒度(所要目安15〜60分)に分解する
- 期限が近いプロジェクトを優先する
- title は「やったら完了と判断できる具体的な作業」を日本語で簡潔に(例: スコア画面のモック作成)
- difficulty(難易度)とimpact(プロジェクトの前進度・期限への寄与)を判定する。金額は次の固定料金表からアプリ側で自動算出される:
${matrix}

2. firstTry: 今日の「初トライ」(やったことのないことに挑戦する)のヒントを1つ。
- 日常で気軽に実行できるもの(例: 姿勢に関連しそうな論文を1本調べる、食べたことのない食べ物を食べる)
- amount は難易度に応じて 100/200/300/500 円から選ぶ`;
  }

  /* 朝のクエスト生成。戻り値: { quests: [...], firstTry: {hint, amount} }
   * quests の金額は固定料金表からこちらで算出する(AIの裁量にしない) */
  async function generateQuests() {
    const settings = Storage.getSettings();
    if (!settings.apiKey) {
      throw new Error('NO_API_KEY');
    }
    const projects = Storage.getProjects();
    if (projects.length === 0) {
      throw new Error('プロジェクトが登録されていません。先にプロジェクトタブで登録してください');
    }

    let res;
    try {
      res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': settings.apiKey,
          'anthropic-version': '2023-06-01',
          // ブラウザから直接呼び出すために必要(キーは端末内のみに保存)
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          // コスト重視: 単純な分解タスクなので思考はオフ
          thinking: { type: 'disabled' },
          output_config: {
            format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
          },
          messages: [{ role: 'user', content: buildPrompt(projects, settings) }],
        }),
      });
    } catch {
      throw new Error('通信できませんでした。オンラインか確認してください');
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message ?? ''; } catch { /* 本文なし */ }
      if (res.status === 401) throw new Error('APIキーが正しくありません。設定タブで確認してください');
      if (res.status === 429) throw new Error('リクエストが多すぎます。少し待ってから再試行してください');
      if (res.status === 400 && /credit/i.test(detail)) throw new Error('APIクレジットが不足しています。Anthropicコンソールで残高を確認してください');
      throw new Error(`生成に失敗しました(${res.status})${detail ? ': ' + detail : ''}`);
    }

    const data = await res.json();
    if (data.stop_reason === 'refusal') {
      throw new Error('生成が拒否されました。もう一度お試しください');
    }
    const text = data.content?.find(b => b.type === 'text')?.text;
    if (!text) throw new Error('応答が空でした。もう一度お試しください');

    const parsed = JSON.parse(text);
    const projectIds = new Set(projects.map(p => p.id));

    const quests = parsed.quests.slice(0, 3).map(q => ({
      id: Storage.newId('q'),
      projectId: projectIds.has(q.projectId) ? q.projectId : null,
      title: q.title,
      difficulty: q.difficulty,
      impact: q.impact,
      amount: settings.priceMatrix[q.difficulty][q.impact], // 固定料金表で算出
      done: false,
      manual: false,
    }));

    return { quests, firstTry: parsed.firstTry };
  }

  return { generateQuests, MODEL };
})();
