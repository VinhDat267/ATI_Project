import React, { useState, useEffect } from 'react';
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
    setConversationId,
    addOptimisticMessage,
    setActivePlan,
    setPlanStatus,
    updateStepStatus,
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

  const handleRetry = async (stepId: string) => {
    updateStepStatus(stepId, 'running');
    if (activePlan?.id) {
      try {
        await apiClient.retryStep(activePlan.id, stepId);
      } catch (err) {
        console.warn('Retry API call failed, running locally:', err);
      }
    }
  };

  const handleSkip = async (stepId: string) => {
    updateStepStatus(stepId, 'skipped');
    if (activePlan?.id) {
      try {
        await apiClient.skipStep(activePlan.id, stepId);
      } catch (err) {
        console.warn('Skip API call failed, running locally:', err);
      }
    }
  };

  const handleStop = async () => {
    if (activePlan?.id) {
      try {
        await apiClient.stopExecution(activePlan.id);
      } catch (err) {
        console.warn('Stop API call failed:', err);
      }
    }
  };

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

  const failedStepId = Object.entries(stepStatuses).find(
    ([_, st]) => st === 'failed'
  )?.[0];

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
            {/* Empty state prompt chips */}
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center max-w-xl mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-200 text-[#0071e3] flex items-center justify-center text-xl mb-4 shadow-xs">
                  ✨
                </div>
                <h2 className="text-xl font-bold text-zinc-900 mb-2">
                  Bạn muốn điều phối tác vụ nào hôm nay?
                </h2>
                <p className="text-xs text-zinc-500 mb-6">
                  Nền tảng tự động hóa quy trình đa dịch vụ — bạn luôn có toàn quyền kiểm duyệt trước khi chạy và dữ liệu luôn được bảo vệ an toàn.
                </p>

                <div className="flex flex-wrap gap-2 justify-center">
                  <button
                    type="button"
                    onClick={() =>
                      handleSendMessage(
                        'Tạo task cập nhật landing page cho Minh trên Trello board Frontend và báo Slack channel #general'
                      )
                    }
                    className="text-xs bg-[#fafafc] border border-zinc-200 hover:border-blue-400 hover:bg-blue-50/40 text-zinc-700 px-3.5 py-2 rounded-full transition shadow-2xs"
                  >
                    ✨ Tạo công việc trên Trello, phân công nhân sự và thông báo qua Slack
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleSendMessage(
                        'Kiểm tra danh sách boards trên Trello và các channels trên Slack'
                      )
                    }
                    className="text-xs bg-[#fafafc] border border-zinc-200 hover:border-blue-400 hover:bg-blue-50/40 text-zinc-700 px-3.5 py-2 rounded-full transition shadow-2xs"
                  >
                    🔍 Kiểm tra danh sách bảng việc Trello và kênh Slack liên kết
                  </button>
                </div>
              </div>
            )}

            {/* Plan Preview Card */}
            {activePlan && (
              <PlanPreview
                plan={activePlan}
                isApproving={planStatus === 'approving'}
                onApprove={handleApprovePlan}
                onEdit={handleEditPlan}
                onCancel={handleRejectPlan}
              />
            )}

            {/* Live Execution Progress Card */}
            {activePlan && Object.keys(stepStatuses).length > 0 && (
              <ExecutionProgress
                steps={activePlan.steps.map((st) => ({
                  id: st.id,
                  tool: st.tool,
                  description: st.description,
                  status: stepStatuses[st.id] || 'pending',
                  error: stepErrors[st.id],
                }))}
              />
            )}

            {/* Partial Failure Recovery Modal */}
            {failedStepId && (
              <PartialFailureModal
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
                onEditAndRetry={(updatedArgs, updatedPrompt) => {
                  if (activePlan) {
                    const updatedSteps = activePlan.steps.map((s) => {
                      if (s.id === failedStepId) {
                        const newArgs = updatedArgs ? { ...updatedArgs } : { ...s.args };
                        if (updatedPrompt && ('prompt' in newArgs || !updatedArgs)) {
                          newArgs.prompt = updatedPrompt;
                        }
                        return {
                          ...s,
                          args: newArgs,
                          description: updatedPrompt || s.description,
                        };
                      }
                      return s;
                    });
                    setActivePlan({ ...activePlan, steps: updatedSteps });
                  }
                  handleRetry(failedStepId);
                }}
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
