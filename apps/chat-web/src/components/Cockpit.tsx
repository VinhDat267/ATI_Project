import { type ReactNode } from 'react';
import { toolDefinition } from '../services/tool-definitions';
import presentation from '../assets/cockpit-services.json';
import type { PlanStep, ServiceInfo, User } from '../types';
import type { RecoveryControls } from '../pages/Cockpit/RecoveryMoment';
import { PlanoraChatWorkspace } from '../planora/workspace/PlanoraChatWorkspace';

export interface CockpitProps {
  user?: User | null;
  onLogout?: () => void;
  navigate?: (path: string) => void;
  services: ServiceInfo[];
  servicesLoading: boolean;
  servicesError: string | null;
  onRefreshServices?: () => void;
  onSendMessage: (text: string) => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onSettings: () => void;
  onApprove: () => void;
  onCancel: () => void;
  recovery: RecoveryControls | null;
  networkError?: boolean;
  contentOverride?: ReactNode;
  canConfigureServices?: boolean;
}

export function resourceDestination(step: PlanStep, labels: Record<string, string> = {}): string {
  if (step.chatId && Object.hasOwn(labels, String(step.chatId))) return labels[String(step.chatId)];
  const definition = toolDefinition(step.tool);
  const resourceNames = presentation.resourceNames as Record<string, string>;
  // A Gmail label is what a step applies to a thread, not where it writes.
  const destinationResource = (key: string) => {
    const resource = definition?.inputSchema.properties?.[key]?.['x-resource'];
    return resource && resource !== 'label';
  };
  const mergedArgs = step.repo && !step.args?.repo ? { repo: step.repo, ...step.args } : step.args;
  return (
    Object.entries(mergedArgs)
      .filter(([key]) => destinationResource(key))
      .map(([key, value]) => {
        if ((typeof value === 'string' || typeof value === 'number') && Object.hasOwn(labels, String(value)))
          return labels[String(value)];
        const reference =
          value && typeof value === 'object' && '$ref' in value
            ? String(value.$ref)
            : typeof value === 'string' && value.startsWith('$step_')
              ? value
              : null;
        const number = reference?.match(/step_(\d+)/)?.[1];
        if (number) return `Kết quả của bước ${number}`;
        if (
          key === 'issueNumber' &&
          (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)))
        )
          return `#${value}`;
        if (typeof value === 'string' && (value.startsWith('#') || (key === 'repo' && value.includes('/'))))
          return value;
        const resource = definition?.inputSchema.properties?.[key]?.['x-resource'];
        return `${resourceNames[String(resource)] ?? 'Nơi được chọn'} · chưa có tên trong dữ liệu`;
      })
      .join(' · ') || 'Trong phạm vi dịch vụ đã thiết lập'
  );
}

export function Cockpit(props: CockpitProps) {
  return <PlanoraChatWorkspace {...props} />;
}
export default Cockpit;
