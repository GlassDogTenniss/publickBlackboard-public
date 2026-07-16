'use strict';

function nodeStatusText(agent) {
  const status = String(agent?.status || '').toLowerCase();
  if (status === 'active') return '生成中';
  if (status === 'ready') return '実行待ち';
  if (status === 'completed') return '完了';
  if (status === 'error') return 'エラー';
  return '待機中';
}

(() => {
  let snapshot = null;

  function asTime(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isFinite(timestamp) ? timestamp : 0;
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

  function formatDateTime(value) {
    const timestamp = asTime(value);
    return timestamp ? new Date(timestamp).toLocaleString('ja-JP') : 'なし';
  }

  function capture(data) {
    if (data && Array.isArray(data.runs)) snapshot = data;
  }

  function selectedRun() {
    const runs = snapshot?.runs || [];
    const selectedId = String(document.querySelector('#runSelect')?.value || '');
    return runs.find(run => String(run?.id || '') === selectedId) || runs[0] || null;
  }

  function taskForAgent(run, agentId) {
    const agent = (run?.agents || []).find(item => String(item?.agentId || '') === String(agentId || ''));
    const taskId = String(agent?.activityTaskId || '');
    return (run?.tasks || []).find(task => String(task?.id || '') === taskId) || null;
  }

  function timingView(task) {
    const timing = task?.timing && typeof task.timing === 'object' ? task.timing : null;
    const startedAt = asTime(timing?.startedAt);
    if (!startedAt) {
      return {
        text: String(task?.status || '') === 'completed' ? '計測前' : '',
        title: '',
        active: false
      };
    }
    const finishedAt = asTime(timing?.finishedAt);
    const endAt = finishedAt || Date.now();
    const active = !finishedAt;
    return {
      text: `${active ? '経過' : '所要'} ${formatDuration(endAt - startedAt)}`,
      title: `開始: ${formatDateTime(timing.startedAt)}${finishedAt ? ` / 完了: ${formatDateTime(timing.finishedAt)}` : ''}`,
      active
    };
  }

  function updateAgentCards(run) {
    for (const node of document.querySelectorAll('.agent-node[data-agent-id]')) {
      const task = taskForAgent(run, node.dataset.agentId);
      const view = timingView(task);
      const progress = node.querySelector('.agent-progress');
      if (!progress) continue;
      const spans = progress.querySelectorAll('span');
      const target = spans[1] || progress.appendChild(document.createElement('span'));
      target.classList.add('agent-timing');
      target.textContent = view.text;
      target.title = view.title;
      target.dataset.running = view.active ? 'true' : 'false';
    }
  }

  function updateTaskTable(run) {
    const header = document.querySelector('#taskTableBody')?.closest('table')?.querySelector('thead th:nth-child(6)');
    if (header) header.textContent = '作業時間';
    for (const row of document.querySelectorAll('#taskTableBody tr')) {
      const taskId = String(row.cells?.[1]?.querySelector('small')?.textContent || '').trim();
      const task = (run?.tasks || []).find(item => String(item?.id || '') === taskId);
      if (!task || !row.cells?.[5]) continue;
      const view = timingView(task);
      row.cells[5].textContent = view.text || '—';
      row.cells[5].title = view.title;
    }
  }

  function updateSelectedDetail(run) {
    const selected = document.querySelector('.agent-node.selected[data-agent-id]');
    const list = document.querySelector('#selectedAgentDetail dl');
    if (!selected || !list) return;
    const task = taskForAgent(run, selected.dataset.agentId);
    const view = timingView(task);
    let term = list.querySelector('dt[data-task-timing]');
    let detail = list.querySelector('dd[data-task-timing]');
    if (!term || !detail) {
      term = document.createElement('dt');
      detail = document.createElement('dd');
      term.dataset.taskTiming = 'true';
      detail.dataset.taskTiming = 'true';
      term.textContent = '作業時間';
      list.append(term, detail);
    }
    detail.textContent = view.text || '未開始';
    detail.title = view.title;
  }

  function updateTimingDisplay() {
    const run = selectedRun();
    if (!run) return;
    updateAgentCards(run);
    updateTaskTable(run);
    updateSelectedDetail(run);
  }

  async function fetchPublicSnapshot() {
    if (!document.querySelector('#statusLink')) return;
    try {
      const response = await fetch(`./data/status.json?ts=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) return;
      capture(await response.json());
      updateTimingDisplay();
    } catch (_) {}
  }

  window.addEventListener('message', event => {
    if (event.source !== window) return;
    if (event.data?.source !== 'publicBlackboard-extension') return;
    if (event.data?.type !== 'PBB_EXTENSION_DASHBOARD_DATA') return;
    capture(event.data?.payload?.snapshot);
    setTimeout(updateTimingDisplay, 0);
  });

  window.addEventListener('load', () => {
    if (typeof render === 'function') render();
    fetchPublicSnapshot();
    updateTimingDisplay();
  }, { once: true });

  document.querySelector('#runSelect')?.addEventListener('change', () => setTimeout(updateTimingDisplay, 0));
  document.querySelector('#nodeLayer')?.addEventListener('click', () => setTimeout(updateTimingDisplay, 0));
  setInterval(updateTimingDisplay, 1000);
  setInterval(fetchPublicSnapshot, 30000);
})();
