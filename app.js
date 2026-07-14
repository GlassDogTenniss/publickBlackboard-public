'use strict';

const $ = selector => document.querySelector(selector);
const REFRESH_INTERVAL_MS = 30_000;
const STATUS_URL = 'https://raw.githubusercontent.com/GlassDogTenniss/publickBlackboard-public/main/data/status.json';
let loading = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[character]));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function relativeAge(value) {
  if (!value) return '更新時刻なし';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  return `${hours}時間前`;
}

function statusLabel(value) {
  const labels = {
    in_progress: '進行中', completed: '完了', stopped: '停止', error: 'エラー',
    blocked: '待機前', waiting: '待機中', ready: '実行待ち', active: '稼働中', failed: '失敗'
  };
  return labels[value] || value || '不明';
}

function render(data) {
  const iteration = data.iteration || {};
  const sourceTime = data.sourceUpdatedAt || data.generatedAt || '';
  $('#workflowStatus').textContent = statusLabel(data.status);
  $('#workflowStatus').className = `status-pill status-${data.status || 'unknown'}`;
  $('#currentTask').textContent = data.currentTask || '—';
  $('#currentAgent').textContent = data.currentAgent || '—';
  $('#iteration').textContent = iteration.current != null
    ? `${iteration.current}${iteration.max != null ? ` / ${iteration.max}` : ''}`
    : '—';
  $('#updatedAt').textContent = formatDate(sourceTime);
  $('#updatedAt').dataset.value = sourceTime;
  $('#freshness').textContent = relativeAge(sourceTime);
  $('#runId').textContent = data.runId || '';

  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  $('#taskTableBody').innerHTML = tasks.map(task => `
    <tr>
      <td><strong>${escapeHtml(task.taskId)}</strong></td>
      <td>${escapeHtml(task.agentId || '—')}</td>
      <td><span class="status-pill status-${escapeHtml(task.status || 'unknown')}">${escapeHtml(statusLabel(task.status))}</span></td>
      <td>${escapeHtml(task.attempt ?? '—')}</td>
      <td>${escapeHtml(formatDate(task.updatedAt))}</td>
    </tr>
  `).join('') || '<tr><td colspan="5">task情報がありません</td></tr>';

  $('#errorPanel').hidden = true;
}

function showError(error) {
  const panel = $('#errorPanel');
  panel.hidden = false;
  panel.textContent = `状態を取得できませんでした: ${String(error?.message || error)}`;
}

async function loadStatus() {
  if (loading) return;
  loading = true;
  const button = $('#reloadButton');
  button.disabled = true;
  button.textContent = '読込中…';
  try {
    const response = await fetch(`${STATUS_URL}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    showError(error);
  } finally {
    loading = false;
    button.disabled = false;
    button.textContent = '再読込';
  }
}

$('#reloadButton').addEventListener('click', loadStatus);
loadStatus();
setInterval(loadStatus, REFRESH_INTERVAL_MS);
setInterval(() => {
  const value = $('#updatedAt').dataset.value;
  if (value) $('#freshness').textContent = relativeAge(value);
}, 1000);
