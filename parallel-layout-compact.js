'use strict';

(() => {
  if (typeof renderGraph !== 'function' || typeof updateEdges !== 'function' || typeof app === 'undefined' || typeof elements === 'undefined') return;

  const BASE_RENDER_GRAPH = renderGraph;
  const BASE_UPDATE_EDGES = updateEdges;
  const LAYOUT_VERSION = 'task-fork-join-v3';
  const NODE_WIDTH_PX = 250;
  const NODE_HEIGHT_PX = 176;
  const H_GAP = 70;
  const V_GAP = 34;

  const text = value => String(value || '').trim();
  const taskNodeId = taskId => `task:${text(taskId)}`;
  const workerNodeId = (groupId, worker) => `worker:${text(groupId)}:${text(worker?.workerId || worker?.agentId)}`;
  const joinNodeId = groupId => `join:${text(groupId)}`;

  function selectedGroup(run) {
    const groups = Array.isArray(run?.parallelGroups) ? run.parallelGroups : [];
    return groups.find(group => text(group?.parentTaskId) === text(run?.currentTaskId))
      || groups.find(group => !['completed', 'failed'].includes(text(group?.status).toLowerCase()))
      || groups[0]
      || null;
  }

  function storageKey(runId) {
    const scope = document.querySelector('#statusLink') ? 'public' : 'private';
    return `pbb-${scope}-dashboard-layout:${LAYOUT_VERSION}:${runId}`;
  }

  layoutKey = storageKey;

  function readSaved(run, requiredIds) {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(run.id)) || '{}');
      const complete = requiredIds.every(id => Number.isFinite(saved?.[id]?.x) && Number.isFinite(saved?.[id]?.y));
      return complete ? saved : null;
    } catch {
      localStorage.removeItem(storageKey(run.id));
      return null;
    }
  }

  function persist(run) {
    try {
      localStorage.setItem(storageKey(run.id), JSON.stringify(Object.fromEntries(app.positions)));
    } catch (_) {}
  }

  function compactPositions(run, group) {
    const tasks = Array.isArray(run?.tasks) ? run.tasks : [];
    const parentTaskId = text(group?.parentTaskId || 'program_build');
    const parentIndex = Math.max(0, tasks.findIndex(task => text(task?.id) === parentTaskId));
    const before = tasks.slice(0, parentIndex);
    const after = tasks.slice(parentIndex + 1);
    const workers = Array.isArray(group?.workers) ? group.workers : [];
    const positions = new Map();

    const topY = 54;
    const parentY = 250;
    const sequenceStep = NODE_WIDTH_PX + 46;
    before.forEach((task, index) => positions.set(taskNodeId(task?.id), { x: 36 + index * sequenceStep, y: topY }));

    const parentX = 36 + before.length * sequenceStep;
    const parentId = taskNodeId(parentTaskId);
    positions.set(parentId, { x: parentX, y: parentY });

    const workerX = parentX + NODE_WIDTH_PX + H_GAP;
    const workerStackHeight = workers.length * NODE_HEIGHT_PX + Math.max(0, workers.length - 1) * V_GAP;
    const parentCenterY = parentY + NODE_HEIGHT_PX / 2;
    const workerStartY = Math.max(40, Math.round(parentCenterY - workerStackHeight / 2));
    workers.forEach((worker, index) => positions.set(workerNodeId(group?.groupId, worker), {
      x: workerX,
      y: workerStartY + index * (NODE_HEIGHT_PX + V_GAP)
    }));

    const joinX = workerX + NODE_WIDTH_PX + H_GAP;
    const joinY = Math.max(40, Math.round(parentCenterY - NODE_HEIGHT_PX / 2));
    positions.set(joinNodeId(group?.groupId), { x: joinX, y: joinY });

    const nextX = joinX + NODE_WIDTH_PX + H_GAP;
    after.forEach((task, index) => positions.set(taskNodeId(task?.id), {
      x: nextX + index * sequenceStep,
      y: index === 0 ? joinY : topY
    }));

    return positions;
  }

  function requiredIds(run, group) {
    const ids = (Array.isArray(run?.tasks) ? run.tasks : []).map(task => taskNodeId(task?.id));
    for (const worker of Array.isArray(group?.workers) ? group.workers : []) ids.push(workerNodeId(group?.groupId, worker));
    ids.push(joinNodeId(group?.groupId));
    return ids;
  }

  function boundsFor(ids) {
    const points = ids.map(id => app.positions.get(id)).filter(Boolean);
    if (!points.length) return null;
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x + NODE_WIDTH_PX));
    const maxY = Math.max(...points.map(point => point.y + NODE_HEIGHT_PX));
    return { minX, minY, maxX, maxY };
  }

  function renderClusterFrame(group) {
    elements.nodeLayer.querySelectorAll('.parallel-cluster-frame').forEach(node => node.remove());
    if (!group) return;
    const ids = [taskNodeId(group?.parentTaskId), joinNodeId(group?.groupId)];
    for (const worker of Array.isArray(group?.workers) ? group.workers : []) ids.push(workerNodeId(group?.groupId, worker));
    const bounds = boundsFor(ids);
    if (!bounds) return;

    const frame = document.createElement('div');
    frame.className = 'parallel-cluster-frame';
    frame.style.left = `${bounds.minX - 24}px`;
    frame.style.top = `${bounds.minY - 36}px`;
    frame.style.width = `${bounds.maxX - bounds.minX + 48}px`;
    frame.style.height = `${bounds.maxY - bounds.minY + 60}px`;
    const label = document.createElement('span');
    label.textContent = 'PROGRAM BUILD — PARALLEL FORK / JOIN';
    frame.append(label);
    elements.nodeLayer.prepend(frame);
  }

  function resizeStageToPositions() {
    const values = [...app.positions.values()];
    const maxX = Math.max(...values.map(position => position.x), 0);
    const maxY = Math.max(...values.map(position => position.y), 0);
    app.stageWidth = Math.max(1180, maxX + NODE_WIDTH_PX + 100);
    app.stageHeight = Math.max(720, maxY + NODE_HEIGHT_PX + 90);
    elements.graphStage.style.width = `${app.stageWidth}px`;
    elements.graphStage.style.height = `${app.stageHeight}px`;
    elements.edgeLayer.setAttribute('viewBox', `0 0 ${app.stageWidth} ${app.stageHeight}`);
  }

  function applyCompactLayout(run) {
    const group = selectedGroup(run);
    if (!group || !(Array.isArray(group?.workers) && group.workers.length)) return;
    const ids = requiredIds(run, group);
    const saved = readSaved(run, ids);
    if (saved) {
      for (const [id, position] of Object.entries(saved)) app.positions.set(id, { x: position.x, y: position.y });
    } else {
      app.positions = compactPositions(run, group);
      persist(run);
    }

    for (const node of elements.nodeLayer.querySelectorAll('.agent-node')) {
      const position = app.positions.get(node.dataset.agentId);
      if (position) node.style.transform = `translate(${position.x}px, ${position.y}px)`;
    }
    renderClusterFrame(group);
    resizeStageToPositions();
  }

  function horizontalPath(fromNode, toNode, fromPosition, toPosition) {
    const fromWidth = fromNode.offsetWidth || NODE_WIDTH_PX;
    const fromHeight = fromNode.offsetHeight || NODE_HEIGHT_PX;
    const toHeight = toNode.offsetHeight || NODE_HEIGHT_PX;
    const startX = fromPosition.x + fromWidth;
    const startY = fromPosition.y + fromHeight / 2;
    const endX = toPosition.x;
    const endY = toPosition.y + toHeight / 2;
    const bend = Math.max(55, (endX - startX) * 0.46);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  }

  updateEdges = function updateCompactForkJoinEdges(run) {
    BASE_UPDATE_EDGES(run);
    const domNodes = new Map([...elements.nodeLayer.querySelectorAll('.agent-node')].map(node => [node.dataset.agentId, node]));
    for (const path of elements.edgeLayer.querySelectorAll('path.edge-parallel-fork, path.edge-parallel-join, path.edge-parallel-next')) {
      const fromId = text(path.dataset.from);
      const toId = text(path.dataset.to);
      const fromNode = domNodes.get(fromId);
      const toNode = domNodes.get(toId);
      const fromPosition = app.positions.get(fromId);
      const toPosition = app.positions.get(toId);
      if (!fromNode || !toNode || !fromPosition || !toPosition) continue;
      path.setAttribute('d', horizontalPath(fromNode, toNode, fromPosition, toPosition));
    }
  };

  renderGraph = function renderCompactTaskGraph(run) {
    BASE_RENDER_GRAPH(run);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      applyCompactLayout(run);
      updateEdges(run);
    }));
  };

  const help = document.querySelector('.graph-help');
  if (help) help.textContent = 'task単位のグラフです。program buildから縦に並んだworker taskへforkし、右側の統合taskへjoinして次taskへ進みます。';
})();
