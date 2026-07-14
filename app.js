'use strict';

const STATUS_URL = 'https://raw.githubusercontent.com/GlassDogTenniss/publickBlackboard-public/main/data/status.json';
const REFRESH_INTERVAL_MS = 30_000;
const NODE_WIDTH = 250;
const NODE_MIN_HEIGHT = 176;
const Y_PATTERN = [42, 132, 282, 162, 306, 78, 224, 122];

const elements = {
  dashboard: document.querySelector('#dashboard'),
  emptyState: document.querySelector('#emptyState'),
  runSelect: document.querySelector('#runSelect'),
  reloadButton: document.querySelector('#reloadButton'),
  resetLayoutButton: document.querySelector('#resetLayoutButton'),
  workflowTitle: document.querySelector('#workflowTitle'),
  workflowStatus: document.querySelector('#workflowStatus'),
  workflowTheme: document.querySelector('#workflowTheme'),
  statusAlert: document.querySelector('#statusAlert'),
  generatedAt: document.querySelector('#generatedAt'),
  currentTask: document.querySelector('#currentTask'),
  currentAgent: document.querySelector('#currentAgent'),
  progressValue: document.querySelector('#progressValue'),
  progressBar: document.querySelector('#progressBar'),
  iterationValue: document.querySelector('#iterationValue'),
  nextAction: document.querySelector('#nextAction'),
  updatedAt: document.querySelector('#updatedAt'),
  runId: document.querySelector('#runId'),
  graphStage: document.querySelector('#graphStage'),
  edgeLayer: document.querySelector('#edgeLayer'),
  nodeLayer: document.querySelector('#nodeLayer'),
  selectedAgentTitle: document.querySelector('#selectedAgentTitle'),
  selectedAgentDetail: document.querySelector('#selectedAgentDetail'),
  historyList: document.querySelector('#historyList'),
  taskTableBody: document.querySelector('#taskTableBody'),
  statusLink: document.querySelector('#statusLink')
};

const app = {
  data: null,
  selectedRunId: '',
  selectedAgentId: '',
  positions: new Map(),
  stageWidth: 1100,
  stageHeight: 570,
  loading: false
};

function createElement(tagName, className = '', text = null) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function statusLabel(status) {
  const value = String(status || '').toLowerCase();
  if (['active', 'in_progress', 'running'].includes(value)) return '稼働中';
  if (value === 'waiting') return '待機中';
  if (value === 'ready') return '実行待ち';
  if (value === 'blocked') return '待機中';
  if (value === 'completed') return '完了';
  if (['error', 'failed'].includes(value)) return 'エラー';
  return value || '不明';
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (['active', 'in_progress', 'running'].includes(value)) return 'status-active';
  if (['waiting', 'ready', 'blocked'].includes(value)) return `status-${value}`;
  if (value === 'completed') return 'status-completed';
  if (['error', 'failed'].includes(value)) return 'status-error';
  return 'status-unknown';
}

function formatDate(value, withSeconds = true) {
  if (!value) return 'なし';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
    hour12: false
  }).format(date);
}

function normalizeLegacyPayload(data) {
  if (Array.isArray(data?.runs)) return data;
  const tasks = (Array.isArray(data?.tasks) ? data.tasks : []).map(task => ({
    id: String(task.taskId || ''),
    label: String(task.taskId || ''),
    agentId: String(task.agentId || ''),
    agentName: String(task.agentId || ''),
    status: String(task.status || ''),
    attempt: Number(task.attempt || 0),
    completedAt: task.updatedAt || null
  }));
  const agentIds = [...new Set(tasks.map(task => task.agentId).filter(Boolean))];
  const agents = agentIds.map(agentId => {
    const relevant = tasks.filter(task => task.agentId === agentId);
    const current = relevant.find(task => task.id === data.currentTask) || relevant.find(task => task.status === 'ready');
    const completedCount = relevant.filter(task => task.status === 'completed').length;
    return {
      agentId,
      name: agentId,
      role: '',
      status: agentId === data.currentAgent ? 'active' : completedCount === relevant.length ? 'completed' : 'waiting',
      activityTaskId: current?.id || '',
      activityTaskLabel: current?.label || '',
      activityStatus: current?.status || '',
      activityInstruction: '',
      completedAt: relevant.map(task => task.completedAt).filter(Boolean).sort().at(-1) || null,
      taskCount: relevant.length,
      completedCount
    };
  });
  const edges = tasks.slice(0, -1).map((task, index) => ({
    from: task.agentId,
    to: tasks[index + 1].agentId,
    fromTask: task.id,
    toTask: tasks[index + 1].id,
    kind: 'sequence'
  }));
  const completed = tasks.filter(task => task.status === 'completed').length;
  return {
    schemaVersion: '2.0.0-legacy',
    generatedAt: data.generatedAt || new Date().toISOString(),
    sourceUpdatedAt: data.sourceUpdatedAt || null,
    runs: [{
      id: String(data.runId || ''),
      title: String(data.workflowId || data.runId || 'publicBlackboard'),
      theme: '公開ステータスを表示しています。',
      status: String(data.status || ''),
      createdAt: null,
      updatedAt: data.sourceUpdatedAt || null,
      currentTaskId: String(data.currentTask || ''),
      currentTaskLabel: String(data.currentTask || ''),
      currentAgentId: String(data.currentAgent || ''),
      currentAgentName: String(data.currentAgent || ''),
      nextActionToken: '',
      iteration: data.iteration || { current: 0, max: 0 },
      progress: {
        completed,
        total: tasks.length,
        percentage: tasks.length ? Math.round(completed / tasks.length * 100) : 0
      },
      completion: { done: data.status === 'completed' },
      statusValidation: { valid: true, errors: [] },
      agents,
      tasks,
      edges,
      history: []
    }]
  };
}

