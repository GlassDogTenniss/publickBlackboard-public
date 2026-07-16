(() => {
  'use strict';

  const section = document.querySelector('#parallelSection');
  const summary = document.querySelector('#parallelSummary');
  const groupsContainer = document.querySelector('#parallelGroups');
  const runSelect = document.querySelector('#runSelect');
  if (!section || !summary || !groupsContainer || !runSelect) return;

  const PUBLIC_STATUS_URL = './data/status.json';
  const TERMINAL = new Set(['completed', 'failed', 'timeout']);
  let snapshot = null;

  function text(value) {
    return String(value || '').trim();
  }

  function timestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}時間${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
    if (minutes) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
    return `${seconds}秒`;
  }

  function formatDate(value) {
    const parsed = timestamp(value);
    return parsed ? new Date(parsed).toLocaleString('ja-JP') : 'なし';
  }

  function createElement(tagName, className = '', value = null) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (value != null) element.textContent = value;
    return element;
  }

  function statusMeta(value) {
    const status = text(value).toLowerCase();
    const map = {
      active: ['生成中', 'parallel-active'],
      running: ['並列実行中', 'parallel-active'],
      integrating: ['統合中', 'parallel-active'],
      submitted: ['送信済み', 'parallel-sent'],
      dispatched: ['送信済み', 'parallel-sent'],
      integration_dispatched: ['統合送信済み', 'parallel-sent'],
      ready: ['実行待ち', 'parallel-ready'],
      integration_ready: ['統合待ち', 'parallel-ready'],
      waiting: ['待機中', 'parallel-waiting'],
      completed: ['完了', 'parallel-completed'],
      failed: ['失敗', 'parallel-failed'],
      timeout: ['時間切れ', 'parallel-timeout'],
      target_missing: ['タブ未登録', 'parallel-failed'],
      prepare_failed: ['送信準備失敗', 'parallel-failed']
    };
    return map[status] || [status || '不明', 'parallel-waiting'];
  }

  function currentRun() {
    const runs = snapshot?.runs || [];
    const selectedId = text(runSelect.value);
    return runs.find(run => text(run?.id) === selectedId) || runs[0] || null;
  }

  function durationView(item) {
    const startedAt = timestamp(item?.startedAt);
    if (!startedAt) return '未開始';
    const completedAt = timestamp(item?.completedAt);
    return `${completedAt ? '所要' : '経過'} ${formatDuration((completedAt || Date.now()) - startedAt)}`;
  }

  function makeStatusPill(status) {
    const [label, className] = statusMeta(status);
    return createElement('span', `parallel-status ${className}`, label);
  }

  function makeMetric(label, value, detail = '') {
    const metric = createElement('div', 'parallel-metric');
    metric.append(createElement('span', '', label), createElement('strong', '', value));
    if (detail) metric.append(createElement('small', '', detail));
    return metric;
  }

  function workerCard(worker) {
    const card = createElement('article', 'parallel-worker');
    card.dataset.status = text(worker?.status || worker?.formalStatus || 'waiting');

    const header = createElement('header', 'parallel-worker-header');
    const title = createElement('div');
    title.append(
      createElement('strong', '', text(worker?.label || worker?.workerId || worker?.agentId || 'worker')),
      createElement('small', '', text(worker?.agentId || 'agent未設定'))
    );
    header.append(title, makeStatusPill(worker?.status || worker?.formalStatus));

    const body = createElement('div', 'parallel-worker-body');
    body.append(
      makeMetric('作業時間', durationView(worker), worker?.startedAt ? `開始 ${formatDate(worker.startedAt)}` : ''),
      makeMetric('実行状態', text(worker?.runtimePhase || worker?.observerState || '未観測'), `attempt ${Number(worker?.attempt || 0)}`)
    );

    if (worker?.completedAt) body.append(makeMetric('完了', formatDate(worker.completedAt)));
    if (worker?.timeoutAt && worker?.formalStatus === 'timeout') body.append(makeMetric('期限', formatDate(worker.timeoutAt)));
    if (worker?.lastError) body.append(createElement('p', 'parallel-error', text(worker.lastError)));
    if (worker?.statePath) {
      const path = createElement('p', 'parallel-path');
      path.append(createElement('span', '', 'state: '), createElement('code', '', text(worker.statePath)));
      body.append(path);
    }

    card.append(header, body);
    return card;
  }

  function integrationCard(group) {
    const integration = group?.integration || {};
    const card = createElement('article', 'parallel-integration');
    const header = createElement('div', 'parallel-integration-header');
    header.append(
      createElement('strong', '', 'プログラマ統合ターン'),
      makeStatusPill(integration.status || (group?.counts?.terminal === group?.counts?.total ? 'ready' : 'waiting'))
    );
    const detail = createElement('div', 'parallel-integration-detail');
    detail.append(
      createElement('span', '', `担当: ${text(group?.coordinatorAgentId || '未設定')}`),
      createElement('span', '', integration.dispatchedAt ? `送信: ${formatDate(integration.dispatchedAt)}` : '全worker終了待ち'),
      createElement('span', '', `観測: ${text(integration.runtimePhase || integration.observerState || '未観測')}`)
    );
    if (integration.lastError) detail.append(createElement('p', 'parallel-error', text(integration.lastError)));
    card.append(header, detail);
    return card;
  }

  function groupCard(group) {
    const card = createElement('article', 'parallel-group');
    const counts = group?.counts || {};
    const total = Number(counts.total || group?.workers?.length || 0);
    const terminal = Number(counts.terminal || 0);
    const percent = total ? Math.round(terminal / total * 100) : 0;

    const header = createElement('div', 'parallel-group-header');
    const title = createElement('div');
    title.append(
      createElement('p', 'eyebrow', 'Fork / Join group'),
      createElement('h3', '', text(group?.groupId || 'parallel group')),
      createElement('small', '', `親task: ${text(group?.parentTaskId || '不明')} / revision ${Number(group?.revision || 1)}`)
    );
    header.append(title, makeStatusPill(group?.status));

    const metrics = createElement('div', 'parallel-group-metrics');
    metrics.append(
      makeMetric('終了', `${terminal} / ${total}`, `${Number(counts.completed || 0)}完了・${Number(counts.failed || 0)}失敗`),
      makeMetric('同時実行', `${Number(counts.active || 0)}生成中`, `上限 ${Number(group?.maxConcurrency || 1)}`),
      makeMetric('グループ時間', durationView(group), group?.startedAt ? `開始 ${formatDate(group.startedAt)}` : 'worker送信待ち'),
      makeMetric('段階', text(group?.phase || 'workers'), `coordinator ${text(group?.coordinatorAgentId || '未設定')}`)
    );

    const progress = createElement('div', 'parallel-progress');
    const progressBar = createElement('i');
    progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    progress.append(progressBar);

    const workerGrid = createElement('div', 'parallel-worker-grid');
    for (const worker of group?.workers || []) workerGrid.append(workerCard(worker));

    card.append(header, metrics, progress, workerGrid, integrationCard(group));
    return card;
  }

  function render() {
    const run = currentRun();
    const groups = Array.isArray(run?.parallelGroups) ? run.parallelGroups : [];
    groupsContainer.replaceChildren();
    if (!groups.length) {
      section.hidden = true;
      return;
    }

    section.hidden = false;
    const workers = groups.flatMap(group => group?.workers || []);
    const terminal = workers.filter(worker => TERMINAL.has(text(worker?.formalStatus || worker?.status).toLowerCase())).length;
    const active = workers.filter(worker => text(worker?.status).toLowerCase() === 'active').length;
    const waiting = workers.length - terminal - active;
    summary.textContent = `${workers.length} worker中 ${terminal}終了・${active}生成中・${Math.max(0, waiting)}待機`;
    for (const group of groups) groupsContainer.append(groupCard(group));
  }

  function capture(data) {
    if (!data || !Array.isArray(data.runs)) return;
    snapshot = data;
    render();
  }

  function requestPrivateSnapshot() {
    if (!document.querySelector('meta[name="public-blackboard-dashboard"][content="github-direct"]')) return;
    window.postMessage({
      source: 'publicBlackboard-dashboard',
      type: 'PBB_DASHBOARD_REQUEST',
      force: false
    }, location.protocol === 'file:' ? '*' : location.origin);
  }

  async function fetchPublicSnapshot() {
    if (!document.querySelector('#statusLink')) return;
    try {
      const response = await fetch(`${PUBLIC_STATUS_URL}?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      capture(await response.json());
    } catch (_) {}
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.source !== 'publicBlackboard-extension') return;
    if (event.data?.type !== 'PBB_EXTENSION_DASHBOARD_DATA') return;
    capture(event.data?.payload?.snapshot);
  });

  runSelect.addEventListener('change', () => setTimeout(render, 0));
  window.addEventListener('load', () => {
    requestPrivateSnapshot();
    fetchPublicSnapshot();
  }, { once: true });

  setInterval(render, 1000);
  setInterval(fetchPublicSnapshot, 30000);
})();
