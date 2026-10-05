import { create } from 'zustand';
import { subscribeAuthTokens } from '../services/auth-storage';
import type {
  ChatMessage,
  ActivePlan,
  StepState,
  Conversation,
  PlanStatus,
  ClarificationState,
  GatherState,
  ExecutionSnapshot,
} from '../types';

export interface ChatStoreState {
  conversationId: string | null;
  conversations: Conversation[];
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isPlanning: boolean;
  planningByConversation: Record<string, { requestId?: string; messageId?: string; startedAt: string }>;
  setIsPlanning: (value: boolean, conversationId?: string | null, requestId?: string) => void;
  beginPlanning: (conversationId: string | null, requestId: string) => boolean;
  transferPlanning: (conversationId: string | null, targetId: string, requestId: string) => void;
  confirmPlanningRequest: (conversationId: string, requestId: string | undefined, messageId: string) => void;
  activePlan: ActivePlan | null;
  planStatus: PlanStatus;
  activeClarification: ClarificationState | null;
  gatherState: GatherState | null;
  stepStatuses: Record<string, StepState>;
  stepErrors: Record<string, string>;
  executionSnapshot: ExecutionSnapshot | null;
  retiredExecutionPlanId: string | null;
  executionRevision: number;
  planRevision: number;
  executionLoadError: string | null;
  setExecutionSnapshot: (snapshot: ExecutionSnapshot | null) => void;
  setExecutionLoadError: (error: string | null) => void;

  // Actions
  setConversationId: (id: string | null) => void;
  setConversations: (conversations: Conversation[]) => void;
  addMessage: (message: ChatMessage) => void;
  addOptimisticMessage: (params: { id: string; content: string }) => void;
  confirmMessage: (tempId: string, confirmedId: string) => void;
  markMessageFailed: (tempId: string) => void;
  setStreamingText: (text: string) => void;
  appendStreamingText: (delta: string) => void;
  setIsStreaming: (isStreaming: boolean) => void;
  setActivePlan: (plan: ActivePlan | null) => void;
  setPlanStatus: (status: PlanStatus) => void;
  setClarification: (clarification: ClarificationState | null) => void;
  setGatherState: (
    gather:
      | GatherState
      | null
      | ((prev: GatherState | null) => GatherState | null)
  ) => void;
  updateStepStatus: (stepId: string, status: StepState, error?: string) => void;
  reset: (options?: { preservePlanning?: boolean }) => void;
}

const initialState = {
  conversationId: null,
  conversations: [],
  messages: [],
  streamingText: '',
  isStreaming: false,
  isPlanning: false,
  planningByConversation: {},
  activePlan: null,
  planStatus: 'idle' as PlanStatus,
  activeClarification: null,
  gatherState: null,
  stepStatuses: {},
  stepErrors: {},
  executionSnapshot: null,
  retiredExecutionPlanId: null,
  executionRevision: 0,
  planRevision: 0,
  executionLoadError: null,
};

