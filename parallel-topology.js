'use strict';

(() => {
  if (typeof renderGraph !== 'function' || typeof updateEdges !== 'function') return;

  const BASE_RENDER_GRAPH = renderGraph;
  const BASE_UPDATE_EDGES = updateEdges;
  const TOPOLOGY_GROUP_ID = 'workflow_program_build_three_workers';
  const WORKER_IDS = ['program_worker_1', 'program_worker_2', 'program_worker_3'];

  const text = value => String(value || '').trim();

  function actualGroups(run) {
    return Array.isArray(run?.parallelGroups)
      ? run.parallelGroups.filter(group => Array.isArray(group?.workers) && group.workers.length)
      : [];
  }

  function taskById(run, taskId) {
    return (Array.isArray(run?.tasks) ? run.tasks : []).find(task => text(task?.id) === taskId) || null;
  }

  function workerAgents(run) {
    const agents = Array.isArray(run?.agents) ? run.agents : [];
    return WORKER_IDS
      .map(agentId => agents.find(agent => text(agent?.agentId) === agentId))
      .filter(Boolean);
  }

  function syntheticGroup(run) {
    const parent = taskById(run, 'program_build');
    const workers = workerAgents(run);
    if (!parent || workers.length !== WORKER_IDS.length) return null;

    const parentStatus = text(parent.status).toLowerCase();
    const terminal = ['completed', 'failed'].includes(parentStatus);
    return {
      groupId: TOPOLOGY_GROUP_ID,
      revision: 0,
      parentTaskId: 'program_build',
      parentTaskStatus: parentStatus,
      phase: parentStatus === 'ready' ? 'planning' : terminal ? 'finished' : 'waiting_for_group',
      coordinatorAgentId: text(parent.agentId || 'program_manager_agent'),
      maxConcurrency: 3,
      timeoutMinutes: 30,
      status: terminal ? parentStatus : parentStatus === 'ready' ? 'ready' : 'waiting',
      syntheticTopology: true,
      integration: {
        status: terminal ? parentStatus : 'waiting',
        runtimePhase: 'not_started',
        observerState: 'IDLE',
        runtimeFresh: false
      },
      workers: workers.map((agent, index) => ({
        workerId: `worker_${index + 1}`,
        label: text(agent.name || agent.agentId),
        agentId: text(agent.agentId),
        taskId: 'worker_implementation',
        attempt: 0,
        status: 'waiting',
        formalStatus: 'waiting',
        runtimePhase: 'not_created',
        observerState: 'IDLE',
        runtimeFresh: false,
        topologyPlaceholder: true
      }))
    };
  }

  function decoratedRun(run) {
    if (!run || typeof run !== 'object') return run;
    const groups = actualGroups(run);
    const group = groups[0] || syntheticGroup(run);
    if (!group) return run;

    const tasks = (Array.isArray(run.tasks) ? run.tasks : []).map(task => {
      if (text(task?.id) !== 'program_build') return task;
      return {
        ...task,
        label: 'program build：分割・指示',
        instruction: text(task?.instruction) || '3 workerへ作業を割り当てる計画turn'
      };
    });

    return {
      ...run,
      tasks,
      parallelGroups: groups.length ? run.parallelGroups : [group]
    };
  }

  function relabelRenderedNodes(run) {
    const groups = actualGroups(run);
    const group = groups[0] || syntheticGroup(run);
    if (!group) return;

    const parent = document.querySelector('[data-agent-id="task:program_build"]');
    if (parent) {
      const title = parent.querySelector('.agent-header strong');
      const task = parent.querySelector('.agent-task');
      const description = parent.querySelector('.agent-description');
      if (title) title.textContent = 'program build：分割・指示';
      if (task) task.textContent = 'program_build / 計画turn';
      if (description) description.textContent = 'プログラマ・マネージャが3 workerへ指示書・sub-run・専用branchを割り当てる';
    }

    const join = document.querySelector(`[data-agent-id="join:${CSS.escape(text(group.groupId))}"]`);
    if (join) {
      const title = join.querySelector('.agent-header strong');
      const task = join.querySelector('.agent-task');
      const description = join.querySelector('.agent-description');
      if (title) title.textContent = 'program build：統合';
      if (task) task.textContent = 'program_build / 統合turn';
      if (description) description.textContent = '同じプログラマ・マネージャが3 workerの結果を受け取り、candidateを統合する';
    }

    if (group.syntheticTopology) {
      for (const workerId of WORKER_IDS) {
        const worker = document.querySelector(`[data-agent-id="worker:${CSS.escape(TOPOLOGY_GROUP_ID)}:${CSS.escape(workerId.replace('program_', ''))}"]`);
        if (!worker) continue;
        const description = worker.querySelector('.agent-description');
        const progress = worker.querySelector('.agent-progress span');
        if (description) description.textContent = '現在iterationのsub-run作成待ち。ノードはworkflow上の固定worker枠です。';
        if (progress) progress.textContent = '割当待ち';
      }
    }
  }

  renderGraph = function renderDeclaredParallelTopology(run) {
    const decorated = decoratedRun(run);
    BASE_RENDER_GRAPH(decorated);
    requestAnimationFrame(() => requestAnimationFrame(() => relabelRenderedNodes(decorated)));
  };

  updateEdges = function updateDeclaredParallelTopologyEdges(run) {
    return BASE_UPDATE_EDGES(decoratedRun(run));
  };

  const help = document.querySelector('.graph-help');
  if (help) help.textContent = 'program buildの計画turnから3 workerへ必ずforkし、3本の結果を同じプログラマ・マネージャの統合turnが受け取って次taskへ進みます。';
})();
