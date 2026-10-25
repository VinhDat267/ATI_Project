/**
 * The prompt section for scheduled workflows (design 5.2). Added only when
 * schedules are on and the turn is not a scheduled run, so the prompt of every
 * other turn stays byte-identical.
 */
export function scheduleRules(): string {
  return `
### Scheduled workflows
Use \`kind: "schedule"\` when the user wants a workflow to run at a later time or repeatedly. Apply these rules in order:
1. A workflow that runs later or repeats ("mỗi sáng 8 giờ…", "9 giờ mai chạy…", "thứ Hai hằng tuần…") → kind "schedule" with "action": "create".
2. Creating an event or meeting on a calendar ("lên lịch họp 9 giờ mai") is a normal plan with calendar.create_event, not a schedule. If it is unclear which one the user means, ask.
3. A due date of a card, issue or task ("tạo card hạn thứ Sáu") is a normal plan.
4. Missing time, missing date of a one-off run, or missing destination → clarification.
5. A repetition that is not supported (monthly, every 2 hours, several times a day) → clarification naming the three supported kinds: once, daily, weekly on chosen weekdays. Never switch to another kind yourself.
6. A scheduled task with no write action ("mỗi sáng cho tôi biết lịch họp") → clarification with "reason": "read_only", because nobody is there to answer a question when it runs.
7. When the conversation already has a schedule (the history contains a schedule proposal or a schedule state), a change of time, days or task → "action": "update"; "tạm dừng / chạy tiếp / hủy lịch này" → "pause" / "resume" / "cancel". If that schedule was cancelled and the user wants a new one → clarification suggesting a new conversation: a conversation holds one schedule.
Fields of a schedule:
- "request": the task as the user would type it to run now, without the timing ("Gửi lịch họp hôm nay lên Slack #ati-test"). Keep resource names exactly as the user typed them; never search for resources and never put IDs in it.
- "name": a short Vietnamese name of at most 80 characters.
- "recurrence": {"type":"once","date":"YYYY-MM-DD","time":"HH:mm"}, {"type":"daily","time":"HH:mm"} or {"type":"weekly","time":"HH:mm","days":[1,2,3,4,5]} (1 = Monday … 7 = Sunday), in 24-hour time of the time zone above.
- "summary": one Vietnamese sentence explaining the schedule.
- "update" returns the whole new schedule (name, request, recurrence), not only what changed. "pause", "resume" and "cancel" need only "action" and "summary".
- A request about a schedule itself is not a data read: rule 0 does not apply to it. Do not search before answering with a schedule.
#### Example: create
{"kind":"schedule","action":"create","name":"Lịch họp hằng ngày","request":"Gửi lịch họp hôm nay lên Slack #ati-test","recurrence":{"type":"daily","time":"08:00"},"summary":"Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test."}
#### Example: update
{"kind":"schedule","action":"update","name":"Lịch họp ngày làm việc","request":"Gửi lịch họp hôm nay lên Slack #ati-test","recurrence":{"type":"weekly","time":"08:30","days":[1,2,3,4,5]},"summary":"Đổi sang 8 giờ 30, từ thứ Hai đến thứ Sáu."}
`;
}
