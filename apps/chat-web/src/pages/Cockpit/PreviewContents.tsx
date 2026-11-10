// Source: AppStagePage.tsx PREVIEW.card/issue/rows/message content, with actual plan arguments.
import { toolDefinition } from '../../services/tool-definitions';
import type { PlanStep } from '../../types';
import { formatArgValue } from '../../components/PlanStepItem';
import { operation } from './presentation';
import { GmailPreview } from './GmailPreview';

const names: Record<string,string> = {
  title:'Tiêu đề', name:'Tên', summary:'Tiêu đề', body:'Nội dung', text:'Nội dung',
  desc:'Mô tả ngắn', description:'Mô tả', range:'Vùng dữ liệu yêu cầu', values:'Giá trị', rows:'Các dòng',
  repo:'Kho mã', issueNumber:'Số issue / PR', issueKey:'Mã issue', projectKey:'Mã dự án', issueType:'Loại issue', label:'Nhãn', labels:'Nhãn',
  assignees:'Người phụ trách', state:'Trạng thái', query:'Từ khóa tìm kiếm', limit:'Số lượng tối đa',
  pageId:'Trang Notion', properties:'Thuộc tính', children:'Nội dung khối', filter:'Bộ lọc', content:'Nội dung',
  start:'Thời gian bắt đầu', end:'Thời gian kết thúc', location:'Địa điểm / Link họp',
  createMeetLink:'Phòng họp Google Meet', recurrence:'Chu kỳ lặp lại', eventId:'Mã sự kiện',
  durationMinutes:'Thời lượng cần tìm (phút)', workdayStartHour:'Giờ bắt đầu ngày làm việc', workdayEndHour:'Giờ kết thúc ngày làm việc',
  attendees:'Người tham dự', timeMin:'Từ thời điểm', timeMax:'Đến thời điểm', maxResults:'Số lượng tối đa',
  filterColumn:'Cột lọc', filterOperator:'Điều kiện lọc', filterValue:'Giá trị lọc',
  column:'Cột lọc', operator:'Điều kiện lọc', value:'Giá trị lọc', filters:'Các điều kiện lọc',
  deduplicate:'Chống ghi trùng', onDuplicate:'Xử lý dòng trùng', keyColumnIndex:'Cột khóa đối chiếu', keyColumn:'Cột khóa đối chiếu',
  deduplicateColumn:'Cột khóa đối chiếu', deduplicateColumns:'Các cột khóa đối chiếu', records:'Các dòng theo tên cột',
  groupBy:'Nhóm theo cột', metrics:'Phép tính thống kê', rowNumbers:'Các dòng cần xoá', matchColumn:'Cột đối chiếu', matchValue:'Giá trị đối chiếu',
  due:'Hạn chót', dueComplete:'Hoàn thành hạn chót', closed:'Lưu trữ (Archive)', pos:'Vị trí',
  items:'Các mục công việc', itemName:'Mục checklist', idMembers:'Thành viên được gán', memberId:'Thành viên',
  status:'Lọc theo trạng thái', archived:'Lưu trữ trang Notion',
  targetStatus:'Trạng thái chuyển tới', priority:'Mức độ ưu tiên', assigneeAccountId:'Người phụ trách (Account ID)',
  dueDate:'Hạn hoàn thành (Due date)', parentKey:'Epic / Issue cha', comment:'Bình luận kèm theo',
  docId:'Tài liệu Google Docs', documentId:'Tài liệu Google Docs', fileId:'Tệp Google Drive',
  folderId:'Thư mục Google Drive đích', parentFolderId:'Thư mục cha trên Drive', mimeType:'Loại tệp Google Drive',
  sendInvites:'Gửi email mời họp', timeZone:'Múi giờ', author:'Tác giả', draft:'Bản nháp (Draft)', channel:'Kênh Slack',
};
const operatorLabels: Record<string,string> = {
  equals:'Bằng (=)',
  contains:'Chứa từ khóa',
  not_equals:'Khác (≠)',
  gt:'Lớn hơn (>)',
  gte:'Lớn hơn hoặc bằng (≥)',
  lt:'Nhỏ hơn (<)',
  lte:'Nhỏ hơn hoặc bằng (≤)',
  empty:'Đang để trống',
  not_empty:'Đã có dữ liệu',
  is_empty:'Đang để trống',
  is_not_empty:'Đã có dữ liệu',
};
const text = (value:unknown) => formatArgValue(value).text;

