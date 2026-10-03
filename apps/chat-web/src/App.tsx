import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, lazy, Suspense } from "react";
import { useChatStore } from "./store/chat-store";
import { useSSE } from "./hooks/use-sse";
import { authStorage, subscribeAuthTokens } from "./services/auth-storage";
import { apiClient } from "./services/api-client";
import { ChatContainer } from "./components/ChatContainer";
import { PlanPreview } from "./components/PlanPreview";
import { ExecutionProgress } from "./components/ExecutionProgress";
import { PartialFailureModal } from "./components/PartialFailureModal";
import { Workspace } from "./views/Workspace";
import { PlanActions } from "./components/PlanPreview";
import { Modal } from "./components/Modal";
import { ViewBoundary } from "./components/ViewBoundary";
import { openConversation } from "./services/conversation-loader";
import { userError } from "./services/user-error";
import { RuntimeNotice } from "./components/RuntimeNotice";
const ServicesView = lazy(() => import("./views/ServicesView"));
const AccountSettingsView = lazy(() => import("./views/AccountSettingsView"));
type View = "landing" | "login" | "signup" | "verify-email" | "workspace" | "services" | "settings";
const SignupView = lazy(()=>import('./components/SignupView').then(module=>({default:module.SignupView})));
const VerifyEmailView = lazy(()=>import('./components/VerifyEmailView').then(module=>({default:module.VerifyEmailView})));
import { LoginView } from "./components/LoginView";
import { LandingPageView } from "./components/LandingPageView";

import { MissionControlLaunchpad } from "./components/MissionControlLaunchpad";
import { ReconciliationNotice } from "./components/ReconciliationNotice";
import { refreshExecutionSnapshot } from "./services/execution-snapshot";
import type { User } from "./types";

export interface AppProps {
  initialView?: "landing" | "login";
}