function currentRun() {
  return app.data?.runs?.find(run => run.id === app.selectedRunId) || app.data?.runs?.[0] || null;
}

function layoutKey(runId) {
  return `pbb-public-dashboard-layout:${runId}`;
}

function defaultPositions(agents) {
  const positions = new Map();
  agents.forEach((agent, index) => {
    positions.set(agent.agentId, { x: 42 + index * 286, y: Y_PATTERN[index % Y_PATTERN.length] });
  });
  return positions;
}

function loadPositions(run) {
  const defaults = defaultPositions(run.agents || []);
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey(run.id)) || '{}');
    for (const agent of run.agents || []) {
      const position = saved[agent.agentId];
      if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
        defaults.set(agent.agentId, { x: position.x, y: position.y });
      }
    }
  } catch {
    localStorage.removeItem(layoutKey(run.id));
  }
  return defaults;
}

function savePositions(run) {
  const serialized = {};
  for (const [agentId, position] of app.positions) serialized[agentId] = position;
  localStorage.setItem(layoutKey(run.id), JSON.stringify(serialized));
}

function calculateStageSize(run) {
  const positions = [...app.positions.values()];
  const maxX = Math.max(...positions.map(position => position.x), 0);
  const maxY = Math.max(...positions.map(position => position.y), 0);
  app.stageWidth = Math.max(1050, maxX + NODE_WIDTH + 80, (run.agents?.length || 0) * 286 + 100);
  app.stageHeight = Math.max(570, maxY + NODE_MIN_HEIGHT + 150);
  elements.graphStage.style.width = `${app.stageWidth}px`;
  elements.graphStage.style.height = `${app.stageHeight}px`;
  elements.edgeLayer.setAttribute('viewBox', `0 0 ${app.stageWidth} ${app.stageHeight}`);
}

function renderRunPicker() {
  elements.runSelect.replaceChildren();
  for (const run of app.data?.runs || []) {
    const option = document.createElement('option');
    option.value = run.id;
    option.textContent = `${run.status === 'completed' ? '✓ ' : '● '}${run.title} — ${run.id}`;
    elements.runSelect.append(option);
  }
  elements.runSelect.value = app.selectedRunId;
}

function renderSummary(run) {
  elements.workflowTitle.textContent = run.title || run.id;
  elements.workflowTheme.textContent = run.theme || '説明なし';
  const invalidStatus = run.statusValidation?.valid === false;
  elements.workflowStatus.textContent = invalidStatus ? '異常停止対象' : statusLabel(run.status);
  elements.workflowStatus.className = `status-pill ${invalidStatus ? 'status-error' : statusClass(run.status)}`;

  if (invalidStatus) {
    const details = (run.statusValidation.errors || []).map(error =>
      `・${error.path}: ${error.value}（許可: ${(error.allowed || []).join(' / ')}）`
    );
    elements.statusAlert.hidden = false;
    elements.statusAlert.textContent = ['未定義ステータスを検出しました。', ...details].join('\n');
  } else {
    elements.statusAlert.hidden = true;
    elements.statusAlert.textContent = '';
  }

  elements.generatedAt.textContent = formatDate(app.data.generatedAt);
  elements.currentTask.textContent = run.currentTaskLabel || (run.completion?.done ? '完了' : '待機中');
  elements.currentAgent.textContent = run.currentAgentName || run.currentAgentId || '担当なし';
  elements.progressValue.textContent = `${run.progress?.completed || 0} / ${run.progress?.total || 0} (${run.progress?.percentage || 0}%)`;
  elements.progressBar.style.width = `${Math.max(0, Math.min(100, Number(run.progress?.percentage || 0)))}%`;
  elements.iterationValue.textContent = run.iteration?.max
    ? `${run.iteration.current} / ${run.iteration.max}`
    : String(run.iteration?.current || 0);
  elements.nextAction.textContent = run.nextActionToken || '次のactionなし';
  elements.updatedAt.textContent = formatDate(run.updatedAt || app.data.sourceUpdatedAt);
  elements.runId.textContent = run.id;
  elements.statusLink.href = STATUS_URL;
}

