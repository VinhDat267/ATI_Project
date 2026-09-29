import React, { useState } from 'react';
import { useChatStore } from './store/chat-store';
import { useSSE } from './hooks/use-sse';
import { ChatContainer } from './components/ChatContainer';
import { PlanPreview } from './components/PlanPreview';
import { ExecutionProgress } from './components/ExecutionProgress';
import { PartialFailureModal } from './components/PartialFailureModal';
import { SettingsModal } from './components/SettingsModal';

export const App: React.FC = () => {
  const {
    conversationId,
    messages,
    streamingText,
    isStreaming,
    activePlan,
    stepStatuses,
    stepErrors,
    setConversationId,
    addOptimisticMessage,
    setActivePlan,
    updateStepStatus,
    reset,
  } = useChatStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [authToken] = useState('demo-token');

  // Activate SSE connection for current conversation
  useSSE(conversationId, authToken);

  const handleSendMessage = async (content: string) => {
    let currentConvId = conversationId;
    if (!currentConvId) {
      currentConvId = `conv-${Date.now()}`;
      setConversationId(currentConvId);
    }

    const tempId = `temp-${Date.now()}`;
    addOptimisticMessage({ id: tempId, content });

    try {
      const res = await fetch(`/api/conversations/${currentConvId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ content, tempId }),
      });

      if (!res.ok && res.status !== 202) {
        useChatStore.getState().markMessageFailed(tempId);
      }
    } catch {
      // In offline / preview mode without backend running, simulate mock response
      setTimeout(() => {
        useChatStore.getState().confirmMessage(tempId, `msg-${Date.now()}`);
        setActivePlan({
          summary: 'Kế hoạch thực thi liên dịch vụ',
          thinking:
            'AI đã phân tích yêu cầu, khảo sát các board Trello và xác nhận member Minh Dev. Kế hoạch tạo thẻ trước và thông báo vào Slack.',
          steps: [
            {
              id: 'step_1',
              tool: 'trello.create_card',
              description: 'Tạo thẻ trên board Frontend',
              args: { name: content, idList: 'list_todo' },
            },
            {
              id: 'step_2',
              tool: 'trello.add_member',
              description: 'Gán người phụ trách Minh Dev',
              args: { idCard: '$step_1.output.id', idMember: 'mem_minh' },
              dependsOn: ['step_1'],
            },
            {
              id: 'step_3',
              tool: 'slack.send_message',
              description: 'Gửi thông báo kênh Slack #general',
              args: { channel: '#general', text: 'Task mới đã tạo' },
              dependsOn: ['step_2'],
            },
          ],
        });
      }, 800);
    }
  };

  const handleApprovePlan = async () => {
    if (!activePlan || !conversationId) return;

    try {
      await fetch(`/api/conversations/${conversationId}/plan/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });
    } catch {
      // Preview mode simulation
      updateStepStatus('step_1', 'running');
      setTimeout(() => updateStepStatus('step_1', 'succeeded'), 1200);
      setTimeout(() => updateStepStatus('step_2', 'running'), 1400);
      setTimeout(() => updateStepStatus('step_2', 'failed', 'HTTP 404 Member Not Found'), 2500);
    }
  };

  const failedStepId = Object.entries(stepStatuses).find(
    ([_, st]) => st === 'failed'
  )?.[0];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white text-[#1d1d1f]">
      {/* Sidebar for Desktop & Mobile Drawer */}
      <div
        className={`fixed md:static inset-y-0 left-0 z-40 w-72 bg-[#f5f5f7] border-r border-zinc-200 flex flex-col justify-between transition-transform transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#0071e3] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                AI
              </div>
              <span className="font-semibold text-sm tracking-tight text-zinc-900">
                AI Workflow v3
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
            onClick={() => {
              reset();
              setConversationId(`conv-${Date.now()}`);
            }}
            className="w-full bg-[#0071e3] text-white text-xs font-medium py-2.5 px-4 rounded-full shadow-xs hover:bg-blue-600 transition flex items-center justify-center gap-1.5"
          >
            <span>+</span>
            <span>Cuộc hội thoại mới</span>
          </button>

          {/* Conversation history items */}
          <div className="mt-6">
            <span className="text-[11px] font-semibold text-zinc-400 tracking-wider uppercase px-1">
              Hôm nay
            </span>
            <div className="mt-2 flex flex-col gap-1">
              <div className="bg-white border border-zinc-200/80 rounded-xl p-2.5 shadow-2xs border-l-2 border-l-[#0071e3] text-xs font-medium text-zinc-800 flex justify-between items-center cursor-pointer">
                <span className="truncate">Tạo card Trello cho Sprint 32</span>
                <span className="text-[10px] text-zinc-400 ml-2">10:42</span>
              </div>
              <div className="hover:bg-zinc-200/50 rounded-xl p-2.5 text-xs text-zinc-600 flex justify-between items-center cursor-pointer transition">
                <span className="truncate">Báo cáo Slack daily standup</span>
                <span className="text-[10px] text-zinc-400 ml-2">Hôm qua</span>
              </div>
            </div>
          </div>
        </div>

        {/* User profile row */}
        <div className="p-4 border-t border-zinc-200/70 flex items-center justify-between bg-zinc-100/40">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-zinc-300 text-zinc-700 flex items-center justify-center font-bold text-xs">
              AO
            </div>
            <div className="text-xs font-medium text-zinc-800">
              Admin Operator
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="text-zinc-500 hover:text-zinc-800 text-xs cursor-pointer"
          >
            ⚙️ Cài đặt
          </button>
        </div>
      </div>

      {/* Main Chat Workspace */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-white">
        {/* Top bar */}
        <div className="h-14 border-b border-zinc-200 px-4 md:px-6 flex items-center justify-between bg-white z-10 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
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
              className="text-xs text-zinc-600 border border-zinc-200 hover:bg-zinc-50 px-3 py-1.5 rounded-full transition cursor-pointer flex items-center gap-1.5"
            >
              <span>⚙️</span>
              <span className="hidden sm:inline">Cài đặt dịch vụ</span>
            </button>
          </div>
        </div>

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
                  Nền tảng tự động hóa quy trình liên dịch vụ với cơ chế kiểm soát Human-in-the-Loop và Write Safety.
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
                    ✨ Tạo task Trello gán member và notify Slack
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
                    🔍 Khảo sát các boards và channels liên kết
                  </button>
                </div>
              </div>
            )}

            {/* Plan Preview Card */}
            {activePlan && (
              <PlanPreview
                plan={activePlan}
                onApprove={handleApprovePlan}
                onEdit={() => {}}
                onCancel={() => setActivePlan(null)}
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
                onRetry={() => updateStepStatus(failedStepId, 'running')}
                onEditAndRetry={() => updateStepStatus(failedStepId, 'running')}
                onSkip={() => updateStepStatus(failedStepId, 'skipped')}
                onStop={() => updateStepStatus(failedStepId, 'paused')}
              />
            )}
          </ChatContainer>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
};

export default App;
