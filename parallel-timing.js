'use strict';

(() => {
  const text = value => String(value || '').trim();

  function timestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function duration(startedAt, completedAt) {
    const start = timestamp(startedAt);
    if (!start) return { label: '未開始', title: '', running: false };
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

  function update() {
    for (const node of document.querySelectorAll('.agent-node[data-started-at]')) {
      const target = node.querySelector('.agent-timing');
      if (!target) continue;
      const view = duration(text(node.dataset.startedAt), text(node.dataset.completedAt));
      target.textContent = view.label;
      target.title = view.title;
      target.dataset.running = view.running ? 'true' : 'false';
    }
  }

  window.addEventListener('load', update, { once: true });
  document.querySelector('#nodeLayer')?.addEventListener('click', () => setTimeout(update, 0));
  setInterval(update, 1000);
})();