function nodeStatusText(agent) {
  if (agent.status === 'active') return '稼働中';
  if (agent.status === 'completed') return '完了';
  if (agent.status === 'error') return 'エラー';
  return '待機中';
}

function makeAgentNode(run, agent) {
  const node = createElement('article', 'agent-node');
  node.dataset.agentId = agent.agentId;
  node.dataset.status = agent.status;
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', `${agent.name}の詳細を表示`);
  if (app.selectedAgentId === agent.agentId) node.classList.add('selected');

  const header = createElement('header', 'agent-header');
  const title = document.createElement('div');
  title.append(createElement('strong', '', agent.name), createElement('small', '', agent.agentId));
  header.append(title, createElement('span', 'agent-state', nodeStatusText(agent)));

  const body = createElement('div', 'agent-body');
  body.append(createElement('p', 'agent-task', agent.activityTaskLabel || '担当taskなし'));
  body.append(createElement('p', 'agent-description', agent.role || '現在の作業説明はありません。'));
  const progress = createElement('div', 'agent-progress');
  progress.append(
    createElement('span', '', `${agent.completedCount || 0}/${agent.taskCount || 0} task`),
    createElement('span', '', agent.completedAt ? formatDate(agent.completedAt, false) : '')
  );
  body.append(progress);
  node.append(header, body);

  const position = app.positions.get(agent.agentId) || { x: 0, y: 0 };
  node.style.transform = `translate(${position.x}px, ${position.y}px)`;
  node.addEventListener('click', () => selectAgent(run, agent.agentId));
  node.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectAgent(run, agent.agentId);
    }
  });
  enableDragging(run, node, agent.agentId);
  return node;
}

function enableDragging(run, node, agentId) {
  node.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const startPosition = app.positions.get(agentId) || { x: 0, y: 0 };
    const startX = event.clientX;
    const startY = event.clientY;
    node.setPointerCapture(event.pointerId);

    const onMove = moveEvent => {
      const nextX = Math.max(10, Math.min(app.stageWidth - node.offsetWidth - 10, startPosition.x + moveEvent.clientX - startX));
      const nextY = Math.max(10, Math.min(app.stageHeight - node.offsetHeight - 10, startPosition.y + moveEvent.clientY - startY));
      app.positions.set(agentId, { x: nextX, y: nextY });
      node.style.transform = `translate(${nextX}px, ${nextY}px)`;
      updateEdges(run);
    };

    const onEnd = endEvent => {
      try { node.releasePointerCapture(endEvent.pointerId); } catch (_) {}
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onEnd);
      node.removeEventListener('pointercancel', onEnd);
      savePositions(run);
    };

    node.addEventListener('pointermove', onMove);
    node.addEventListener('pointerup', onEnd);
    node.addEventListener('pointercancel', onEnd);
  });
}

