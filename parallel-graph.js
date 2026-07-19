'use strict';

(() => {
  if (typeof app === 'undefined' || typeof elements === 'undefined' || typeof makeAgentNode !== 'function') return;

  const ORIGINAL_RENDER_SUMMARY = renderSummary;
  const TERMINAL = new Set(['completed', 'failed', 'timeout']);
  const FAILURE = new Set(['failed', 'timeout', 'error', 'target_missing', 'prepare_failed', 'draft_present', 'draft_mismatch', 'submission_unknown']);
  const LAYOUT_VERSION = 'parallel-v1';

  function text(value) {
    return String(value || '').trim();
  }

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

  function selectedParallelGroup(run) {
    const groups = Array.isArray(run?.parallelGroups) ? run.parallelGroups : [];
    if (!groups.length) return null;
    return groups.find(group => text(group?.parentTaskId) === text(run?.currentTaskId))
      || groups.find(group => !['completed', 'failed'].includes(text(group?.status).toLowerCase()))
      || groups[0];
  }

  function workerVisibleStatus(worker) {
    const visible = text(worker?.status).toLowerCase();
    const formal = text(worker?.formalStatus).toLowerCase();
    if (visible === 'active') return 'active';
    if (FAILURE.has(visible) || FAILURE.has(formal)) return 'error';
    if (formal === 'completed') return 'completed';
    if (['ready', 'prepared', 'submit_requested', 'submitted_confirmed', 'submitted', 'dispatched', 'response_started'].includes(visible)
        || ['ready', 'dispatched'].includes(formal)) return 'ready';
    return 'waiting';
  }

  function joinVisibleStatus(group) {
    const status = text(group?.integration?.status || group?.status).toLowerCase();
    if (['active', 'integrating'].includes(status)) return 'active';
    if (FAILURE.has(status) || status === 'failed') return 'error';
    if (status === 'completed' || text(group?.parentTaskStatus).toLowerCase() === 'completed') return 'completed';
    if (['ready', 'integration_ready', 'dispatched', 'integration_dispatched', 'submitted_confirmed'].includes(status)) return 'ready';
    return 'waiting';
  }

  function graphModel(run) {
    const group = selectedParallelGroup(run);
    if (!group) return { group: null, agents: Array.isArray(run?.agents) ? run.agents : [], workerIds: new Set(), joinAgent: null, nextAgentId: '' };

    const workers = Array.isArray(group?.workers) ? group.workers : [];
    const workerMap = new Map(workers.map(worker => [text(worker?.agentId), worker]));
    const workerIds = new Set(workerMap.keys());
    const counts = group?.counts || {};
    const total = Number(counts.total || workers.length || 0);
    const terminal = Number(counts.terminal || 0);
    const coordinatorId = text(group?.coordinatorAgentId || run?.currentAgentId);

    const agents = (Array.isArray(run?.agents) ? run.agents : []).map(agent => {
      const worker = workerMap.get(text(agent?.agentId));
      if (worker) {
        const formal = text(worker?.formalStatus || worker?.status || 'waiting');
        return {
          ...agent,
          status: workerVisibleStatus(worker),
          activityTaskId: text(worker?.taskId || 'worker_implementation'),
          activityTaskLabel: text(worker?.label || worker?.workerId || '並列worker'),
          activityStatus: formal,
          activityInstruction: `並列group ${text(group?.groupId)} / runtime ${text(worker?.runtimePhase || worker?.observerState || '未観測')}`,
          taskCount: 1,
          completedCount: formal === 'completed' ? 1 : 0,
          completedAt: worker?.completedAt || null,
          parallelWorker: worker,
          parallelGroupId: text(group?.groupId)
        };
      }
      if (text(agent?.agentId) === coordinatorId) {
        return {
          ...agent,
          activityTaskLabel: text(group?.phase) === 'workers' ? `program build — ${total} worker並列` : 'program build — worker統合',
          activityInstruction: `${terminal}/${total} worker終了・${Number(counts.active || 0)}生成中・${Number(counts.ready || 0)}実行待ち`,
          parallelGroupId: text(group?.groupId)
        };
      }
      return agent;
    });

    const outerAgents = agents.filter(agent => !workerIds.has(text(agent?.agentId)));
    const coordinatorIndex = outerAgents.findIndex(agent => text(agent?.agentId) === coordinatorId);
    const nextAgentId = coordinatorIndex >= 0 ? text(outerAgents[coordinatorIndex + 1]?.agentId) : '';
    const joinId = `parallel_join_${text(group?.groupId)}`;
    const integration = group?.integration || {};
    const joinAgent = {
      agentId: joinId,
      name: 'プログラマ統合',
      role: '全workerの成果を確認し、統合candidateを固定して次taskへ渡す',
      status: joinVisibleStatus(group),
      activityTaskId: text(group?.parentTaskId || 'program_build'),
      activityTaskLabel: text(group?.phase) === 'workers' ? '全worker終了待ち' : '統合ターン',
      activityStatus: text(integration?.status || group?.status || 'waiting'),
      activityInstruction: `group ${text(group?.groupId)} / coordinator ${coordinatorId || '未設定'}`,
      taskCount: 1,
      completedCount: text(group?.parentTaskStatus).toLowerCase() === 'completed' ? 1 : 0,
      completedAt: group?.completedAt || null,
      parallelJoin: true,
      parallelGroupId: text(group?.groupId),
      integration
    };

    return { group, agents, workers, workerIds, coordinatorId, joinAgent, joinId, nextAgentId };
  }

  layoutKey = function parallelLayoutKey(runId) {
    return `pbb-public-dashboard-layout:${LAYOUT_VERSION}:${runId}`;
  };

  function defaultParallelPositions(run, model) {
    const positions = new Map();
    if (!model.group) return defaultPositions(model.agents);
    const outerAgents = model.agents.filter(agent => !model.workerIds.has(text(agent?.agentId)));
    const coordinatorIndex = outerAgents.findIndex(agent => text(agent?.agentId) === model.coordinatorId);
    let slot = 0;
    for (let index = 0; index < outerAgents.length; index += 1) {
      const agent = outerAgents[index];
      positions.set(agent.agentId, { x: 42 + slot * 286, y: 42 + (index % 2) * 54 });
      slot += 1;
      if (index === coordinatorIndex) {
        positions.set(model.joinId, { x: 42 + slot * 286, y: 78 });
        slot += 1;
      }
    }
    const coordinator = positions.get(model.coordinatorId) || { x: 42, y: 42 };
    const workerGap = 270;
    const workerCount = Math.max(1, model.workers.length);
    const startX = Math.max(42, coordinator.x - Math.round((workerCount - 1) * workerGap * 0.28));
    model.workers.forEach((worker, index) => positions.set(text(worker?.agentId), { x: startX + index * workerGap, y: 345 + (index % 2) * 34 }));
    return positions;
  }

  function loadParallelPositions(run, model) {
    const positions = defaultParallelPositions(run, model);
    try {
      const saved = JSON.parse(localStorage.getItem(layoutKey(run.id)) || '{}');
      for (const [agentId, position] of Object.entries(saved)) {
        if (!positions.has(agentId)) continue;
        if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) positions.set(agentId, { x: position.x, y: position.y });
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
    app.stageWidth = Math.max(1100, maxX + NODE_WIDTH + 90);
    app.stageHeight = Math.max(650, maxY + NODE_MIN_HEIGHT + 120);
    elements.graphStage.style.width = `${app.stageWidth}px`;
    elements.graphStage.style.height = `${app.stageHeight}px`;
    elements.edgeLayer.setAttribute('viewBox', `0 0 ${app.stageWidth} ${app.stageHeight}`);
  }

  function nodeCenter(node, position, side) {
    const width = node.offsetWidth || NODE_WIDTH;
    const height = node.offsetHeight || NODE_MIN_HEIGHT;
    if (side === 'top') return { x: position.x + width / 2, y: position.y };
    if (side === 'bottom') return { x: position.x + width / 2, y: position.y + height };
    if (side === 'left') return { x: position.x, y: position.y + height * 0.42 };
    return { x: position.x + width, y: position.y + height * 0.42 };
  }

  function parallelPath(edge, fromNode, toNode, fromPosition, toPosition) {
    if (edge.kind === 'parallel-fork') {
      const start = nodeCenter(fromNode, fromPosition, 'bottom');
      const end = nodeCenter(toNode, toPosition, 'top');
      const bend = Math.max(60, Math.abs(end.y - start.y) * 0.45);
      return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
    }
    if (edge.kind === 'parallel-join') {
      const start = nodeCenter(fromNode, fromPosition, 'top');
      const end = nodeCenter(toNode, toPosition, 'bottom');
      const bend = Math.max(60, Math.abs(start.y - end.y) * 0.45);
      return `M ${start.x} ${start.y} C ${start.x} ${start.y - bend}, ${end.x} ${end.y + bend}, ${end.x} ${end.y}`;
    }
    return pathForEdge(fromNode, toNode, fromPosition, toPosition);
  }

  function workerById(model, agentId) {
    return model.workers?.find(worker => text(worker?.agentId) === text(agentId)) || null;
  }

  function parallelEdgeClass(run, model, edge) {
    if (edge.kind === 'parallel-fork' || edge.kind === 'parallel-join') {
      const status = workerVisibleStatus(workerById(model, edge.workerAgentId));
      if (status === 'active') return 'edge edge-active edge-parallel';
      if (status === 'completed') return 'edge edge-completed edge-parallel';
      if (status === 'error') return 'edge edge-error edge-parallel';
      return 'edge edge-muted edge-parallel';
    }
    if (edge.kind === 'parallel-next') {
      const status = joinVisibleStatus(model.group);
      if (status === 'active') return 'edge edge-active edge-parallel-next';
      if (status === 'completed') return 'edge edge-completed edge-parallel-next';
      if (status === 'error') return 'edge edge-error edge-parallel-next';
      return 'edge edge-muted edge-parallel-next';
    }
    return edgeClass(run, edge);
  }

  function graphEdges(run, model) {
    const original = Array.isArray(run?.edges) ? run.edges : [];
    if (!model.group) return original;
    const edges = original.filter(edge => {
      if (model.workerIds.has(text(edge?.from)) || model.workerIds.has(text(edge?.to))) return false;
      return !(text(edge?.from) === model.coordinatorId && text(edge?.to) === model.nextAgentId);
    });
    for (const worker of model.workers) {
      const agentId = text(worker?.agentId);
      edges.push({ from: model.coordinatorId, to: agentId, kind: 'parallel-fork', workerAgentId: agentId });
      edges.push({ from: agentId, to: model.joinId, kind: 'parallel-join', workerAgentId: agentId });
    }
    if (model.nextAgentId) edges.push({ from: model.joinId, to: model.nextAgentId, kind: 'parallel-next' });
    return edges;
  }

  updateEdges = function updateParallelEdges(run) {
    const model = graphModel(run);
    for (const path of [...elements.edgeLayer.querySelectorAll('path.edge')]) path.remove();
    const nodeMap = new Map([...elements.nodeLayer.querySelectorAll('.agent-node')].map(node => [node.dataset.agentId, node]));
    for (const edge of graphEdges(run, model)) {
      const fromNode = nodeMap.get(text(edge?.from));
      const toNode = nodeMap.get(text(edge?.to));
      const fromPosition = app.positions.get(text(edge?.from));
      const toPosition = app.positions.get(text(edge?.to));
      if (!fromNode || !toNode || !fromPosition || !toPosition) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', parallelPath(edge, fromNode, toNode, fromPosition, toPosition));
      path.setAttribute('class', parallelEdgeClass(run, model, edge));
      path.dataset.from = text(edge?.from);
      path.dataset.to = text(edge?.to);
      elements.edgeLayer.append(path);
    }
  };

  renderGraph = function renderParallelGraph(run) {
    const model = graphModel(run);
    elements.nodeLayer.replaceChildren();
    app.positions = loadParallelPositions(run, model);
    resizeStage();
    for (const agent of model.agents) {
      const node = makeAgentNode(run, agent);
      if (model.workerIds.has(text(agent?.agentId))) node.classList.add('parallel-worker-node');
      elements.nodeLayer.append(node);
    }
    if (model.joinAgent) {
      const joinNode = makeAgentNode(run, model.joinAgent);
      joinNode.classList.add('parallel-join-node');
      elements.nodeLayer.append(joinNode);
    }
    requestAnimationFrame(() => updateEdges(run));
  };

  renderSummary = function renderParallelSummary(run) {
    ORIGINAL_RENDER_SUMMARY(run);
    const model = graphModel(run);
    if (!model.group || text(model.group?.parentTaskId) !== text(run?.currentTaskId)) return;
    const counts = model.group?.counts || {};
    const total = Number(counts.total || model.workers.length || 0);
    const terminal = Number(counts.terminal || 0);
    const activeWorkers = model.workers.filter(worker => workerVisibleStatus(worker) === 'active').map(worker => text(worker?.label || worker?.agentId));
    const phase = text(model.group?.phase || 'workers');
    elements.currentTask.textContent = phase === 'workers'
      ? `${run.currentTaskLabel || run.currentTaskId} — ${terminal}/${total} worker終了`
      : `${run.currentTaskLabel || run.currentTaskId} — 統合ターン`;
    elements.currentAgent.textContent = activeWorkers.length
      ? `生成中: ${activeWorkers.join(' / ')}`
      : phase === 'workers' ? `並列worker ${total}件を監視中` : `統合: ${model.coordinatorId || '未設定'}`;
    elements.nextAction.textContent = `${text(model.group?.groupId)} / ${Number(counts.active || 0)}生成中・${Number(counts.ready || 0)}実行待ち・${terminal}終了`;
  };

  selectAgent = function selectParallelAgent(run, agentId) {
    app.selectedAgentId = agentId;
    const model = graphModel(run);
    const candidates = model.joinAgent ? [...model.agents, model.joinAgent] : model.agents;
    const agent = candidates.find(item => text(item?.agentId) === text(agentId));
    for (const node of elements.nodeLayer.querySelectorAll('.agent-node')) node.classList.toggle('selected', node.dataset.agentId === agentId);
    if (!agent) return;
    elements.selectedAgentTitle.textContent = agent.name;
    const worker = agent.parallelWorker || null;
    const values = [
      ['agentId', agent.agentId],
      ['状態', nodeStatusText(agent)],
      ['役割', agent.role || 'なし'],
      ['現在のtask', agent.activityTaskLabel || 'なし'],
      ['task状態', statusLabel(agent.activityStatus)],
      ['作業内容', agent.activityInstruction || 'なし'],
      ['並列group', agent.parallelGroupId || 'なし'],
      ['作業時間', worker ? durationText(worker.startedAt, worker.completedAt) : agent.parallelJoin ? durationText(model.group?.startedAt, model.group?.completedAt) : '未開始'],
      ['runtime観測', worker ? text(worker.runtimePhase || worker.observerState || '未観測') : agent.parallelJoin ? text(agent.integration?.runtimePhase || agent.integration?.observerState || '未観測') : '—'],
      ['attempt', worker ? String(worker.attempt || 0) : '—'],
      ['最終完了', agent.completedAt ? formatDate(agent.completedAt) : 'なし']
    ];
    const list = document.createElement('dl');
    for (const [label, value] of values) list.append(createElement('dt', '', label), createElement('dd', '', value));
    elements.selectedAgentDetail.replaceChildren(list);
  };

  const help = document.querySelector('.graph-help');
  if (help) help.textContent = '通常taskは上段、program buildのworkerは下段へforkし、全worker終了後に「プログラマ統合」へjoinします。「生成中」は直近90秒以内のChatGPT生成シグナルがある場合だけです。';
})();
