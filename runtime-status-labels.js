'use strict';

function nodeStatusText(agent) {
  const status = String(agent?.status || '').toLowerCase();
  if (status === 'active') return '生成中';
  if (status === 'ready') return '実行待ち';
  if (status === 'completed') return '完了';
  if (status === 'error') return 'エラー';
  return '待機中';
}

window.addEventListener('load', () => {
  if (typeof render === 'function') render();
}, { once: true });
