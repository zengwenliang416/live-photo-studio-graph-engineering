'use strict';

const phases = [
  'START',
  'WAITING_GENERATION',
  'REVIEW_ANCHOR',
  'WAITING_RENDER',
  'COMPLETED',
  'CANCELLED',
  'FAILED'
];

function initialState(maxRepairAttempts = 2) {
  return {
    phase: 'START',
    generationJobId: null,
    renderJobId: null,
    pendingTaskId: null,
    repairAttempts: 0,
    maxRepairAttempts,
    consumedSignals: []
  };
}

function hasConsumed(state, signalId) {
  return state.consumedSignals.includes(signalId);
}

function consume(state, signalId) {
  if (!hasConsumed(state, signalId)) {
    state.consumedSignals.push(signalId);
  }
}

function transition(state, event) {
  if (!phases.includes(state.phase)) throw new Error(`Unknown phase: ${state.phase}`);

  if (event.type === 'start' && state.phase === 'START') {
    return { ...state, phase: 'WAITING_GENERATION', generationJobId: event.jobId };
  }

  if (event.type === 'generation-completed') {
    if (hasConsumed(state, event.signalId)) return state;
    consume(state, event.signalId);
    if (state.phase === 'CANCELLED' || state.phase === 'COMPLETED' || state.phase === 'FAILED') {
      return state;
    }
    if (state.phase !== 'WAITING_GENERATION' || event.jobId !== state.generationJobId) {
      throw new Error('GENERATION_SIGNAL_NOT_APPLICABLE');
    }
    return {
      ...state,
      phase: 'REVIEW_ANCHOR',
      pendingTaskId: event.taskId
    };
  }

  if (event.type === 'decision') {
    if (state.phase !== 'REVIEW_ANCHOR' || event.taskId !== state.pendingTaskId) {
      throw new Error('HUMAN_TASK_NOT_APPLICABLE');
    }
    if (event.action === 'CANCEL') {
      return { ...state, phase: 'CANCELLED', pendingTaskId: null };
    }
    if (event.action === 'REGENERATE') {
      if (state.repairAttempts >= state.maxRepairAttempts) {
        return { ...state, phase: 'FAILED', pendingTaskId: null };
      }
      return {
        ...state,
        phase: 'WAITING_GENERATION',
        generationJobId: event.jobId,
        pendingTaskId: null,
        repairAttempts: state.repairAttempts + 1
      };
    }
    if (event.action === 'SELECT') {
      return { ...state, phase: 'WAITING_RENDER', renderJobId: event.jobId, pendingTaskId: null };
    }
  }

  if (event.type === 'render-completed') {
    if (hasConsumed(state, event.signalId)) return state;
    consume(state, event.signalId);
    if (state.phase === 'CANCELLED' || state.phase === 'COMPLETED' || state.phase === 'FAILED') {
      return state;
    }
    if (state.phase !== 'WAITING_RENDER' || event.jobId !== state.renderJobId) {
      throw new Error('RENDER_SIGNAL_NOT_APPLICABLE');
    }
    return { ...state, phase: 'COMPLETED' };
  }

  throw new Error(`Unsupported transition: ${event.type} from ${state.phase}`);
}

module.exports = { phases, initialState, transition };

if (require.main === module) {
  let state = initialState(1);
  const flow = [
    { type: 'start', jobId: 'generation-1' },
    { type: 'generation-completed', signalId: 'signal-1', jobId: 'generation-1', taskId: 'task-1' },
    { type: 'decision', action: 'SELECT', taskId: 'task-1', jobId: 'render-1' },
    { type: 'render-completed', signalId: 'signal-2', jobId: 'render-1' }
  ];
  for (const event of flow) {
    state = transition(state, event);
    process.stdout.write(`${event.type} -> ${state.phase}\n`);
  }
}