export const App: React.FC<AppProps> = ({ initialView }) => {
  const {
    conversationId,
    conversationArchived,
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

  const readView = (): View => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (
      view === "login" ||
      view === "signup" || view === "verify-email" ||
      view === "landing" ||
      view === "workspace" ||
      view === "services" || view === "settings"
    )
      return view;
    return initialView || "landing";
  };
  const [currentView, setCurrentView] = useState<View>(readView);
  const [routeVersion, setRouteVersion] = useState(0);
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = conversationId || "new";
  const updateDraft = useCallback((value: string) => {
    setDrafts((previous) => ({ ...previous, [draftKey]: value }));
  }, [draftKey]);
  const navigate = (view: View, id?: string | null) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", view);
    if (id) url.searchParams.set("c", id);
    else url.searchParams.delete("c");
    url.searchParams.delete("next");
    if (view !== "settings") url.searchParams.delete("section");
    url.hash = "";
    window.history.pushState({}, "", url);
    setCurrentView(view);
    setRouteVersion((v) => v + 1);
  };
  useEffect(() => {
    const pop = () => {
      setCurrentView(readView());
      setRouteVersion((v) => v + 1);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const [authToken, setAuthToken] = useState<string | null>(() => authStorage.getStoredTokens().accessToken);
  const [user, setUser] = useState<User | null>(() => authStorage.getStoredTokens().user);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [signupEnabled,setSignupEnabled] = useState<boolean|null>(null);
  const [verificationToken] = useState(()=>new URLSearchParams(window.location.search).get('token'));
  useLayoutEffect(() => {
    if (currentView === 'login' || currentView === 'signup' || currentView === 'verify-email') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [currentView]);
  useEffect(()=>{
    let active=true;
    apiClient.getAuthConfig().then(data=>{if(active)setSignupEnabled(data.signupEnabled);}).catch(()=>{if(active)setSignupEnabled(false);});
    return()=>{active=false;};
  },[]);
  const navigateAuth = (view:'login'|'signup') => {
    setAuthError(null);setPassword('');
    const url=new URL(window.location.href);url.searchParams.set('view',view);url.searchParams.delete('token');url.hash='';
    window.history.pushState({},'',url);setCurrentView(view);setRouteVersion(v=>v+1);
  };
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryPending = useRef(false);
  useEffect(() => {
    const protectedView = currentView === "workspace" || currentView === "services" || currentView === "settings";
    if (protectedView && !authToken) {
      const url = new URL(window.location.href);
      url.searchParams.set("next", currentView);
      url.searchParams.set("view", "login");
      url.hash = "";
      window.history.replaceState({}, "", url);
      setCurrentView("login");
    } else if ((currentView === "login" || currentView === "signup") && authToken) {
      const url = new URL(window.location.href);
      const destination = url.searchParams.get("next");
      const next = destination === "services" || destination === "settings" ? destination : "workspace";
      url.searchParams.set("view", next);
      url.searchParams.delete("next");
      window.history.replaceState({}, "", url);
      setCurrentView(next);
    }
  }, [authToken, currentView]);
  useEffect(() => {
    if (!authToken) setDrafts({});
  }, [authToken]);
  useEffect(() => {
    setRecoveryError(null);
  }, [conversationId, executionSnapshot?.plan.id]);

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
          console.warn("Session restore failed:", err);
          if (err?.status === 401) {
            authStorage.clearStoredTokens();
            setAuthToken(null);
            setUser(null);
          } else {
            setAuthError(userError(err));
          }
        });
    }
  }, []);

  const loginUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    setIsLoggingIn(true);
    try {
      const data = await apiClient.login(email, password);
      setAuthToken(data.accessToken);
      setUser(data.user);
      setPassword("");
      const route = new URLSearchParams(window.location.search);
      const next = route.get("next");
      navigate(next === "services" || next === "settings" ? next : "workspace", route.get("c"));
    } catch (err: any) {
      setAuthError(userError(err));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try { await apiClient.logout(); } catch { /* Local sign-out must remain available offline. */ }
    authStorage.clearStoredTokens();
    setAuthToken(null);
    setUser(null);
    reset();
    useChatStore.getState().setConversations([]);
    navigate("landing");
  };

  // Activate SSE connection for current conversation
  useSSE(conversationId, authToken);

  const handleNewConversation = async () => {
    try {
      const data = await apiClient.createConversation();
      if (!data.conversation?.id)
        throw new Error("Máy chủ chưa tạo được hội thoại.");
      reset();
      setConversationId(data.conversation.id);
      useChatStore
        .getState()
        .setConversations([
          data.conversation,
          ...useChatStore
            .getState()
            .conversations.filter((c) => c.id !== data.conversation.id),
        ]);
      navigate("workspace", data.conversation.id);
    } catch (err) {
      useChatStore.getState().addMessage({
        id: "new-error-" + Date.now(),
        role: "system",
        content: userError(err),
      });
    }
  };
  const handleSendMessage = async (content: string) => {
    if (useChatStore.getState().isStreaming) return;
    useChatStore.getState().setIsStreaming(true);
    let currentConvId = conversationId;
    if (!currentConvId) {
      try {
        const data = await apiClient.createConversation();
        currentConvId = data.conversation?.id;
        if (currentConvId) {
          setConversationId(currentConvId);
          navigate("workspace", currentConvId);
        }
      } catch (err) {
        console.warn("Could not create conversation via API:", err);
      }
      if (!currentConvId) {
        useChatStore.getState().addMessage({
          id: `err-${Date.now()}`,
          role: "system",
          content: "[Lỗi]: Không thể tạo phiên hội thoại mới trên máy chủ.",
        });
        useChatStore.getState().setIsStreaming(false);
        return;
      }
    }

    const tempId = `temp-${Date.now()}`;
    addOptimisticMessage({ id: tempId, content });

    try {
      const result = await apiClient.sendMessage(
        currentConvId,
        content,
        tempId,
      );
      useChatStore
        .getState()
        .confirmMessage(tempId, result?.messageId || tempId);
    } catch (err: any) {
      useChatStore.getState().setIsStreaming(false);
      useChatStore.getState().markMessageFailed(tempId);
      useChatStore.getState().addMessage({
        id: `err-${Date.now()}`,
        role: "system",
        content: `[Lỗi gửi tin nhắn]: ${err?.message || "Máy chủ từ chối yêu cầu"}`,
      });
    }
  };

  const handleApprovePlan = async () => {
    if (!activePlan?.id || planStatus === "approving") return;

    setPlanStatus("approving");
    const planId = activePlan.id;
    try {
      await apiClient.approvePlan(planId);
    } catch (err: any) {
      setPlanStatus("preview");
      useChatStore.getState().addMessage({
        id: `err-${Date.now()}`,
        role: "system",
        content: `[Lỗi phê duyệt kế hoạch]: ${err?.message || "Phê duyệt thất bại"}`,
      });
    }
  };

  const handleRejectPlan = async () => {
    if (!activePlan?.id) return;
    try {
      await apiClient.rejectPlan(activePlan.id);
      setActivePlan(null);
      setPlanStatus("rejected");
    } catch (err) {
      useChatStore.getState().addMessage({
        id: "reject-error-" + Date.now(),
        role: "system",
        content: "Không hủy được kế hoạch: " + userError(err),
      });
    }
  };
  const recover = async (
    action: "retry" | "skip" | "stop" | "continue",
    stepId?: string,
  ) => {
    const planId = executionSnapshot?.plan.id || activePlan?.id;
    const convId = conversationId;
    if (!planId || !convId || recoveryPending.current) return;
    if (
      executionSnapshot &&
      !executionSnapshot.recoveryActions.includes(action)
    )
      return;
    if (action === "retry" && stepId && stepStatuses[stepId] === "unknown")
      return;
    recoveryPending.current = true;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      if (action === "stop") await apiClient.stopExecution(planId);
      else if (action === "continue") await apiClient.continueExecution(planId);
      else if (stepId) {
        if (action === "retry") await apiClient.retryStep(planId, stepId);
        else await apiClient.skipStep(planId, stepId);
      }
      if (useChatStore.getState().conversationId === convId)
        await refreshExecutionSnapshot(convId, planId);
    } catch (err) {
      if (useChatStore.getState().conversationId === convId) {
        setRecoveryError(
          err instanceof Error
            ? err.message
            : "Không thể cập nhật quy trình. Hãy tải lại trạng thái trước khi quyết định.",
        );
      }
    } finally {
      recoveryPending.current = false;
      setRecoveryBusy(false);
    }
  };
  const handleRetry = (stepId: string) => recover("retry", stepId);
  const handleSkip = (stepId: string) => recover("skip", stepId);
  const handleStop = () => recover("stop");

  const handleEditPlan = () =>
    window.dispatchEvent(
      new CustomEvent("chat:prefill", {
        detail: { text: "Điều chỉnh kế hoạch: " },
      }),
    );

  const executionStatus = executionSnapshot?.execution.status || planStatus;
  const pausedStep = executionSnapshot?.steps.find(
    (step) => step.stepId === executionSnapshot.execution.pausedStepId,
  );
  const needsReconciliation =
    executionStatus === "reconciliation_required" ||
    (executionStatus === "partial" && pausedStep?.status === "unknown");
  const failedStepId =
    executionStatus === "partial"
      ? Object.entries(stepStatuses).find(([_, st]) => st === "failed")?.[0]
      : undefined;
  const progressPlan = executionSnapshot?.plan || activePlan;
  const failureId =
    pausedStep?.status === "failed" ? pausedStep.stepId : failedStepId;
  const failureStep = progressPlan?.steps?.find(
    (step) => step.id === failureId,
  );

  useEffect(() => {
    if (
      !authToken ||
      (currentView !== "workspace" && currentView !== "services" && currentView !== "settings")
    )
      return;
    const id = new URLSearchParams(window.location.search).get("c");
    if (id && id !== useChatStore.getState().conversationId)
      void openConversation(id);
  }, [authToken, currentView, routeVersion]);
  if (currentView === "landing")
    return (
      <LandingPageView
        onGoToServices={()=>navigate('services',conversationId)}
        isAuthenticated={Boolean(authToken)}
        onGoToLogin={() =>
          navigate(
            authToken ? "workspace" : "login",
            authToken ? conversationId : null,
          )
        }
      />
    );
  if(currentView==='verify-email') return <ViewBoundary label="xác minh email"><Suspense fallback={<p role="status">Đang mở trang xác minh…</p>}><VerifyEmailView token={verificationToken} onLogin={()=>navigateAuth('login')} onBackToLanding={()=>navigate('landing')}/></Suspense></ViewBoundary>;
  if(currentView==='signup'&&!authToken) return <ViewBoundary label="tạo tài khoản"><Suspense fallback={<p role="status">Đang mở trang tạo tài khoản…</p>}><SignupView signupEnabled={signupEnabled} onLogin={()=>navigateAuth('login')} onBackToLanding={()=>navigate('landing')}/></Suspense></ViewBoundary>;
  if (!authToken)
    return (
      <LoginView
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        isLoggingIn={isLoggingIn}
        authError={authError}
        onLogin={loginUser}
        onBackToLanding={() => navigate("landing")}
        signupEnabled={signupEnabled===true}
        onSignup={()=>navigateAuth('signup')}
      />
    );
  const preview = activePlan && ["preview", "approving"].includes(planStatus);
  const failureKey = `${progressPlan?.id}:${failureId}`;
  const mode = (import.meta as any).env?.VITE_RUNTIME_MODE;
  return (
    <Workspace
      user={user}
      services={currentView === "services"}
      settings={currentView === "settings"}
      onSettings={() => navigate("settings", conversationId)}
      onServices={() => navigate("services", conversationId)}
      onWorkspace={() => navigate("workspace", conversationId)}
      onNew={handleNewConversation}
      onLogout={handleLogout}
      onSelect={(id) => navigate("workspace", id)}
      onConversationRemoved={(id) => {
        if (useChatStore.getState().conversationId !== id) return;
        reset();
        navigate(currentView === "settings" ? "settings" : "workspace", null);
      }}
    >
      <RuntimeNotice mode={mode} />
      {authError && (
        <p role="alert" className="app-alert">
          {authError}
        </p>
      )}
      {conversationArchived && currentView === "workspace" && (
        <div className="archived-notice" role="status">
          <span>Hội thoại đã lưu trữ. Khôi phục để tiếp tục làm việc.</span>
          <button className="text-button" disabled={recoveryBusy} onClick={async () => {
            if (!conversationId) return;
            const restoringId = conversationId;
            setRecoveryBusy(true);
            try {
              await apiClient.restoreConversation(restoringId);
              if (useChatStore.getState().conversationId === restoringId)
                useChatStore.getState().setConversationArchived(false);
            } catch (error) {
              if (useChatStore.getState().conversationId === restoringId)
                setAuthError(userError(error));
            }
            finally { setRecoveryBusy(false); }
          }}>Khôi phục hội thoại</button>
        </div>
      )}
      {currentView === "services" ? (
        <ViewBoundary>
          <Suspense
            fallback={
              <div className="services-body">
                <div className="skeleton-card" role="status">
                  Đang mở dịch vụ…
                  <div className="skeleton" />
                </div>
              </div>
            }
          >
            <ServicesView />
          </Suspense>
        </ViewBoundary>
      ) : currentView === "settings" ? (
        <ViewBoundary key="settings" label="cài đặt tài khoản">
          <Suspense fallback={<div className="settings-loading"><div className="skeleton-card" role="status">Đang mở cài đặt…<div className="skeleton" /></div></div>}>
            <AccountSettingsView
              user={user}
              mode={mode}
              currentConversationId={conversationId}
              onOpenConversation={(id) => navigate("workspace", id)}
              onConversationRemoved={(id) => {
                if (useChatStore.getState().conversationId !== id) return;
                reset();
                navigate("settings", null);
              }}
              onServices={() => navigate("services", conversationId)}
              onLogout={handleLogout}
            />
          </Suspense>
        </ViewBoundary>
      ) : (
        <ChatContainer
          draft={drafts[draftKey] || ""}
          onDraftChange={updateDraft}
          messages={messages}
          onSendMessage={handleSendMessage}
          streamingText={streamingText}
          isStreaming={isStreaming}
          busy={planStatus === "approving" || planStatus === "executing"}
          readOnly={conversationArchived}
          actions={
            preview && !conversationArchived && (
              <PlanActions
                plan={activePlan}
                isApproving={planStatus === "approving"}
                onApprove={handleApprovePlan}
                onEdit={handleEditPlan}
                onCancel={handleRejectPlan}
              />
            )
          }
        >
          {messages.length === 0 && !conversationArchived && (
            <MissionControlLaunchpad onSendMessage={handleSendMessage} />
          )}
          {preview && (
            <PlanPreview
              plan={activePlan}
              isApproving={planStatus === "approving"}
              hideActions
            />
          )}
          {executionLoadError && (
            <p role="alert" className="app-alert">
              Không tải được trạng thái thực thi: {executionLoadError}. Hãy mở
              lại hội thoại.
            </p>
          )}
          {executionSnapshot && needsReconciliation && (
            <ReconciliationNotice
              snapshot={executionSnapshot}
              busy={recoveryBusy}
              error={recoveryError}
              onSkip={handleSkip}
              onStop={() => setConfirmStop(true)}
              onContinue={() => recover("continue")}
            />
          )}
          {executionStatus === "completed" && (
            <p role="status" className="execution-summary">
              Quy trình đã hoàn thành.
            </p>
          )}
          {executionStatus === "stopped" && (
            <p role="status" className="execution-summary">
              Quy trình đã dừng.
            </p>
          )}
          {recoveryError && !needsReconciliation && (
            <p role="alert" className="field-error">
              {recoveryError}
            </p>
          )}
          {progressPlan && Object.keys(stepStatuses).length > 0 && (
            <ExecutionProgress
              steps={(
                progressPlan.steps ||
                executionSnapshot?.steps.map((row) => ({
                  id: row.stepId,
                  tool: row.tool,
                  description: row.stepId,
                })) ||
                []
              ).map((st) => {
                const saved = executionSnapshot?.steps.find(
                  (row) => row.stepId === st.id,
                );
                return {
                  id: st.id,
                  tool: st.tool,
                  description: st.description,
                  status: stepStatuses[st.id] || "pending",
                  error: stepErrors[st.id],
                  duration:
                    saved?.durationMs != null
                      ? `${saved.durationMs / 1000}s`
                      : undefined,
                  output:
                    saved?.output != null
                      ? JSON.stringify(saved.output)
                      : undefined,
                };
              })}
            />
          )}
          {progressPlan && !["preview", "approving"].includes(planStatus) && (
            <details className="approved-plan">
              <summary>Kế hoạch đã duyệt</summary>
              <PlanPreview
                plan={{
                  id: progressPlan.id,
                  summary: progressPlan.summary || "Kế hoạch đã duyệt",
                  steps: progressPlan.steps || [],
                }}
                readOnly
                hideActions
              />
            </details>
          )}
          {failureId && !needsReconciliation && (
            <>
              <div className="recovery-note">
                Quy trình tạm dừng tại {failureId}.{" "}
                <button
                  className="btn"
                  onClick={() => setDismissedFailure(null)}
                >
                  Xem cách xử lý
                </button>
              </div>
              {dismissedFailure !== failureKey && (
                <PartialFailureModal
                  key={failureKey}
                  stepId={failureId}
                  tool={failureStep?.tool || pausedStep?.tool || "unknown"}
                  errorMessage={stepErrors[failureId] || "Lỗi thực thi bước"}
                  stepArgs={failureStep?.args}
                  prompt={failureStep?.description}
                  busy={recoveryBusy}
                  allowEdit={false}
                  allowedActions={executionSnapshot?.recoveryActions.filter(
                    (a): a is "retry" | "skip" | "stop" => a !== "continue",
                  )}
                  onRetry={() => handleRetry(failureId)}
                  onEditAndRetry={() => handleRetry(failureId)}
                  onSkip={() => handleSkip(failureId)}
                  onStop={handleStop}
                  onClose={() => setDismissedFailure(failureKey)}
                />
              )}
            </>
          )}
        </ChatContainer>
      )}
      {confirmStop && (
        <Modal
          title="Dừng hẳn quy trình?"
          onClose={() => setConfirmStop(false)}
        >
          <p>
            Không thể chạy tiếp sau khi dừng. Các thay đổi đã tạo được giữ lại.
          </p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => setConfirmStop(false)}>
              Quay lại
            </button>
            <button
              className="btn primary"
              disabled={recoveryBusy}
              onClick={() => {
                setConfirmStop(false);
                void handleStop();
              }}
            >
              Xác nhận dừng
            </button>
          </div>
        </Modal>
      )}
    </Workspace>
  );
};
export default App;
