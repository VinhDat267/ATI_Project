import type { ExecutionSnapshot } from '../types';

function savedArguments(value: unknown, snapshot: ExecutionSnapshot): unknown {
  const resolve = (ref: string): unknown => {
    const [id, ...path] = ref.split('.');
    const row = snapshot.steps.find(step => step.stepId === id && step.status === 'succeeded');
    if (!row || row.output == null) return undefined;
    if (path.length === 0) return row.output;
    let result: unknown = typeof row.output === 'object' && Object.hasOwn(row.output, 'output') ? row.output : { output: row.output };
    for (const key of path) {
      if (!result || typeof result !== 'object' || !Object.hasOwn(result, key)) return undefined;
      result = (result as Record<string, unknown>)[key];
    }
    return result;
  };
  if (Array.isArray(value)) return value.map(item => savedArguments(item, snapshot));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$ref === 'string') {
      const resolved = resolve(obj.$ref);
      return resolved === undefined ? value : resolved;
    }
    if (typeof obj.$template === 'string') {
      return obj.$template.replace(/\$\{([^}]+)\}/g, (token, ref: string) => {
        const resolved = resolve(ref.trim());
        return resolved === undefined ? token : resolved === null ? '' : String(resolved);
      });
    }
    return Object.fromEntries(Object.entries(obj).map(([key, item]) => [key, savedArguments(item, snapshot)]));
  }
  return value;
}

export function ReconciliationNotice({ snapshot, busy, error, onSkip, onStop, onContinue }: {
  snapshot: ExecutionSnapshot; busy: boolean; error: string | null;
  onSkip: (stepId: string) => void; onStop: () => void; onContinue: () => void;
}) {
  const unknown = snapshot.steps.filter(step => step.status === 'unknown');
  const canContinue = snapshot.recoveryActions.includes('continue') && unknown.length === 0;
  const paused = unknown.find(step => step.stepId === snapshot.execution.pausedStepId);
  const services = [...new Set(unknown.map(step => {
    const service = step.tool.split('.')[0];
    return ({ trello: 'Trello', slack: 'Slack', github: 'GitHub' } as Record<string, string>)[service] || service;
  }))].join(', ') || 'dịch vụ liên quan';
  return (
    <section aria-label="Cần đối soát trước khi tiếp tục" aria-busy={busy}
      className="my-4 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-zinc-800">
      <h2 className="font-semibold text-amber-900">Cần đối soát trước khi tiếp tục</h2>
      {canContinue ? <p className="mt-2">Quy trình bị gián đoạn giữa các bước. Không có bước nào chưa rõ kết quả; các bước còn lại chưa từng được gửi tới dịch vụ. Bạn có thể chạy tiếp các bước còn lại hoặc dừng kế hoạch.</p> : <>
        <p className="mt-2">Quy trình bị gián đoạn. Các bước UNKNOWN dưới đây có thể đã tạo thay đổi nhưng hệ thống chưa xác nhận được kết quả.</p>
        <p className="mt-2">Hãy tự kiểm tra trên {services} trước khi tiếp tục. Skip bỏ qua bước đang đối soát và chạy các bước còn lại; hãy xác nhận thay đổi trên dịch vụ đã đúng. Dừng plan giữ lại bằng chứng để bạn xử lý sau.</p>
        {unknown.length === 0 && <p className="mt-3">Không có bước UNKNOWN có thể tiếp tục. Bạn chỉ có thể dừng kế hoạch này.</p>}
      </>}
      <ul className="mt-3 space-y-3">
        {unknown.map(row => {
          const step = snapshot.plan.steps?.find(item => item.id === row.stepId);
          return <li key={row.stepId} className="rounded-xl border border-amber-200 bg-white p-3 min-w-0">
            <div className="flex flex-wrap gap-2"><code>{row.tool}</code><span className="font-semibold">UNKNOWN · {row.stepId}</span></div>
            {step?.description && <p className="mt-1">{step.description}</p>}
            {step?.args && <><p className="mt-2 text-xs text-zinc-600">Tham số kế hoạch, đối chiếu output đã lưu:</p>
              <pre className="mt-1 whitespace-pre-wrap break-all text-xs">{JSON.stringify(savedArguments(step.args, snapshot), null, 2)}</pre></>}
          </li>;
        })}
      </ul>
      {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {canContinue && <button type="button" disabled={busy} onClick={onContinue}
          className="rounded-full bg-[#0071e3] px-4 py-2 text-white disabled:opacity-50">Chạy tiếp các bước còn lại</button>}
        {paused && snapshot.recoveryActions.includes('skip') && <button type="button" disabled={busy}
          onClick={() => onSkip(paused.stepId)} className="rounded-full bg-[#0071e3] px-4 py-2 text-white disabled:opacity-50">
          Skip step này rồi chạy tiếp
        </button>}
        {snapshot.recoveryActions.includes('stop') && <button type="button" disabled={busy} onClick={onStop}
          className="rounded-full border border-zinc-300 bg-white px-4 py-2 disabled:opacity-50">Dừng plan</button>}
      </div>
      {busy && <p role="status" className="mt-2 text-xs">Đang gửi yêu cầu và tải lại trạng thái…</p>}
    </section>
  );
}
