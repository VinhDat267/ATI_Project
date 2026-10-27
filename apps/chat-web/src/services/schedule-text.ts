import type { ScheduleRecurrence, ScheduleRunView, ScheduleView } from '@wap/tool-schemas';
const days = ['Chủ nhật', 'thứ Hai', 'thứ Ba', 'thứ Tư', 'thứ Năm', 'thứ Sáu', 'thứ Bảy'];
const capital = (text: string) => text[0].toUpperCase() + text.slice(1);
export function describeRecurrence(r: ScheduleRecurrence): string {
  let text: string;
  if (r.type === 'daily') text = 'Hằng ngày';
  else if (r.type === 'once') {
    const date = new Date(`${r.date}T12:00:00Z`);
    text = `Một lần, ${days[date.getUTCDay()]} ${r.date.split('-').reverse().join('/')}`;
  } else {
    const names = r.days.map(day => days[day % 7]);
    const consecutive = r.days.length >= 3 && r.days.every((day, index) => !index || day === r.days[index - 1] + 1);
    text = r.days.length === 7 ? 'Mọi ngày trong tuần' : consecutive ? `${names[0]} đến ${names.at(-1)}` : names.join(', ');
  }
  return `${capital(text)}, ${r.time}, giờ Việt Nam`;
}
export function formatRunTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'Chưa có giờ hẹn';
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  const weekday = new Date(`${values.year}-${values.month}-${values.day}T12:00:00Z`).getUTCDay();
  return `${values.hour}:${values.minute} ${days[weekday]} ${values.day}/${values.month}`;
}
export function runOrigin(name: string, iso: string): string {
  const text = formatRunTime(iso).replace(/ (?:thứ [^ ]+|Chủ nhật) /, ' ');
  return `Lịch "${name}" tự gửi lúc ${text}`;
}
export function scheduleLabel(s: ScheduleView): string {
  return s.status === 'active' ? `Đang bật${s.nextRuns[0] ? ` · lần chạy tới ${formatRunTime(s.nextRuns[0])}` : ''}`
    : s.status === 'paused' ? `Đã tạm dừng${s.pauseReason ? `: ${s.pauseReason}` : ''}` : s.status === 'cancelled' ? 'Đã hủy' : 'Đã chạy xong';
}
export function runLabel(run: ScheduleRunView): string {
  if (run.state === 'approved') return ({ executing: 'Đang chạy', approved: 'Đang chạy', completed: 'Đã xong', partial: 'Xong một phần', failed: 'Có lỗi', stopped: 'Đã dừng', reconciliation_required: 'Cần đối soát' } as Record<string, string>)[run.planStatus ?? ''] ?? 'Đang chạy';
  if (run.state === 'missed') return run.missedCount > 1 ? `Đã lỡ ${run.missedCount} lượt` : 'Đã lỡ';
  return ({ planning: 'Đang lập kế hoạch', awaiting_approval: 'Chờ bạn duyệt', expired: 'Hết hạn duyệt', rejected: 'Bạn đã hủy kế hoạch', needs_attention: 'Cần bạn xem', planning_failed: 'Không lập được kế hoạch', interrupted: 'Bị gián đoạn', discarded: 'Đã bỏ vì lịch thay đổi', blocked: 'Bị chặn' } as Record<string, string>)[run.state];
}
