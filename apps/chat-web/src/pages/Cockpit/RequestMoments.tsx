// Source: AppStagePage.tsx moments 1–2. Content comes from the registered catalog and gatherState.
import { useState, useEffect, useRef, type KeyboardEvent, type RefObject, type ReactNode } from 'react';
import { getServiceDefinition } from '@wap/tool-schemas';
import { toolDefinition } from '../../services/tool-definitions';
import { ServiceLogo } from '../../components/ServiceLogo';
import presentation from '../../assets/cockpit-services.json';
import type { ServiceInfo, GatherState } from '../../types';
import { RequestEcho, useScheduledOrigin } from './RequestEcho';
import { multiServicePlaybooks } from './presentation';
import { getActiveWorkspaceSummary, setActiveWorkspaceId, subscribeWorkspace } from '../../services/workspace-storage';
import { authStorage } from '../../services/auth-storage';
import {
  loadPlaybooks,
  savePlaybook,
  deletePlaybook,
  type CustomPlaybook,
} from '../../services/playbook-storage';
import { CORE_JOBS, evaluateJobReadiness } from '../../services/job-readiness';
import {
  loadWorkflowDefaults,
  saveWorkflowDefaults,
  clearWorkflowDefaults,
  type WorkflowResourceDefaults,
} from '../../services/workflow-defaults-storage';
export interface SendWorkflowContext {
  templateId?: string;
  resourceDefaults?: Record<string, Record<string, string>>;
}
interface Props {
  services: ServiceInfo[];
  loading: boolean;
  error: string | null;
  draft: string;
  planning: boolean;
  input: RefObject<HTMLTextAreaElement | null>;
  inputHidden?: boolean;
  feedback?: ReactNode;
  /** PBI-03: thẻ hội thoại đã lưu; khi có, tiêu đề mời tiếp tục thay vì bắt đầu mới. */
  resume?: ReactNode;
  onDraft: (value: string) => void;
  onSend: (value: string, workflowContext?: SendWorkflowContext) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSettings: () => void;
  navigate: (path: string) => void;
  servicePrompt: (service: ServiceInfo) => string;
}
const connections = {
  healthy: 'Kết nối tốt',
  unhealthy: 'Không kết nối được',
  unchecked: 'Chưa kiểm tra',
  unconfigured: 'Chưa kết nối',
};
// Presentation metadata uses the same service-keyed asset table as logos and prompts.
interface CardColors { icon: string; decoration: string; name: string; logo?: string }
const cardColors: Record<string, CardColors> = Object.fromEntries(
  Object.entries(presentation.services).map(([id, asset]) => [id, asset.suggestion]),
);
const neutralCard: CardColors = {
  icon: 'bg-neutral-100 border-neutral-200',
  decoration: 'bg-neutral-900/5 group-hover:bg-neutral-900/10',
  name: 'text-neutral-800',
  logo: 'text-neutral-900',
};

export function extractPlaybookVariables(text: string): string[] {
  const vars: string[] = [];
  const regex = /\{\{\s*([^}{]+?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]?.trim();
    if (name && !vars.includes(name)) {
      vars.push(name);
    }
  }
  return vars;
}

export function applyPlaybookVariables(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([^}{]+?)\s*\}\}/g, (full, rawName: string) => {
    const name = rawName.trim();
    const val = values[name]?.trim();
    return val ? val : full;
  });
}

