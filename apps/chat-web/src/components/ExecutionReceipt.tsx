import { getToolDefinition, getServiceDefinition } from '@wap/tool-schemas';
import { ResultFields, type ExecutionStepInfo } from './ExecutionProgress';
import { ServiceLogo } from './ServiceLogo';
import type { ServiceInfo } from '../types';
export function ExecutionReceipt({ steps, services }: {steps: ExecutionStepInfo[];services: ServiceInfo[]}) {
  const groups = new Map<string, ExecutionStepInfo[]>();
  for (const step of steps) {
    const service=getToolDefinition(step.tool)?.service ?? step.tool.split('.')[0];
    groups.set(service,[...(groups.get(service) ?? []),step]);
  }
  const succeeded=steps.filter(step=>step.status==='succeeded').length;
  const skipped=steps.filter(step=>step.status==='skipped').length;
  return <div aria-label="Biên nhận công việc" className="space-y-4">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="text-xl">Biên nhận công việc</h2><span>{succeeded}/{steps.length} hoàn thành</span></div>
    {[...groups].map(([service,rows])=><section key={service} aria-label={services.find(item=>item.id===service)?.name ?? getServiceDefinition(service)?.name ?? service} className="border border-border rounded-2xl bg-surface p-5">
      <h3 className="flex items-center gap-3 font-sans font-semibold mb-4"><ServiceLogo service={service} />{services.find(item=>item.id===service)?.name ?? getServiceDefinition(service)?.name ?? service}</h3>
      <ol className="space-y-5">{rows.map(step=><li key={step.id}><div className="flex justify-between gap-3"><p className="font-semibold">{step.description}</p><span className="shrink-0 text-text-secondary">{step.duration}</span></div><p className="text-sm text-text-secondary">{step.status==='skipped'?'Đã bỏ qua':step.status==='succeeded'?'Hoàn thành':'Chưa hoàn thành'}</p>{step.output != null && <ResultFields output={step.output} tool={step.tool} />}<details className="mt-2 text-sm"><summary>Thông tin bước</summary><code>{step.tool}</code>{step.completedAt && <time className="block" dateTime={step.completedAt}>{new Date(step.completedAt).toLocaleString('vi-VN',{hour12:false})}</time>}</details></li>)}</ol>
    </section>)}
    <p role="status" className="text-success-text">Đã hoàn thành {succeeded}/{steps.length} bước{skipped ? `; ${skipped} bước đã bỏ qua` : ''}.</p>
  </div>;
}
