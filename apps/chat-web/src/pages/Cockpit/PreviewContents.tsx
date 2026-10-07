// Source: AppStagePage.tsx PREVIEW.card/issue/rows/message content, with actual plan arguments.
import { getToolDefinition } from '@wap/tool-schemas';
import type { PlanStep } from '../../types';
import { formatArgValue } from '../../components/PlanStepItem';
import { operation } from './presentation';

const names: Record<string,string> = {
  title:'Tiêu đề', name:'Tên', summary:'Tiêu đề', body:'Nội dung', text:'Nội dung',
  desc:'Mô tả ngắn', description:'Mô tả', range:'Vùng dữ liệu yêu cầu', values:'Giá trị', rows:'Các dòng',
};
const text = (value:unknown) => formatArgValue(value).text;

function OtherArguments({step,except}:{step:PlanStep;except:string[]}) {
  return Object.entries(step.args).filter(([key])=>!except.includes(key) && !getToolDefinition(step.tool)?.inputSchema.properties?.[key]?.['x-resource']).map(([key,value])=><div key={key}>
    <span className="text-[11px] text-neutral-400 uppercase font-semibold">{names[key] ?? key}:</span>
    <div className="text-xs text-neutral-800 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed v3-space-y-1.5 whitespace-pre-wrap break-words">{text(value)}</div>
  </div>);
}

export function PreviewContents({step,destination}:{step:PlanStep;destination:string}) {
  const style=operation(step.tool).previewStyle;
  if(style==='card') return <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
    {step.args.title!=null && <div>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">Tiêu đề card:</span>
      <div className="text-sm font-bold text-neutral-900 mt-0.5">{text(step.args.title)}</div>
    </div>}
    <div>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">Đích:</span>
      <div className="text-xs text-neutral-700 mt-0.5">{destination}</div>
    </div>
    {step.args.desc!=null && <div>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">Mô tả ngắn:</span>
      <p className="text-xs text-neutral-700 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed">{text(step.args.desc)}</p>
    </div>}
    <OtherArguments step={step} except={['title','desc']}/>
  </div>;
  if(style==='message') return <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-2.5">
    <div className="flex items-center justify-between text-xs text-neutral-500">
      <span>{'Đích: '}<strong>{destination}</strong></span>
    </div>
    {step.args.text!=null && <div className="bg-white p-3 rounded-lg border border-neutral-200 text-xs text-neutral-900 leading-relaxed font-sans v3-space-y-1.5 whitespace-pre-wrap break-words">{text(step.args.text)}</div>}
    <OtherArguments step={step} except={['text']}/>
  </div>;
  if(style==='rows') {
    const values=step.args.values ?? step.args.rows;
    const rows=Array.isArray(values) ? values.filter(Array.isArray) as unknown[][] : [];
    return <div className="v3-space-y-3">
      <div className="text-xs text-neutral-600">{'Đích: '}<strong>{destination}</strong></div>
      <div className="border border-neutral-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-100 text-neutral-600 font-semibold border-b border-neutral-200">
            <tr><th className="p-2.5">Cột</th><th className="p-2.5">Giá trị sẽ ghi</th></tr>
          </thead>
          <tbody className="v3-divide-y divide-neutral-200 bg-white">
            {rows.flatMap((row,rowIndex)=>row.map((value,columnIndex)=><tr key={`${rowIndex}-${columnIndex}`}>
              <td className="p-2.5 font-medium text-neutral-500">Giá trị {columnIndex+1}{rows.length>1 ? ` · nhóm ${rowIndex+1}` : ''}</td>
              <td className="p-2.5">{text(value)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <OtherArguments step={step} except={['values','rows']}/>
    </div>;
  }
  // The issue frame is also the catalog fallback for tools without a prototype-specific preview.
  return <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
    <div>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">Đích:</span>
      <div className="text-xs font-medium text-neutral-800 mt-0.5">{destination}</div>
    </div>
    {Object.entries(step.args).filter(([key])=>['title','name','summary'].includes(key)).map(([key,value])=><div key={key}>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">{names[key]}:</span>
      <div className="text-sm font-bold text-neutral-900 mt-0.5">{text(value)}</div>
    </div>)}
    <OtherArguments step={step} except={['title','name','summary']}/>
  </div>;
}