const planningKey = (id: string | null) => id ?? '__draft__';
export const useChatStore = create<ChatStoreState>((set, get) => ({
  ...initialState,

  setConversationId: (id) => set(state => ({ conversationId: id, isPlanning: !!state.planningByConversation[planningKey(id)] })),
  setConversations: (conversations) => set({ conversations }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, { ...message, timestamp: message.timestamp || message.created_at || new Date().toISOString() }] })),

  addOptimisticMessage: ({ id, content }) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: 'user',
          content,
          status: 'sending',
          timestamp: new Date().toISOString(),
        },
      ],
    })),

  confirmMessage: (tempId, confirmedId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === tempId ? { ...m, id: confirmedId, status: 'sent' } : m
      ),
    })),

  markMessageFailed: (tempId) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === tempId ? { ...m, status: 'failed' } : m
      ),
    })),

  setStreamingText: (text) => set({ streamingText: text }),

  appendStreamingText: (delta) =>
    set((state) => ({ streamingText: state.streamingText + delta })),

  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setIsPlanning: (value, conversationId, requestId) => set(state => {
    const id = conversationId === undefined ? state.conversationId : conversationId;
    const key = planningKey(id), previous = state.planningByConversation[key];
    if (requestId && previous?.requestId && previous.requestId !== requestId) return {};
    const records = { ...state.planningByConversation };
    if (value) records[key] = previous ?? { requestId, startedAt: new Date().toISOString() };
    else delete records[key];
    // Settling the selected request is authoritative too: invalidate reads opened during planning.
    const settledOwner = !value && previous && id === state.conversationId;
    return { planningByConversation: records, isPlanning: !!records[planningKey(state.conversationId)],
      ...(settledOwner ? { executionRevision: state.executionRevision + 1, planRevision: state.planRevision + 1 } : {}) };
  }),
  beginPlanning: (id, requestId) => {
    if (get().planningByConversation[planningKey(id)]) return false;
    set(state => {
      if (state.conversationId !== id) return {};
      const unsafe = state.planStatus === 'reconciliation_required' ||
        state.executionSnapshot?.execution.status === 'reconciliation_required' ||
        [...Object.values(state.stepStatuses), ...(state.executionSnapshot?.steps.map(step => step.status) ?? [])]
          .some(status => status === 'unknown' || status === 'failed');
      if (unsafe || !['idle', 'preview', 'completed', 'stopped', 'rejected'].includes(state.planStatus)) return {};
      // The new request owns planning. Keep the saved receipt as history, not its active plan.
      return { activePlan: null, planStatus: 'idle', activeClarification: null, gatherState: null,
        retiredExecutionPlanId: state.executionSnapshot?.plan.id ?? state.activePlan?.id ?? state.retiredExecutionPlanId,
        stepStatuses: {}, stepErrors: {}, planRevision: state.planRevision + 1,
        executionRevision: state.executionRevision + 1 };
    });
    get().setIsPlanning(true, id, requestId); return true;
  },
  transferPlanning: (id, targetId, requestId) => set(state => {
    const record = state.planningByConversation[planningKey(id)];
    if (!record || record.requestId !== requestId) return {};
    const records = { ...state.planningByConversation, [targetId]: record };
    delete records[planningKey(id)];
    return { planningByConversation: records, isPlanning: !!records[planningKey(state.conversationId)] };
  }),
  confirmPlanningRequest: (id, requestId, messageId) => set(state => {
    const record = state.planningByConversation[id];
    if (!record || record.requestId !== requestId) return {};
    return { planningByConversation: { ...state.planningByConversation, [id]: { ...record, messageId } } };
  }),

  // A read-only execution snapshot may hydrate activePlan, but cannot supersede a pending-plan read.
  setActivePlan: (plan) => set(state => ({ activePlan: plan, planRevision: state.planRevision + 1, executionRevision: state.executionRevision + 1 })),

  setPlanStatus: (status) => set(state => ({ planStatus: status, executionRevision: state.executionRevision + 1 })),

  setExecutionLoadError: (error) => set({ executionLoadError: error }),
  setExecutionSnapshot: (snapshot) => set(state => {
    if (!snapshot) return { executionSnapshot: null, stepStatuses: {}, stepErrors: {}, executionRevision: state.executionRevision + 1 };
    const hasNewPreview = state.activePlan?.id !== snapshot.plan.id && ['preview', 'approving'].includes(state.planStatus);
    const hasNewRequest = (state.isPlanning || state.retiredExecutionPlanId === snapshot.plan.id) &&
      ['completed', 'stopped'].includes(snapshot.execution.status) &&
      !snapshot.steps.some(step => step.status === 'unknown' || step.status === 'failed');
    const plan: ActivePlan = {
      id: snapshot.plan.id,
      summary: snapshot.plan.summary || 'Quy trình đã lưu',
      steps: snapshot.plan.steps || snapshot.steps.map(row => ({ id: row.stepId, tool: row.tool, description: row.stepId, args: {} })),
      resourceLabels: snapshot.plan.resourceLabels,
    };
    return {
      executionSnapshot: snapshot,
      executionRevision: state.executionRevision + 1,
      executionLoadError: null,
      ...(hasNewPreview || hasNewRequest ? {} : { activePlan: plan, planStatus: snapshot.execution.status }),
      stepStatuses: Object.fromEntries(snapshot.steps.map(row => [row.stepId, row.status])),
      stepErrors: Object.fromEntries(snapshot.steps.flatMap(row => {
        const error = typeof row.error === 'string' ? row.error : row.error?.message;
        return error ? [[row.stepId, error]] : [];
      })),
    };
  }),

  setClarification: (clarification) =>
    set({ activeClarification: clarification }),

  setGatherState: (gather) =>
    set((state) => ({
      gatherState:
        typeof gather === 'function' ? gather(state.gatherState) : gather,
    })),

  updateStepStatus: (stepId, status, error) =>
    set((state) => {
      const stepErrors = { ...state.stepErrors };
      if (error) stepErrors[stepId] = error;
      else if (status === 'running' || status === 'succeeded') delete stepErrors[stepId];
      return { stepStatuses: { ...state.stepStatuses, [stepId]: status }, stepErrors, executionRevision: state.executionRevision + 1 };
    }),

  reset: (options) =>
    set((state) => ({
      conversationId: null,
      messages: [],
      streamingText: '',
      isStreaming: false,
      planningByConversation: options?.preservePlanning ? state.planningByConversation : {},
      isPlanning: options?.preservePlanning ? !!state.planningByConversation[planningKey(null)] : false,
      activePlan: null,
      planStatus: 'idle',
      activeClarification: null,
      gatherState: null,
      stepStatuses: {},
      stepErrors: {},
      executionSnapshot: null,
      retiredExecutionPlanId: null,
      executionLoadError: null,
      executionRevision: state.executionRevision + 1,
      planRevision: state.planRevision + 1,
      conversations: state.conversations,
    })),
}));

// Session loss must release every request; navigation resets preserve them.
subscribeAuthTokens(tokens => { if (!tokens.accessToken) useChatStore.getState().reset(); });
