'use strict';

(() => {
  const text = value => String(value || '').trim();

  function timestamp(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function completedDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours}時間${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
    if (minutes) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
    return `${seconds}秒`;
  }

  function runningDuration(totalSeconds) {
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 1) return '1分未満';
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours ? `${hours}時間${String(minutes).padStart(2, '0')}分` : `${minutes}分`;
  }

  function duration(startedAt, completedAt) {
    const start = timestamp(startedAt);
    if (!start) return { label: '未開始', title: '', running: false };
    const end = timestamp(completedAt) || Date.now();
    const total = Math.max(0, Math.floor((end - start) / 1000));
    return {
      label: completedAt ? `所要 ${completedDuration(total)}` : `経過 ${runningDuration(total)}`,
      title: `開始: ${new Date(start).toLocaleString('ja-JP')}${completedAt ? ` / 完了: ${new Date(end).toLocaleString('ja-JP')}` : ''}`,
      running: !completedAt
    };
  }

  function update() {
    for (const node of document.querySelectorAll('.agent-node[data-started-at]')) {
      const target = node.querySelector('.agent-timing');
      if (!target) continue;
      const view = duration(text(node.dataset.startedAt), text(node.dataset.completedAt));
      if (target.textContent !== view.label) target.textContent = view.label;
      if (target.title !== view.title) target.title = view.title;
      const running = view.running ? 'true' : 'false';
      if (target.dataset.running !== running) target.dataset.running = running;
    }
  }

  window.addEventListener('load', update, { once: true });
  document.querySelector('#nodeLayer')?.addEventListener('click', () => setTimeout(update, 0));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
  setInterval(update, 60_000);
})();