function pathForEdge(fromNode, toNode, fromPosition, toPosition) {
  const fromWidth = fromNode.offsetWidth || NODE_WIDTH;
  const fromHeight = fromNode.offsetHeight || NODE_MIN_HEIGHT;
  const toWidth = toNode.offsetWidth || NODE_WIDTH;
  const toHeight = toNode.offsetHeight || NODE_MIN_HEIGHT;

  if (fromNode === toNode) {
    const startX = fromPosition.x + fromWidth * 0.7;
    const endX = fromPosition.x + fromWidth * 0.3;
    const y = fromPosition.y;
    return `M ${startX} ${y} C ${startX + 80} ${y - 90}, ${endX - 80} ${y - 90}, ${endX} ${y}`;
  }

  if (toPosition.x > fromPosition.x + 40) {
    const startX = fromPosition.x + fromWidth;
    const startY = fromPosition.y + fromHeight * 0.42;
    const endX = toPosition.x;
    const endY = toPosition.y + toHeight * 0.42;
    const bend = Math.max(70, (endX - startX) * 0.42);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  }

  const startX = fromPosition.x + fromWidth * 0.5;
  const startY = fromPosition.y + fromHeight;
  const endX = toPosition.x + toWidth * 0.5;
  const endY = toPosition.y + toHeight;
  const arcY = Math.max(app.stageHeight - 40, startY + 110, endY + 110);
  return `M ${startX} ${startY} C ${startX} ${arcY}, ${endX} ${arcY}, ${endX} ${endY}`;
}

function edgeClass(run, edge) {
  const fromTask = (run.tasks || []).find(task => task.id === edge.fromTask);
  const toTask = (run.tasks || []).find(task => task.id === edge.toTask);
  if (edge.to === run.currentAgentId || toTask?.id === run.currentTaskId) return 'edge edge-active';
  if (run.status === 'completed' || (fromTask?.status === 'completed' && toTask?.status === 'completed')) return 'edge edge-completed';
  if (fromTask?.status === 'completed') return 'edge';
  return 'edge edge-muted';
}

function updateEdges(run) {
  for (const path of [...elements.edgeLayer.querySelectorAll('path.edge')]) path.remove();
  const nodeMap = new Map([...elements.nodeLayer.querySelectorAll('.agent-node')].map(node => [node.dataset.agentId, node]));
  for (const edge of run.edges || []) {
    const fromNode = nodeMap.get(edge.from);
    const toNode = nodeMap.get(edge.to);
    const fromPosition = app.positions.get(edge.from);
    const toPosition = app.positions.get(edge.to);
    if (!fromNode || !toNode || !fromPosition || !toPosition) continue;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathForEdge(fromNode, toNode, fromPosition, toPosition));
    path.setAttribute('class', edgeClass(run, edge));
    elements.edgeLayer.append(path);
  }
}

function renderGraph(run) {
  elements.nodeLayer.replaceChildren();
  app.positions = loadPositions(run);
  calculateStageSize(run);
  for (const agent of run.agents || []) elements.nodeLayer.append(makeAgentNode(run, agent));
  requestAnimationFrame(() => updateEdges(run));
}

function selectAgent(run, agentId) {
  app.selectedAgentId = agentId;
  const agent = (run.agents || []).find(item => item.agentId === agentId);
  for (const node of elements.nodeLayer.querySelectorAll('.agent-node')) {
    node.classList.toggle('selected', node.dataset.agentId === agentId);
  }
  if (!agent) return;
  elements.selectedAgentTitle.textContent = agent.name;
  const list = document.createElement('dl');
  const values = [
    ['agentId', agent.agentId],
    ['状態', nodeStatusText(agent)],
    ['役割', agent.role || 'なし'],
    ['現在表示しているtask', agent.activityTaskLabel || 'なし'],
    ['task状態', statusLabel(agent.activityStatus)],
    ['担当task進捗', `${agent.completedCount || 0} / ${agent.taskCount || 0}`],
    ['最終完了', agent.completedAt ? formatDate(agent.completedAt) : 'なし']
  ];
  for (const [label, value] of values) {
    list.append(createElement('dt', '', label), createElement('dd', '', value));
  }
  elements.selectedAgentDetail.replaceChildren(list);
}

function renderHistory(run) {
  elements.historyList.replaceChildren();
  if (!(run.history || []).length) {
    elements.historyList.append(createElement('li', '', '履歴はまだありません。'));
    return;
  }
  for (const entry of run.history) {
    const item = document.createElement('li');
    const title = createElement('strong', '', `${entry.agentId || 'agent不明'} — ${entry.taskLabel || entry.taskId}`);
    const detail = createElement('p', '', [
      statusLabel(entry.status),
      entry.verdict ? `判定: ${entry.verdict}` : '',
      entry.completedAt ? formatDate(entry.completedAt) : '',
      entry.nextTask ? `次: ${entry.nextTask}` : 'workflow終端'
    ].filter(Boolean).join(' / '));
    item.append(title, detail);
    elements.historyList.append(item);
  }
}

function dispatchProgress(task) {
  const planned = Math.max(0, Number(task.attempt || 0));
  const status = String(task.status || '');
  const sent = ['completed', 'failed', 'in_progress'].includes(status) ? planned : Math.max(0, planned - 1);
  return { planned, sent, remaining: Math.max(0, planned - sent) };
}