export function formatRecurrenceLabel(recurrence: unknown): string | null {
  if (typeof recurrence !== 'string' || !recurrence.trim()) return null;
  const normalized = recurrence.trim().toUpperCase();
  if (normalized === 'DAILY') return 'Hàng ngày';
  if (normalized === 'WEEKDAYS') return 'Thứ 2 – Thứ 6 hàng tuần';
  if (normalized === 'WEEKLY') return 'Hàng tuần';
  if (normalized === 'BIWEEKLY') return '2 tuần 1 lần';
  if (normalized === 'MONTHLY') return 'Hàng tháng';
  if (normalized.startsWith('RRULE:')) {
    const body = normalized.slice(6);
    const parts = body.split(';').filter(Boolean);
    const params = new Map<string, string>();
    const allowedKeys = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY']);
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx <= 0) return recurrence.trim();
      const k = part.slice(0, eqIdx).trim();
      const v = part.slice(eqIdx + 1).trim();
      if (!allowedKeys.has(k) || !v) return recurrence.trim();
      params.set(k, v);
    }
    const freq = params.get('FREQ');
    if (!freq) return recurrence.trim();
    const intervalRaw = params.get('INTERVAL');
    const interval = intervalRaw ? Number(intervalRaw) : 1;
    if (!Number.isInteger(interval) || interval < 1) return recurrence.trim();
    const byday = params.get('BYDAY');
    const count = params.get('COUNT');
    const until = params.get('UNTIL');

    let label = '';
    if (freq === 'DAILY') {
      label = interval === 1 ? 'Hàng ngày' : `${interval} ngày 1 lần`;
    } else if (freq === 'WEEKLY') {
      if (byday === 'MO,TU,WE,TH,FR' && interval === 1) {
        label = 'Thứ 2 – Thứ 6 hàng tuần';
      } else {
        label = interval === 1 ? 'Hàng tuần' : `${interval} tuần 1 lần`;
        if (byday) label += ` (${byday})`;
      }
    } else if (freq === 'MONTHLY') {
      label = interval === 1 ? 'Hàng tháng' : `${interval} tháng 1 lần`;
      if (byday) label += ` (${byday})`;
    } else if (freq === 'YEARLY') {
      label = interval === 1 ? 'Hàng năm' : `${interval} năm 1 lần`;
    } else {
      return recurrence.trim();
    }

    if (count) label += `, ${count} lần`;
    if (until) label += `, đến ${until}`;
    return label;
  }
  return recurrence.trim();
}

export function formatCalendarDateTime(raw: unknown, timeZone?: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return text(raw);
  const trimmed = raw.trim();
  if (trimmed.startsWith('$')) return text(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-');
    return `${d}/${m}/${y} (Cả ngày)`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  try {
    return parsed.toLocaleString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(typeof timeZone === 'string' && timeZone.trim() ? { timeZone: timeZone.trim() } : {}),
    });
  } catch {
    return `${trimmed} (Múi giờ không hợp lệ)`;
  }
}

function OtherArguments({step,except}:{step:PlanStep;except:string[]}) {
  return Object.entries(step.args).filter(([key])=>!except.includes(key) && !toolDefinition(step.tool)?.inputSchema.properties?.[key]?.['x-resource']).map(([key,value])=><div key={key}>
    <span className="text-[11px] text-neutral-400 uppercase font-semibold">{names[key] ?? key}:</span>
    <div className="text-xs text-neutral-800 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed v3-space-y-1.5 whitespace-pre-wrap break-words">{text(value)}</div>
  </div>);
}

