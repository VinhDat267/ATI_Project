// Source: AppStagePage.tsx moments 1–2. Content comes from the registered catalog and gatherState.
import { useState, useEffect, useRef, type KeyboardEvent, type RefObject, type ReactNode } from 'react';
import { getServiceDefinition } from '@wap/tool-schemas';
import { toolDefinition } from '../../services/tool-definitions';
import { ServiceLogo } from '../../components/ServiceLogo';
import presentation from '../../assets/cockpit-services.json';
import type { ServiceInfo, GatherState } from '../../types';
import { RequestEcho, useScheduledOrigin } from './RequestEcho';
import { multiServicePlaybooks } from './presentation';
import { getActiveWorkspaceSummary, subscribeWorkspace } from '../../services/workspace-storage';
import { authStorage } from '../../services/auth-storage';
import {
  loadPlaybooks,
  savePlaybook,
  deletePlaybook,
  type CustomPlaybook,
} from '../../services/playbook-storage';
import { CORE_JOBS, evaluateJobReadiness, formatServiceList } from '../../services/job-readiness';
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

const VARIABLE_META: Record<string, { label: string; placeholder: string }> = {
  'tên_dự_án': { label: 'Tên dự án', placeholder: 'Ví dụ: Ra mắt sản phẩm Quý 4' },
  'email_nhận': { label: 'Email người nhận', placeholder: 'Ví dụ: nhom-du-an@congty.vn' },
  'email_khách': { label: 'Email khách hàng', placeholder: 'Ví dụ: doi-tac@khachhang.vn' },
  'kênh_slack': { label: 'Kênh Slack', placeholder: 'Ví dụ: du-an-chung' },
  'tên_bảng': { label: 'Tên bảng dữ liệu', placeholder: 'Ví dụ: Tiến độ Tuần 45' },
  'tiêu_đề_việc': { label: 'Tiêu đề công việc', placeholder: 'Ví dụ: Kiểm tra báo cáo doanh thu' },
  'người_nhận': { label: 'Người phụ trách', placeholder: 'Ví dụ: @minh.nguyen' },
  'hạn_chót': { label: 'Hạn hoàn thành', placeholder: 'Ví dụ: 17:00 thứ Sáu' },
  'mã_dự_án': { label: 'Mã dự án Jira', placeholder: 'Ví dụ: PROJ' },
  'tên_repo': { label: 'Kho mã nguồn GitHub', placeholder: 'Ví dụ: org/web-app' },
  'kho_github': { label: 'Kho mã nguồn GitHub', placeholder: 'Ví dụ: org/web-app' },
  'số_ngày': { label: 'Số ngày tồn đọng', placeholder: 'Ví dụ: 7' },
  'biến_số': { label: 'Thông tin cần điền', placeholder: 'Nhập nội dung...' },
};

