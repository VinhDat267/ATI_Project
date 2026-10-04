import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../store/chat-store';
import { useSSE } from '../hooks/use-sse';
import { apiClient } from '../services/api-client';
import { ChatContainer } from '../components/ChatContainer';
import { PlanPreview } from '../components/PlanPreview';
import { ExecutionProgress } from '../components/ExecutionProgress';
import { PartialFailureModal } from '../components/PartialFailureModal';
import { SettingsModal } from '../components/SettingsModal';
import { SidebarHistory } from '../components/layout/SidebarHistory';
import { UserNavMenu } from '../components/layout/UserNavMenu';
import { MissionControlLaunchpad } from '../components/MissionControlLaunchpad';
import { ReconciliationNotice } from '../components/ReconciliationNotice';
import { userErrorMessage } from '../services/user-error';
import type { ServiceInfo, User } from '../types';

import { useExecutionRecovery } from '../hooks/use-execution-recovery';
import { useConversationHistory } from '../hooks/use-conversation-history';
import { conversationPath, type AppRoute } from '../routes';
import { NotFoundView } from '../views/NotFoundView';

interface WorkspaceProps {
  authToken: string; user: User | null; authError: string | null;
  onClearAuthError: () => void; onLogout: () => void;
  route: AppRoute; navigate: (path: string, replace?: boolean) => void;
}
export const Workspace: React.FC<WorkspaceProps> = ({ authToken, user, authError, onClearAuthError, onLogout, route, navigate }) => {
  const {
    conversationId,
    messages,
    streamingText,
    isStreaming,
    isPlanning,
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

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeMode, setRuntimeMode] = useState<'sandbox' | 'live' | null>(null);
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(false);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const serviceRequest = useRef(0);
  const loadServices = useCallback(async () => {
    const request = ++serviceRequest.current;
    setServicesLoading(true);
    try {
      const data = await apiClient.getServices();
      if (!Array.isArray(data?.services)) throw new Error('Không tải được danh mục dịch vụ.');
      if (request === serviceRequest.current) { setServices(data.services); setServicesError(null); }
    } catch (error) {
      if (request === serviceRequest.current) { setServices([]); setServicesError(userErrorMessage(error)); }
    } finally { if (request === serviceRequest.current) setServicesLoading(false); }
  }, []);
  useEffect(() => {
    let current = true;
    apiClient.getRuntime().then(data => {
      if (current && ['sandbox', 'live'].includes(data?.runtimeMode)) setRuntimeMode(data.runtimeMode);
    }).catch(() => { if (current) setRuntimeMode(null); }).finally(() => { if (current) setRuntimeLoading(false); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    if (authToken) void loadServices();
    else { serviceRequest.current++; setServices([]); }
    return () => { serviceRequest.current++; };
  }, [authToken, loadServices]);
  const { recover, recoveryBusy, recoveryError } = useExecutionRecovery();
  const history = useConversationHistory(route.kind === 'conversation' ? route.conversationId : null);

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

  // Activate SSE connection for current conversation
  const { disconnected } = useSSE(conversationId, authToken);

  const handleNewConversation = async () => {
    setActionError(null);
    try {
      const data = await apiClient.createConversation();
      const newConv = data.conversation;
      if (!newConv?.id) throw new Error('Máy chủ không trả về phiên hội thoại hợp lệ.');
      reset({ preservePlanning: true });
      setConversationId(newConv.id);
      navigate(conversationPath(newConv.id));
      useChatStore.getState().setConversations([
        newConv, ...useChatStore.getState().conversations.filter(c => c.id !== newConv.id),
      ]);
    } catch (error) { setActionError(userErrorMessage(error)); }
  };

  const handleSendMessage = async (content: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    let currentConvId = route.kind === 'conversation' ? route.conversationId : null;
    if (!useChatStore.getState().beginPlanning(currentConvId, tempId)) return;
    if (!currentConvId) {
      try {
        const data = await apiClient.createConversation();
        currentConvId = data.conversation?.id;
        if (currentConvId) {
          useChatStore.getState().transferPlanning(null, currentConvId, tempId);
          if (currentRoute.current.kind === 'home' && useChatStore.getState().conversationId === null) {
            setConversationId(currentConvId);
            navigate(conversationPath(currentConvId));
          }
        }
      } catch (err) {
        console.warn('Could not create conversation via API:', err);
      }
      if (!currentConvId) {
        if (currentRoute.current.kind === 'home') useChatStore.getState().addMessage({
          id: `err-${Date.now()}`,
          role: 'system',
          content: '[Lỗi]: Không thể tạo phiên hội thoại mới trên máy chủ.',
        });
        useChatStore.getState().setIsPlanning(false, null, tempId);
        return;
      }
    }

    if (useChatStore.getState().conversationId === currentConvId) addOptimisticMessage({ id: tempId, content });

    try {
      const result = await apiClient.sendMessage(
        currentConvId,
        content,
        tempId
      );
      const store = useChatStore.getState();
      store.confirmPlanningRequest(currentConvId, tempId, result?.messageId || tempId);
      if (store.conversationId === currentConvId) store.confirmMessage(tempId, result?.messageId || tempId);
    } catch (err: any) {
      const store = useChatStore.getState();
      const ownsAttempt = store.planningByConversation[currentConvId]?.requestId === tempId;
      store.setIsPlanning(false, currentConvId, tempId);
      if (store.conversationId !== currentConvId || !ownsAttempt) return;
      store.markMessageFailed(tempId);
      store.addMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: `[Lỗi gửi tin nhắn]: ${userErrorMessage(err, 'Máy chủ từ chối yêu cầu')}`,
      });
    }
  };

  const handleApprovePlan = async () => {
    if (!activePlan?.id || planStatus === 'approving') return;

    setPlanStatus('approving');
    const planId = activePlan.id;
    try {
      await apiClient.approvePlan(planId);
    } catch (err: any) {
      setPlanStatus('preview');
      useChatStore.getState().addMessage({
        id: `err-${Date.now()}`,
        role: 'system',
        content: `[Lỗi phê duyệt kế hoạch]: ${userErrorMessage(err, 'Phê duyệt thất bại')}`,
      });
    }
  };

  const handleRejectPlan = async () => {
    if (!activePlan?.id) { setActionError('Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại.'); return; }
    setActionError(null);
    try {
      await apiClient.rejectPlan(activePlan.id);
      setActivePlan(null); setPlanStatus('rejected');
    } catch (error) { setActionError(userErrorMessage(error)); }
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

  };

  const executionStatus = executionSnapshot?.execution.status || planStatus;
  const pausedStep = executionSnapshot?.steps.find(step => step.stepId === executionSnapshot.execution.pausedStepId);
  const needsReconciliation = executionStatus === 'reconciliation_required' ||
    (executionStatus === 'partial' && pausedStep?.status === 'unknown');
  const failedStepId = executionStatus === 'partial' ? Object.entries(stepStatuses).find(
    ([_, st]) => st === 'failed'
  )?.[0] : undefined;
  const progressPlan = executionSnapshot?.plan || activePlan;
  const failureId = pausedStep?.status === 'failed' ? pausedStep.stepId : failedStepId;
  const failureKey = `${conversationId}:${progressPlan?.id}:${failureId}`;
  const failureStep = progressPlan?.steps?.find(step => step.id === failureId);

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-white text-[#1d1d1f]">
      {/* Mobile sidebar backdrop overlay */}
      {isSidebarOpen && (
        <div
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 bg-black/30 backdrop-blur-xs z-30 cursor-pointer md:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar for Desktop & Mobile Drawer */}
      <aside aria-label="Danh sách hội thoại"
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
              aria-label="Đóng danh sách hội thoại"
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
            onSelectConversation={id => navigate(conversationPath(id))}
            onCloseMobileSidebar={() => setIsSidebarOpen(false)}
          />
        </div>

        <UserNavMenu
          user={user}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onLogout={onLogout}
        />
      </aside>

      {/* Main Chat Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-white">
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
              onClick={onClearAuthError}
              aria-label="Đóng thông báo đăng nhập"
              className="text-amber-600 hover:text-amber-800 font-bold ml-2 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {runtimeMode === 'sandbox' && <p role="status" className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-900">Chế độ thử nghiệm: kế hoạch mẫu, không gọi dịch vụ thật</p>}
        {runtimeMode === null && !runtimeLoading && <p role="status" className="px-4 py-2 text-xs text-zinc-600">Chưa xác định được chế độ chạy của máy chủ.</p>}
        {disconnected && <p role="status" className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900">Mất kết nối, đang thử lại…</p>}
        {actionError && <p role="alert" className="px-4 py-2 text-sm text-red-700">{actionError}</p>}
        {/* Chat Feed */}
        <div className="flex-1 overflow-hidden relative">
          {history.error || route.kind === 'not-found' ? <NotFoundView message={history.error || undefined} onGoHome={() => navigate('/')} /> : history.loading ? <p role="status" className="p-6 text-sm">Đang tải hội thoại...</p> : <ChatContainer
            messages={messages}
            onSendMessage={handleSendMessage}
            streamingText={streamingText}
            isStreaming={isStreaming}
            isPlanning={isPlanning}
          >
            {/* Mission Control Launchpad when no messages */}
            {messages.length === 0 && (
              <MissionControlLaunchpad onSendMessage={handleSendMessage} services={services} runtimeMode={runtimeMode} loading={servicesLoading} error={servicesError} />
            )}

            {/* Plan Preview Card */}
            {activePlan && ['preview', 'approving'].includes(planStatus) && (
              <PlanPreview
                plan={activePlan}
                isApproving={planStatus === 'approving'}
                approvalDisabled={!activePlan.id}
                onApprove={handleApprovePlan}
                onEdit={handleEditPlan}
                onCancel={handleRejectPlan}
              />
            )}

            {activePlan && !['preview', 'approving', 'idle', 'rejected'].includes(planStatus) && <details className="my-3"><summary className="cursor-pointer text-sm">Kế hoạch đã duyệt: {activePlan.summary}</summary><PlanPreview plan={activePlan} /></details>}
            {activePlan && !activePlan.id && <p role="alert">Kế hoạch thiếu mã định danh hợp lệ. Hãy tải lại hội thoại trước khi duyệt.</p>}
            {failureId && !needsReconciliation && dismissedFailure === failureKey && <div role="status" className="my-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
              <p>Quy trình vẫn đang tạm dừng tại bước {failureId}.</p>
              <button type="button" onClick={() => setDismissedFailure(null)} className="text-blue-700 p-2">Mở lại xử lý lỗi</button>
            </div>}
            {/* Live Execution Progress Card */}
            {executionLoadError && <p role="alert" className="my-3 text-sm text-red-700">Không tải được trạng thái thực thi: {executionLoadError}. Hãy mở lại hội thoại.</p>}
            {executionSnapshot && needsReconciliation && <ReconciliationNotice
              snapshot={executionSnapshot} busy={recoveryBusy} error={recoveryError} onSkip={handleSkip} onStop={handleStop} onContinue={() => recover('continue')} />}
            {executionStatus === 'completed' && <p role="status" className="mt-4 text-sm text-green-700">Quy trình đã hoàn thành.</p>}
            {executionStatus === 'stopped' && <p role="status" className="mt-4 text-sm text-zinc-700">Quy trình đã dừng.</p>}
            {recoveryError && !needsReconciliation && <p role="alert" className="text-sm text-red-700">{recoveryError}</p>}
            {progressPlan && Object.keys(stepStatuses).length > 0 && (
              <ExecutionProgress
                status={executionStatus}
                steps={(progressPlan.steps || executionSnapshot?.steps.map(row => ({ id: row.stepId, tool: row.tool, description: row.stepId })) || []).map((st) => {
                  const saved = executionSnapshot?.steps.find(row => row.stepId === st.id);
                  return ({
                  id: st.id,
                  tool: st.tool,
                  description: st.description,
                  status: stepStatuses[st.id] || 'pending',
                  error: stepErrors[st.id],
                  duration: saved?.durationMs != null ? `${saved.durationMs / 1000}s` : undefined,
                  output: saved?.output,
                  completedAt: saved?.completedAt,
                }); })}
              />
            )}

            {/* Partial Failure Recovery Modal */}
            {failureId && !needsReconciliation && dismissedFailure !== failureKey && (
              <PartialFailureModal
                busy={recoveryBusy}
                allowedActions={executionSnapshot?.recoveryActions.filter((action): action is 'retry' | 'skip' | 'stop' => action !== 'continue')}
                allowEdit={false}
                stepId={failureId}
                tool={failureStep?.tool || pausedStep?.tool || 'unknown'}
                errorMessage={
                  stepErrors[failureId] || 'Lỗi thực thi bước'
                }
                stepArgs={
                  failureStep?.args
                }
                prompt={
                  (typeof failureStep?.args?.prompt === 'string' ? failureStep.args.prompt : undefined) || failureStep?.description
                }
                onRetry={() => handleRetry(failureId)}
                onEditAndRetry={() => handleRetry(failureId)}
                onSkip={() => handleSkip(failureId)}
                onStop={handleStop}
                onClose={() => setDismissedFailure(failureKey)}
              />
            )}
          </ChatContainer>}
        </div>
      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        authToken={authToken}
        onServicesChanged={loadServices}
      />
    </div>
  );
};

export default Workspace;
