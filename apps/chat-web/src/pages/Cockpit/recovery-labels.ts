import labels from './recovery-labels.json';

/** Presentation metadata; core lookup stays generic for future services. */
const common: Record<string, string> = labels.common;
const services: Record<string, Record<string, string>> = labels.services;

export function recoveryFieldLabel(tool: string, key: string, description?: string): string {
  return description || services[tool.split('.')[0]]?.[key] || common[key] || key;
}

export function friendlyFieldLabel(tool: string, key: string, description?: string): string {
  const serviceKey = tool.split('.')[0];
  const serviceOverride = services[serviceKey]?.[key];
  if (serviceOverride) return serviceOverride;

  if (key === 'channel') return 'Tên kênh hoặc mã kênh';
  if (key === 'text' || key === 'body' || key === 'message' || key === 'content') return 'Nội dung tin nhắn';
  if (key === 'title' || key === 'name' || key === 'summary') return 'Tiêu đề';
  if (key === 'description') return 'Mô tả chi tiết';

  if (description) {
    return description.replace(/^ID\s+/i, 'Mã ').replace(/\bID\s+/gi, 'mã ').replace(/\bID\b/g, 'mã');
  }

  return common[key] || key;
}

const outputs: Record<string, string> = { ...common, ...labels.outputs };

/** Keep every path segment: two fields of one output must remain distinguishable. */
export function recoveryOutputLabel(path: string[]): string {
  return path.map(key => /^\d+$/.test(key) ? `mục ${Number(key) + 1}` : outputs[key]?.toLocaleLowerCase('vi-VN') || `trường “${key}”`).join(' / ');
}