export function RequestMoment({
  services,
  loading,
  error,
  draft,
  planning,
  input,
  inputHidden,
  feedback,
  resume,
  onDraft,
  onSend,
  onKeyDown,
  onSettings,
  navigate,
  servicePrompt,
}: Props) {
  const [workspace, setWorkspace] = useState(getActiveWorkspaceSummary());
  const [currentUser, setCurrentUser] = useState(() => authStorage.getStoredTokens().user);
  const userId = currentUser?.id ?? 'anonymous';
  const workspaceKey = workspace?.id || 'personal';
  const saveModalScopeRef = useRef<{ userId: string; workspaceKey: string } | null>(null);

  const [customPlaybooks, setCustomPlaybooks] = useState<CustomPlaybook[]>(() =>
    loadPlaybooks(userId, workspaceKey)
  );
  const [activeDefaults, setActiveDefaults] = useState<WorkflowResourceDefaults | null>(() =>
    loadWorkflowDefaults(userId, workspaceKey)
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [defaultsEditorOpen, setDefaultsEditorOpen] = useState(false);
  const [defaultRepoInput, setDefaultRepoInput] = useState('');
  const [defaultSlackInput, setDefaultSlackInput] = useState('');
  const [templateText, setTemplateText] = useState<string>(() => draft);
  const [composerTab, setComposerTab] = useState<'template' | 'preview'>('template');
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [savingPlaybookOpen, setSavingPlaybookOpen] = useState(false);
  const [newPlaybookTitle, setNewPlaybookTitle] = useState('');
  const [savedToast, setSavedToast] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribeWs = subscribeWorkspace(() => {
      const nextWs = getActiveWorkspaceSummary();
      const nextWsKey = nextWs?.id || 'personal';
      setWorkspace(nextWs);
      const user = authStorage.getStoredTokens().user;
      const nextUserId = user?.id ?? 'anonymous';
      setCustomPlaybooks(loadPlaybooks(nextUserId, nextWsKey));
      if (
        saveModalScopeRef.current &&
        (saveModalScopeRef.current.userId !== nextUserId ||
          saveModalScopeRef.current.workspaceKey !== nextWsKey)
      ) {
        setSavingPlaybookOpen(false);
        saveModalScopeRef.current = null;
      }
    });
    const unsubscribeAuth = authStorage.subscribeAuthTokens((tokens) => {
      setCurrentUser(tokens.user);
      const nextUserId = tokens.user?.id ?? 'anonymous';
      if (
        saveModalScopeRef.current &&
        saveModalScopeRef.current.userId !== nextUserId
      ) {
        setSavingPlaybookOpen(false);
        saveModalScopeRef.current = null;
      }
    });
    return () => {
      unsubscribeWs();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    setCustomPlaybooks(loadPlaybooks(userId, workspaceKey));
    setActiveDefaults(loadWorkflowDefaults(userId, workspaceKey));
    if (
      saveModalScopeRef.current &&
      (saveModalScopeRef.current.userId !== userId ||
        saveModalScopeRef.current.workspaceKey !== workspaceKey)
    ) {
      setSavingPlaybookOpen(false);
      saveModalScopeRef.current = null;
    }
  }, [userId, workspaceKey]);

  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem('ati_prefill_prompt');
      if (prefill) {
        sessionStorage.removeItem('ati_prefill_prompt');
        setTemplateText(prefill);
        setVariableValues({});
        setValidationError(null);
        onDraft(prefill);
        input.current?.focus();
      }
    } catch {
      // ignore storage errors
    }
  }, [onDraft, input]);

  useEffect(() => {
    if (draft && !templateText) {
      setTemplateText(draft);
    }
  }, [draft, templateText]);

  const templateVariables = extractPlaybookVariables(templateText || draft);

  const handleSelectPlaybook = (promptText: string, templateId?: string) => {
    setTemplateText(promptText);
    setSelectedTemplateId(templateId ?? null);
    setVariableValues({});
    setValidationError(null);
    setComposerTab('template');
    onDraft(promptText);
    input.current?.focus();
  };

  const handleVariableChange = (varName: string, value: string) => {
    const base = templateText || draft;
    const nextValues = { ...variableValues, [varName]: value };
    setVariableValues(nextValues);
    setValidationError(null);
    onDraft(applyPlaybookVariables(base, nextValues));
  };

  const handleInsertVariableToken = () => {
    const currentBase = templateText || draft;
    const nextIdx = extractPlaybookVariables(currentBase).length + 1;
    const token = nextIdx === 1 ? '{{tên_dự_án}}' : nextIdx === 2 ? '{{email_khách}}' : `{{biến_${nextIdx}}}`;
    const updated = currentBase ? `${currentBase.trimEnd()} ${token}` : token;
    setTemplateText(updated);
    setComposerTab('template');
    const rendered = applyPlaybookVariables(updated, variableValues);
    onDraft(rendered);
    input.current?.focus();
  };

  const handleSend = () => {
    const currentTemplate = templateText || draft;
    const vars = extractPlaybookVariables(currentTemplate);
    const unfulfilled = vars.filter((v) => !variableValues[v]?.trim());
    if (unfulfilled.length > 0) {
      setValidationError(
        `Vui lòng điền đủ các biến số còn thiếu: ${unfulfilled.map((v) => `{{${v}}}`).join(', ')}`
      );
      return;
    }
    setValidationError(null);
    const rendered = applyPlaybookVariables(currentTemplate, variableValues);
    const hasDefaults = Boolean(activeDefaults && Object.keys(activeDefaults).length > 0);
    if (selectedTemplateId || hasDefaults) {
      onSend(rendered, {
        ...(selectedTemplateId ? { templateId: selectedTemplateId } : {}),
        ...(hasDefaults ? { resourceDefaults: activeDefaults as Record<string, Record<string, string>> } : {}),
      });
    } else {
      onSend(rendered);
    }
  };

  const handleOpenSavePlaybook = () => {
    const sourceText = (templateText || draft).trim();
    if (!sourceText) return;
    const defaultTitle =
      sourceText.length > 42 ? `${sourceText.slice(0, 42).trim()}…` : sourceText;
    saveModalScopeRef.current = { userId, workspaceKey };
    setNewPlaybookTitle(defaultTitle);
    setSavingPlaybookOpen(true);
  };

  const handleConfirmSavePlaybook = () => {
    if (
      saveModalScopeRef.current &&
      (saveModalScopeRef.current.userId !== userId ||
        saveModalScopeRef.current.workspaceKey !== workspaceKey)
    ) {
      setSavingPlaybookOpen(false);
      saveModalScopeRef.current = null;
      setSavedToast('Phiên làm việc hoặc tài khoản đã thay đổi. Vui lòng thử lưu lại.');
      setTimeout(() => setSavedToast(null), 5000);
      return;
    }
    const sourceText = (templateText || draft).trim();
    const title = newPlaybookTitle.trim();
    if (!sourceText || !title) return;
    const configuredIds = services.filter((s) => s.configured).map((s) => s.id);
    const lower = sourceText.toLowerCase();
    const matchedServices = configuredIds.filter((id) => {
      if (id === 'mycalendar' || id === 'calendar') return /calendar|lịch|họp|meet/i.test(lower);
      if (id === 'mysheets' || id === 'sheets') return /sheet|bảng tính|drive|docs|tài liệu|thư mục/i.test(lower);
      if (id === 'myjira' || id === 'jira') return /jira|ticket|sprint/i.test(lower);
      return lower.includes(id);
    });
    const playbookServices =
      matchedServices.length > 0 ? matchedServices.slice(0, 5) : configuredIds.slice(0, 3);
    const created: CustomPlaybook = {
      id: `custom-pb-${Date.now()}`,
      title,
      prompt: sourceText,
      services: playbookServices.length > 0 ? playbookServices : ['calendar', 'sheets'],
      isCustom: true,
    };
    const res = savePlaybook(userId, workspaceKey, created);
    if (!res.success) {
      setSavedToast(res.error || 'Không thể lưu mẫu');
      setTimeout(() => setSavedToast(null), 5000);
      return;
    }
    setCustomPlaybooks(loadPlaybooks(userId, workspaceKey));
    setSavingPlaybookOpen(false);
    setNewPlaybookTitle('');
    setSavedToast(`Đã lưu Playbook "${title}"`);
    setTimeout(() => setSavedToast(null), 3000);
  };

  const handleDeleteCustomPlaybook = (id: string) => {
    deletePlaybook(userId, workspaceKey, id);
    setCustomPlaybooks(loadPlaybooks(userId, workspaceKey));
  };

  return (
    <section
      id="moment-1"
      className="stage-section is-active v3-space-y-8"
      data-moment="1"
      aria-label="Cockpit"
    >
      {/* Context Pill & Guidance Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-3.5 rounded-xl border border-[#E7E7E2] bg-white shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xl flex-shrink-0">{workspace.id === 'personal' ? '👤' : '🏢'}</span>
          <div className="text-xs leading-relaxed min-w-0">
            <div className="font-semibold text-[#111827] flex items-center gap-1.5 flex-wrap">
              <span>Đang làm việc tại:</span>
              <span className="text-[#FF5701]">{workspace.name}</span>
            </div>
            <p className="text-[#6B7280] text-[11px] truncate">
              {workspace.id === 'personal'
                ? `(${services.some((s) => s.id === 'gmail') ? 'Gmail, ' : ''}Lịch, Trang tính, Trello & công cụ riêng của bạn)`
                : '(Sử dụng kết nối chung của nhóm & dịch vụ đã cấp quyền)'}
            </p>
          </div>
        </div>
        {workspace.id === 'personal' ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveWorkspaceId('personal');
                navigate('/settings');
              }}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border border-[#E7E7E2] bg-[#F8F8F6] text-[#4B5563] hover:text-[#111827] hover:bg-neutral-100 transition-colors"
            >
              Kết nối công cụ cá nhân
            </button>
          </div>
        ) : services.some((s) => s.id === 'myjira' && s.configured) ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              data-testid="jira-context-ready-pill"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-[#0052CC] border border-blue-200"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#0052CC]" />
              <span>Jira OAuth 3LO: Sẵn sàng</span>
            </span>
          </div>
        ) : null}
      </div>

      <div className="v3-space-y-3 text-center sm:text-left">
        <h1
          id="heading-moment-1"
          className="font-display text-4xl sm:text-5xl lg:text-[52px] text-brand-text font-normal tracking-tight leading-[1.12]"
          tabIndex={-1}
        >
          {resume ? 'Tiếp tục hội thoại này' : 'Hôm nay bạn muốn nhờ việc gì?'}
        </h1>
        <p className="text-base sm:text-lg text-brand-muted max-w-2xl leading-relaxed">
          {resume
            ? 'Xem lại yêu cầu trước bên dưới, rồi gửi tiếp hoặc mô tả việc mới.'
            : 'Mô tả bằng lời thường điều bạn cần. Tôi sẽ tự chia việc, lên kế hoạch và thao tác trên các công cụ của nhóm.'}
        </p>
      </div>
      {resume}
      {feedback}
      {/* Large Input Area */}
      <form
        aria-label="Nhập yêu cầu"
        aria-busy={planning}
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        className="relative bg-white rounded-2xl border border-brand-border shadow-soft-card p-3 sm:p-4 focus-within:border-brand-primary focus-within:shadow-orange-glow transition-all"
      >
        <label htmlFor="prompt-input" className="sr-only">
          Nội dung bạn muốn nhờ
        </label>{' '}
        {templateVariables.length > 0 && (
          <div className="flex items-center gap-1.5 mb-2">
            <button
              type="button"
              data-testid="tab-template-mode"
              onClick={() => setComposerTab('template')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                composerTab === 'template'
                  ? 'bg-[#FF5701] text-white shadow-xs'
                  : 'bg-[#F4F4F0] text-[#4B5563] hover:bg-[#EAEAE5]'
              }`}
            >
              Mẫu ({templateVariables.length} biến)
            </button>
            <button
              type="button"
              data-testid="tab-preview-mode"
              onClick={() => setComposerTab('preview')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                composerTab === 'preview'
                  ? 'bg-[#FF5701] text-white shadow-xs'
                  : 'bg-[#F4F4F0] text-[#4B5563] hover:bg-[#EAEAE5]'
              }`}
            >
              Nội dung sẽ gửi (Xem trước)
            </button>
          </div>
        )}
        {!inputHidden && (
          <textarea
            ref={input}
            id="prompt-input"
            rows={3}
            value={composerTab === 'preview' ? draft : (templateText || draft)}
            readOnly={composerTab === 'preview'}
            onChange={(event) => {
              const nextVal = event.target.value;
              setTemplateText(nextVal);
              setValidationError(null);
              const rendered = applyPlaybookVariables(nextVal, variableValues);
              onDraft(rendered);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              } else {
                onKeyDown(event);
              }
            }}
            aria-label="Mô tả công việc bạn muốn thực hiện"
            className="w-full text-base sm:text-lg text-brand-text placeholder-neutral-400 bg-transparent resize-none border-0 focus:ring-0 focus:v3-outline-none p-1"
            placeholder="Ví dụ: Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack..."
          />
        )}{' '}
        {validationError && (
          <div
            role="alert"
            data-testid="variable-validation-error"
            className="mt-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center gap-2"
          >
            <span className="text-sm">⚠️</span>
            <span>{validationError}</span>
          </div>
        )}
        {templateVariables.length > 0 && (
          <div
            data-testid="playbook-variables-bar"
            className="mt-2 p-2.5 sm:p-3 rounded-xl bg-[#FFF9F4] border border-[#FFDFC6] v3-space-y-2"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-[#C2410C] uppercase tracking-wider">
                  ⚡ Điền nhanh biến số 1-Click
                </span>
                <span className="text-[11px] font-medium text-[#9A3412] bg-[#FFEDD5] px-1.5 py-0.5 rounded">
                  Đã điền {templateVariables.filter((v) => Boolean(variableValues[v]?.trim())).length}/{templateVariables.length}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="btn-reset-playbook-variables"
                  onClick={() => {
                    setVariableValues({});
                    setValidationError(null);
                    onDraft(templateText);
                  }}
                  className="text-[11px] font-medium text-[#C2410C] hover:underline"
                >
                  Đặt lại mẫu gốc
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setVariableValues({});
                    setValidationError(null);
                  }}
                  className="text-[11px] text-[#9A3412] hover:underline"
                >
                  Ẩn thanh biến số
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templateVariables.map((varName) => (
                <label key={varName} className="flex flex-col gap-1 text-xs">
                  <span className="font-mono text-[11px] font-semibold text-[#7C2D12]">
                    {`{{${varName}}}`}
                  </span>
                  <input
                    type="text"
                    aria-label={`Biến số ${varName}`}
                    placeholder={`Nhập ${varName.replace(/_/g, ' ')}...`}
                    value={variableValues[varName] ?? ''}
                    onChange={(e) => handleVariableChange(varName, e.target.value)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs bg-white text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-brand-primary ${
                      validationError && !variableValues[varName]?.trim()
                        ? 'border-2 border-red-400 bg-red-50/20'
                        : 'border border-[#FED7AA]'
                    }`}
                  />
                </label>
              ))}
            </div>
          </div>
        )}
        {savingPlaybookOpen && (
          <div
            data-testid="save-playbook-modal"
            className="mt-2 p-2.5 sm:p-3 rounded-xl bg-neutral-50 border border-brand-border flex flex-col sm:flex-row sm:items-center gap-2"
          >
            <input
              type="text"
              aria-label="Tên Playbook 1-Click"
              placeholder="Đặt tên cho Playbook 1-Click..."
              value={newPlaybookTitle}
              onChange={(e) => setNewPlaybookTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirmSavePlaybook();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setSavingPlaybookOpen(false);
                }
              }}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs bg-white border border-brand-border text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-primary"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="btn-confirm-save-playbook"
                disabled={!newPlaybookTitle.trim()}
                onClick={handleConfirmSavePlaybook}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary-hover disabled:opacity-50"
              >
                Lưu Playbook
              </button>
              <button
                type="button"
                onClick={() => setSavingPlaybookOpen(false)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand-muted hover:text-brand-text"
              >
                Huỷ
              </button>
            </div>
          </div>
        )}
        {savedToast && (
          <div role="status" className="mt-1.5 text-xs font-medium text-emerald-700">
            ✓ {savedToast}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-brand-border-subtle mt-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-brand-muted inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-neutral-100 border border-neutral-300 rounded text-[10px] font-mono">
                Enter
              </kbd>
              {' để gửi'}
            </span>
            <button
              type="button"
              data-testid="btn-insert-variable"
              disabled={planning}
              onClick={handleInsertVariableToken}
              className="px-2 py-1 rounded-lg text-[11px] font-medium border border-[#E7E7E2] bg-[#F8F8F6] text-[#4B5563] hover:text-[#111827] hover:bg-neutral-100 transition-colors"
            >
              + Chèn {'{{biến_số}}'}
            </button>
            <button
              type="button"
              data-testid="btn-save-playbook"
              disabled={(!draft.trim() && !templateText.trim()) || planning}
              onClick={handleOpenSavePlaybook}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-[#FFDFC6] bg-[#FFF6EE] text-brand-primary hover:bg-[#FFEDD5] disabled:opacity-40 transition-colors"
            >
              ★ Lưu Playbook 1-Click
            </button>
          </div>
          <button
            type="button"
            disabled={(!draft.trim() && !templateText.trim()) || planning}
            onClick={handleSend}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white text-sm font-semibold rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            <span>Gửi yêu cầu</span>
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </button>
        </div>
      </form>

      {customPlaybooks.length > 0 && (
        <div className="v3-space-y-3" data-testid="custom-playbooks-section">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
              Playbook 1-Click đã lưu của bạn
            </div>
            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              Tái sử dụng 1-Click
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {customPlaybooks.map((playbook) => (
              <div
                key={playbook.id}
                className="relative p-3.5 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border hover:border-brand-primary/50 shadow-soft-card transition-all group flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {playbook.services.map((svcId, idx) => (
                      <span key={svcId} className="inline-flex items-center gap-1">
                        <span className="w-6 h-6 rounded-full bg-white border border-brand-border shadow-2xs flex items-center justify-center">
                          <ServiceLogo service={svcId} className="w-3 h-3" />
                        </span>
                        {idx < playbook.services.length - 1 && (
                          <span className="text-[10px] font-mono text-neutral-400">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={`Xoá Playbook ${playbook.title}`}
                    onClick={() => handleDeleteCustomPlaybook(playbook.id)}
                    className="text-xs text-neutral-400 hover:text-red-600 px-1.5 py-0.5 rounded"
                  >
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`Playbook đã lưu: ${playbook.title}`}
                  disabled={planning}
                  onClick={() => handleSelectPlaybook(playbook.prompt)}
                  className="text-left"
                >
                  <div className="text-xs font-bold text-brand-text group-hover:text-brand-primary transition-colors">
                    {playbook.title}
                  </div>
                  <p className="text-[11px] text-brand-muted line-clamp-2 mt-1 leading-relaxed">
                    {playbook.prompt}
                  </p>
                  {extractPlaybookVariables(playbook.prompt).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {extractPlaybookVariables(playbook.prompt).map((v) => (
                        <span
                          key={v}
                          data-testid="playbook-var-chip"
                          className="px-1.5 py-0.5 rounded bg-[#FFF6EE] text-[#C2410C] border border-[#FFDFC6] font-mono text-[10px]"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FLOW-04: 6 Core Jobs prioritized at the top of recommendations */}
      <div className="v3-space-y-3" data-testid="core-jobs-section">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
            6 Quy trình trọng tâm sẵn dùng (Chuẩn hoá theo đầu ra)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="btn-open-workflow-defaults"
              onClick={() => {
                setDefaultRepoInput(activeDefaults?.github?.repo ?? '');
                setDefaultSlackInput(activeDefaults?.slack?.channelId ?? '');
                setDefaultsEditorOpen((prev) => !prev);
              }}
              className="text-[11px] font-medium text-neutral-700 hover:text-brand-primary bg-white border border-neutral-200 px-2.5 py-0.5 rounded-full transition-colors"
            >
              ⚙️ Đặt tài nguyên mặc định
            </button>
            <span className="text-[11px] font-medium text-brand-primary bg-[#FFF6EE] border border-[#FFDFC6] px-2 py-0.5 rounded-full">
              Core Production Workflows
            </span>
          </div>
        </div>

        {defaultsEditorOpen && (
          <div
            data-testid="workflow-defaults-editor"
            className="p-3 rounded-xl bg-white border border-brand-border shadow-xs v3-space-y-2.5"
          >
            <div className="text-xs font-semibold text-brand-text">
              Cấu hình tài nguyên mặc định cho quy trình (lưu theo tài khoản &amp; workspace)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-neutral-700">GitHub Repository mặc định</span>
                <input
                  type="text"
                  aria-label="GitHub Repository mặc định"
                  placeholder="vd: acme/web"
                  value={defaultRepoInput}
                  onChange={(e) => setDefaultRepoInput(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-neutral-300"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-neutral-700">Kênh Slack mặc định (Channel ID)</span>
                <input
                  type="text"
                  aria-label="Kênh Slack mặc định"
                  placeholder="vd: C01GENERAL"
                  value={defaultSlackInput}
                  onChange={(e) => setDefaultSlackInput(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs border border-neutral-300"
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="btn-save-workflow-defaults"
                onClick={() => {
                  const nextDefaults: WorkflowResourceDefaults = {
                    ...(activeDefaults ?? {}),
                    ...(defaultRepoInput.trim() ? { github: { repo: defaultRepoInput.trim() } } : {}),
                    ...(defaultSlackInput.trim() ? { slack: { channelId: defaultSlackInput.trim() } } : {}),
                  };
                  saveWorkflowDefaults(userId, workspaceKey, nextDefaults);
                  setActiveDefaults(loadWorkflowDefaults(userId, workspaceKey));
                  setDefaultsEditorOpen(false);
                }}
                className="px-3 py-1 rounded-lg text-xs font-semibold bg-brand-primary text-white hover:bg-brand-primary-hover"
              >
                Lưu mặc định
              </button>
              <button
                type="button"
                onClick={() => setDefaultsEditorOpen(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-neutral-500 hover:text-neutral-800"
              >
                Đóng
              </button>
            </div>
          </div>
        )}

        {activeDefaults && (
          <div
            data-testid="workflow-active-defaults"
            className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-600"
          >
            <span className="font-semibold text-neutral-800">Tài nguyên mặc định:</span>
            {activeDefaults.github?.repo && (
              <span className="px-2 py-0.5 rounded bg-white border font-mono text-[11px]">
                Repo: {activeDefaults.github.repo}
              </span>
            )}
            {activeDefaults.slack?.channelId && (
              <span className="px-2 py-0.5 rounded bg-white border font-mono text-[11px]">
                Slack: #{activeDefaults.slack.channelId}
              </span>
            )}
            {activeDefaults.trello?.boardId && (
              <span className="px-2 py-0.5 rounded bg-white border font-mono text-[11px]">
                Trello: {activeDefaults.trello.boardId}
              </span>
            )}
            {activeDefaults.myjira?.projectKey && (
              <span className="px-2 py-0.5 rounded bg-white border font-mono text-[11px]">
                Jira: {activeDefaults.myjira.projectKey}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                clearWorkflowDefaults(userId, workspaceKey);
                setActiveDefaults(null);
              }}
              className="text-[11px] text-neutral-500 hover:text-red-600 ml-auto underline"
            >
              Xoá mặc định
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CORE_JOBS.map((job) => {
            const readiness = evaluateJobReadiness(job.requiredServices, services);
            return (
              <div
                key={job.id}
                className="relative p-3.5 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border hover:border-brand-primary/50 shadow-soft-card transition-all group flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5 mb-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {job.requiredServices.map((svcId, idx) => (
                        <span key={svcId} className="inline-flex items-center gap-1">
                          <span className="w-6 h-6 rounded-full bg-white border border-brand-border shadow-2xs flex items-center justify-center">
                            <ServiceLogo service={svcId} className="w-3.5 h-3.5" />
                          </span>
                          {idx < job.requiredServices.length - 1 && (
                            <span className="text-[10px] font-mono text-neutral-400">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                    <span
                      data-testid={`readiness-badge-${job.id}`}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        readiness.isReady
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : readiness.status === 'needs_reauth'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : readiness.status === 'needs_resource'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-orange-50 text-orange-800 border-orange-200'
                      }`}
                    >
                      {readiness.isReady
                        ? '✓ Sẵn sàng'
                        : readiness.status === 'needs_reauth'
                        ? '⚠️ Cấp lại quyền'
                        : readiness.status === 'needs_resource'
                        ? '📁 Chọn tài nguyên'
                        : `⚡ Thiếu ${readiness.missingServices.join(', ')}`}
                    </span>
                  </div>

                  <button
                    type="button"
                    aria-label={`Quy trình ${job.id}: ${job.title}`}
                    disabled={planning}
                    onClick={() => handleSelectPlaybook(job.prompt, job.id)}
                    className="text-left w-full"
                  >
                    <div className="text-xs font-bold text-brand-text group-hover:text-brand-primary transition-colors flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-brand-primary font-semibold">[{job.id}]</span>
                      <span>{job.title}</span>
                    </div>
                    <p className="text-[11px] text-brand-muted line-clamp-2 mt-1 leading-relaxed">
                      {job.description}
                    </p>
                    <div className="mt-2 text-[10px] text-neutral-500 bg-neutral-50 p-1.5 rounded-lg border border-neutral-100 flex items-center gap-1">
                      <span className="font-semibold text-neutral-700">Đầu ra:</span>
                      <span className="truncate">{job.outputDescription}</span>
                    </div>
                  </button>
                </div>

                {!readiness.isReady && (
                  <button
                    type="button"
                    onClick={() => navigate(readiness.ctaPath)}
                    className="w-full py-1 text-center text-xs font-semibold text-brand-primary bg-[#FFF6EE] hover:bg-[#FFEDD5] border border-[#FFDFC6] rounded-lg transition-colors"
                  >
                    {readiness.ctaLabel} →
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {services.some((service) => service.configured) ? (
        <>
          <div className="v3-space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
              Gợi ý việc phổ biến theo công cụ của bạn
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {services
                .filter((service) => service.configured)
                .slice(0, 4)
                .map((service) => {
                  const colors = cardColors[service.id] ?? neutralCard;
                  return (
                  <button
                    key={service.id}
                    type="button"
                    aria-label={servicePrompt(service)}
                    disabled={planning}
                    onClick={() => {
                      onDraft(servicePrompt(service));
                      input.current?.focus();
                    }}
                    className="relative overflow-hidden text-left p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border shadow-soft-card transition-all duration-200 group hover:-translate-y-0.5 hover:shadow-md flex items-start gap-3.5"
                  >
                    <div className={`absolute -right-6 -bottom-6 w-20 h-20 rounded-full ${colors.decoration} transition-colors pointer-events-none`} />
                    <div className="flex items-center -v3-space-x-1.5 flex-shrink-0 mt-0.5">
                      <div title={service.name} className={`w-8 h-8 rounded-xl ${colors.icon} border flex items-center justify-center p-1.5 shadow-sm group-hover:scale-105 transition-transform`}>
                        <ServiceLogo
                          service={service.id}
                          className={`w-4 h-4 ${colors.logo ?? ''}`}
                        />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                        {servicePrompt(service)}
                      </div>
                      <div className="text-xs text-brand-muted mt-1 flex items-center gap-1.5 font-sans">
                        <span className={`${colors.name} font-medium`}>{service.name}</span>
                      </div>
                    </div>
                  </button>
                ); })}
            </div>
          </div>

          {multiServicePlaybooks.filter((pb) => services.some((s) => s.id === 'gmail') || !pb.services.includes('gmail')).length > 0 && (
            <div className="v3-space-y-3" data-testid="multi-service-playbooks">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                  Kịch bản tự động hoá nâng cao (Đa dịch vụ)
                </div>
                <span className="text-[11px] font-medium text-neutral-600 bg-neutral-100 border border-neutral-200 px-2 py-0.5 rounded-full">
                  Advanced Multi-Service Flow
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {multiServicePlaybooks
                  .filter((pb) => services.some((s) => s.id === 'gmail') || !pb.services.includes('gmail'))
                  .map((playbook) => {
                  const pbReadiness = evaluateJobReadiness(playbook.services, services);
                  return (
                    <button
                      key={playbook.id}
                      type="button"
                      aria-label={`Kịch bản liên dịch vụ: ${playbook.title}`}
                      disabled={planning}
                      onClick={() => handleSelectPlaybook(playbook.prompt)}
                      className="text-left p-3.5 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border hover:border-brand-primary/50 shadow-soft-card transition-all group flex flex-col justify-between gap-2.5"
                    >
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {playbook.services.map((svcId, idx) => (
                            <span key={svcId} className="inline-flex items-center gap-1">
                              <span className="w-6 h-6 rounded-full bg-white border border-brand-border shadow-2xs flex items-center justify-center">
                                <ServiceLogo service={svcId} className="w-3 h-3" />
                              </span>
                              {idx < playbook.services.length - 1 && (
                                <span className="text-[9px] font-mono text-neutral-400">→</span>
                              )}
                            </span>
                          ))}
                        </div>
                        <span
                          className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border ${
                            pbReadiness.isReady
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                          }`}
                        >
                          {pbReadiness.isReady ? '✓ Sẵn sàng' : `Thiếu ${pbReadiness.missingServices.length} dịch vụ`}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-brand-text group-hover:text-brand-primary transition-colors">
                          {playbook.title}
                        </div>
                        <p className="text-[11px] text-brand-muted line-clamp-2 mt-1 leading-relaxed">
                          {playbook.prompt}
                        </p>
                        {extractPlaybookVariables(playbook.prompt).length > 0 && (
                          <div className="flex flex-wrap items-center gap-1 mt-1.5">
                            {extractPlaybookVariables(playbook.prompt).map((v) => (
                              <span
                                key={v}
                                data-testid="playbook-var-chip"
                                className="px-1.5 py-0.5 rounded bg-[#FFF6EE] text-[#C2410C] border border-[#FFDFC6] font-mono text-[10px]"
                              >
                                {`{{${v}}}`}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : !loading && !error ? (
        <div className="v3-space-y-3">
          <p className="text-sm text-brand-muted">
            Chưa có dịch vụ nào được kết nối
          </p>
          <a
            href="/settings"
            className="text-sm text-brand-primary hover:underline font-medium"
            onClick={(event) => {
              event.preventDefault();
              onSettings();
            }}
          >
            Kết nối dịch vụ
          </a>
        </div>
      ) : null}
      <div className="pt-4 border-t border-brand-border flex flex-col gap-2.5 text-xs text-brand-muted">
        <div
          className="flex flex-wrap items-center gap-2 text-xs text-brand-muted"
          aria-label="Dịch vụ đã thiết lập"
        >
          <span>Đã kết nối:</span>
          {services
            .filter((service) => service.configured)
            .map((service) => (
              <span
                key={service.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white rounded-lg border border-brand-border text-neutral-800 font-medium shadow-sm"
              >
                <ServiceLogo
                  service={service.id}
                  className="w-3.5 h-3.5 shrink-0"
                />
                <span>{service.name}</span>
                {service.connectionStatus !== 'healthy' && (
                  <span>
                    <span aria-hidden="true">
                      {service.connectionStatus === 'unhealthy' ? '⚠' : '?'}
                    </span>{' '}
                    {connections[service.connectionStatus ?? 'unchecked']}
                  </span>
                )}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-2 text-neutral-500 flex-wrap w-full">
          <span>Chưa kết nối:</span>
          {services
            .filter((service) => !service.configured)
            .map((service) => (
              <span
                key={service.id}
                className="inline-flex items-center gap-1 text-neutral-400"
              >
                <ServiceLogo
                  service={service.id}
                  mono
                  className="w-3.5 h-3.5 shrink-0 fill-current opacity-60"
                />
                {service.name}
              </span>
            ))}
          <a
            href="/settings"
            onClick={(event) => {
              event.preventDefault();
              onSettings();
            }}
            className="text-brand-primary hover:underline font-medium"
          >
            Kết nối thêm
          </a>
          <span>·</span>
          <a
            href="/guide"
            onClick={(event) => {
              event.preventDefault();
              navigate('/guide');
            }}
            className="text-brand-primary hover:underline font-medium"
          >
            Cẩm nang &amp; Mẫu câu lệnh
          </a>
        </div>
      </div>
      {loading && <p role="status">Đang tải dịch vụ…</p>}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
export function DiscoveryMoment({
  request,
  gather,
  services,
}: {
  request: string;
  gather: GatherState | null;
  services: ServiceInfo[];
}) {
  const origin = useScheduledOrigin();
  return (
    <section
      id="moment-2"
      className="stage-section is-active v3-space-y-8"
      data-moment="2"
      aria-label="Cockpit"
    >
      <div className="p-6 bg-white rounded-2xl border border-brand-border shadow-soft-card v3-space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-brand-primary">
          Đang phân tích yêu cầu
        </div>
        {origin && <RequestEcho request={request} />}
        <h1
          id="heading-moment-2"
          className="font-display text-2xl sm:text-3xl text-brand-text font-normal leading-snug"
          tabIndex={-1}
        >
          <span id="moment-2-query-display">{origin ? 'Planora đang lập kế hoạch cho lượt này' : `“${request}”`}</span>
        </h1>
      </div>
      <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-soft-card v3-space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-brand-border-subtle">
          <div className="flex items-center gap-2">
            <div
              id="moment-2-pulse"
              className="w-2.5 h-2.5 rounded-full bg-brand-primary animate-ping"
            />
            <span
              id="moment-2-status-text"
              className="text-sm font-semibold text-brand-text"
            >
              Tôi đang kiểm tra các tài nguyên liên quan
            </span>
          </div>
        </div>
        <ul
          className="v3-space-y-3 text-sm"
          id="discovery-steps-list"
          aria-live="polite"
        >
          {!gather?.steps.length ? (
            <li className="text-brand-muted">Đang đọc yêu cầu…</li>
          ) : (
            gather.steps.map((step, index) => {
              const service =
                toolDefinition(step.tool)?.service ??
                step.tool.split('.')[0];
              const found = step.status === 'completed';
              return (
                <li
                  key={step.tool + '-' + index}
                  id={'disc-step-' + (index + 1)}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="disc-icon w-4 h-4 flex items-center justify-center flex-shrink-0"
                      aria-hidden="true"
                    >
                      {found ? (
                        '✓'
                      ) : (
                        <span className="w-2 h-2 bg-brand-primary rounded-full animate-pulse" />
                      )}
                    </span>
                    <span className="break-words">
                      {found ? 'Đã tìm thông tin' : 'Đang tìm nơi phù hợp'} trên{' '}
                      {services.find((row) => row.id === service)?.name ??
                        getServiceDefinition(service)?.name ??
                        service}{' '}
                      {step.result && <strong>{step.result}</strong>}
                    </span>
                  </span>
                  <span
                    className={
                      found
                        ? 'text-xs text-emerald-600'
                        : 'text-xs text-brand-muted'
                    }
                  >
                    {found ? 'Đã thấy' : 'Đang tìm…'}
                  </span>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </section>
  );
}
