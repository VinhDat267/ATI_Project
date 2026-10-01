import { create } from 'zustand';
import type {
  ChatMessage,
  ActivePlan,
  StepState,
  Conversation,
  PlanStatus,
  ClarificationState,
  GatherState,
} from '../types';

export interface ChatStoreState {
  conversationId: string | null;
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
  reset: () => void;
}

const initialState = {
  conversationId: null,
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
};

export const useChatStore = create<ChatStoreState>((set) => ({
  ...initialState,

  setConversationId: (id) => set({ conversationId: id }),
  setConversations: (conversations) => set({ conversations }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

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

  setActivePlan: (plan) => set({ activePlan: plan }),

  setPlanStatus: (status) => set({ planStatus: status }),

  setClarification: (clarification) =>
    set({ activeClarification: clarification }),

  setGatherState: (gather) =>
    set((state) => ({
      gatherState:
        typeof gather === 'function' ? gather(state.gatherState) : gather,
    })),

  updateStepStatus: (stepId, status, error) =>
    set((state) => ({
      stepStatuses: { ...state.stepStatuses, [stepId]: status },
      stepErrors: error
        ? { ...state.stepErrors, [stepId]: error }
        : state.stepErrors,
    })),

  reset: () =>
    set((state) => ({
      conversationId: null,
      messages: [],
      streamingText: '',
      isStreaming: false,
      activePlan: null,
      planStatus: 'idle',
      activeClarification: null,
      gatherState: null,
      stepStatuses: {},
      stepErrors: {},
      conversations: state.conversations,
    })),
}));
