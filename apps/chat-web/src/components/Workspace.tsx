import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../store/chat-store';
import { useSSE } from '../hooks/use-sse';
import { apiClient } from '../services/api-client';
import { Cockpit } from './Cockpit';
import { savedArguments } from '../pages/Cockpit/RecoveryMoment';
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
export const Workspace: React.FC<WorkspaceProps> = ({ authToken, user, onLogout, authError, onClearAuthError, route, navigate }) => {
  const {
    conversationId,
    activePlan,
    planStatus,
    executionSnapshot,
    setConversationId,
    addOptimisticMessage,
    setActivePlan,
    setPlanStatus,
    reset,
  } = useChatStore();


  const [actionError, setActionError] = useState<string | null>(null);

  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(false);
  const currentRoute = useRef(route);
  currentRoute.current = route;
  const workspaceMounted = useRef(true);
  const unsentDraftRequest = useRef<string | null>(null);
  useEffect(() => {
    workspaceMounted.current = true;
    return () => {
      workspaceMounted.current = false;
      if (unsentDraftRequest.current) {
        useChatStore.getState().setIsPlanning(false, null, unsentDraftRequest.current);
        unsentDraftRequest.current = null;
      }
    };
  }, []);
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
    if (authToken) void loadServices();
    else { serviceRequest.current++; setServices([]); }
    return () => { serviceRequest.current++; };
  }, [authToken, loadServices]);
  const { recover, recoveryBusy, recoveryError } = useExecutionRecovery();
  const history = useConversationHistory(route.kind === 'conversation' ? route.conversationId : null);



  // Activate SSE connection for current conversation
  const { disconnected } = useSSE(conversationId, authToken);

  // A message sent before "Cuộc hội thoại mới" gets its ID belongs to that conversation (FE-03b).
  const newConversation = useRef<Promise<string | null> | null>(null);
  const handleNewConversation = async () => {
    if (newConversation.current) return;
    const previous = useChatStore.getState();
    const previousRoute = route;
    setActionError(null);
    reset({ preservePlanning: true });
    setConversationId(null);
    navigate('/');
    const request = (async () => {
      const data = await apiClient.createConversation();
      if (!workspaceMounted.current) return null;
      const newConv = data.conversation;
      if (!newConv?.id) throw new Error('Máy chủ không trả về phiên hội thoại hợp lệ.');
      if (currentRoute.current.kind === 'home' && useChatStore.getState().conversationId === null) {
        setConversationId(newConv.id);
        navigate(conversationPath(newConv.id), true);
      }
      useChatStore.getState().setConversations([
        newConv, ...useChatStore.getState().conversations.filter(c => c.id !== newConv.id),
      ]);
      return newConv.id as string;
    })();
    newConversation.current = request.catch(() => null);
    try { await request; }
    catch (error) {
      if (!workspaceMounted.current) return;
      if (currentRoute.current.kind === 'home' && useChatStore.getState().conversationId === null) {
        useChatStore.setState({
          messages: previous.messages, streamingText: previous.streamingText, isStreaming: previous.isStreaming,
          activePlan: previous.activePlan, planStatus: previous.planStatus,
          activeClarification: previous.activeClarification, gatherState: previous.gatherState,
          stepStatuses: previous.stepStatuses, stepErrors: previous.stepErrors,
          executionSnapshot: previous.executionSnapshot, executionLoadError: previous.executionLoadError,
          retiredExecutionPlanId: previous.retiredExecutionPlanId,
        });
        setConversationId(previous.conversationId);
        if (previousRoute.kind === 'conversation') navigate(conversationPath(previousRoute.conversationId));
      }
      setActionError(userErrorMessage(error));
    }
    finally { newConversation.current = null; }
  };

  const handleSendMessage = async (content: string) => {
    const tempId = `temp-${crypto.randomUUID()}`;
    const pendingConversation = newConversation.current;
    let currentConvId = route.kind === 'conversation' ? route.conversationId : null;
    if (!useChatStore.getState().beginPlanning(currentConvId, tempId)) return;
    if (!currentConvId) {
      unsentDraftRequest.current = tempId;
      try {
        if (pendingConversation) currentConvId = await pendingConversation;
        else currentConvId = (await apiClient.createConversation()).conversation?.id;
        if (!workspaceMounted.current) return;
        if (currentConvId) {
          useChatStore.getState().transferPlanning(null, currentConvId, tempId);
          if (unsentDraftRequest.current === tempId) unsentDraftRequest.current = null;
          if (currentRoute.current.kind === 'home' && useChatStore.getState().conversationId === null) {
            setConversationId(currentConvId);
            navigate(conversationPath(currentConvId));
          }
        }
      } catch (err) {
        if (!workspaceMounted.current) return;
        console.warn('Could not create conversation via API:', err);
      }
      if (!currentConvId) {
        if (currentRoute.current.kind === 'home') useChatStore.getState().addMessage({
          id: `err-${Date.now()}`,
          role: 'system',
          content: '[Lỗi]: Không thể tạo phiên hội thoại mới trên máy chủ.',
        });
        useChatStore.getState().setIsPlanning(false, null, tempId);
        if (unsentDraftRequest.current === tempId) unsentDraftRequest.current = null;
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
      if (!workspaceMounted.current) return;
      if (store.conversationId === currentConvId) store.confirmMessage(tempId, result?.messageId || tempId);
    } catch (err: any) {
      const store = useChatStore.getState();
      const ownsAttempt = store.planningByConversation[currentConvId]?.requestId === tempId;
      store.setIsPlanning(false, currentConvId, tempId);
      if (!workspaceMounted.current || store.conversationId !== currentConvId || !ownsAttempt) return;
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
    const owner = conversationId;
    const revision = useChatStore.getState().planRevision;
    try {
      await apiClient.approvePlan(planId);
    } catch (err: any) {
      const current = useChatStore.getState();
      if (!workspaceMounted.current || current.conversationId !== owner || current.activePlan?.id !== planId || current.planRevision !== revision || current.planStatus !== 'approving') return;
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
    const owner = conversationId;
    const planId = activePlan.id;
    const revision = useChatStore.getState().planRevision;
    try {
      await apiClient.rejectPlan(planId);
      const current = useChatStore.getState();
      if (!workspaceMounted.current || current.conversationId !== owner || current.activePlan?.id !== planId || current.planRevision !== revision) return;
      setActivePlan(null); setPlanStatus('rejected');
    } catch (error) { const current = useChatStore.getState(); if (workspaceMounted.current && current.conversationId === owner && current.activePlan?.id === planId && current.planRevision === revision) setActionError(userErrorMessage(error)); }
  };

  const handleRetry = (stepId: string) => recover('retry', stepId);
  const handleSkip = (stepId: string) => recover('skip', stepId);
  const handleStop = () => recover('stop');



  const handleEditRecovery = async (stepId: string, args: Record<string, unknown>, prompt?: string) => {
    const owner = useChatStore.getState().conversationId;
    const planId = executionSnapshot?.plan.id;
    if (!owner || !planId || !executionSnapshot?.recoveryActions.includes('retry')) return;
    const stopped = await recover('stop');
    const current = useChatStore.getState();
    if (!stopped || !workspaceMounted.current || current.conversationId !== owner || current.executionSnapshot?.plan.id !== planId || current.executionSnapshot.execution.status !== 'stopped') return;
    const remaining = executionSnapshot.plan.steps?.filter(step => executionSnapshot.steps.find(row=>row.stepId===step.id)?.status==='pending').map(step=>({...step,args:savedArguments(step.args,executionSnapshot)}));
    handleSendMessage(`Sửa việc ${stepId} của kế hoạch đã dừng. Chỉ lập kế hoạch cho việc lỗi và các việc chưa làm; không chạy lại việc đã xong. Yêu cầu: ${prompt || ''}. Tham số sửa: ${JSON.stringify(args)}. Các việc chưa làm: ${JSON.stringify(remaining ?? [])}`);
  };

  return (
    <div className="workspace w-full min-w-0">
      <div className="min-w-0">
        {authError && <div role="alert" className="bg-warning-tint px-4 py-2 flex justify-between"><span>{authError}</span><button type="button" onClick={onClearAuthError} aria-label="Đóng thông báo đăng nhập">✕</button></div>}
        {disconnected && <p role="status" className="bg-warning-tint px-4 py-2 text-warning-text">Mất kết nối, đang thử lại…</p>}
        {actionError && <p role="alert" className="px-4 py-2 text-danger-text">{actionError}</p>}
        <div className="contents">
          <Cockpit user={user} onLogout={onLogout} navigate={navigate} services={services} servicesLoading={servicesLoading} servicesError={servicesError}
            contentOverride={history.error || route.kind === 'not-found' ? <NotFoundView message={history.error || undefined} onGoHome={() => navigate('/')} /> : history.loading ? <p role="status" className="p-6">Đang tải hội thoại...</p> : undefined}
            onSendMessage={handleSendMessage} onNewConversation={handleNewConversation}
            onSelectConversation={id => navigate(conversationPath(id))} onSettings={() => navigate('/settings')}
            onApprove={handleApprovePlan} onCancel={handleRejectPlan}
            recovery={{busy:recoveryBusy,error:recoveryError,onRetry:handleRetry,onSkip:handleSkip,onStop:handleStop,onContinue:()=>recover('continue'),onEdit:handleEditRecovery}} />
        </div>
      </div>
    </div>
  );
};
export default Workspace;