function makeDispatchCountCell(value, detail, tone = '') {
  const cell = createElement('td', `dispatch-count ${tone}`.trim());
  cell.append(createElement('strong', '', String(value)));
  if (detail) cell.append(createElement('small', '', detail));
  return cell;
}

function renderTasks(run) {
  elements.taskTableBody.replaceChildren();
  for (const task of run.tasks || []) {
    const row = document.createElement('tr');
    const statusCell = document.createElement('td');
    statusCell.append(createElement('span', `task-status ${statusClass(task.status)}`, statusLabel(task.status)));

    const taskCell = document.createElement('td');
    taskCell.append(createElement('strong', '', task.label || task.id), createElement('small', '', task.id));

    const agentCell = document.createElement('td');
    agentCell.append(createElement('strong', '', task.agentName || task.agentId), createElement('small', '', task.agentId));

    const dispatch = dispatchProgress(task);
    const waitingToSend = task.status === 'ready' && dispatch.remaining > 0;
    const plannedCell = makeDispatchCountCell(
      dispatch.planned,
      task.status === 'completed' ? '実行済み' : waitingToSend ? '今回の送信予定' : '後続予定',
      waitingToSend ? 'dispatch-planned' : ''
    );
    const sentCell = makeDispatchCountCell(
      dispatch.sent,
      waitingToSend ? `${dispatch.remaining}件送信待ち` : 'GitHub stateから推定',
      waitingToSend ? 'dispatch-waiting' : 'dispatch-sent'
    );
    const dateCell = createElement('td', '', task.completedAt ? formatDate(task.completedAt, false) : '—');
    const outputCell = createElement('td', '', '非公開');
    row.append(statusCell, taskCell, agentCell, plannedCell, sentCell, dateCell, outputCell);
    elements.taskTableBody.append(row);
  }
}

function render() {
  const runs = app.data?.runs || [];
  if (!runs.length) {
    elements.dashboard.hidden = true;
    elements.emptyState.hidden = false;
    return;
  }
  elements.emptyState.hidden = true;
  elements.dashboard.hidden = false;
  const run = currentRun();
  if (!run) return;
  app.selectedAgentId = run.currentAgentId || app.selectedAgentId || run.agents?.[0]?.agentId || '';
  renderRunPicker();
  renderSummary(run);
  renderGraph(run);
  renderHistory(run);
  renderTasks(run);
  if (app.selectedAgentId) selectAgent(run, app.selectedAgentId);
}

function showLoadError(message) {
  elements.emptyState.hidden = false;
  elements.dashboard.hidden = true;
  elements.emptyState.querySelector('h2').textContent = 'ダッシュボードを読み込めませんでした';
  elements.emptyState.querySelector('p').textContent = String(message || '公開ステータスを取得できませんでした');
}

async function loadData({ preserveSelection = true } = {}) {
  if (app.loading) return;
  app.loading = true;
  const previousRunId = preserveSelection ? app.selectedRunId : '';
  elements.reloadButton.disabled = true;
  elements.reloadButton.textContent = '読込中…';
  try {
    const response = await fetch(`${STATUS_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    app.data = normalizeLegacyPayload(await response.json());
    const runs = app.data.runs || [];
    const preferred = runs.find(run => run.id === previousRunId)
      || runs.find(run => run.status !== 'completed')
      || runs[0];
    app.selectedRunId = preferred?.id || '';
    render();
  } catch (error) {
    showLoadError(`公開status.jsonの取得に失敗しました: ${String(error?.message || error)}`);
  } finally {
    app.loading = false;
    elements.reloadButton.disabled = false;
    elements.reloadButton.textContent = '再読込';
  }
}

elements.runSelect.addEventListener('change', () => {
  app.selectedRunId = elements.runSelect.value;
  app.selectedAgentId = '';
  render();
});

elements.reloadButton.addEventListener('click', () => loadData());

elements.resetLayoutButton.addEventListener('click', () => {
  const run = currentRun();
  if (!run) return;
  localStorage.removeItem(layoutKey(run.id));
  renderGraph(run);
  if (app.selectedAgentId) selectAgent(run, app.selectedAgentId);
});

window.addEventListener('resize', () => {
  const run = currentRun();
  if (run) requestAnimationFrame(() => updateEdges(run));
});

loadData({ preserveSelection: false });
setInterval(() => loadData(), REFRESH_INTERVAL_MS);
