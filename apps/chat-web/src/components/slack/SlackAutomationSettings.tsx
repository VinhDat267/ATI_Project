import {useEffect,useRef,useState,useId} from 'react';
import {SLACK_ASSISTANT_INTENT_SERVICES,defaultSlackAssistantConfig,validateSlackAssistantConfig,type SlackAssistantConfig,type SlackAssistantSettingsView,type SlackAssistantRule,type SlackConversationKind} from '@wap/tool-schemas';
import {slackAssistantApi} from '../../services/slack-assistant';
import {slackSessionOwner} from '../../services/slack-connection';
import {authStorage} from '../../services/auth-storage';
const field='w-full min-w-0 rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] bg-white dark:bg-[#1E1E1E] px-3 py-2 text-sm text-[#111827] dark:text-white';
const button='rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] px-3 py-2 text-sm disabled:opacity-50';
export function SlackAutomationSettings({connectionId,workspaceName,active}:{connectionId:string;workspaceName:string;active:boolean}){
 const id=useId(),[open,setOpen]=useState(false),[view,setView]=useState<SlackAssistantSettingsView|null>(null),[draft,setDraft]=useState<SlackAssistantConfig|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0),[channel,setChannel]=useState(''),[thread,setThread]=useState('');
 const generation=useRef(0);
 useEffect(()=>{const owns=slackSessionOwner();return authStorage.subscribeAuthTokens(()=>{if(!owns()){generation.current++;setOpen(false);setView(null);setDraft(null);setError('');setNotice('');setChannel('');setThread('');setBusy(false);}});},[connectionId]);
 useEffect(()=>{
  if(!open)return;const epoch=++generation.current,owns=slackSessionOwner(),controller=new AbortController();setView(null);setDraft(null);setError('');setNotice('');setBusy(true);
  void slackAssistantApi.get(connectionId,AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])).then(data=>{if(owns()&&epoch===generation.current){setView(data);setDraft(data.config);}},()=>{if(owns()&&epoch===generation.current&&!controller.signal.aborted)setError('Không tải được cấu hình tự động hóa. Hãy thử tải lại.');}).finally(()=>{if(owns()&&epoch===generation.current)setBusy(false);});
  return ()=>{generation.current++;controller.abort();};
 },[open,connectionId,reload]);
 const patch=(value:Partial<SlackAssistantConfig>)=>setDraft(current=>current?{...current,...value}:null);
 const rule=(index:number,value:Partial<SlackAssistantRule>)=>draft&&patch({rules:draft.rules.map((r,n)=>n===index?{...r,...value}:r)});
 const save=async()=>{
  if(!draft||!view||busy)return;const owns=slackSessionOwner(),epoch=generation.current;setError('');setNotice('');
  let config:SlackAssistantConfig;try{config=validateSlackAssistantConfig({...draft,rules:draft.rules.map(r=>({...r,keywords:r.keywords.map(x=>x.trim()).filter(Boolean),authorIds:r.authorIds.map(x=>x.trim()).filter(Boolean)}))});}catch{setError('Kiểm tra luật, múi giờ và các giới hạn dương. Giới hạn tháng phải đủ cho giới hạn ngày.');return;}
  setBusy(true);try{const result=await slackAssistantApi.update(connectionId,view.configVersion,config);if(owns()&&epoch===generation.current){setView(result);setDraft(result.config);setNotice('Đã lưu tự động hóa cho workspace này.');}}
  catch(e){if(owns()&&epoch===generation.current)setError((e as any)?.status===409?'Cấu hình đã thay đổi ở nơi khác. Tải lại trước khi lưu.':'Chưa lưu được cấu hình. Kiểm tra quyền xử lý hoặc tải lại cấu hình.');}
  finally{if(owns()&&epoch===generation.current)setBusy(false);}
 };
 const follow=async(value:boolean)=>{const owns=slackSessionOwner(),epoch=generation.current;if(!/^[A-Za-z0-9_-]{1,64}$/.test(channel)||!/^\d{1,10}(?:\.\d{1,6})?$/.test(thread)){setError('Nhập ID kênh và timestamp gốc hợp lệ.');return;}setBusy(true);setError('');setNotice('');try{await slackAssistantApi.follow(connectionId,channel,thread,value);if(owns()&&epoch===generation.current)setNotice(value?'Đã theo dõi các sự kiện mới trong thread.':'Đã dừng theo dõi các sự kiện mới trong thread.');}catch{if(owns()&&epoch===generation.current)setError('Chưa cập nhật được thread.');}finally{if(owns()&&epoch===generation.current)setBusy(false);}};
 return <div className="mt-4 border-t border-[#E7E7E2] dark:border-[#333333] pt-3 text-[#111827] dark:text-white">
  <button type="button" className={button} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)} aria-label={'Tự động hóa '+workspaceName}>Tự động hóa và đề xuất</button>
  {open&&<div id={id} className="mt-3 space-y-4 min-w-0">
   {busy&&!view&&<p role="status">Đang tải tự động hóa…</p>}
   {error&&<p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}{notice&&<p role="status" className="text-sm text-green-700 dark:text-green-300">{notice}</p>}
   {draft&&view&&<fieldset disabled={busy} className="min-w-0 space-y-4">
    {!view.available&&<p className="text-sm">Tự động hóa chưa khả dụng. Bạn vẫn có thể xem và lưu tùy chọn khi tắt xử lý.</p>}
    {!active&&<p className="text-sm">Cần kết nối lại workspace trước khi bật xử lý.</p>}
    {view.pausedReason&&<p role="status" className="text-sm text-amber-800 dark:text-amber-300">{view.pausedReason==='budget_exceeded'?'Đã tạm dừng vì hết ngân sách. Việc chưa xử lý vẫn đang chờ.':'Hàng đợi đầy. Các sự kiện chưa xử lý đang chờ thêm chỗ.'}</p>}
    {view.queue&&<p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">{view.queue.pending} việc đang chờ · {view.queue.running} đang xử lý · {view.queue.held} chờ ngân sách · {view.queue.needsAttention} cần xem lại (lần tải gần nhất).</p>}
    <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={draft.enabled} disabled={busy||(!draft.enabled&&(!view.available||!active))} onChange={e=>patch({enabled:e.target.checked})}/>Tự động tạo đề xuất</label>
    <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">Chỉ xử lý sự kiện mới sau khi bật. Đề xuất luôn cần bạn xem và phê duyệt trước khi ghi sang dịch vụ.</p>
    <label className="block text-sm space-y-1"><span>Chế độ</span><select className={field} value={draft.mode} disabled={busy} onChange={e=>patch({mode:e.target.value as SlackAssistantConfig['mode']})}><option value="rules">Rules — dùng luật</option><option value="ai">AI — phân loại mọi sự kiện hợp lệ</option><option value="hybrid">Hybrid — luật lọc rồi AI phân loại</option></select></label>
    <p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">{draft.mode==='rules'?'Rules tạo đề xuất theo luật, không gọi AI.':draft.mode==='ai'?'AI xem mọi sự kiện đủ điều kiện. Chỉ đề xuất khi có bằng chứng liên quan trực tiếp đến bạn.':'Hybrid chỉ gọi AI khi sự kiện khớp luật cá nhân.'}</p>
    <details><summary className="cursor-pointer text-sm font-semibold">Luật dùng cho Rules và Hybrid</summary><div className="mt-3 space-y-4">
     {draft.rules.map((r,index)=><fieldset key={r.id} className="rounded-lg border border-[#D1D5DB] dark:border-[#4B5563] p-3 space-y-3 min-w-0"><legend className="px-1 text-sm">Luật {index+1}</legend>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={r.enabled} onChange={e=>rule(index,{enabled:e.target.checked})}/>Bật luật {index+1}</label>
      <label className="block text-sm">Tên luật<input className={field} value={r.name} maxLength={100} onChange={e=>rule(index,{name:e.target.value})}/></label>
      <label className="block text-sm">Từ khóa (mỗi dòng một từ khóa)<textarea className={field} value={r.keywords.join('\n')} rows={3} onChange={e=>rule(index,{keywords:e.target.value.split('\n')})}/></label>
      <label className="block text-sm">Cách khớp từ khóa<select className={field} value={r.keywordMode} onChange={e=>rule(index,{keywordMode:e.target.value as 'any'|'all'})}><option value="any">Một từ khóa</option><option value="all">Tất cả từ khóa</option></select></label>
      <label className="block text-sm">ID người gửi (cách nhau bởi dấu phẩy)<input className={field} value={r.authorIds.join(',')} onChange={e=>rule(index,{authorIds:e.target.value.split(',')})}/></label>
      <div className="flex flex-wrap gap-3">{(['public','private','im','mpim'] as SlackConversationKind[]).map(kind=><label key={kind} className="flex gap-1 text-sm"><input type="checkbox" checked={r.conversationTypes.includes(kind)} onChange={e=>rule(index,{conversationTypes:e.target.checked?[...r.conversationTypes,kind]:r.conversationTypes.filter(v=>v!==kind)})}/>{({public:'Kênh công khai',private:'Kênh riêng tư',im:'Tin nhắn riêng',mpim:'Nhóm nhắn tin'})[kind]}</label>)}</div>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={r.requireMention} onChange={e=>rule(index,{requireMention:e.target.checked})}/>Yêu cầu nhắc trực tiếp tài khoản Slack của tôi</label>
      <label className="block text-sm">Loại đề xuất<select className={field} value={r.intent.action} onChange={e=>rule(index,{intent:{...r.intent,action:e.target.value as SlackAssistantRule['intent']['action']}})}>{(['task','issue','progress','question'] as const).map(action=><option key={action} value={action}>{({task:'Công việc',issue:'Sự cố',progress:'Tiến độ',question:'Câu hỏi'})[action]}</option>)}</select></label>
      <label className="block text-sm">Dịch vụ gợi ý<select className={field} value={r.intent.service} onChange={e=>rule(index,{intent:{...r.intent,service:e.target.value as SlackAssistantRule['intent']['service']}})}>{SLACK_ASSISTANT_INTENT_SERVICES.map(service=><option key={service} value={service}>{service}</option>)}</select></label>
      <label className="block text-sm">Nội dung mẫu (để trống dùng yêu cầu gốc)<input className={field} value={r.intent.template} maxLength={512} onChange={e=>rule(index,{intent:{...r.intent,template:e.target.value}})}/></label>
      <button type="button" className={button} onClick={()=>patch({rules:draft.rules.filter((_,n)=>n!==index)})}>Xóa luật {index+1}</button>
     </fieldset>)}
     <button type="button" className={button} disabled={draft.rules.length>=20} onClick={()=>{const r=defaultSlackAssistantConfig().rules[0]!;patch({rules:[...draft.rules,{...r,id:crypto.randomUUID(),name:'Luật mới',keywords:[]}]});}}>Thêm luật</button>
    </div></details>
    <fieldset className="space-y-3"><legend className="font-semibold text-sm">Giới hạn xử lý</legend><p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">Ngân sách đặt lại theo ngày/tháng UTC. Mỗi lần thử lại AI cũng tính một lượt. Token được giữ trước theo giới hạn đầu vào/đầu ra; lần gọi chưa rõ kết quả không được hoàn ngân sách.</p>
     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{([{key:'dailyCalls',label:'Số lượt AI mỗi ngày',max:1000000},{key:'monthlyCalls',label:'Số lượt AI mỗi tháng',max:10000000},{key:'dailyTokens',label:'Ngân sách token mỗi ngày',max:1000000000},{key:'monthlyTokens',label:'Ngân sách token mỗi tháng',max:10000000000},{key:'maxOutputTokens',label:'Token đầu ra tối đa mỗi lượt',max:4096}] as const).map(item=><label key={item.key} className="block text-sm">{item.label}<input type="number" className={field} min={item.key==='maxOutputTokens'?256:1} max={item.max} step={1} value={Number.isFinite(draft.budget[item.key])?draft.budget[item.key]:''} onChange={e=>patch({budget:{...draft.budget,[item.key]:e.target.valueAsNumber}})}/></label>)}
      <label className="block text-sm">Tối đa việc trong hàng đợi<input className={field} type="number" min={1} max={10000} value={Number.isFinite(draft.maxQueueLength)?draft.maxQueueLength:''} onChange={e=>patch({maxQueueLength:e.target.valueAsNumber})}/></label>
      <label className="block text-sm">Số ngày lưu nội dung (tối đa theo quyền workspace)<input className={field} type="number" min={1} max={7} value={Number.isFinite(draft.retentionDays)?draft.retentionDays:''} onChange={e=>patch({retentionDays:e.target.valueAsNumber})}/></label>
      <label className="block text-sm">Múi giờ<input className={field} value={draft.timezone} maxLength={80} onChange={e=>patch({timezone:e.target.value})}/></label>
     </div>
    </fieldset>
    <fieldset className="space-y-3 border-t border-[#E7E7E2] dark:border-[#333333] pt-3"><legend className="font-semibold text-sm">Bản tóm tắt hàng ngày</legend>
     <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={draft.digest.enabled} onChange={e=>patch({digest:{...draft.digest,enabled:e.target.checked}})}/>Bật bản tóm tắt hàng ngày</label>
     <label className="block text-sm">Giờ gửi bản tóm tắt (HH:MM)<input className={field} value={draft.digest.time} maxLength={5} onChange={e=>patch({digest:{...draft.digest,time:e.target.value}})}/></label>
    </fieldset>
    <div className="flex flex-wrap items-center gap-2"><button type="button" className="rounded-lg bg-[#FF5701] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={()=>void save()}>Lưu tự động hóa</button><a href="/inbox" className={button}>Mở hộp thư đề xuất</a></div>
    <fieldset className="space-y-3 border-t border-[#E7E7E2] dark:border-[#333333] pt-3"><legend className="text-sm font-semibold">Theo dõi một thread</legend><p className="text-sm text-[#4B5563] dark:text-[#9CA3AF]">Chỉ nhận các sự kiện mới sau khi theo dõi; không quét lại lịch sử.</p><label className="block text-sm">ID kênh<input className={field} value={channel} maxLength={64} onChange={e=>setChannel(e.target.value)}/></label><label className="block text-sm">Timestamp gốc của thread<input className={field} value={thread} maxLength={17} onChange={e=>setThread(e.target.value)}/></label><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void follow(true)}>Theo dõi thread</button><button type="button" className={button} disabled={busy} onClick={()=>void follow(false)}>Dừng theo dõi thread</button></div></fieldset>
   </fieldset>}
   <button type="button" className={button} disabled={busy} onClick={()=>setReload(v=>v+1)}>Tải lại cấu hình</button>
  </div>}
 </div>;
}
