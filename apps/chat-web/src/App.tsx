import React, { useState, useEffect, useRef } from 'react';
import { useChatStore } from './store/chat-store';
import { useSSE } from './hooks/use-sse';
import { authStorage, subscribeAuthTokens } from './services/auth-storage';
import { apiClient } from './services/api-client';
import { ChatContainer } from './components/ChatContainer';
import { PlanPreview } from './components/PlanPreview';
import { ExecutionProgress } from './components/ExecutionProgress';
import { PartialFailureModal } from './components/PartialFailureModal';
import { SettingsModal } from './components/SettingsModal';
import { LoginView } from './components/LoginView';
import { LandingPageView } from './components/LandingPageView';
import { SidebarHistory } from './components/layout/SidebarHistory';
import { UserNavMenu } from './components/layout/UserNavMenu';
import { MissionControlLaunchpad } from './components/MissionControlLaunchpad';
import { ReconciliationNotice } from './components/ReconciliationNotice';
import { refreshExecutionSnapshot } from './services/execution-snapshot';
import type { User } from './types';

export interface AppProps {
  initialView?: 'landing' | 'login';
}

export const App: React.FC<AppProps> = ({ initialView }) => {
  const {
    conversationId,
    messages,
    streamingText,
    isStreaming,
    activePlan,
    planStatus,
    stepStatuses,
    stepErrors,
    executionSnapshot,
    executionLoadError,
    setConversationId,
    addOptimisticMessage,
    setActivePlan,
    setPlanStatus,
    reset,
  } = useChatStore();

  const [currentView, setCurrentView] = useState<'landing' | 'login'>(() => {
    if (initialView) return initialView;
    if (typeof window !== 'undefined' && window.location?.search) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('view') === 'login') return 'login';
      if (params.get('view') === 'landing') return 'landing';
    }
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return 'login';
    }
    return 'landing';
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryPending = useRef(false);
  useEffect(() => { setRecoveryError(null); }, [conversationId, executionSnapshot?.plan.id]);

  // Subscribe to auth token updates to keep React state and SSE in sync
  useEffect(() => {
    const unsub = subscribeAuthTokens((tokens) => {
      setAuthToken(tokens.accessToken);
      if (tokens.user) {
        setUser(tokens.user);
      } else if (!tokens.accessToken) {
        setUser(null);
      }
    });
    return unsub;
  }, []);

  // Restore stored session on mount
  useEffect(() => {
    const { accessToken, user: storedUser } = authStorage.getStoredTokens();
    if (accessToken) {
      setAuthToken(accessToken);
      if (storedUser) {
        setUser(storedUser);
      }
      apiClient
        .getMe()
        .then((data) => {
          if (data?.user) {
            setUser(data.user);
            authStorage.setStoredTokens({ user: data.user });
          }
        })
        .catch((err) => {
          console.warn('Session restore failed:', err);
          authStorage.clearStoredTokens();
          setAuthToken(null);
          setUser(null);
        });
    }
  }, []);

  // Close mobile sidebar drawer on Escape key press
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen]);

  const loginUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);
    try {
      const data = await apiClient.login(email, password);
      setAuthToken(data.accessToken);
      setUser(data.user);
      setPassword('');
    } catch (err: any) {
      setAuthError(err.message || 'Không thể xác thực với API backend');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    authStorage.clearStoredTokens();
    setAuthToken(null);
    setUser(null);
    reset();
    useChatStore.getState().setConversations([]);
    setCurrentView('landing');
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('view');
      window.history.pushState({}, '', url.toString());
    }
  };

  // Activate SSE connection for current conversation
  useSSE(conversationId, authToken);

  const handleNewConversation = async () => {
    reset();
    try {
      const data = await apiClient.createConversation();
      const newConv = data.conversation;
      if (newConv?.id) {
        setConversationId(newConv.id);
        useChatStore.getState().setConversations([
          newConv,
          ...useChatStore.getState().conversations.filter((c) => c.id !== newConv.id),
        ]);
        return;
      }
    } catch (err) {
      console.warn('Could not create conversation via API:', err);
    }
    setConversationId(`conv-${Date.now()}`);
  };

  const handleSendMessage = async (content: string) => {
    let currentConvId = conversationId;
    if (!currentConvId) {
      try {
        const data = await apiClient.createConversation();
        currentConvId = data.conversation?.id;
        if (currentConvId) {
          setConversationId(currentConvId);
        }
      } catch (err) {
        console.warn('Could not create conversation via API:', err);
      }
      if (!currentConvId) {
        useChatStore.getState().addMessage({
          id: `err-${Date.now()}`,
          role: 'system',
          content: '[Lỗi]: Không thể tạo phiên hội thoại mới trên máy chủ.',
        });
        return;
      }
    }

    const tempId = `temp-${Date.now()}`;
    addOptimisticMessage({ id: tempId, content });

    try {
      const result = await apiClient.sendMessage(
        currentConvId,
        content,
        tempId
      );
      useChatStore
        .getState()
        .confirmMessage(tempId, result?.messageId || tempId);
    } catch (err: any) {
      useChatStore.getState().markMessageFailed(tempId);
      useChatStore.getState().addMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: `[Lỗi gửi tin nhắn]: ${err?.message || 'Máy chủ từ chối yêu cầu'}`,
      });
    }
  };

  const handleApprovePlan = async () => {
    if (!activePlan || planStatus === 'approving') return;

    setPlanStatus('approving');
    const planId = activePlan.id || 'plan_default';
    try {
      await apiClient.approvePlan(planId);
    } catch (err: any) {
      setPlanStatus('preview');
      useChatStore.getState().addMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: `[Lỗi phê duyệt kế hoạch]: ${err?.message || 'Phê duyệt thất bại'}`,
      });
    }
  };

  const handleRejectPlan = async () => {
    if (!activePlan) return;
    const planId = activePlan.id;
    try {
      if (planId) {
        await apiClient.rejectPlan(planId);
      }
    } catch (err) {
      console.warn('Reject plan API call failed:', err);
    }
    setActivePlan(null);
    setPlanStatus('rejected');
  };

  const recover = async (action: 'retry' | 'skip' | 'stop', stepId?: string) => {
    const planId = executionSnapshot?.plan.id || activePlan?.id;
    const convId = conversationId;
    if (!planId || !convId || recoveryPending.current) return;
    if (executionSnapshot && !executionSnapshot.recoveryActions.includes(action)) return;
    if (action === 'retry' && stepId && stepStatuses[stepId] === 'unknown') return;
    recoveryPending.current = true;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      if (action === 'stop') await apiClient.stopExecution(planId);
      else if (stepId) {
        if (action === 'retry') await apiClient.retryStep(planId, stepId);
        else await apiClient.skipStep(planId, stepId);
      }
      if (useChatStore.getState().conversationId === convId) await refreshExecutionSnapshot(convId, planId);
    } catch (err) {
      if (useChatStore.getState().conversationId === convId) {
        setRecoveryError(err instanceof Error ? err.message : 'Không thể cập nhật quy trình. Hãy tải lại trạng thái trước khi quyết định.');
      }
    } finally {
      recoveryPending.current = false;
      setRecoveryBusy(false);
    }
  };
  const handleRetry = (stepId: string) => recover('retry', stepId);
  const handleSkip = (stepId: string) => recover('skip', stepId);
  const handleStop = () => recover('stop');

  const handleEditPlan = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('chat:prefill', {
          detail: { text: 'Điều chỉnh kế hoạch: ' },
        })
      );
    }
    const chatInput = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '#chat-input, input[placeholder*="Mô tả công việc"], textarea[placeholder*="Mô tả công việc"], [aria-label*="Mô tả công việc"]'
    );
    if (chatInput) {
      const nativeSetter =
        Object.getOwnPropertyDescriptor(window.HTMLInputElement?.prototype || {}, 'value')?.set ||
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement?.prototype || {}, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(chatInput, 'Điều chỉnh kế hoạch: ');
      } else {
        chatInput.value = 'Điều chỉnh kế hoạch: ';
      }
      chatInput.dispatchEvent(new Event('input', { bubbles: true }));
      chatInput.dispatchEvent(new Event('change', { bubbles: true }));
      chatInput.focus();
      chatInput.setSelectionRange?.(chatInput.value.length, chatInput.value.length);
    }
  };

  const executionStatus = executionSnapshot?.execution.status || planStatus;
  const failedStepId = executionStatus === 'partial' ? Object.entries(stepStatuses).find(
    ([_, st]) => st === 'failed'
  )?.[0] : undefined;
  const progressPlan = executionSnapshot?.plan || activePlan;

  if (!authToken) {
    if (currentView === 'landing') {
      return (
        <LandingPageView
          onGoToLogin={() => {
            setCurrentView('login');
            if (typeof window !== 'undefined' && window.history?.pushState) {
              const url = new URL(window.location.href);
              url.searchParams.set('view', 'login');
              window.history.pushState({}, '', url.toString());
            }
          }}
        />
      );
    }

    return (
      <LoginView
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        isLoggingIn={isLoggingIn}
        authError={authError}
        onLogin={loginUser}
        onQuickFillAdmin={() => {
          setEmail((import.meta as any).env?.VITE_DEFAULT_ADMIN_EMAIL || 'admin@localhost.test');
          setPassword((import.meta as any).env?.VITE_DEFAULT_ADMIN_PASSWORD || 'Admin@12345678');
        }}
        onBackToLanding={() => {
          setCurrentView('landing');
          if (typeof window !== 'undefined' && window.history?.pushState) {
            const url = new URL(window.location.href);
            url.searchParams.delete('view');
            window.history.pushState({}, '', url.toString());
          }
        }}
      />
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-[#1d1d1f]">
      {/* Mobile sidebar backdrop overlay */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 bg-black/30 backdrop-blur-xs z-30 cursor-pointer md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar for Desktop & Mobile Drawer */}
      <div
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 bg-[#f5f5f7] border-r border-zinc-200 flex flex-col justify-between transition-transform transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-4 flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center justify-between mb-4 shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#0071e3] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                AI
              </div>
              <span className="font-semibold text-sm tracking-tight text-zinc-900">
                AI Workflow Platform
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="md:hidden text-zinc-400 hover:text-zinc-600 text-sm"
            >
              ✕
            </button>
          </div>

          <button
            type="button"
            onClick={handleNewConversation}
            className="w-full bg-[#0071e3] text-white text-xs font-medium py-2.5 px-4 rounded-full shadow-xs hover:bg-blue-600 transition flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <span>+</span>
            <span>Cuộc hội thoại mới</span>
          </button>

          <SidebarHistory
            currentConversationId={conversationId}
            onCloseMobileSidebar={() => setIsSidebarOpen(false)}
          />
        </div>

        <UserNavMenu
          user={user}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={handleLogout}
        />
      </div>

      {/* Main Chat Workspace */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
        {/* Top bar */}
        <div className="h-14 border-b border-zinc-200 px-4 md:px-6 flex items-center justify-between bg-white z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Mở danh sách hội thoại"
              className="md:hidden p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-600"
            >
              ☰
            </button>
            <h1 className="font-semibold text-sm md:text-base text-zinc-900">
              AI Workflow Platform
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Mở cài đặt dịch vụ"
              className="text-xs text-zinc-600 border border-zinc-200 hover:bg-zinc-50 px-3 py-1.5 rounded-full transition cursor-pointer flex items-center gap-1.5"
            >
              <span>⚙️</span>
              <span className="hidden sm:inline">Cài đặt dịch vụ</span>
            </button>
          </div>
        </div>

        {authError && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-800 flex items-center justify-between">
            <span>⚠️ {authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-amber-600 hover:text-amber-800 font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Chat Feed */}
        <div className="flex-1 overflow-hidden relative">
          <ChatContainer
            messages={messages}
            onSendMessage={handleSendMessage}
            streamingText={streamingText}
            isStreaming={isStreaming}
          >
            {/* Mission Control Launchpad when no messages */}
            {messages.length === 0 && (
              <MissionControlLaunchpad onSendMessage={handleSendMessage} />
            )}

            {/* Plan Preview Card */}
            {activePlan && ['preview', 'approving'].includes(planStatus) && (
              <PlanPreview
                plan={activePlan}
                isApproving={planStatus === 'approving'}
                onApprove={handleApprovePlan}
                onEdit={handleEditPlan}
                onCancel={handleRejectPlan}
              />
            )}

            {/* Live Execution Progress Card */}
            {executionLoadError && <p role="alert" className="my-3 text-sm text-red-700">Không tải được trạng thái thực thi: {executionLoadError}. Hãy mở lại hội thoại.</p>}
            {executionSnapshot && executionStatus === 'reconciliation_required' && <ReconciliationNotice
              snapshot={executionSnapshot} busy={recoveryBusy} error={recoveryError} onSkip={handleSkip} onStop={handleStop} />}
            {executionStatus === 'completed' && <p role="status" className="mt-4 text-sm text-green-700">Quy trình đã hoàn thành.</p>}
            {executionStatus === 'stopped' && <p role="status" className="mt-4 text-sm text-zinc-700">Quy trình đã dừng.</p>}
            {recoveryError && executionStatus !== 'reconciliation_required' && <p role="alert" className="text-sm text-red-700">{recoveryError}</p>}
            {progressPlan && Object.keys(stepStatuses).length > 0 && (
              <ExecutionProgress
                steps={(progressPlan.steps || executionSnapshot?.steps.map(row => ({ id: row.stepId, tool: row.tool, description: row.stepId })) || []).map((st) => {
                  const saved = executionSnapshot?.steps.find(row => row.stepId === st.id);
                  return ({
                  id: st.id,
                  tool: st.tool,
                  description: st.description,
                  status: stepStatuses[st.id] || 'pending',
                  error: stepErrors[st.id],
                  duration: saved?.durationMs != null ? `${saved.durationMs / 1000}s` : undefined,
                  output: saved?.output != null ? JSON.stringify(saved.output) : undefined,
                }); })}
              />
            )}

            {/* Partial Failure Recovery Modal */}
            {failedStepId && (
              <PartialFailureModal
                busy={recoveryBusy}
                allowedActions={executionSnapshot?.recoveryActions}
                allowEdit={false}
                stepId={failedStepId}
                tool={
                  activePlan?.steps.find((s) => s.id === failedStepId)?.tool ||
                  'unknown'
                }
                errorMessage={
                  stepErrors[failedStepId] || 'Lỗi thực thi bước'
                }
                stepArgs={
                  activePlan?.steps.find((s) => s.id === failedStepId)?.args
                }
                prompt={
                  (activePlan?.steps.find((s) => s.id === failedStepId)?.args?.prompt as string) ||
                  activePlan?.steps.find((s) => s.id === failedStepId)?.description
                }
                onRetry={() => handleRetry(failedStepId)}
                onEditAndRetry={() => handleRetry(failedStepId)}
                onSkip={() => handleSkip(failedStepId)}
                onStop={handleStop}
                onClose={handleStop}
              />
            )}
          </ChatContainer>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        authToken={authToken}
      />
    </div>
  );
};

export default App;
