'use strict';

(() => {
  function text(value) {
    return String(value || '').trim();
  }

  function timestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function duration(startedAt, completedAt) {
    const start = timestamp(startedAt);
    if (!start) return { label: '', title: '', running: false };
    const end = timestamp(completedAt) || Date.now();
    const total = Math.max(0, Math.floor((end - start) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const value = hours
      ? `${hours}時間${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`
      : minutes
        ? `${minutes}分${String(seconds).padStart(2, '0')}秒`
        : `${seconds}秒`;
    return {
      label: `${completedAt ? '所要' : '経過'} ${value}`,
      title: `開始: ${new Date(start).toLocaleString('ja-JP')}${completedAt ? ` / 完了: ${new Date(end).toLocaleString('ja-JP')}` : ''}`,
      running: !completedAt
    };
  }

  function selectedGroup(run) {
    const groups = Array.isArray(run?.parallelGroups) ? run.parallelGroups : [];
    return groups.find(group => text(group?.parentTaskId) === text(run?.currentTaskId))
      || groups.find(group => !['completed', 'failed'].includes(text(group?.status).toLowerCase()))
      || groups[0]
      || null;
  }

  function update() {
    if (typeof currentRun !== 'function') return;
    const run = currentRun();
    const group = selectedGroup(run);
    if (!group) return;

    for (const worker of group?.workers || []) {
      const node = document.querySelector(`.agent-node[data-agent-id="${CSS.escape(text(worker?.agentId))}"]`);
      const progress = node?.querySelector('.agent-progress');
      if (!progress) continue;
      const spans = progress.querySelectorAll('span');
      const target = spans[1] || progress.appendChild(document.createElement('span'));
      const view = duration(worker?.startedAt, worker?.completedAt);
      target.className = 'agent-timing';
      target.textContent = view.label;
      target.title = view.title;
      target.dataset.running = view.running ? 'true' : 'false';
    }

    const joinId = `parallel_join_${text(group?.groupId)}`;
    const join = document.querySelector(`.agent-node[data-agent-id="${CSS.escape(joinId)}"]`);
    const joinProgress = join?.querySelector('.agent-progress');
    if (joinProgress) {
      const spans = joinProgress.querySelectorAll('span');
      const target = spans[1] || joinProgress.appendChild(document.createElement('span'));
      const view = duration(group?.startedAt, group?.completedAt);
      target.className = 'agent-timing';
      target.textContent = view.label;
      target.title = view.title;
      target.dataset.running = view.running ? 'true' : 'false';
    }

    const selected = document.querySelector('.agent-node.selected.parallel-worker-node, .agent-node.selected.parallel-join-node');
    if (selected) {
      for (const term of document.querySelectorAll('#selectedAgentDetail dt[data-task-timing]')) {
        const detail = term.nextElementSibling;
        term.remove();
        detail?.remove();
      }
    }
  }

  window.addEventListener('load', update, { once: true });
  document.querySelector('#nodeLayer')?.addEventListener('click', () => setTimeout(update, 0));
  setInterval(update, 1000);
})();
