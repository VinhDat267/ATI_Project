import type { ScheduleRunView } from '@wap/tool-schemas';
import { apiClient } from './api-client';

/** Creating a run returns before the runner has assigned its conversation. */
export async function runConversation(run: ScheduleRunView, signal: AbortSignal): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (!run.convId) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error('Lượt đã tạo. Hãy mở lại từ Nhật ký sau ít giây.');
    const data = await apiClient.getScheduleRuns(run.scheduleId, 50);
    run = data.runs.find(row => row.id === run.id) ?? run;
    if (!run.convId) await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 200);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  signal.throwIfAborted();
  return run.convId;
}
