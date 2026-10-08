import { useState } from 'react';
import { getToolDefinition } from '@wap/tool-schemas';
import { CockpitDialog } from '../../components/CockpitDialog';
import { recoveryFieldLabel } from './recovery-labels';

export function RecoveryEditor({tool,stepArgs,prompt,busy,onClose,onSubmit}:{tool:string;stepArgs?:Record<string,unknown>;prompt?:string;busy:boolean;onClose:()=>void;onSubmit:(args:Record<string,unknown>,prompt?:string)=>void}) {
  const schema=getToolDefinition(tool)?.inputSchema as { properties?: Record<string,{description?:string;type?:string}>;required?:string[] } | undefined;
  const [args]=useState(stepArgs ?? {});
  const [fieldText,setFieldText]=useState<Record<string,string>>({});
  const [json,setJson]=useState(JSON.stringify(stepArgs ?? {},null,2));
  const [promptText,setPrompt]=useState(prompt ?? '');
  const [error,setError]=useState<string|null>(null);
  const [confirm,setConfirm]=useState(false);
  const parse=()=>{
    try {const result=schema ? {...args} : JSON.parse(json);
      if(schema) for(const [key,property] of Object.entries(schema.properties ?? {})) {
        if(Object.hasOwn(fieldText,key)) {
          const raw=fieldText[key];
          result[key]=['object','array','boolean'].includes(property.type ?? '') ? JSON.parse(raw) : ['number','integer'].includes(property.type ?? '') ? (raw.trim() ? Number(raw) : NaN) : raw;
        }
        const value=result[key];
        if(value===undefined && !schema.required?.includes(key)) continue;
        if(property.type==='array' && !Array.isArray(value)) throw new Error();
        if(property.type==='object' && (!value || typeof value!=='object' || Array.isArray(value))) throw new Error();
        if(['number','integer'].includes(property.type ?? '') && (typeof value!=='number' || !Number.isFinite(value) || (property.type==='integer' && !Number.isInteger(value)))) throw new Error();
        if(property.type==='boolean' && typeof value!=='boolean') throw new Error();
        if(property.type==='string' && typeof value!=='string') throw new Error();
      }
if(!result || typeof result!=='object' || Array.isArray(result))throw new Error();setError(null);return result as Record<string,unknown>;}
    catch {setError('Định dạng JSON không hợp lệ. Vui lòng nhập một đối tượng tham số.');return null;}
  };
  return <CockpitDialog title="Sửa rồi thử lại" returnFocusId="btn-recovery-edit" onClose={()=>{if(!busy){if(confirm)setConfirm(false);else onClose();}}}>
    <form className="p-5 v3-space-y-4 text-sm" onSubmit={event=>{event.preventDefault();const result=parse();if(!result)return;if(!confirm)setConfirm(true);else onSubmit(result,promptText || undefined);}}>
      <p>Để sửa tham số, cần dừng kế hoạch cũ và lập kế hoạch mới. Chưa có lệnh ghi nào chạy cho tới khi bạn duyệt lại.</p>
      {schema ? Object.entries(schema.properties ?? {}).map(([key,property])=><label key={key} className="block v3-space-y-1"><span>{recoveryFieldLabel(tool,key,property.description)}</span><textarea aria-label={recoveryFieldLabel(tool,key,property.description)} required={schema.required?.includes(key)} disabled={busy || confirm} className="block w-full rounded-xl border border-brand-border p-3 bg-white text-brand-text" value={fieldText[key] ?? (typeof args[key]==='string'?args[key] as string:JSON.stringify(args[key] ?? ''))} onChange={event=>{
        setFieldText(current=>({...current,[key]:event.target.value}));
      }}/></label>) : <label className="block v3-space-y-1"><span>Tham số thực thi (JSON)</span><textarea aria-label="Tham số thực thi" value={json} disabled={busy || confirm} onChange={event=>setJson(event.target.value)} className="block w-full rounded-xl border border-brand-border p-3 font-mono bg-white text-brand-text"/></label>}
      <label className="block v3-space-y-1"><span>Ghi chú thêm (không bắt buộc)</span><textarea value={promptText} disabled={busy || confirm} onChange={event=>setPrompt(event.target.value)} className="block w-full rounded-xl border border-brand-border p-3 bg-white text-brand-text"/></label>
      {error && <p role="alert" className="text-brand-danger">{error}</p>}
      {confirm && <p role="status">Không thể chạy tiếp kế hoạch cũ sau khi dừng. Gửi nội dung sửa để ATI lập kế hoạch mới?</p>}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={()=>confirm?setConfirm(false):onClose()} className="px-5 py-3 bg-white border border-brand-border rounded-xl">{confirm?'Quay lại sửa':'Hủy sửa'}</button><button type="submit" disabled={busy} className="px-6 py-3 bg-brand-primary text-white font-semibold rounded-xl">{confirm?'Dừng và gửi yêu cầu sửa':'Xem lại nội dung sửa'}</button></div>
    </form>
  </CockpitDialog>;
}