export function PreviewContents({step,destination,labels}:{step:PlanStep;destination:string;labels?:Record<string,string>}) {
  if (step.tool.startsWith('gmail.')) return <GmailPreview step={step} labels={labels} />;
  const style=operation(step.tool).previewStyle;
  if(style==='calendar_event') {
    const isDelete = step.tool.endsWith('.delete_event');
    const recurrenceLabel = formatRecurrenceLabel(step.args.recurrence);
    const hasMeetLink = step.tool === 'mycalendar.schedule_meet' || step.args.createMeetLink === true;
    const timeZoneText = typeof step.args.timeZone === 'string' && step.args.timeZone.trim().length > 0 ? step.args.timeZone.trim() : null;
    const locationText = typeof step.args.location === 'string' && step.args.location.trim().length > 0 ? step.args.location.trim() : null;
    const attendees = Array.isArray(step.args.attendees)
      ? step.args.attendees.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      : [];
    const notifyExisting = step.tool.endsWith('.update_event') && step.args.sendInvites === true;
    const sendInvites = (attendees.length > 0 || notifyExisting) && step.args.sendInvites === true;
    const suppressInvites = attendees.length > 0 && step.args.sendInvites !== true;
    return <div data-testid="calendar-event-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Lịch đích: '}<strong>{destination}</strong></span>
        {isDelete && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            🗑️ Huỷ / xoá sự kiện khỏi lịch
          </span>
        )}
      </div>
      {(step.args.summary!=null || step.args.title!=null) && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Tiêu đề sự kiện:</span>
          <div className="text-sm font-bold text-neutral-900 mt-0.5">{text(step.args.summary ?? step.args.title)}</div>
        </div>
      )}
      {(step.args.start!=null || step.args.end!=null || timeZoneText!=null) && (
        <div className="p-3 bg-white rounded-lg border border-blue-100 v3-space-y-1">
          <span className="text-[11px] text-blue-700 uppercase font-semibold block">Thời gian sự kiện</span>
          {step.args.start!=null && (
            <div className="text-xs text-neutral-800">
              <span className="font-medium text-neutral-500">Bắt đầu: </span>
              <span className="font-semibold">{formatCalendarDateTime(step.args.start, step.args.timeZone)}</span>
            </div>
          )}
          {step.args.end!=null && (
            <div className="text-xs text-neutral-800">
              <span className="font-medium text-neutral-500">Kết thúc: </span>
              <span className="font-semibold">{formatCalendarDateTime(step.args.end, step.args.timeZone)}</span>
            </div>
          )}
          {timeZoneText && (
            <div className="text-xs text-neutral-800 font-medium">
              Múi giờ: {timeZoneText}
            </div>
          )}
        </div>
      )}
      {(hasMeetLink || recurrenceLabel || locationText || attendees.length > 0 || notifyExisting) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {hasMeetLink && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
              🎥 Tự động tạo phòng họp Google Meet
            </span>
          )}
          {recurrenceLabel && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">
              🔁 Lặp lại: {recurrenceLabel}
            </span>
          )}
          {locationText && (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200">
              📍 {locationText}
            </span>
          )}
          {attendees.map((email) => (
            <span key={email} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
              👤 {email}
            </span>
          ))}
          {sendInvites && (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-sky-50 text-sky-800 border border-sky-200">
              {notifyExisting ? '📨 Gửi thông báo cập nhật cho khách mời hiện có và danh sách khách mời sau thay đổi' : '📨 Gửi email mời họp cho khách mời'}
            </span>
          )}
          {suppressInvites && (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
              🔕 Không gửi email mời họp
            </span>
          )}
        </div>
      )}
      {step.args.description!=null && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Nội dung / Agenda:</span>
          <div className="text-xs text-neutral-800 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed whitespace-pre-wrap break-words">{text(step.args.description)}</div>
        </div>
      )}
      <OtherArguments step={step} except={['summary','title','start','end','createMeetLink','recurrence','timeZone','location','description','attendees','sendInvites']}/>
    </div>;
  }
  if(style==='card') {
    const rawMembers = Array.isArray(step.args.idMembers)
      ? step.args.idMembers.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : typeof step.args.memberId === 'string' && step.args.memberId.trim().length > 0
        ? [step.args.memberId.trim()]
        : [];
    const checklistItems = Array.isArray(step.args.items)
      ? step.args.items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    const chkState = step.tool === 'trello.update_checklist_item' && (step.args.state === 'complete' || step.args.state === 'incomplete')
      ? step.args.state
      : null;
    const isRemoveMember = step.tool === 'trello.remove_member';
    const hasBadges = rawMembers.length > 0 || step.args.due != null || typeof step.args.dueComplete === 'boolean' || typeof step.args.closed === 'boolean' || chkState !== null;

    return <div data-testid="trello-card-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      {step.args.title!=null && <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">{step.tool === 'trello.add_checklist' ? 'Tên checklist:' : 'Tiêu đề card:'}</span>
        <div className="text-sm font-bold text-neutral-900 mt-0.5">{text(step.args.title)}</div>
      </div>}
      {step.args.title==null && step.args.name!=null && <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">{step.tool === 'trello.create_list' ? 'Tên cột mới:' : step.tool === 'trello.add_checklist' ? 'Tên checklist:' : 'Tên:'}</span>
        <div className="text-sm font-bold text-neutral-900 mt-0.5">{text(step.args.name)}</div>
      </div>}
      {(step.args.itemName!=null || step.args.checkItemId!=null) && <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Mục checklist:</span>
        <div className="text-sm font-bold text-neutral-900 mt-0.5">
          {step.args.itemName != null ? text(step.args.itemName) : text(labels?.[String(step.args.checkItemId)] ?? step.args.checkItemId)}
          {step.args.itemName != null && step.args.checkItemId != null && (
            <span className="ml-1.5 text-xs font-normal text-neutral-500">
              ({labels?.[String(step.args.checkItemId)] ?? String(step.args.checkItemId)})
            </span>
          )}
        </div>
      </div>}
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Đích:</span>
        <div className="text-xs text-neutral-700 mt-0.5">{destination}</div>
      </div>
      {hasBadges && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="trello-preview-badges">
          {rawMembers.map((memberId) => {
            const resolved = labels?.[memberId] ?? memberId;
            return (
              <span
                key={`mem-${memberId}`}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                  isRemoveMember
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {isRemoveMember ? `👤 Gỡ: ${resolved}` : `👤 ${resolved}`}
              </span>
            );
          })}
          {step.args.due != null && (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
              📅 Hạn chót: {formatCalendarDateTime(step.args.due)}
            </span>
          )}
          {typeof step.args.dueComplete === 'boolean' && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                step.args.dueComplete
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-neutral-100 text-neutral-700 border-neutral-200'
              }`}
            >
              {step.args.dueComplete ? '✓ Đã hoàn thành hạn' : '⏳ Chưa hoàn thành hạn'}
            </span>
          )}
          {typeof step.args.closed === 'boolean' && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                step.args.closed
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}
            >
              {step.args.closed ? '📦 Lưu trữ (Archive)' : '📂 Mở lại thẻ (Unarchive)'}
            </span>
          )}
          {chkState && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                chkState === 'complete'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              {chkState === 'complete' ? '☑ Đã hoàn thành (complete)' : '☐ Chưa xong (incomplete)'}
            </span>
          )}
        </div>
      )}
      {checklistItems.length > 0 && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Các mục công việc ({checklistItems.length}):</span>
          <ul className="mt-1 bg-white p-2.5 rounded-lg border border-neutral-200 v3-space-y-1.5 text-xs text-neutral-800">
            {checklistItems.map((item, idx) => (
              <li key={`${idx}-${item}`} className="flex items-center gap-2">
                <span aria-hidden="true" className="text-neutral-400">☐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {step.args.desc!=null && <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Mô tả ngắn:</span>
        <p className="text-xs text-neutral-700 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed">{text(step.args.desc)}</p>
      </div>}
      {step.args.text!=null && <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Nội dung bình luận:</span>
        <p className="text-xs text-neutral-800 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 leading-relaxed whitespace-pre-wrap break-words">{text(step.args.text)}</p>
      </div>}
      <OtherArguments step={step} except={['title','name','itemName','checkItemId','desc','text','due','dueComplete','closed','items','idMembers','memberId', ...(chkState ? ['state'] : [])]}/>
    </div>;
  }
  if(style==='message') return <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-2.5">
    <div className="flex items-center justify-between text-xs text-neutral-500">
      <span>{'Đích: '}<strong>{destination}</strong></span>
    </div>
    {step.args.text!=null && <div className="bg-white p-3 rounded-lg border border-neutral-200 text-xs text-neutral-900 leading-relaxed font-sans v3-space-y-1.5 whitespace-pre-wrap break-words">{text(step.args.text)}</div>}
    <OtherArguments step={step} except={['text']}/>
  </div>;
  if(style==='rows') {
    const sId=typeof step.args.spreadsheetId === 'string' ? step.args.spreadsheetId : '';
    const sheetName=typeof step.args.sheet === 'string' ? step.args.sheet : typeof step.args.sheetTitle === 'string' ? step.args.sheetTitle : '';
    const rawHeadersJson=(sId && sheetName ? labels?.[`sheet_headers:${sId}:${sheetName}`] : undefined) ?? (sheetName ? labels?.[`sheet_headers:${sheetName}`] : undefined);
    let sheetHeaders: string[] = [];
    if (typeof rawHeadersJson === 'string') {
      try {
        const parsed = JSON.parse(rawHeadersJson);
        if (Array.isArray(parsed)) sheetHeaders = parsed.filter((h): h is string => typeof h === 'string');
      } catch {
        // ignore invalid json
      }
    }
    const rawRecords=Array.isArray(step.args.records)
      ? step.args.records.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object' && !Array.isArray(r)))
      : [];
    if (rawRecords.length > 0 && sheetHeaders.length === 0) {
      const seenKeys = new Set<string>();
      for (const rec of rawRecords) {
        for (const k of Object.keys(rec)) {
          if (k.trim() && !seenKeys.has(k)) {
            seenKeys.add(k);
            sheetHeaders.push(k);
          }
        }
      }
    }
    const values=step.args.values ?? step.args.rows;
    const rows: unknown[][] = Array.isArray(values)
      ? (values.filter(Array.isArray) as unknown[][])
      : rawRecords.length > 0
        ? rawRecords.map((rec) => sheetHeaders.map((h) => rec[h] ?? ''))
        : [];
    const maxCols=Math.max(1, sheetHeaders.length, ...rows.map(r => r.length));
    const colLetters=Array.from({length:maxCols}, (_, idx) => String.fromCharCode(65 + (idx % 26)));
    const isUpsert=step.args.onDuplicate === 'update';
    return <div className="v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Đích: '}<strong>{destination}</strong></span>
        {isUpsert && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            Cập nhật dòng trùng khóa (Upsert)
          </span>
        )}
      </div>
      {rows.length > 0 && (
        <div data-testid="spreadsheet-grid-preview" className="border border-emerald-200 rounded-xl overflow-x-auto bg-white shadow-2xs">
          <div className="px-3 py-1.5 bg-emerald-50/80 border-b border-emerald-200 text-[11px] font-semibold text-emerald-900 flex items-center justify-between">
            <span>Xem trước dòng bảng tính (Spreadsheet Grid)</span>
            <span className="font-mono text-[10px] text-emerald-700">{rows.length} dòng × {maxCols} cột</span>
          </div>
          <div className="min-w-full">
            <div className="grid border-b border-neutral-200 bg-neutral-50 text-[11px] font-semibold text-neutral-600" style={{ gridTemplateColumns: `repeat(${maxCols}, minmax(96px, 1fr))` }}>
              {colLetters.map((letter, idx) => (
                <div key={letter} className="px-2.5 py-1.5 border-r last:border-r-0 border-neutral-200 font-mono">
                  {`Cột ${letter}${sheetHeaders[idx] ? ` · ${sheetHeaders[idx]}` : ''}`}
                </div>
              ))}
            </div>
            {rows.map((row, rIdx) => (
              <div key={rIdx} className="grid border-b last:border-b-0 border-neutral-200 text-xs text-neutral-900 bg-white" style={{ gridTemplateColumns: `repeat(${maxCols}, minmax(96px, 1fr))` }}>
                {colLetters.map((letter, cIdx) => (
                  <div key={`${rIdx}-${letter}`} className="px-2.5 py-2 border-r last:border-r-0 border-neutral-100 break-words">
                    {row[cIdx] !== undefined ? text(row[cIdx]) : ''}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="border border-neutral-200 rounded-xl overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-neutral-100 text-neutral-600 font-semibold border-b border-neutral-200">
            <tr><th className="p-2.5">Cột</th><th className="p-2.5">Giá trị sẽ ghi</th></tr>
          </thead>
          <tbody className="v3-divide-y divide-neutral-200 bg-white">
            {rows.flatMap((row,rowIndex)=>row.map((value,columnIndex)=><tr key={`${rowIndex}-${columnIndex}`}>
              <td className="p-2.5 font-medium text-neutral-500">Giá trị {columnIndex+1}{sheetHeaders[columnIndex] ? ` (${sheetHeaders[columnIndex]})` : ''}{rows.length>1 ? ` · nhóm ${rowIndex+1}` : ''}</td>
              <td className="p-2.5">{text(value)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
      <OtherArguments step={step} except={['values','rows','records']}/>
    </div>;
  }
  if(style==='sheet_update') {
    const rawUpdates=Array.isArray(step.args.updates) ? step.args.updates.filter((u): u is Record<string,unknown> => Boolean(u && typeof u==='object' && !Array.isArray(u))) : [];
    return <div data-testid="spreadsheet-update-preview" className="v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Đích: '}<strong>{destination}</strong></span>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          Cập nhật cột chọn lọc (Bảo toàn công thức)
        </span>
      </div>
      {rawUpdates.length > 0 && (
        <div className="border border-emerald-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-emerald-50/80 text-emerald-900 font-semibold border-b border-emerald-200">
              <tr>
                <th className="p-2.5">Dòng mục tiêu</th>
                <th className="p-2.5">Cột cập nhật</th>
                <th className="p-2.5">Giá trị mới</th>
              </tr>
            </thead>
            <tbody className="v3-divide-y divide-neutral-200 bg-white">
              {rawUpdates.flatMap((u, uIdx) => {
                const targetDesc = typeof u.rowNumber === 'number'
                  ? `Dòng #${u.rowNumber}`
                  : `${text(u.matchColumn ?? 'Khóa')} = ${text(u.matchValue ?? '')}`;
                const valEntries = u.values && typeof u.values === 'object' && !Array.isArray(u.values)
                  ? Object.entries(u.values as Record<string, unknown>)
                  : [];
                return valEntries.map(([colKey, colVal], cIdx) => (
                  <tr key={`${uIdx}-${cIdx}`}>
                    <td className="p-2.5 font-mono text-neutral-600">{targetDesc}</td>
                    <td className="p-2.5 font-medium text-neutral-800">{colKey}</td>
                    <td className="p-2.5 text-emerald-900 font-medium">{text(colVal)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
      <OtherArguments step={step} except={['updates']}/>
    </div>;
  }
  if(style==='sheet_create') {
    const headers=Array.isArray(step.args.headers) ? step.args.headers.filter((h): h is string => typeof h==='string') : [];
    return <div data-testid="spreadsheet-create-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Bảng tính đích:</span>
        <div className="text-xs font-medium text-neutral-800 mt-0.5">{destination}</div>
      </div>
      {step.args.title!=null && <div>
        <span className="text-[11px] text-neutral-400 uppercase font-semibold">Tên trang tính (Tab) mới:</span>
        <div className="text-sm font-bold text-emerald-900 mt-0.5">{text(step.args.title)}</div>
      </div>}
      {headers.length > 0 && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Khởi tạo tiêu đề cột (Dòng 1):</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {headers.map((h, idx) => (
              <span key={`${idx}-${h}`} className="px-2 py-0.5 rounded-md text-xs font-mono bg-emerald-50 text-emerald-800 border border-emerald-200">
                {`Cột ${String.fromCharCode(65 + (idx % 26))} · ${h}`}
              </span>
            ))}
          </div>
        </div>
      )}
      <OtherArguments step={step} except={['title','headers']}/>
    </div>;
  }
  if(style==='sheet_search') {
    const filterCol=step.args.column ?? step.args.filterColumn;
    const rawOp=typeof step.args.operator==='string' ? step.args.operator : typeof step.args.filterOperator==='string' ? step.args.filterOperator : 'contains';
    const filterVal=step.args.value ?? step.args.filterValue;
    const opLabel=operatorLabels[rawOp] ?? rawOp;
    const extraFilters=Array.isArray(step.args.filters)
      ? step.args.filters.filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object' && !Array.isArray(f)))
      : [];
    return <div data-testid="spreadsheet-search-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Đích tra cứu: '}<strong>{destination}</strong></span>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          Tra cứu có cấu trúc (Hỗ trợ gán cột theo tiêu đề)
        </span>
      </div>
      {filterCol!=null && (
        <div className="bg-white p-3 rounded-lg border border-emerald-200 text-xs v3-space-y-1">
          <div className="text-[11px] text-neutral-400 uppercase font-semibold">Điều kiện lọc theo cột:</div>
          <div className="flex flex-wrap items-center gap-1.5 text-neutral-900 font-medium">
            <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 font-mono">{text(filterCol)}</span>
            <span className="text-neutral-500">{opLabel}</span>
            {filterVal!=null && rawOp!=='empty' && rawOp!=='not_empty' && rawOp!=='is_empty' && rawOp!=='is_not_empty' && (
              <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-900 border border-neutral-200 font-mono">{text(filterVal)}</span>
            )}
          </div>
        </div>
      )}
      {extraFilters.length > 0 && (
        <div className="bg-white p-3 rounded-lg border border-emerald-200 text-xs v3-space-y-1.5">
          <div className="text-[11px] text-neutral-400 uppercase font-semibold">Các điều kiện lọc kết hợp ({extraFilters.length}):</div>
          {extraFilters.map((f, fIdx) => {
            const fOp = typeof f.operator === 'string' ? f.operator : 'contains';
            return (
              <div key={fIdx} className="flex flex-wrap items-center gap-1.5 text-neutral-900 font-medium">
                <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 font-mono">{text(f.column)}</span>
                <span className="text-neutral-500">{operatorLabels[fOp] ?? fOp}</span>
                {f.value != null && (
                  <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-900 border border-neutral-200 font-mono">{text(f.value)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {step.args.query!=null && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Từ khóa tìm kiếm:</span>
          <div className="text-xs text-neutral-800 bg-white p-2.5 rounded-lg border border-neutral-200 mt-1 font-medium">{text(step.args.query)}</div>
        </div>
      )}
      {step.args.limit!=null && (
        <div className="text-xs text-neutral-600">
          Giới hạn kết quả: <strong>Tối đa {text(step.args.limit)} dòng</strong>
        </div>
      )}
      <OtherArguments step={step} except={['column','operator','value','filterColumn','filterOperator','filterValue','filters','query','limit']}/>
    </div>;
  }
  if(style==='sheet_aggregate') {
    const rawMetrics = Array.isArray(step.args.metrics)
      ? step.args.metrics.filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object' && !Array.isArray(m)))
      : [];
    return <div data-testid="spreadsheet-aggregate-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Đích thống kê: '}<strong>{destination}</strong></span>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
          Thống kê &amp; tổng hợp số liệu (SUM / AVG / COUNT)
        </span>
      </div>
      {step.args.groupBy != null && (
        <div className="text-xs text-neutral-700">
          <span>Nhóm theo cột: </span>
          <strong className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200 font-mono">{text(step.args.groupBy)}</strong>
        </div>
      )}
      {rawMetrics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {rawMetrics.map((m, idx) => {
            const op = typeof m.op === 'string' ? m.op.toUpperCase() : 'COUNT';
            const col = typeof m.column === 'string' && m.column.trim() ? m.column.trim() : '';
            return (
              <span key={idx} className="px-2.5 py-1 rounded-md text-xs font-mono font-semibold bg-white text-emerald-900 border border-emerald-200">
                {col ? `${op}(${col})` : op}
              </span>
            );
          })}
        </div>
      )}
      <OtherArguments step={step} except={['groupBy','metrics']}/>
    </div>;
  }
  if(style==='sheet_delete') {
    const rowNumbers = Array.isArray(step.args.rowNumbers) ? step.args.rowNumbers : [];
    return <div data-testid="spreadsheet-delete-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Đích: '}<strong>{destination}</strong></span>
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
          🗑️ Xoá dòng dữ liệu (Bảo vệ dòng tiêu đề 1)
        </span>
      </div>
      {rowNumbers.length > 0 && (
        <div className="bg-white p-3 rounded-lg border border-rose-200 text-xs text-neutral-800">
          <span className="font-semibold text-rose-800">Các số thứ tự dòng sẽ xoá: </span>
          <span className="font-mono">{rowNumbers.map((r) => `#${text(r)}`).join(', ')}</span>
        </div>
      )}
      {step.args.matchColumn != null && (
        <div className="bg-white p-3 rounded-lg border border-rose-200 text-xs text-neutral-800">
          <span className="font-semibold text-rose-800">Điều kiện dòng sẽ xoá: </span>
          <span className="font-mono">{`${text(step.args.matchColumn)} = ${text(step.args.matchValue ?? '')}`}</span>
        </div>
      )}
      <OtherArguments step={step} except={['rowNumbers','matchColumn','matchValue']}/>
    </div>;
  }
  if (
    style === 'doc_create' ||
    style === 'doc_append' ||
    style === 'doc_read' ||
    step.tool === 'mysheets.create_doc' ||
    step.tool === 'mysheets.append_doc_text' ||
    step.tool === 'mysheets.get_doc'
  ) {
    const docBody =
      step.args.content != null
        ? text(step.args.content)
        : step.args.text != null
          ? text(step.args.text)
          : '';
    const rawFolderId = step.args.folderId;
    const folderLabel =
      typeof rawFolderId === 'string' && rawFolderId.trim()
        ? (labels?.[rawFolderId] ?? rawFolderId)
        : rawFolderId != null
          ? text(rawFolderId)
          : null;
    const docBadge =
      step.tool === 'mysheets.create_doc'
        ? '📝 Tạo tài liệu Google Docs mới'
        : step.tool === 'mysheets.append_doc_text'
          ? '✏️ Nối thêm nội dung vào Google Docs'
          : '📖 Đọc nội dung tài liệu Google Docs';
    return (
      <div
        data-testid="google-doc-preview"
        className="p-4 bg-neutral-50 rounded-xl border border-blue-200 v3-space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
          <span>
            {'Đích Google Docs: '}
            <strong>{destination}</strong>
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            {docBadge}
          </span>
        </div>
        {step.args.title != null && (
          <div>
            <span className="text-[11px] text-neutral-400 uppercase font-semibold">
              Tiêu đề tài liệu Google Docs:
            </span>
            <div className="text-sm font-bold text-neutral-900 mt-0.5 flex items-center gap-1.5">
              <span aria-hidden="true">📄</span>
              <span>{text(step.args.title)}</span>
            </div>
          </div>
        )}
        {folderLabel && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[11px] text-neutral-400 uppercase font-semibold">
              Thư mục lưu trữ:
            </span>
            <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-900 border border-amber-200">
              📁 {folderLabel}
            </span>
          </div>
        )}
        {docBody && (
          <div>
            <span className="text-[11px] text-neutral-400 uppercase font-semibold">
              {step.tool === 'mysheets.append_doc_text'
                ? 'Nội dung sẽ nối thêm vào cuối tài liệu:'
                : 'Xem trước trang văn bản Google Docs:'}
            </span>
            <div className="mt-1 p-3.5 bg-white rounded-lg border border-blue-100 shadow-2xs text-xs text-neutral-800 whitespace-pre-wrap leading-relaxed font-sans">
              {docBody}
            </div>
          </div>
        )}
        <OtherArguments step={step} except={['title', 'content', 'text', 'folderId']} />
      </div>
    );
  }
  if (
    style === 'drive_folder' ||
    style === 'drive_move' ||
    style === 'drive_search' ||
    step.tool === 'mysheets.create_drive_folder' ||
    step.tool === 'mysheets.move_drive_file' ||
    step.tool === 'mysheets.list_drive_files'
  ) {
    const driveBadge =
      step.tool === 'mysheets.create_drive_folder'
        ? '📁 Tạo thư mục Google Drive mới'
        : step.tool === 'mysheets.move_drive_file'
          ? '📦 Di chuyển tệp vào thư mục Drive'
          : '🔎 Tìm kiếm tệp & thư mục Google Drive';
    return (
      <div
        data-testid="google-drive-preview"
        className="p-4 bg-neutral-50 rounded-xl border border-amber-200 v3-space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
          <span>
            {'Đích Google Drive: '}
            <strong>{destination}</strong>
          </span>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200">
            {driveBadge}
          </span>
        </div>
        {(step.args.name != null || step.args.title != null) && (
          <div>
            <span className="text-[11px] text-neutral-400 uppercase font-semibold">
              Tên thư mục Google Drive:
            </span>
            <div className="text-sm font-bold text-neutral-900 mt-0.5 flex items-center gap-1.5">
              <span aria-hidden="true">📁</span>
              <span>{text(step.args.name ?? step.args.title)}</span>
            </div>
          </div>
        )}
        {step.args.mimeType != null && (
          <div className="text-xs text-neutral-700">
            <span>Loại tệp lọc: </span>
            <strong className="px-2 py-0.5 rounded bg-white border border-neutral-200 font-mono">
              {text(step.args.mimeType)}
            </strong>
          </div>
        )}
        <OtherArguments step={step} except={['name', 'title', 'mimeType']} />
      </div>
    );
  }
  if(style==='notion_page' || step.tool.startsWith('notion.')) {
    const rawProps = step.args.properties && typeof step.args.properties === 'object' && !Array.isArray(step.args.properties)
      ? Object.entries(step.args.properties as Record<string, unknown>)
      : [];
    const bodyText = step.args.content != null ? text(step.args.content) : step.args.text != null ? text(step.args.text) : '';
    const isArchived = typeof step.args.archived === 'boolean' ? step.args.archived : null;
    const actionBadge =
      step.tool === 'notion.create_page' ? '📄 Tạo trang Notion mới'
      : step.tool === 'notion.update_page' ? '✏️ Cập nhật thuộc tính trang'
      : step.tool === 'notion.append_text' || step.tool === 'notion.append_blocks' ? '📝 Nối thêm nội dung trang'
      : step.tool === 'notion.get_page' ? '📖 Đọc chi tiết & nội dung trang'
      : step.tool === 'notion.query_database' ? '🔎 Truy vấn Database Notion'
      : '📒 Thao tác Notion';

    const statusBadgeClass = (val: string) => {
      const lower = val.trim().toLowerCase();
      if (/^(done|completed|complete|hoàn thành|đã xong)$/.test(lower)) return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      if (/(in progress|in-progress|doing|đang làm|review|active)/.test(lower)) return 'bg-sky-50 text-sky-800 border-sky-200';
      if (/(blocked|bị chặn|quá hạn|overdue|urgent|high|cao)/.test(lower)) return 'bg-rose-50 text-rose-800 border-rose-200';
      return 'bg-neutral-100 text-neutral-800 border-neutral-200';
    };

    return <div data-testid="notion-page-preview" className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        <span>{'Đích Notion: '}<strong>{destination}</strong></span>
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-neutral-900 text-white">
          {actionBadge}
        </span>
      </div>
      {step.args.title != null && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Tiêu đề trang:</span>
          <div className="text-sm font-bold text-neutral-900 mt-0.5 flex items-center gap-1.5">
            <span aria-hidden="true">📄</span>
            <span>{text(step.args.title)}</span>
          </div>
        </div>
      )}
      {isArchived !== null && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Trạng thái lưu trữ:</span>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${isArchived ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'}`}>
            {isArchived ? '📦 Chuyển vào Lưu trữ (Archive)' : '📂 Khôi phục hoạt động'}
          </span>
        </div>
      )}
      {rawProps.length > 0 && (
        <div data-testid="notion-properties-grid" className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <div className="px-3 py-1.5 bg-neutral-100 border-b border-neutral-200 text-[11px] font-semibold text-neutral-600 uppercase tracking-wider">
            Bảng thuộc tính trang Notion ({rawProps.length} cột)
          </div>
          <div className="divide-y divide-neutral-100">
            {rawProps.map(([propKey, propVal]) => {
              const valStr = text(propVal);
              const keyLower = propKey.toLowerCase();
              const isCheckbox = propVal === true || propVal === false || valStr === 'true' || valStr === 'false';
              const isDate = /^\d{4}-\d{2}-\d{2}/.test(valStr);
              const isMultiTag = valStr.includes(',') && (keyLower.includes('tag') || keyLower.includes('nhãn') || keyLower.includes('label'));
              const isStatusOrPriority = keyLower.includes('status') || keyLower.includes('trạng thái') || keyLower.includes('stage') || keyLower.includes('priority') || keyLower.includes('ưu tiên');
              return (
                <div key={propKey} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-neutral-600">{propKey}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {isCheckbox ? (
                      <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${valStr === 'true' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-neutral-100 text-neutral-600 border-neutral-200'}`}>
                        {valStr === 'true' ? '☑ Đã chọn (True)' : '☐ Chưa chọn (False)'}
                      </span>
                    ) : isDate ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-50 text-amber-900 border border-amber-200">
                        📅 {valStr}
                      </span>
                    ) : isMultiTag ? (
                      valStr.split(',').map(t => t.trim()).filter(Boolean).map((tag, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-800 border border-indigo-200">
                          #{tag}
                        </span>
                      ))
                    ) : isStatusOrPriority ? (
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadgeClass(valStr)}`}>
                        {valStr}
                      </span>
                    ) : (
                      <span className="font-semibold text-neutral-900 break-all">{valStr}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {(step.args.status != null || step.args.query != null) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {step.args.status != null && (
            <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${statusBadgeClass(text(step.args.status))}`}>
              Lọc trạng thái: {text(step.args.status)}
            </span>
          )}
          {step.args.query != null && String(step.args.query).trim() !== '' && (
            <span className="px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-white text-neutral-800 border border-neutral-200">
              Từ khóa: “{text(step.args.query)}”
            </span>
          )}
        </div>
      )}
      {bodyText && (
        <div>
          <span className="text-[11px] text-neutral-400 uppercase font-semibold">Nội dung văn bản trang:</span>
          <div className="text-xs text-neutral-800 bg-white p-3 rounded-lg border border-neutral-200 mt-1 whitespace-pre-wrap leading-relaxed">
            {bodyText}
          </div>
        </div>
      )}
      <OtherArguments step={step} except={['title','properties','content','text','archived','status','query']}/>
    </div>;
  }
  // The issue frame is also the catalog fallback for tools without a prototype-specific preview.
  const ghLabels = Array.isArray(step.args.labels)
    ? step.args.labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : typeof step.args.label === 'string' && step.args.label.trim().length > 0
      ? [step.args.label.trim()]
      : [];
  const ghAssignees = Array.isArray(step.args.assignees)
    ? step.args.assignees.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  const ghState = step.tool.startsWith('github.') && (step.args.state === 'open' || step.args.state === 'closed')
    ? step.args.state
    : null;
  const isMyJira = step.tool.startsWith('myjira.');
  const jiraTargetStatus = isMyJira && typeof step.args.targetStatus === 'string' && step.args.targetStatus.trim()
    ? step.args.targetStatus.trim()
    : null;
  const jiraPriority = isMyJira && typeof step.args.priority === 'string' && step.args.priority.trim()
    ? step.args.priority.trim()
    : null;
  const jiraDueDate = isMyJira && typeof step.args.dueDate === 'string' && step.args.dueDate.trim()
    ? step.args.dueDate.trim()
    : null;
  const jiraAssignee = isMyJira && typeof step.args.assigneeAccountId === 'string' && step.args.assigneeAccountId.trim()
    ? (labels?.[step.args.assigneeAccountId.trim()] ?? step.args.assigneeAccountId.trim())
    : null;
  const jiraParentKey = isMyJira && typeof step.args.parentKey === 'string' && step.args.parentKey.trim()
    ? step.args.parentKey.trim()
    : null;
  const badgeExcluded = [
    ...(ghLabels.length > 0 ? ['labels', 'label'] : []),
    ...(ghAssignees.length > 0 ? ['assignees'] : []),
    ...(ghState ? ['state'] : []),
    ...(jiraTargetStatus ? ['targetStatus'] : []),
    ...(jiraPriority ? ['priority'] : []),
    ...(jiraDueDate ? ['dueDate'] : []),
    ...(jiraAssignee ? ['assigneeAccountId'] : []),
    ...(jiraParentKey ? ['parentKey'] : []),
  ];
  return <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 v3-space-y-3">
    <div>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">Đích:</span>
      <div className="text-xs font-medium text-neutral-800 mt-0.5">{destination}</div>
    </div>
    {Object.entries(step.args).filter(([key])=>['title','name','summary'].includes(key)).map(([key,value])=><div key={key}>
      <span className="text-[11px] text-neutral-400 uppercase font-semibold">{names[key]}:</span>
      <div className="text-sm font-bold text-neutral-900 mt-0.5">{text(value)}</div>
    </div>)}
    {(jiraTargetStatus || jiraPriority || jiraDueDate || jiraAssignee || jiraParentKey) && (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="myjira-preview-badges">
        {jiraTargetStatus && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            🔄 Chuyển sang: {jiraTargetStatus}
          </span>
        )}
        {jiraPriority && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            ⚡ Ưu tiên: {jiraPriority}
          </span>
        )}
        {jiraDueDate && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
            📅 Hạn: {jiraDueDate}
          </span>
        )}
        {jiraAssignee && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-800 border border-indigo-200">
            👤 Phụ trách: {jiraAssignee}
          </span>
        )}
        {jiraParentKey && (
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-neutral-100 text-neutral-800 border border-neutral-200">
            🔗 Epic/Parent: {jiraParentKey}
          </span>
        )}
      </div>
    )}
    {(ghState || ghLabels.length > 0 || ghAssignees.length > 0) && (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="github-preview-badges">
        {ghState && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${ghState === 'open' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
            {ghState === 'open' ? 'Đang mở (open)' : 'Đã đóng (closed)'}
          </span>
        )}
        {ghLabels.map((lbl) => (
          <span key={`lbl-${lbl}`} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
            #{lbl}
          </span>
        ))}
        {ghAssignees.map((assignee) => (
          <span key={`asg-${assignee}`} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
            @{assignee.replace(/^@/, '')}
          </span>
        ))}
      </div>
    )}
    <OtherArguments step={step} except={['title','name','summary', ...badgeExcluded]}/>
  </div>;
}
