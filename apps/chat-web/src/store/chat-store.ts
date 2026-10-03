import { create } from 'zustand';
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
  conversationArchived: boolean;
  conversations: Conversation[];
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  activePlan: ActivePlan | null;
  planStatus: PlanStatus;
  activeClarification: ClarificationState | null;
  gatherState: GatherState | null;
  stepStatuses: Record<string, StepState>;
  stepErrors: Record<string, string>;
  executionSnapshot: ExecutionSnapshot | null;
  executionRevision: number;
  planRevision: number;
  executionLoadError: string | null;
  setExecutionSnapshot: (snapshot: ExecutionSnapshot | null) => void;
  setExecutionLoadError: (error: string | null) => void;

  // Actions
  setConversationId: (id: string | null) => void;
  setConversationArchived: (archived: boolean) => void;
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
  reset: () => void;
}

const initialState = {
  conversationId: null,
  conversationArchived: false,
  conversations: [],
  messages: [],
  streamingText: '',
  isStreaming: false,
  activePlan: null,
  planStatus: 'idle' as PlanStatus,
  activeClarification: null,
  gatherState: null,
  stepStatuses: {},
  stepErrors: {},
  executionSnapshot: null,
  executionRevision: 0,
  planRevision: 0,
  executionLoadError: null,
};

export const useChatStore = create<ChatStoreState>((set) => ({
  ...initialState,

  setConversationId: (id) => set({ conversationId: id }),
  setConversationArchived: (archived) => set({ conversationArchived: archived }),
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

  // A read-only execution snapshot may hydrate activePlan, but cannot supersede a pending-plan read.
  setActivePlan: (plan) => set(state => ({ activePlan: plan, planRevision: state.planRevision + 1, executionRevision: state.executionRevision + 1 })),

  setPlanStatus: (status) => set(state => ({ planStatus: status, executionRevision: state.executionRevision + 1 })),

  setExecutionLoadError: (error) => set({ executionLoadError: error }),
  setExecutionSnapshot: (snapshot) => set(state => {
    if (!snapshot) return { executionSnapshot: null, stepStatuses: {}, stepErrors: {}, executionRevision: state.executionRevision + 1 };
    const hasNewPreview = state.activePlan?.id !== snapshot.plan.id && ['preview', 'approving'].includes(state.planStatus);
    const plan: ActivePlan = {
      id: snapshot.plan.id,
      summary: snapshot.plan.summary || 'Quy trình đã lưu',
      steps: snapshot.plan.steps || snapshot.steps.map(row => ({ id: row.stepId, tool: row.tool, description: row.stepId, args: {} })),
    };
    return {
      executionSnapshot: snapshot,
      executionRevision: state.executionRevision + 1,
      executionLoadError: null,
      ...(hasNewPreview ? {} : { activePlan: plan, planStatus: snapshot.execution.status }),
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

  reset: () =>
    set((state) => ({
      conversationId: null,
      conversationArchived: false,
      messages: [],
      streamingText: '',
      isStreaming: false,
      activePlan: null,
      planStatus: 'idle',
      activeClarification: null,
      gatherState: null,
      stepStatuses: {},
      stepErrors: {},
      executionSnapshot: null,
      executionLoadError: null,
      executionRevision: state.executionRevision + 1,
      planRevision: state.planRevision + 1,
      conversations: state.conversations,
    })),
}));