function formatVariableLabel(varName: string): string {
  const key = varName.trim().toLowerCase();
  if (VARIABLE_META[key]) return VARIABLE_META[key].label;
  const cleaned = varName.replace(/_/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : varName;
}

function formatVariablePlaceholder(varName: string): string {
  const key = varName.trim().toLowerCase();
  if (VARIABLE_META[key]) return VARIABLE_META[key].placeholder;
  return `Nhập ${varName.replace(/_/g, ' ')}...`;
}

function renderInteractiveTemplatePreview(
  template: string,
  values: Record<string, string>,
  onFocusVar: (varName: string) => void,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /\{\{\s*([^}{]+?)\s*\}\}/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIdx) {
      parts.push(<span key={`t-${keyIdx++}`}>{template.slice(lastIdx, match.index)}</span>);
    }
    const varName = match[1].trim();
    const filled = values[varName]?.trim();
    parts.push(
      <button
        key={`v-${keyIdx++}`}
        type="button"
        onClick={() => onFocusVar(varName)}
        title={`Nhấn để điền ${formatVariableLabel(varName)}`}
        className={`inline-flex items-center px-2 py-0.5 mx-0.5 rounded-md text-[15px] font-medium align-baseline transition-colors cursor-pointer ${
          filled
            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
            : 'bg-[#F4F4F1] text-[#111827] border border-dashed border-[#B8B8B0] hover:border-[#111827] hover:bg-neutral-200/60'
        }`}
      >
        {filled || formatVariableLabel(varName)}
      </button>,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < template.length) {
    parts.push(<span key={`t-${keyIdx++}`}>{template.slice(lastIdx)}</span>);
  }
  return parts;
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
  const defaultsEditorScopeRef = useRef<{ userId: string; workspaceKey: string } | null>(null);

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
  const [galleryTab, setGalleryTab] = useState<'core' | 'multi' | 'all'>('core');

  useEffect(() => {
    const unsubscribeWs = subscribeWorkspace(() => {
      const nextWs = getActiveWorkspaceSummary();
      const nextWsKey = nextWs?.id || 'personal';
      setWorkspace(nextWs);
      const user = authStorage.getStoredTokens().user;
      const nextUserId = user?.id ?? 'anonymous';
      if (defaultsEditorScopeRef.current && (defaultsEditorScopeRef.current.userId !== nextUserId || defaultsEditorScopeRef.current.workspaceKey !== nextWsKey)) {
        setDefaultsEditorOpen(false);
        setDefaultRepoInput(''); setDefaultSlackInput('');
        defaultsEditorScopeRef.current = null;
      }
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
      if (defaultsEditorScopeRef.current && defaultsEditorScopeRef.current.userId !== nextUserId) {
        setDefaultsEditorOpen(false);
        setDefaultRepoInput(''); setDefaultSlackInput('');
        defaultsEditorScopeRef.current = null;
      }
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
    const vars = extractPlaybookVariables(promptText);
    setTemplateText(promptText);
    setSelectedTemplateId(templateId ?? null);
    setVariableValues({});
    setValidationError(null);
    setComposerTab(vars.length > 0 ? 'preview' : 'template');
    onDraft(promptText);
    if (vars.length > 0) {
      requestAnimationFrame(() => {
        const firstInput = document.querySelector<HTMLInputElement>(
          '[data-testid="playbook-variables-bar"] input',
        );
        firstInput?.focus();
      });
    } else {
      input.current?.focus();
    }
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
        `Vui lòng điền thông tin còn thiếu: ${unfulfilled.map(formatVariableLabel).join(', ')}`,
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
      className="stage-section is-active v3-space-y-6"
      data-moment="1"
      aria-label="Cockpit"
    >
      {/* Clean Hero Header */}
      <div className="v3-space-y-2 text-center sm:text-left">
        {workspace.id !== 'personal' && services.some((s) => s.id === 'myjira' && s.configured) && (
          <div>
            <span
              data-testid="jira-context-ready-pill"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-[#0052CC] border border-blue-200"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#0052CC]" />
              <span>Jira: Sẵn sàng làm việc</span>
            </span>
          </div>
        )}

        <h1
          id="heading-moment-1"
          className="font-sans text-2xl sm:text-[28px] text-[#111827] font-semibold tracking-tight leading-tight"
          tabIndex={-1}
        >
          {resume ? 'Tiếp tục hội thoại này' : 'Hôm nay bạn muốn nhờ việc gì?'}
        </h1>
        <p className="text-sm sm:text-[15px] text-[#6B7280] max-w-2xl leading-relaxed">
          {resume
            ? 'Xem lại yêu cầu trước bên dưới, rồi gửi tiếp hoặc mô tả việc mới.'
            : workspace.id === 'personal'
            ? 'Mô tả bằng lời thường điều bạn cần trong Không gian Cá nhân — tôi sẽ lên kế hoạch từng bước để bạn kiểm tra trước khi thực hiện.'
            : `Mô tả bằng lời thường điều bạn cần — tôi sẽ phối hợp trên các công cụ của ${workspace.name} sau khi bạn duyệt.`}
        </p>
      </div>
      {resume}
      {feedback}
      {/* Smart Composer */}
      <form
        aria-label="Nhập yêu cầu"
        aria-busy={planning}
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
        className="relative bg-white rounded-2xl border border-[#E5E5E0] shadow-2xs p-3.5 sm:p-4 focus-within:border-[#FF5701] transition-colors"
      >
        <label htmlFor="prompt-input" className="sr-only">
          Nội dung bạn muốn nhờ
        </label>
        {templateVariables.length > 0 && (
          <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-[#F1F1EC]">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4B5563]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF5701]" aria-hidden="true" />
              <span>Mẫu câu lệnh điền nhanh</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center p-0.5 rounded-lg bg-[#F4F4F1] border border-[#E7E7E2]">
                <button
                  type="button"
                  data-testid="tab-preview-mode"
                  onClick={() => setComposerTab('preview')}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    composerTab === 'preview'
                      ? 'bg-white text-[#111827] shadow-2xs font-semibold'
                      : 'text-[#4B5563] hover:text-[#111827]'
                  }`}
                >
                  Xem câu lệnh
                </button>
                <button
                  type="button"
                  data-testid="tab-template-mode"
                  onClick={() => {
                    setComposerTab('template');
                    requestAnimationFrame(() => input.current?.focus());
                  }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    composerTab === 'template'
                      ? 'bg-white text-[#111827] shadow-2xs font-semibold'
                      : 'text-[#4B5563] hover:text-[#111827]'
                  }`}
                >
                  Sửa câu gốc
                </button>
              </div>
              <button
                type="button"
                title="Xoá mẫu và nhập lại từ đầu"
                onClick={() => {
                  setTemplateText('');
                  setSelectedTemplateId(null);
                  setVariableValues({});
                  setValidationError(null);
                  setComposerTab('template');
                  onDraft('');
                  requestAnimationFrame(() => input.current?.focus());
                }}
                className="p-1 rounded-md text-[#6B7280] hover:text-[#111827] hover:bg-neutral-100 transition-colors cursor-pointer"
                aria-label="Xoá mẫu câu lệnh"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}
        {!inputHidden && templateVariables.length > 0 && composerTab === 'preview' && (
          <div className="min-h-[64px] px-1 py-1 text-[16px] sm:text-[17px] leading-relaxed text-[#111827]">
            {renderInteractiveTemplatePreview(
              templateText || draft,
              variableValues,
              (varName) => {
                const el = document.querySelector<HTMLInputElement>(
                  `[aria-label="Biến số ${varName}"]`,
                );
                el?.focus();
              },
            )}
          </div>
        )}
        {!inputHidden && (
          <textarea
            ref={input}
            id="prompt-input"
            rows={3}
            spellCheck={false}
            value={composerTab === 'preview' ? draft : (templateText || draft)}
            readOnly={templateVariables.length > 0 && composerTab === 'preview'}
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
            className={
              templateVariables.length > 0 && composerTab === 'preview'
                ? 'sr-only'
                : 'w-full text-base sm:text-[17px] leading-relaxed text-brand-text placeholder-neutral-400 bg-transparent resize-none border-0 focus:ring-0 focus:v3-outline-none p-1'
            }
            placeholder="Ví dụ: Tạo card Trello cho lỗi đăng nhập Google, tạo issue GitHub, ghi vào Google Sheets và báo kênh Slack..."
          />
        )}
        {validationError && (
          <div
            role="alert"
            data-testid="variable-validation-error"
            className="mt-2.5 px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-700 flex items-center gap-2"
          >
            <span>{validationError}</span>
          </div>
        )}
        {templateVariables.length > 0 && (
          <div
            data-testid="playbook-variables-bar"
            className="mt-3 p-3.5 rounded-xl bg-[#F8F8F6] border border-[#EAEAE4] v3-space-y-3"
          >
            {(() => {
              const filledCount = templateVariables.filter((v) =>
                Boolean(variableValues[v]?.trim()),
              ).length;
              const allFilled = filledCount === templateVariables.length;
              return (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#111827]">
                      Điền thông tin cụ thể
                    </span>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                        allFilled
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-[#6B7280] border-[#E5E5E0]'
                      }`}
                    >
                      {allFilled
                        ? `✓ Đủ ${filledCount}/${templateVariables.length} mục`
                        : `${filledCount}/${templateVariables.length} đã điền`}
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid="btn-reset-playbook-variables"
                    onClick={() => {
                      setVariableValues({});
                      setValidationError(null);
                      onDraft(templateText);
                    }}
                    className="text-xs font-medium text-[#6B7280] hover:text-[#111827] transition-colors cursor-pointer"
                  >
                    Đặt lại
                  </button>
                </div>
              );
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {templateVariables.map((varName, idx) => (
                <label key={varName} className="flex flex-col gap-1.5 text-xs">
                  <span className="text-xs font-medium text-[#374151]">
                    {formatVariableLabel(varName)}
                  </span>
                  <input
                    type="text"
                    spellCheck={false}
                    aria-label={`Biến số ${varName}`}
                    placeholder={formatVariablePlaceholder(varName)}
                    value={variableValues[varName] ?? ''}
                    onChange={(e) => handleVariableChange(varName, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const nextUnfilled = templateVariables.find(
                          (v, i) => i > idx && !variableValues[v]?.trim(),
                        );
                        if (nextUnfilled) {
                          document
                            .querySelector<HTMLInputElement>(
                              `[aria-label="Biến số ${nextUnfilled}"]`,
                            )
                            ?.focus();
                        } else {
                          handleSend();
                        }
                      }
                    }}
                    className={`px-3 py-2 rounded-lg text-sm bg-white text-[#111827] placeholder:text-[#9CA3AF] !outline-none focus-visible:!outline-none transition-all ${
                      validationError && !variableValues[varName]?.trim()
                        ? 'border-2 border-rose-400 bg-rose-50/20'
                        : 'border border-[#DEDED8] focus:border-[#111827] focus:ring-2 focus:ring-neutral-900/8'
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
            className="mt-3 p-3 rounded-xl bg-[#F8F8F6] border border-[#EAEAE4] flex flex-col sm:flex-row sm:items-center gap-2"
          >
            <input
              type="text"
              aria-label="Tên mẫu công việc"
              placeholder="Đặt tên cho mẫu công việc tái sử dụng..."
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
              className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-white border border-[#DEDED8] text-brand-text !outline-none focus-visible:!outline-none focus:border-[#111827] focus:ring-2 focus:ring-neutral-900/8"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="btn-confirm-save-playbook"
                disabled={!newPlaybookTitle.trim()}
                onClick={handleConfirmSavePlaybook}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#111827] text-white hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
              >
                Lưu mẫu công việc
              </button>
              <button
                type="button"
                onClick={() => setSavingPlaybookOpen(false)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand-muted hover:text-brand-text cursor-pointer"
              >
                Huỷ
              </button>
            </div>
          </div>
        )}
        {savedToast && (
          <div role="status" className="mt-2 text-xs font-medium text-emerald-700">
            ✓ {savedToast}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#F1F1EC] mt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="hidden sm:inline-flex text-xs text-[#6B7280] items-center gap-1 mr-1.5">
              <kbd className="px-1.5 py-0.5 bg-[#F4F4F1] border border-[#E5E5E0] rounded text-[11px] font-mono text-[#4B5563]">
                Enter
              </kbd>
              <span>để gửi</span>
            </span>
            <button
              type="button"
              data-testid="btn-insert-variable"
              disabled={planning}
              title="Thêm một ô điền nhanh vào câu lệnh để tái sử dụng nhiều lần"
              onClick={handleInsertVariableToken}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#4B5563] hover:text-[#111827] hover:bg-[#F4F4F1] transition-colors cursor-pointer"
            >
              + Thêm ô điền nhanh
            </button>
            <button
              type="button"
              data-testid="btn-save-playbook"
              disabled={(!draft.trim() && !templateText.trim()) || planning}
              onClick={handleOpenSavePlaybook}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#4B5563] hover:text-[#111827] hover:bg-[#F4F4F1] disabled:opacity-40 transition-colors cursor-pointer"
            >
              Lưu làm mẫu
            </button>
          </div>
          <button
            type="button"
            disabled={(!draft.trim() && !templateText.trim()) || planning}
            onClick={handleSend}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-primary hover:bg-brand-primary-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-xs transition-all cursor-pointer"
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
            <div className="text-xs font-semibold text-brand-muted">
              Mẫu công việc đã lưu của bạn
            </div>
            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
              Tái sử dụng nhanh
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {customPlaybooks.map((playbook) => (
              <div
                key={playbook.id}
                className="relative p-4 bg-white hover:bg-neutral-50 rounded-2xl border border-brand-border hover:border-brand-primary/50 shadow-soft-card transition-all group flex flex-col justify-between gap-2.5"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {playbook.services.map((svcId, idx) => (
                      <span key={svcId} className="inline-flex items-center gap-1">
                        <span className="w-6 h-6 rounded-full bg-white border border-brand-border shadow-2xs flex items-center justify-center">
                          <ServiceLogo service={svcId} className="w-3 h-3" />
                        </span>
                        {idx < playbook.services.length - 1 && (
                          <span className="text-xs font-mono text-neutral-400">→</span>
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
                  <p className="text-xs text-brand-muted line-clamp-2 mt-1 leading-relaxed">
                    {playbook.prompt.replace(
                      /\{\{\s*([^}{]+?)\s*\}\}/g,
                      (_, n) => `[${formatVariableLabel(n)}]`,
                    )}
                  </p>
                  {extractPlaybookVariables(playbook.prompt).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      {extractPlaybookVariables(playbook.prompt).map((v) => (
                        <span
                          key={v}
                          data-testid="playbook-var-chip"
                          className="px-2 py-0.5 rounded-md bg-[#F4F4F1] text-[#4B5563] border border-[#E5E5E0] text-[11px] font-medium"
                        >
                          {formatVariableLabel(v)}
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

      {/* Quick Single-Tool Starter Pills directly below Composer */}
      {services.some((service) => service.configured) ? (
        <div className="v3-space-y-2">
          <div className="text-xs font-semibold text-[#4B5563]">
            Gợi ý việc phổ biến theo công cụ của bạn
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
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
                    className="relative overflow-hidden text-left p-3 bg-white hover:bg-neutral-50 rounded-xl border border-brand-border hover:border-brand-primary/40 shadow-2xs transition-all group flex items-center gap-2.5 cursor-pointer"
                  >
                    <div
                      className={`absolute -right-6 -bottom-6 w-16 h-16 rounded-full ${colors.decoration} transition-colors pointer-events-none`}
                    />
                    <div
                      title={service.name}
                      className={`w-7 h-7 rounded-lg ${colors.icon} border flex items-center justify-center p-1.5 shrink-0 group-hover:scale-105 transition-transform`}
                    >
                      <ServiceLogo
                        service={service.id}
                        className={`w-3.5 h-3.5 ${colors.logo ?? ''}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0 relative z-10">
                      <div className="text-xs font-medium leading-snug text-brand-text group-hover:text-brand-primary transition-colors truncate">
                        {servicePrompt(service)}
                      </div>
                      <div className={`text-[11px] ${colors.name} font-medium truncate mt-0.5`}>
                        {service.name}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      ) : !loading && !error ? (
        <div className="v3-space-y-2">
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

      {/* Unified Tabbed Workflow Gallery: Core Jobs & Multi-Service Playbooks */}
      {(() => {
        const visibleCoreJobs = CORE_JOBS.filter(
          (job) => services.some((service) => service.id === 'gmail') || !job.requiredServices.includes('gmail'),
        );
        const visibleMultiPlaybooks = multiServicePlaybooks.filter(
          (pb) => services.some((s) => s.id === 'gmail') || !pb.services.includes('gmail'),
        );
        return (
      <div className="v3-space-y-4 pt-1">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2.5 border-b border-[#E7E7E2]">
          <div role="tablist" aria-label="Danh mục quy trình mẫu" className="inline-flex flex-wrap items-center gap-1 p-1 rounded-xl bg-[#F3F2EE] border border-[#E7E7E2]">
            {([
              { id: 'core', label: `Quy trình trọng tâm (${visibleCoreJobs.length})` },
              { id: 'multi', label: `Kịch bản liên dịch vụ (${visibleMultiPlaybooks.length})` },
              { id: 'all', label: `Tất cả (${visibleCoreJobs.length + visibleMultiPlaybooks.length})` },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={galleryTab === tab.id}
                onClick={() => setGalleryTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  galleryTab === tab.id
                    ? 'bg-white text-[#111827] shadow-2xs'
                    : 'text-[#6B7280] hover:text-[#111827]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="btn-open-workflow-defaults"
              onClick={() => {
                defaultsEditorScopeRef.current = { userId, workspaceKey };
                setDefaultRepoInput(activeDefaults?.github?.repo ?? '');
                setDefaultSlackInput(activeDefaults?.slack?.channelId ?? '');
                setDefaultsEditorOpen((prev) => !prev);
              }}
              className="text-xs font-medium text-neutral-700 hover:text-brand-primary bg-white border border-neutral-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
            >
              Đặt tài nguyên mặc định
            </button>
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
                  const scope = defaultsEditorScopeRef.current;
                  if (!scope || scope.userId !== authStorage.getStoredTokens().user?.id || scope.workspaceKey !== (getActiveWorkspaceSummary()?.id || 'personal')) {
                    setDefaultsEditorOpen(false);
                    defaultsEditorScopeRef.current = null;
                    return;
                  }
                  const nextDefaults: WorkflowResourceDefaults = {
                    ...(activeDefaults ?? {}),
                    ...(defaultRepoInput.trim() ? { github: { repo: defaultRepoInput.trim() } } : {}),
                    ...(defaultSlackInput.trim() ? { slack: { channelId: defaultSlackInput.trim() } } : {}),
                  };
                  saveWorkflowDefaults(userId, workspaceKey, nextDefaults);
                  setActiveDefaults(loadWorkflowDefaults(userId, workspaceKey));
                  setDefaultsEditorOpen(false);
                  defaultsEditorScopeRef.current = null;
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

        {/* Tab 1: 6 Core Jobs */}
        <div
          className={galleryTab === 'multi' ? 'hidden' : 'v3-space-y-3'}
          data-testid="core-jobs-section"
        >
          <div className="sr-only">{visibleCoreJobs.length} Quy trình trọng tâm sẵn dùng</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 items-stretch">
            {visibleCoreJobs.map((job) => {
              const readiness = evaluateJobReadiness(job.requiredServices, services);
              return (
                <div
                  key={job.id}
                  className="relative p-4 bg-white hover:bg-neutral-50/80 rounded-2xl border border-brand-border hover:border-brand-primary/50 shadow-2xs transition-all group flex flex-col justify-between gap-3"
                >
                  <div className="v3-space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center -space-x-1">
                        {job.requiredServices.map((svcId) => (
                          <span
                            key={svcId}
                            className="w-6 h-6 rounded-full bg-white border border-brand-border shadow-2xs flex items-center justify-center"
                          >
                            <ServiceLogo service={svcId} className="w-3.5 h-3.5" />
                          </span>
                        ))}
                      </div>
                      <span
                        data-testid={`readiness-badge-${job.id}`}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                          readiness.isReady
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : readiness.status === 'needs_reauth'
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : readiness.status === 'needs_resource' || readiness.status === 'needs_admin'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-neutral-100 text-neutral-700 border-neutral-200'
                        }`}
                      >
                        {readiness.isReady
                          ? '● Sẵn sàng'
                          : readiness.status === 'needs_reauth'
                          ? 'Cần kết nối lại'
                          : readiness.status === 'needs_resource'
                          ? 'Chọn phạm vi'
                          : readiness.status === 'needs_admin'
                          ? 'Cần cấp quyền bảng'
                          : `Thiếu ${formatServiceList(readiness.missingServices)}`}
                      </span>
                    </div>

                    <button
                      type="button"
                      aria-label={`Quy trình ${job.id}: ${job.title}`}
                      disabled={planning}
                      onClick={() => handleSelectPlaybook(job.prompt, job.id)}
                      className="text-left w-full cursor-pointer"
                    >
                      <div className="text-sm font-semibold text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                        {job.title}
                      </div>
                      <p className="text-xs text-brand-muted line-clamp-2 mt-1 leading-relaxed">
                        {job.description}
                      </p>
                    </button>
                  </div>

                  <div className="pt-2.5 border-t border-[#F3F4F6] flex items-center justify-between gap-2 text-xs">
                    <span className="text-[11px] text-[#6B7280] truncate" title={job.outputDescription}>
                      Đầu ra: {job.outputDescription}
                    </span>
                    {!readiness.isReady ? (
                      <button
                        type="button"
                        onClick={() => navigate(readiness.ctaPath)}
                        className="text-xs font-semibold text-brand-primary hover:underline shrink-0 cursor-pointer"
                      >
                        {readiness.ctaLabel} →
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={planning}
                        onClick={() => handleSelectPlaybook(job.prompt, job.id)}
                        className="text-xs font-semibold text-[#4B5563] group-hover:text-brand-primary shrink-0 cursor-pointer"
                      >
                        Dùng mẫu →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Tab 2: Multi-Service Playbooks */}
        {services.some((service) => service.configured) &&
          visibleMultiPlaybooks.length > 0 && (
            <div
              className={galleryTab === 'core' ? 'hidden' : 'v3-space-y-3'}
              data-testid="multi-service-playbooks"
            >
              <div className="sr-only">Kịch bản tự động hoá nâng cao (Đa dịch vụ)</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 items-stretch">
                {visibleMultiPlaybooks.map((playbook) => {
                    const pbReadiness = evaluateJobReadiness(playbook.services, services);
                    const visibleServices = playbook.services.slice(0, 4);
                    const extraServicesCount = Math.max(0, playbook.services.length - 4);
                    return (
                      <button
                        key={playbook.id}
                        type="button"
                        aria-label={`Kịch bản liên dịch vụ: ${playbook.title}`}
                        disabled={planning}
                        onClick={() => handleSelectPlaybook(playbook.prompt)}
                        className="text-left p-4 bg-white hover:bg-neutral-50/80 rounded-2xl border border-brand-border hover:border-brand-primary/50 shadow-2xs transition-all group flex flex-col justify-between gap-2.5 cursor-pointer"
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center -space-x-1">
                            {visibleServices.map((svcId) => (
                              <span
                                key={svcId}
                                className="w-6 h-6 rounded-full bg-white border border-brand-border shadow-2xs flex items-center justify-center"
                              >
                                <ServiceLogo service={svcId} className="w-3 h-3" />
                              </span>
                            ))}
                            {extraServicesCount > 0 && (
                              <span className="h-6 px-1.5 rounded-full bg-neutral-100 border border-brand-border text-[10px] font-semibold text-neutral-600 flex items-center justify-center">
                                +{extraServicesCount}
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                              pbReadiness.isReady
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : pbReadiness.status === 'needs_reauth'
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : pbReadiness.status === 'needs_resource' || pbReadiness.status === 'needs_admin'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                            }`}
                          >
                            {pbReadiness.isReady
                              ? '● Sẵn sàng'
                              : pbReadiness.missingServices.length > 0
                              ? `Thiếu ${pbReadiness.missingServices.length} dịch vụ`
                              : pbReadiness.status === 'needs_resource'
                              ? 'Chọn phạm vi'
                              : pbReadiness.status === 'needs_admin'
                              ? 'Cần cấp quyền bảng'
                              : 'Cần kết nối lại'}
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-brand-text group-hover:text-brand-primary transition-colors leading-snug">
                            {playbook.title}
                          </div>
                          <p className="text-xs text-brand-muted line-clamp-2 mt-1 leading-relaxed">
                            {playbook.prompt.replace(
                              /\{\{\s*([^}{]+?)\s*\}\}/g,
                              (_, rawName: string) => `[${formatVariableLabel(rawName)}]`,
                            )}
                          </p>
                          {extractPlaybookVariables(playbook.prompt).length > 0 && (
                            <div className="flex flex-wrap items-center gap-1 mt-2">
                              {extractPlaybookVariables(playbook.prompt).map((v) => (
                                <span
                                  key={v}
                                  data-testid="playbook-var-chip"
                                  className="px-2 py-0.5 rounded-md bg-[#F4F4F1] text-[#4B5563] border border-[#E5E5E0] text-[11px] font-medium"
                                >
                                  {formatVariableLabel(v)}
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
      </div>
        );
      })()}

      {/* Sleek Single-Row Connected Services Footer */}
      {(() => {
        const configuredServices = services.filter((service) => service.configured);
        const unconfiguredServices = services.filter(
          (service) =>
            !service.configured &&
            !(service.id === 'sheets' && services.some((s) => s.id === 'mysheets')) &&
            !(service.id === 'calendar' && services.some((s) => s.id === 'mycalendar')) &&
            !(service.id === 'jira' && services.some((s) => s.id === 'myjira'))
        );
        return (
          <div className="pt-4 border-t border-[#E7E7E2] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <div
                className="flex items-center gap-2.5 flex-wrap"
                aria-label="Dịch vụ đã thiết lập"
              >
                <span className="inline-flex items-center gap-1.5 font-medium text-[#4B5563]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                  <span>Đã kết nối ({configuredServices.length})</span>
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {configuredServices.map((service) => {
                    const cleanLabel = service.name.replace(/\s+của bạn$/i, '');
                    const isUnhealthy = service.connectionStatus === 'unhealthy';
                    return (
                      <span
                        key={service.id}
                        title={
                          isUnhealthy
                            ? `${cleanLabel} — Cần kiểm tra kết nối`
                            : cleanLabel
                        }
                        className={`w-7 h-7 rounded-full flex items-center justify-center border shadow-2xs transition-transform hover:-translate-y-0.5 ${
                          isUnhealthy
                            ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-100'
                            : 'bg-white border-[#E7E7E2]'
                        }`}
                      >
                        <ServiceLogo
                          service={service.id}
                          className="w-3.5 h-3.5 shrink-0"
                        />
                        <span className="sr-only">{service.name}</span>
                        {service.connectionStatus !== 'healthy' && (
                          <span className="sr-only">
                            {connections[service.connectionStatus ?? 'unchecked']}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>

              {unconfiguredServices.length > 0 ? (
                <div className="inline-flex items-center gap-1.5 text-[#6B7280]">
                  <span className="text-[#D1D5DB]" aria-hidden="true">·</span>
                  <span>Còn {unconfiguredServices.length} công cụ chưa kết nối</span>
                  <span className="sr-only">
                    <span>Chưa kết nối:</span>
                    {unconfiguredServices.map((service) => (
                      <span key={service.id}>
                        <ServiceLogo service={service.id} mono className="w-3.5 h-3.5 fill-current" />
                        {service.name}
                      </span>
                    ))}
                  </span>
                </div>
              ) : (
                <span className="sr-only">Chưa kết nối:</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href="/settings"
                onClick={(event) => {
                  event.preventDefault();
                  onSettings();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-neutral-50 border border-[#E7E7E2] hover:border-[#D1D5DB] text-xs font-medium text-[#111827] shadow-2xs transition-colors"
              >
                Kết nối thêm
              </a>
              <a
                href="/guide"
                aria-label="Cẩm nang & Mẫu câu lệnh"
                onClick={(event) => {
                  event.preventDefault();
                  navigate('/guide');
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#4B5563] hover:text-[#111827] hover:bg-neutral-100/80 transition-colors"
              >
                Cẩm nang mẫu lệnh
              </a>
            </div>
          </div>
        );
      })()}
      {loading && <p role="status">Đang tải dịch vụ…</p>}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
export function DiscoveryMoment({
  request,
  gather,
  services,
  onCancelWait,
}: {
  request: string;
  gather: GatherState | null;
  services: ServiceInfo[];
  onCancelWait?: () => void;
}) {
  const origin = useScheduledOrigin();
  const completedCount = gather?.steps.filter((s) => s.status === 'completed').length ?? 0;
  const totalSteps = gather?.steps.length ?? 0;

  return (
    <section
      id="moment-2"
      className="stage-section is-active max-w-2xl mx-auto w-full pt-2 sm:pt-4"
      data-moment="2"
      aria-label="Cockpit"
    >
      <div className="bg-white rounded-2xl border border-[#E5E5E0] shadow-2xs overflow-hidden">
        {/* Top Workflow Stepper & Safety Assurance */}
        <div className="px-5 py-3 bg-[#F8F8F6] border-b border-[#EAEAE4] flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#DEDED8] font-semibold text-[#111827] shadow-2xs">
              <span
                id="moment-2-pulse"
                className="w-2 h-2 rounded-full bg-[#FF5701] animate-pulse"
              />
              <span>1. Phân tích &amp; tra cứu</span>
            </span>
            <span className="text-[#9CA3AF] hidden sm:inline" aria-hidden="true">
              →
            </span>
            <span className="text-[#6B7280] font-medium hidden sm:inline">
              2. Xem trước kế hoạch
            </span>
            <span className="text-[#9CA3AF] hidden md:inline" aria-hidden="true">
              →
            </span>
            <span className="text-[#6B7280] font-medium hidden md:inline">
              3. Duyệt &amp; thực thi
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
            <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <span>Chưa ghi dữ liệu</span>
          </span>
        </div>

        {/* User Request Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#F1F1EC] v3-space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-[#6B7280]">
              Yêu cầu đang xử lý
            </span>
            {onCancelWait && !origin && (
              <button
                type="button"
                onClick={onCancelWait}
                className="text-xs font-medium text-[#4B5563] hover:text-[#111827] px-2.5 py-1 rounded-lg hover:bg-[#F4F4F1] border border-transparent hover:border-[#E5E5E0] transition-colors cursor-pointer"
              >
                Sửa lại yêu cầu
              </button>
            )}
          </div>
          {origin && <RequestEcho request={request} />}
          <h1
            id="heading-moment-2"
            className="text-lg sm:text-xl font-semibold text-[#111827] leading-snug [overflow-wrap:anywhere]"
            tabIndex={-1}
          >
            <span id="moment-2-query-display">
              {origin ? 'Planora đang lập kế hoạch cho lượt này' : request}
            </span>
          </h1>
        </div>

        {/* Live Resource Lookup Feed */}
        <div className="px-5 sm:px-6 py-4 v3-space-y-3 bg-white">
          <div className="flex items-center justify-between gap-2">
            <span
              id="moment-2-status-text"
              className="text-xs font-semibold text-[#374151]"
            >
              Tiến trình kiểm tra công cụ liên quan
            </span>
            {totalSteps > 0 && (
              <span className="text-xs text-[#6B7280] font-medium">
                {completedCount}/{totalSteps} hoàn tất
              </span>
            )}
          </div>

          <ul
            className="v3-space-y-2 text-sm"
            id="discovery-steps-list"
            aria-live="polite"
          >
            {!gather?.steps.length ? (
              <li className="flex items-center gap-3 p-3 rounded-xl bg-[#FAFAF8] border border-[#EAEAE4] text-[#4B5563]">
                <svg
                  className="w-4 h-4 text-[#FF5701] animate-spin shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-sm text-[#374151]">
                  Đang đọc yêu cầu và xác định công cụ cần kết nối…
                </span>
              </li>
            ) : (
              gather.steps.map((step, index) => {
                const service =
                  toolDefinition(step.tool)?.service ??
                  step.tool.split('.')[0];
                const serviceLabel =
                  services.find((row) => row.id === service)?.name ??
                  getServiceDefinition(service)?.name ??
                  service;
                const found = step.status === 'completed';
                return (
                  <li
                    key={step.tool + '-' + index}
                    id={'disc-step-' + (index + 1)}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl border transition-colors ${
                      found
                        ? 'bg-white border-[#EAEAE4]'
                        : 'bg-[#FAFAF8] border-[#E5E5E0]'
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-white border border-[#E5E5E0] shadow-2xs flex items-center justify-center flex-shrink-0">
                        <ServiceLogo service={service} className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="text-sm font-medium text-[#111827]">
                          {found ? 'Đã đối chiếu trên ' : 'Tra cứu ngữ cảnh trên '}
                          {serviceLabel}
                        </span>
                        {step.result && (
                          <strong className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-[#F4F4F1] border border-[#E5E5E0] text-xs font-medium text-[#111827]">
                            {step.result}
                          </strong>
                        )}
                      </span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 border ${
                        found
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-white text-[#4B5563] border-[#E5E5E0]'
                      }`}
                    >
                      {found ? (
                        <>
                          <span aria-hidden="true">✓</span>
                          <span>Đã xác định</span>
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-3 h-3 text-[#FF5701] animate-spin"
                            fill="none"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                          >
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span>Đang tra cứu</span>
                        </>
                      )}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
