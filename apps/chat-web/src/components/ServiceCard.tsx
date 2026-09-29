import React, { useState } from 'react';

export interface ServiceCardProps {
  service: string;
  title: string;
  connected?: boolean;
  allowedScope?: string[];
  onSave?: (credentials: { apiKey?: string; token?: string; allowedScope: string[] }) => void;
  onTestConnection?: () => void;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({
  service,
  title,
  connected = false,
  allowedScope: initialScope = [],
  onSave,
  onTestConnection,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  const [scopes, setScopes] = useState<string[]>(initialScope);
  const [newScope, setNewScope] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);

  const handleTest = () => {
    setTestResult('Đang kiểm tra... ⏳');
    onTestConnection?.();
    setTimeout(() => {
      setTestResult('✓ Kết nối tốt (Ping: 120ms)');
    }, 600);
  };

  const handleAddScope = () => {
    if (newScope.trim() && !scopes.includes(newScope.trim())) {
      setScopes([...scopes, newScope.trim()]);
      setNewScope('');
    }
  };

  const handleRemoveScope = (scopeToRemove: string) => {
    setScopes(scopes.filter((s) => s !== scopeToRemove));
  };

  const handleSave = () => {
    onSave?.({ apiKey, token, allowedScope: scopes });
  };

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-zinc-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0071e3] text-white flex items-center justify-center font-bold text-xs uppercase shadow-xs">
            {service[0]}
          </div>
          <h4 className="font-semibold text-zinc-900 text-base">{title}</h4>
        </div>
        <span
          className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
            connected
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-zinc-100 text-zinc-500 border border-zinc-200'
          }`}
        >
          {connected ? 'Đã kết nối ✅' : 'Chưa kết nối ⚪'}
        </span>
      </div>

      {/* Credential Inputs */}
      <div className="mt-4 flex flex-col gap-3">
        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-1">
            API Key / Client ID
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="••••••••••••••••"
            className="w-full bg-[#f5f5f7] border border-zinc-200 rounded-xl px-3.5 py-2 text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-700 mb-1">
            OAuth / API Token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="••••••••••••••••"
            className="w-full bg-[#f5f5f7] border border-zinc-200 rounded-xl px-3.5 py-2 text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Allowed Scope Section */}
      <div className="mt-4 pt-3 border-t border-zinc-100">
        <label className="block text-xs font-semibold text-zinc-800 mb-1">
          Phạm vi được phép truy cập (Allowed Scope)
        </label>
        <p className="text-[11px] text-zinc-500 mb-2">
          Giới hạn các board / channel mà AI được phép đọc và ghi.
        </p>

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {scopes.map((sc) => (
            <span
              key={sc}
              className="inline-flex items-center gap-1.5 bg-[#f5f5f7] border border-zinc-200 text-zinc-800 text-xs px-2.5 py-1 rounded-lg"
            >
              <span>{sc}</span>
              <button
                type="button"
                onClick={() => handleRemoveScope(sc)}
                className="text-zinc-400 hover:text-red-500 font-bold text-xs"
              >
                ✕
              </button>
            </span>
          ))}
        </div>

        {/* Add Scope Input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newScope}
            onChange={(e) => setNewScope(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddScope();
              }
            }}
            placeholder="Thêm board hoặc channel..."
            className="flex-1 bg-[#f5f5f7] border border-zinc-200 rounded-xl px-3 py-1.5 text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddScope}
            className="text-xs font-medium text-[#0066cc] border border-blue-300 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition"
          >
            Thêm
          </button>
        </div>
      </div>

      {/* Action Footer */}
      <div className="mt-6 pt-4 border-t border-zinc-100 flex items-center justify-between">
        {onTestConnection && (
          <button
            type="button"
            onClick={handleTest}
            className="text-xs font-medium text-[#0066cc] border border-blue-400 hover:bg-blue-50 px-4 py-2 rounded-full transition"
          >
            {testResult || 'Kiểm tra kết nối'}
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          className="text-xs font-medium bg-[#0071e3] text-white hover:bg-blue-600 px-5 py-2 rounded-full transition shadow-xs ml-auto"
        >
          Lưu cấu hình
        </button>
      </div>
    </div>
  );
};
