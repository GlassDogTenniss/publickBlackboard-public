'use strict';

(() => {
  if (typeof app === 'undefined' || typeof elements === 'undefined' || typeof enableDragging !== 'function') return;

  const ORIGINAL_RENDER_SUMMARY = renderSummary;
  const FAILURE = new Set(['failed', 'timeout', 'error', 'target_missing', 'prepare_failed', 'draft_present', 'draft_mismatch', 'submission_unknown']);
  const LAYOUT_VERSION = 'task-fork-join-v2';
  let lastModel = null;

  const text = value => String(value || '').trim();
  const taskNodeId = taskId => `task:${text(taskId)}`;
  const workerNodeId = (groupId, worker) => `worker:${text(groupId)}:${text(worker?.workerId || worker?.agentId)}`;
  const joinNodeId = groupId => `join:${text(groupId)}`;

  function time(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function durationText(startedAt, completedAt) {
    const start = time(startedAt);
    if (!start) return '未開始';
    const end = time(completedAt) || Date.now();
    const total = Math.max(0, Math.floor((end - start) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const value = hours
      ? `${hours}時間${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`
      : minutes
        ? `${minutes}分${String(seconds).padStart(2, '0')}秒`
        : `${seconds}秒`;
    return `${completedAt ? '所要' : '経過'} ${value}`;
  }

  function visibleStatus(value, formal = '') {
    const status = text(value).toLowerCase();
    const formalStatus = text(formal).toLowerCase();
    if (status === 'active' || status === 'in_progress' || status === 'running') return 'active';
    if (FAILURE.has(status) || FAILURE.has(formalStatus)) return 'error';
    if (status === 'completed' || formalStatus === 'completed') return 'completed';
    if (['ready', 'prepared', 'submit_requested', 'submitted_confirmed', 'submitted', 'dispatched', 'response_started'].includes(status)
        || ['ready', 'dispatched'].includes(formalStatus)) return 'ready';
    return 'waiting';
  }

  function stateText(status) {
    if (status === 'active') return '生成中';
    if (status === 'completed') return '完了';
    if (status === 'error') return 'エラー';
    if (status === 'ready') return '実行待ち';
    return '待機中';
  }

  function selectedParallelGroup(run) {
    const groups = Array.isArray(run?.parallelGroups) ? run.parallelGroups : [];
    if (!groups.length) return null;
    return groups.find(group => text(group?.parentTaskId) === text(run?.currentTaskId))
      || groups.find(group => !['completed', 'failed'].includes(text(group?.status).toLowerCase()))
      || groups[0];
  }

  function integrationStatus(group) {
    const integration = text(group?.integration?.status).toLowerCase();
    const groupStatus = text(group?.status).toLowerCase();
    if (['active', 'integrating', 'response_started'].includes(integration) || groupStatus === 'integrating') return 'active';
    if (FAILURE.has(integration) || groupStatus === 'failed') return 'error';
    if (integration === 'completed' || text(group?.parentTaskStatus).toLowerCase() === 'completed') return 'completed';
    if (['ready', 'integration_ready', 'dispatched', 'integration_dispatched', 'submitted_confirmed'].includes(integration)) return 'ready';
    return 'waiting';
  }

  function agentMeta(run, agentId) {
    return (Array.isArray(run?.agents) ? run.agents : []).find(agent => text(agent?.agentId) === text(agentId)) || null;
  }

  function taskNode(run, task) {
    const agent = agentMeta(run, task?.agentId);
    return {
      id: taskNodeId(task?.id),
      kind: 'task',
      title: text(task?.label || task?.id || 'task'),
      subtitle: text(task?.agentId || 'agent未設定'),
      status: visibleStatus(task?.status),
      taskId: text(task?.id),
      taskStatus: text(task?.status),
      description: text(agent?.role || agent?.activityInstruction || 'workflow task'),
      startedAt: task?.timing?.startedAt || task?.startedAt || null,
      completedAt: task?.timing?.finishedAt || task?.completedAt || null,
      attempt: Number(task?.attempt || 0),
      sourceAgentId: text(task?.agentId)
    };
  }

  function workerNode(run, group, worker) {
    const agent = agentMeta(run, worker?.agentId);
    return {
      id: workerNodeId(group?.groupId, worker),
      kind: 'worker',
      title: text(agent?.name || worker?.label || worker?.workerId || 'parallel worker'),
      subtitle: text(worker?.agentId || 'agent未設定'),
      status: visibleStatus(worker?.status, worker?.formalStatus),
      taskId: text(worker?.taskId || 'worker_implementation'),
      taskStatus: text(worker?.formalStatus || worker?.status),
      description: [
        text(worker?.label || worker?.workerId),
        `並列group ${text(group?.groupId)}`,
        `runtime ${text(worker?.runtimePhase || worker?.observerState || '未観測')}`
      ].filter(Boolean).join(' / '),
      startedAt: worker?.startedAt || null,
      completedAt: worker?.completedAt || null,
      attempt: Number(worker?.attempt || 0),
      sourceAgentId: text(worker?.agentId),
      worker,
      group
    };
  }

  function integrationNode(run, group) {
    const coordinatorId = text(group?.coordinatorAgentId || run?.currentAgentId);
    const agent = agentMeta(run, coordinatorId);
    const integration = group?.integration || {};
    return {
      id: joinNodeId(group?.groupId),
      kind: 'join',
      title: 'プログラマ統合',
      subtitle: coordinatorId || 'coordinator未設定',
      status: integrationStatus(group),
      taskId: `${text(group?.parentTaskId || 'program_build')}__integration`,
      taskStatus: text(integration?.status || group?.status || 'waiting'),
      description: `全workerの成果を確認し、統合candidateを固定して次taskへ渡す / ${text(agent?.name || coordinatorId)}`,
      startedAt: integration?.dispatchedAt || null,
      completedAt: group?.completedAt || null,
      attempt: 0,
      sourceAgentId: coordinatorId,
      integration,
      group
    };
  }

  function findTaskIdForAgent(run, agentId, preferLast = false) {
    const matches = (Array.isArray(run?.tasks) ? run.tasks : []).filter(task => text(task?.agentId) === text(agentId));
    const task = preferLast ? matches.at(-1) : matches[0];
    return text(task?.id);
  }

  function buildModel(run) {
    const group = selectedParallelGroup(run);
    const nodes = (Array.isArray(run?.tasks) ? run.tasks : []).map(task => taskNode(run, task));
    const edges = [];

    for (const edge of Array.isArray(run?.edges) ? run.edges : []) {
      const fromTask = text(edge?.fromTask) || findTaskIdForAgent(run, edge?.from, text(edge?.kind) === 'loop');
      const toTask = text(edge?.toTask) || findTaskIdForAgent(run, edge?.to, false);
      if (!fromTask || !toTask) continue;
      edges.push({ from: taskNodeId(fromTask), to: taskNodeId(toTask), kind: text(edge?.kind || 'sequence'), fromTask, toTask });
    }

    if (group) {
      const parentId = taskNodeId(group?.parentTaskId);
      const outgoing = edges.filter(edge => edge.from === parentId && edge.kind !== 'loop');
      const retained = edges.filter(edge => !(edge.from === parentId && edge.kind !== 'loop'));
      edges.length = 0;
      edges.push(...retained);

      const workers = Array.isArray(group?.workers) ? group.workers : [];
      for (const worker of workers) {
        const node = workerNode(run, group, worker);
        nodes.push(node);
        edges.push({ from: parentId, to: node.id, kind: 'parallel-fork', worker });
      }

      const join = integrationNode(run, group);
      nodes.push(join);
      for (const worker of workers) edges.push({ from: workerNodeId(group?.groupId, worker), to: join.id, kind: 'parallel-join', worker });
      for (const edge of outgoing) edges.push({ from: join.id, to: edge.to, kind: 'parallel-next', fromTask: group?.parentTaskId, toTask: edge.toTask });
    }

    return { run, group, nodes, edges, nodeMap: new Map(nodes.map(node => [node.id, node])) };
  }

  layoutKey = function taskGraphLayoutKey(runId) {
    const scope = document.querySelector('#statusLink') ? 'public' : 'private';
    return `pbb-${scope}-dashboard-layout:${LAYOUT_VERSION}:${runId}`;
  };

  function defaultTaskPositions(run, model) {
    const positions = new Map();
    const outer = model.nodes.filter(node => node.kind === 'task');
    outer.forEach((node, index) => positions.set(node.id, { x: 42 + index * 300, y: 42 }));
    if (!model.group) return positions;

    const parentId = taskNodeId(model.group?.parentTaskId);
    const parent = positions.get(parentId) || { x: 42, y: 42 };
    const workers = model.nodes.filter(node => node.kind === 'worker');
    const gap = 280;
    const centerX = parent.x + NODE_WIDTH / 2;
    const startX = Math.max(42, centerX - ((workers.length - 1) * gap + NODE_WIDTH) / 2);
    workers.forEach((node, index) => positions.set(node.id, { x: startX + index * gap, y: 320 }));
    const join = model.nodes.find(node => node.kind === 'join');
    if (join) positions.set(join.id, { x: Math.max(42, centerX - NODE_WIDTH / 2), y: 590 });
    return positions;
  }

  function loadTaskPositions(run, model) {
    const positions = defaultTaskPositions(run, model);
    try {
      const saved = JSON.parse(localStorage.getItem(layoutKey(run.id)) || '{}');
      for (const [nodeId, position] of Object.entries(saved)) {
        if (!positions.has(nodeId)) continue;
        if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) positions.set(nodeId, { x: position.x, y: position.y });
      }
    } catch {
      localStorage.removeItem(layoutKey(run.id));
    }
    return positions;
  }

  function resizeStage() {
    const positions = [...app.positions.values()];
    const maxX = Math.max(...positions.map(position => position.x), 0);
    const maxY = Math.max(...positions.map(position => position.y), 0);
    app.stageWidth = Math.max(1180, maxX + NODE_WIDTH + 100);
    app.stageHeight = Math.max(820, maxY + NODE_MIN_HEIGHT + 150);
    elements.graphStage.style.width = `${app.stageWidth}px`;
    elements.graphStage.style.height = `${app.stageHeight}px`;
    elements.edgeLayer.setAttribute('viewBox', `0 0 ${app.stageWidth} ${app.stageHeight}`);
  }

  function makeTaskNode(run, item) {
    const node = createElement('article', `agent-node task-graph-node task-graph-${item.kind}`);
    node.dataset.agentId = item.id;
    node.dataset.status = item.status;
    node.dataset.nodeKind = item.kind;
    node.dataset.startedAt = item.startedAt || '';
    node.dataset.completedAt = item.completedAt || '';
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `${item.title}の詳細を表示`);
    if (app.selectedAgentId === item.id) node.classList.add('selected');

    const header = createElement('header', 'agent-header');
    const title = document.createElement('div');
    title.append(createElement('strong', '', item.title));
    title.append(createElement('small', '', item.subtitle));
    header.append(title, createElement('span', 'agent-state', stateText(item.status)));

    const body = createElement('div', 'agent-body');
    body.append(createElement('p', 'agent-task', item.taskId || 'task未設定'));
    body.append(createElement('p', 'agent-description', item.description || '作業説明なし'));
    const progress = createElement('div', 'agent-progress');
    progress.append(
      createElement('span', '', item.taskStatus ? statusLabel(item.taskStatus) : stateText(item.status)),
      createElement('span', 'agent-timing', durationText(item.startedAt, item.completedAt))
    );
    body.append(progress);
    node.append(header, body);

    const position = app.positions.get(item.id) || { x: 0, y: 0 };
    node.style.transform = `translate(${position.x}px, ${position.y}px)`;
    const select = () => selectAgent(run, item.id);
    node.addEventListener('click', select);
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    enableDragging(run, node, item.id);
    return node;
  }

  function nodeCenter(node, position, side) {
    const width = node.offsetWidth || NODE_WIDTH;
    const height = node.offsetHeight || NODE_MIN_HEIGHT;
    if (side === 'top') return { x: position.x + width / 2, y: position.y };
    if (side === 'bottom') return { x: position.x + width / 2, y: position.y + height };
    if (side === 'left') return { x: position.x, y: position.y + height * 0.42 };
    return { x: position.x + width, y: position.y + height * 0.42 };
  }

  function edgePath(edge, fromNode, toNode, fromPosition, toPosition) {
    if (edge.kind === 'parallel-fork' || edge.kind === 'parallel-join') {
      const start = nodeCenter(fromNode, fromPosition, 'bottom');
      const end = nodeCenter(toNode, toPosition, 'top');
      const bend = Math.max(70, Math.abs(end.y - start.y) * 0.45);
      return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
    }
    if (edge.kind === 'parallel-next') {
      const start = nodeCenter(fromNode, fromPosition, 'top');
      const end = nodeCenter(toNode, toPosition, 'bottom');
      const bend = Math.max(90, Math.abs(start.y - end.y) * 0.42);
      return `M ${start.x} ${start.y} C ${start.x} ${start.y - bend}, ${end.x} ${end.y + bend}, ${end.x} ${end.y}`;
    }
    return pathForEdge(fromNode, toNode, fromPosition, toPosition);
  }

  function edgeStatusClass(model, edge) {
    const from = model.nodeMap.get(edge.from);
    const to = model.nodeMap.get(edge.to);
    const status = edge.kind === 'parallel-next' ? from?.status : to?.status;
    if (status === 'active') return 'edge edge-active';
    if (status === 'completed') return 'edge edge-completed';
    if (status === 'error') return 'edge edge-error';
    return 'edge edge-muted';
  }

  updateEdges = function updateTaskGraphEdges(run) {
    const model = buildModel(run);
    lastModel = model;
    for (const path of [...elements.edgeLayer.querySelectorAll('path.edge')]) path.remove();
    const domNodes = new Map([...elements.nodeLayer.querySelectorAll('.agent-node')].map(node => [node.dataset.agentId, node]));
    for (const edge of model.edges) {
      const fromNode = domNodes.get(edge.from);
      const toNode = domNodes.get(edge.to);
      const fromPosition = app.positions.get(edge.from);
      const toPosition = app.positions.get(edge.to);
      if (!fromNode || !toNode || !fromPosition || !toPosition) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', edgePath(edge, fromNode, toNode, fromPosition, toPosition));
      path.setAttribute('class', `${edgeStatusClass(model, edge)} edge-${edge.kind}`);
      path.dataset.from = edge.from;
      path.dataset.to = edge.to;
      elements.edgeLayer.append(path);
    }
  };

  renderGraph = function renderTaskGraph(run) {
    const model = buildModel(run);
    lastModel = model;
    elements.nodeLayer.replaceChildren();
    app.positions = loadTaskPositions(run, model);
    if (!model.nodeMap.has(app.selectedAgentId)) app.selectedAgentId = taskNodeId(run.currentTaskId) || model.nodes[0]?.id || '';
    resizeStage();
    for (const item of model.nodes) elements.nodeLayer.append(makeTaskNode(run, item));
    requestAnimationFrame(() => requestAnimationFrame(() => updateEdges(run)));
  };

  selectAgent = function selectTaskGraphNode(run, nodeId) {
    app.selectedAgentId = nodeId;
    const model = lastModel?.run === run ? lastModel : buildModel(run);
    const item = model.nodeMap.get(nodeId);
    for (const node of elements.nodeLayer.querySelectorAll('.agent-node')) node.classList.toggle('selected', node.dataset.agentId === nodeId);
    if (!item) return;

    elements.selectedAgentTitle.textContent = item.title;
    const values = [
      ['ノード種別', item.kind === 'task' ? 'workflow task' : item.kind === 'worker' ? 'parallel worker task' : 'parallel integration task'],
      ['taskId', item.taskId || 'なし'],
      ['担当agent', item.sourceAgentId || 'なし'],
      ['状態', stateText(item.status)],
      ['task状態', statusLabel(item.taskStatus)],
      ['作業内容', item.description || 'なし'],
      ['作業時間', durationText(item.startedAt, item.completedAt)],
      ['attempt', String(item.attempt || 0)],
      ['開始', item.startedAt ? formatDate(item.startedAt) : 'なし'],
      ['完了', item.completedAt ? formatDate(item.completedAt) : 'なし']
    ];
    const list = document.createElement('dl');
    for (const [label, value] of values) list.append(createElement('dt', '', label), createElement('dd', '', value));
    elements.selectedAgentDetail.replaceChildren(list);
  };

  renderSummary = function renderTaskGraphSummary(run) {
    ORIGINAL_RENDER_SUMMARY(run);
    const group = selectedParallelGroup(run);
    if (!group || text(group?.parentTaskId) !== text(run?.currentTaskId)) return;
    const workers = Array.isArray(group?.workers) ? group.workers : [];
    const terminal = workers.filter(worker => ['completed', 'failed', 'timeout'].includes(text(worker?.formalStatus || worker?.status).toLowerCase())).length;
    const activeWorkers = workers
      .filter(worker => visibleStatus(worker?.status, worker?.formalStatus) === 'active')
      .map(worker => text(agentMeta(run, worker?.agentId)?.name || worker?.label || worker?.agentId));
    const phase = text(group?.phase || 'workers');
    elements.currentTask.textContent = phase === 'workers'
      ? `${run.currentTaskLabel || run.currentTaskId} — ${terminal}/${workers.length} worker終了`
      : `${run.currentTaskLabel || run.currentTaskId} — 統合ターン`;
    elements.currentAgent.textContent = activeWorkers.length
      ? `生成中: ${activeWorkers.join(' / ')}`
      : phase === 'workers' ? `並列worker ${workers.length}件を監視中` : `統合: ${text(group?.coordinatorAgentId || '未設定')}`;
  };

  const help = document.querySelector('.graph-help');
  if (help) help.textContent = '四角いノードはtask単位です。program buildから各worker taskへforkし、全worker終了後に統合taskへjoinして次taskへ進みます。';
})();
