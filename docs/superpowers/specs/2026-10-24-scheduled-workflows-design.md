# Lịch chạy workflow bằng hội thoại

**Ngày:** 24/10/2026 (Asia/Saigon) · **Trạng thái:** đã duyệt 25/10/2026; khi lập task card bổ sung hai kiểu metadata ở mục 4, thời hạn 180 giây ở mục 6.4, và việc gộp dịch vụ của lịch vào router ở mục 5.3 · **Người quyết:** nhóm trưởng

Tài liệu này bổ sung đặc tả v3 (`2026-09-29-ai-workflow-platform-v3-design.md`). Nguồn ý tưởng: tài liệu "Đề xuất tính năng OAuth và tạo lịch workflow bằng AI" của `longnguyen005`, ngày 24/10/2026 (không commit). Tài liệu đó gồm hai tính năng; đặc tả này chỉ phủ phần **lịch chạy**. OAuth có đặc tả riêng, lập sau.

## 1. Bối cảnh và quyết định

### 1.1. Người dùng muốn gì

Người dùng mô tả việc cần làm và thời điểm trong ô chat hiện có, ví dụ "Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test". ATI:
- hỏi lại phần còn thiếu;
- hiện thẻ lịch để xác nhận;
- cho sửa lịch bằng câu nói tiếp theo ("Đổi sang 8 giờ 30, chỉ thứ Hai đến thứ Sáu");
- tới giờ thì tra dữ liệu mới, lập kế hoạch mới, và chờ người dùng duyệt như mọi kế hoạch khác;
- cho tạm dừng, chạy tiếp, hủy, và xem kết quả các lượt.

### 1.2. Các quyết định ngày 24/10/2026

- Nhóm trưởng quyết **triển khai** đề xuất của Long trước buổi bảo vệ.
- **Mốc ngừng thêm tính năng dời từ 29/10 sang 04/11.** Phần ổn định demo của tuần 5 dời sang 05–06/11.
- **Lịch chạy làm trước, OAuth làm sau**, mỗi phần một đặc tả.
- Chỉ có chế độ **chờ duyệt từng lần**. Chế độ tự chạy trong phạm vi đã cấp nằm ngoài phạm vi.
- Demo dùng workflow **Google Calendar → Slack**. Workflow GitHub → Slack ("issue mới từ lượt trước") không làm được với `github.search_issues` hiện tại: tool chỉ tìm theo một cụm từ, không lọc theo ngày, và kết quả không có ngày tạo. Sửa tool là đổi catalog đã chốt 20/10.
- **Chia việc:** reviewer thi công backend và planner; `longnguyen005` thi công giao diện.
- Toàn bộ tính năng nằm sau cờ **`SCHEDULES_ENABLED`**, mặc định tắt. Một PR riêng bật cờ sau phép đo (mục 9).

### 1.3. Quy tắc giữ nguyên

- Mọi lệnh ghi lên dịch vụ chỉ chạy sau khi người dùng duyệt đúng kế hoạch đó: so mã băm, hạn 30 phút. Lịch chạy không thay quy tắc này; mỗi lượt có kế hoạch, mã băm và lần duyệt riêng.
- Kế hoạch phải có ít nhất một bước ghi (`READ_ONLY_PLAN`).
- Catalog 33 tool/8 dịch vụ không đổi. Lịch chạy không thêm tool.
- Khi cờ tắt, hệ thống không đổi: prompt giữ nguyên từng byte, route lịch trả 404, bộ hẹn giờ không chạy, web không hiện gì về lịch.

### 1.4. Lấy gì từ đề xuất của Long

| Đề xuất | Trong đặc tả này |
|---|---|
| Tạo lịch bằng hội thoại, AI hỏi phần thiếu, thẻ xác nhận | có (mục 3, 5) |
| Sửa lịch bằng câu tiếp theo, xác nhận bản mới trước khi thay | có, trong hội thoại đã tạo lịch (mục 5.4) |
| Một lần, hằng ngày, hằng tuần theo ngày chọn | có |
| Phân biệt lịch chạy với sự kiện Calendar và hạn của card | có (mục 5.2), có bộ đo riêng (mục 9.1) |
| Chờ duyệt từng lần | có |
| Tự chạy trong phạm vi đã cấp | không; cần sửa đặc tả phê duyệt |
| Nhận lượt nguyên tử, không tạo trùng; lưu bền, không phụ thuộc tab | có (mục 6) |
| Không tái dùng approval, mã băm, ID đầu ra của lượt trước | có |
| Lượt bị lỡ hiện rõ, không dồn lệnh ghi khi khởi động lại | có (mục 6.3) |
| Quản lý bằng tên từ hội thoại bất kỳ, AI hỏi chọn khi nhiều lịch khớp | không; chỉ trong hội thoại đã tạo lịch và bằng nút (mục 7) |
| Thông báo ra ngoài app | không; chỉ báo trong app |

## 2. Phạm vi

**Trong phạm vi**
- Ba kiểu lặp: một lần, hằng ngày, hằng tuần theo các ngày được chọn.
- Một múi giờ: `APP_TIME_ZONE` (mặc định `Asia/Ho_Chi_Minh`, không có giờ mùa hè).
- Tạo, sửa, tạm dừng, chạy tiếp, hủy lịch bằng chat **trong hội thoại đã tạo lịch**; tạm dừng, chạy tiếp, hủy, "Chạy lượt này ngay" bằng nút.
- Mỗi lượt chạy là một hội thoại mới, kế hoạch chờ duyệt như thường.
- Danh sách lịch trong trang Nhật ký; số lượt chờ duyệt trên tab Nhật ký.
- Ghi lượt bị lỡ; tự tạm dừng sau 3 lượt liền không được duyệt.

**Ngoài phạm vi**
- Chế độ tự chạy; tái dùng lần duyệt giữa các lượt.
- Hằng tháng, cron, chu kỳ ngắn hơn một ngày, nhiều giờ trong một ngày, múi giờ khác.
- Thông báo qua Slack, email, Telegram hay push.
- Quản lý lịch bằng tên từ một hội thoại khác.
- Nhiều API instance (không có lease cho bộ hẹn giờ; giống giới hạn của W2-01).
- OAuth (đặc tả riêng).
- Sửa tool để lọc dữ liệu "từ lượt trước".

## 3. Kịch bản demo (chốt 24/10)

1. **Tạo lịch.** Người dùng gõ "Mỗi sáng 8 giờ, gửi lịch họp hôm nay lên Slack #ati-test". ATI hiện thẻ lịch, không phải kế hoạch. Thẻ ghi tên lịch, "Hằng ngày 08:00, giờ Việt Nam", dịch vụ Google Calendar → Slack, ba lần chạy tới do backend tính, và câu "Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào." Nút: Xác nhận, Sửa, Bỏ qua.
2. **Sửa bằng một câu.** "Đổi sang 8 giờ 30, chỉ thứ Hai đến thứ Sáu". Thẻ hiện phần đổi (08:00 → 08:30; Hằng ngày → T2–T6); người dùng xác nhận.
3. **Tới giờ.** Đầu buổi bảo vệ, người dùng tạo thêm một lịch một lần, hẹn sau vài phút. Tới giờ, tab Nhật ký hiện "1"; người dùng mở lượt chạy, thấy kế hoạch mới lập từ dữ liệu vừa tra, duyệt, rồi tin xuất hiện trong Slack.
4. **Dự phòng.** Nút "Chạy lượt này ngay" tạo một lượt tức thì.
5. **Quản lý.** Trong hội thoại đã tạo lịch, gõ "Tạm dừng lịch này" rồi xác nhận. Mục Lịch chạy trong trang Nhật ký liệt kê lịch, lần chạy tới và kết quả lần trước.

## 4. Kiểu dữ liệu chung (hợp đồng giữa backend và giao diện)

Thêm vào `packages/tool-schemas/src/types.ts` trong SCHED-01. SCHED-03 (giao diện) dựng trên các kiểu này.

```ts
/** ISO weekday: 1 = thứ Hai … 7 = Chủ nhật. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ScheduleRecurrence =
  | { type: 'once'; date: string; time: string }      // date YYYY-MM-DD, time HH:mm, theo APP_TIME_ZONE
  | { type: 'daily'; time: string }
  | { type: 'weekly'; time: string; days: Weekday[] }; // không rỗng, không trùng, tăng dần

/** Planner trả kiểu này khi người dùng muốn đặt, sửa, tạm dừng, chạy tiếp hoặc hủy lịch. */
export interface ScheduleResponse {
  kind: 'schedule';
  action: 'create' | 'update' | 'pause' | 'resume' | 'cancel';
  /** Bắt buộc với create/update; bỏ qua với pause/resume/cancel. */
  name?: string;                    // 1–80 ký tự
  request?: string;                 // 1–1.000 ký tự: việc cần làm, viết như câu người dùng gõ để chạy ngay
  recurrence?: ScheduleRecurrence;
  summary: string;                  // một câu tiếng Việt giải thích
}

export type PlannerResponse = PlanResponse | ClarificationResponse | RefusalResponse | AnswerResponse | ScheduleResponse;
```

Với `update`, planner trả **toàn bộ** lịch mới (tên, việc, lặp), không trả phần thay đổi. Backend tự so với phiên bản hiện tại để giao diện hiện phần đổi.

**Dữ liệu API trả cho web** (cũng trong `tool-schemas`, để web và API dùng chung):

```ts
export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export interface ScheduleView {
  id: string; convId: string; version: number;
  name: string; request: string; recurrence: ScheduleRecurrence;
  services: string[];               // id dịch vụ, do router của planner xác định
  status: ScheduleStatus;
  pauseReason: string | null;       // ví dụ "3 lượt liền không được duyệt"
  nextRuns: string[];               // ISO, tối đa 3; rỗng khi không còn lượt
  lastRun: ScheduleRunView | null;
}

export type ScheduleRunState =
  | 'planning' | 'awaiting_approval' | 'approved' | 'expired' | 'rejected'
  | 'needs_attention' | 'planning_failed' | 'interrupted' | 'discarded' | 'missed' | 'blocked';

export interface ScheduleRunView {
  id: string; scheduleId: string;
  trigger: 'scheduled' | 'manual' | 'replan';
  dueAt: string; createdAt: string;
  state: ScheduleRunState;
  missedCount: number;              // > 1 khi nhiều giờ hẹn bị lỡ được gộp
  convId: string | null; planId: string | null;
  planStatus: string | null;        // status của bảng plans khi đã có kế hoạch
  error: string | null;             // câu tiếng Việt cho người dùng
}

/** Metadata của tin assistant mang đề xuất lịch. */
export interface ScheduleProposalMetadata {
  type: 'schedule_proposal';
  proposal: ScheduleResponse;
  scheduleId: string | null;        // null khi tạo mới
  baseVersion: number | null;       // phiên bản lịch mà đề xuất sửa; null khi tạo mới
  services: string[];
  nextRuns: string[];               // backend tính lúc lưu đề xuất
  previous: Pick<ScheduleView, 'name' | 'request' | 'recurrence' | 'status'> | null; // để hiện phần đổi
}

/** Metadata của tin assistant ghi trạng thái lịch sau mỗi lần đổi (mục 6.5). */
export interface ScheduleStateMetadata {
  type: 'schedule_state';
  schedule: ScheduleView;
}

/** Metadata của tin user mà bộ hẹn giờ lưu ở đầu hội thoại của lượt (mục 5.5). */
export interface ScheduleRunMessageMetadata {
  type: 'schedule_run';
  scheduleId: string; runId: string; name: string;
  dueAt: string; trigger: 'scheduled' | 'manual' | 'replan';
}
```

`ScheduleRunState` là trạng thái **suy ra** cho giao diện (mục 6.1), không phải cột lưu nguyên văn.

## 5. Planner

### 5.1. Cờ và prompt

- `validateEnv` đọc `SCHEDULES_ENABLED` (`on`/`off`, mặc định `off`, giá trị khác là lỗi cấu hình), như `PLANNER_READ_ANSWERS`.
- `AIPlannerOptions` thêm `schedules?: boolean`. Khi tắt: prompt không đổi từng byte (test SHA-256 như ANS-01), validator từ chối `kind: "schedule"`.
- Khi bật, `buildSystemPrompt` thêm một mục quy tắc lịch (5.2) và kiểu `schedule` vào danh sách kiểu phản hồi. Cả hai chế độ `regex` và `llm` đều nhận được.
- **(SCHED-02)** Mục `### Scheduled workflows` (`prompts/schedule-rules.ts`) được nối vào **cuối** prompt, không chen vào danh sách quy tắc đánh số. Nhờ vậy, mọi phần trước nó giống từng byte với prompt khi cờ tắt. Mục này có quy tắc 5.2, các trường, một ví dụ `create` và một ví dụ `update`. Nó cũng ghi rõ rằng quy tắc 0 (chỉ đọc thì hỏi lại ngay) không áp dụng cho câu về chính lịch, và không tra cứu trước khi trả `schedule`.
- **(SCHED-02)** Chế độ `regex` vẫn chạy bước tra tên (gather) trước model, như với mọi câu. Câu tạo lịch có `#ati-test` vẫn tra kênh đó. Chế độ live dùng `llm`, nên quy tắc "không tra cứu lúc tạo lịch" dựa vào prompt.

### 5.2. Khi nào trả `schedule`

Quy tắc trong prompt, theo thứ tự:
1. Người dùng muốn một **workflow chạy vào thời điểm sau này hoặc lặp lại** ("mỗi sáng…", "9 giờ mai chạy…", "thứ Hai hằng tuần…") → `schedule` với `action: "create"`.
2. Người dùng muốn **tạo sự kiện, cuộc họp trên lịch** ("lên lịch họp 9 giờ mai") → kế hoạch thường với `calendar.create_event`, không phải `schedule`. Mơ hồ → hỏi lại.
3. **Hạn, ngày đến hạn** của card, issue, task ("tạo card hạn thứ Sáu") → kế hoạch thường.
4. Thiếu giờ, thiếu ngày (kiểu một lần), thiếu nơi ghi → `clarification`.
5. Chu kỳ chưa hỗ trợ (hằng tháng, mỗi 2 giờ, nhiều giờ một ngày) → `clarification` nêu ba kiểu đang hỗ trợ; không tự đổi sang kiểu khác.
6. Việc cần làm **không có hành động ghi** ("mỗi sáng cho tôi biết lịch họp") → `clarification` với `reason: "read_only"`, cùng câu hỏi như quy tắc chỉ đọc hiện nay. Lý do: tới giờ không có ai để hỏi lại.
7. Trong hội thoại đã có lịch (lịch sử chứa đề xuất hoặc trạng thái lịch), câu sửa giờ, ngày, việc → `action: "update"`; "tạm dừng/chạy tiếp/hủy lịch này" → `pause`/`resume`/`cancel`. Lịch của hội thoại đã hủy mà người dùng muốn lịch mới → `clarification` gợi ý mở hội thoại mới (mỗi hội thoại chỉ một lịch).

`request` là câu việc cần làm, **không chứa thời điểm lặp** ("Gửi lịch họp hôm nay lên Slack #ati-test"), giữ nguyên tên tài nguyên người dùng gõ. Không tra cứu, không điền ID trong `request`.

### 5.3. Validator

`ChatService` cho planner biết lịch của hội thoại qua trường mới `ProcessMessageInput.schedule?: { services: string[] }`; có trường này nghĩa là `hasSchedule`. Khi có, planner **gộp `services` của lịch vào kết quả router** trước khi chọn tool. Lý do: câu như "tạm dừng lịch này" không có từ khoá dịch vụ, nên nếu chỉ dùng router thì planner trả từ chối `unroutable` mà không gọi model.

**(SCHED-02)** Khi đo trên mã, lý do trên không đúng với router hiện tại. Câu không có từ khoá nào ("Tạm dừng lịch này", "Hủy lịch") được router trả **mọi** dịch vụ chung đã cấu hình, nên vẫn tới model; `unroutable` chỉ xảy ra khi catalog rỗng. Việc gộp vẫn được làm, nhưng chỉ đổi kết quả khi router chọn hẹp hơn lịch. Ví dụ: "Chuyển lịch này sang gửi lên Telegram" chỉ ra Telegram; sau khi gộp có thêm dịch vụ của lịch. Khi câu nêu một dịch vụ **chưa cấu hình**, planner **không gộp** và vẫn từ chối, để không lặng lẽ chuyển việc sang dịch vụ khác (quy tắc của router).

`validateSchedule(raw, { enabled, now, timeZone, hasSchedule })`:
- JSON, đúng schema mục 4; `name`, `request`, `recurrence` bắt buộc với `create`/`update`;
- `time` khớp `HH:mm` trong 00:00–23:59;
- `once`: `date` hợp lệ, giờ hẹn sau `now` ít nhất 1 phút và trong 365 ngày;
- `weekly`: `days` không rỗng, không trùng, mỗi giá trị 1–7 (validator sắp xếp lại);
- `update`/`pause`/`resume`/`cancel` khi hội thoại chưa có lịch, hoặc `create` khi đã có → lỗi semantic, để model sửa ở lượt thử lại;
- lớp an toàn (`INJECTION_PATTERNS`) áp như với kế hoạch.

Sai thì thử lại một lần như kế hoạch; vẫn sai thì báo lỗi lập kế hoạch như hiện nay.

### 5.4. Dịch vụ của lịch

Planner không để model khai dịch vụ. Với `create`/`update`, planner chạy `routeIntent(request)`:
- dịch vụ chưa cấu hình → `refusal` với `unavailableServices`, như hiện nay;
- `services` = dịch vụ router chọn, lưu cùng đề xuất.

**(SCHED-02)** Bước này nằm ở `ChatService`, qua `planner.routeSchedule(request, actor)`. Lý do: server dựng planner cho từng lần gọi, với catalog của chính người dùng đó. `validateSchedule` bỏ mọi trường lạ, kể cả `services` do model tự khai.

Lúc tạo lịch **không** tra tài nguyên (kênh, lịch). Tài nguyên được tra lúc mỗi lượt chạy; "Chạy lượt này ngay" là cách kiểm trước.

### 5.5. Lượt chạy

Lúc lập kế hoạch cho một lượt, câu gửi planner là:

```
<request>

(Lượt chạy theo lịch "<name>" lúc <dueAt theo giờ Việt Nam>.)
```

Câu này lưu thành tin `user` có `metadata.type = 'schedule_run'` trong hội thoại của lượt, nên grounding coi tên tài nguyên trong `request` là chữ người dùng gõ. `now` của planner là giờ hệ thống lúc lập kế hoạch, nên "hôm nay" là ngày của lượt.

Lượt chạy gọi planner với `ProcessMessageInput.scheduledRun = true`. Khi đó planner dựng prompt **như khi cờ tắt** (không có mục lịch) và validator từ chối `kind: "schedule"`. Lý do: lượt chạy phải ra kế hoạch, không ra lịch mới; và kế hoạch của lượt được lập bằng đúng prompt đã đo ở các bộ golden.

## 6. Backend

### 6.1. Lưu trữ (migration `0010_schedules.sql`)

```sql
CREATE TABLE schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  conv_id uuid NOT NULL UNIQUE REFERENCES conversations(id),  -- hội thoại tạo lịch; một lịch mỗi hội thoại
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  request text NOT NULL CHECK (char_length(request) BETWEEN 1 AND 1000),
  recurrence jsonb NOT NULL,
  services text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'cancelled', 'completed')),
  pause_reason text,
  version integer NOT NULL DEFAULT 1,
  next_run_at timestamptz,            -- chỉ có giá trị khi status = 'active'
  last_proposal_id uuid REFERENCES messages(id),  -- (SCHED-01) đề xuất áp dụng gần nhất, mục 6.5
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'active') = (next_run_at IS NOT NULL))
);
CREATE INDEX schedules_due ON schedules (next_run_at) WHERE status = 'active';

CREATE TABLE schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules(id),
  schedule_version integer NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'replan')),
  due_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN
    ('planning', 'planned', 'needs_attention', 'planning_failed', 'interrupted', 'discarded', 'missed', 'blocked')),
  missed_count integer NOT NULL DEFAULT 0,
  conv_id uuid REFERENCES conversations(id),
  plan_id uuid REFERENCES plans(id),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'planned') = (plan_id IS NOT NULL))
);
CREATE UNIQUE INDEX schedule_runs_slot ON schedule_runs (schedule_id, due_at) WHERE trigger = 'scheduled';
CREATE UNIQUE INDEX schedule_runs_one_planning ON schedule_runs (schedule_id) WHERE status = 'planning';
```

Trạng thái giao diện suy ra từ `schedule_runs.status` và **kế hoạch mới nhất của hội thoại lượt** (`plans.conv_id = schedule_runs.conv_id`, `created_at` lớn nhất). Không dùng riêng `plan_id`, vì người dùng có thể sửa kế hoạch trong hội thoại lượt, làm kế hoạch đầu thành `superseded`:

| `schedule_runs.status` | Kế hoạch mới nhất | `ScheduleRunState` |
|---|---|---|
| `planned` | `pending`, `expires_at > now()` | `awaiting_approval` |
| `planned` | `pending`, đã quá hạn | `expired` |
| `planned` | `rejected` | `rejected` |
| `planned` | `approved` trở đi (executing, completed, partial…) | `approved`; giao diện đọc `planStatus` để hiện chi tiết |
| còn lại | — | trùng tên |

Hội thoại của lượt có `title` = `Lịch: <name> · <dd/MM HH:mm>`.

### 6.2. Tính giờ hẹn

Hàm thuần `nextOccurrence(recurrence, after: Date, timeZone): Date | null` trong `apps/chat-api/src/services/schedules/`:
- trả giờ hẹn đầu tiên **sau** `after`;
- `once` trả `null` khi giờ hẹn đã qua;
- `nextRuns` = ba lần gọi liên tiếp;
- múi giờ có giờ mùa hè: giờ địa phương không tồn tại thì dùng phút hợp lệ kế tiếp, giờ lặp hai lần thì dùng lần đầu. `Asia/Ho_Chi_Minh` không gặp trường hợp này.

Test ranh giới: 23:59 sang ngày sau, Chủ nhật sang thứ Hai, cuối tháng, cuối năm, `after` đúng bằng giờ hẹn.

### 6.3. Bộ hẹn giờ

`ScheduleRunner` trong `apps/chat-api/src/services/schedules/`, khởi động trong `bootstrap` sau `reconcileInterruptedExecutions`, chỉ khi cờ bật và có PostgreSQL. Đồng hồ và khoảng nhịp tiêm được (`now()`, `tickMs`, mặc định 30 giây); test gọi `tick()` trực tiếp, không chờ thời gian thật.

**Mỗi nhịp:**
1. Một transaction: `SELECT … FROM schedules WHERE status = 'active' AND next_run_at <= $now ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT 5`. **(SCHED-01, review #167)** Câu này khoá cả dòng `conversations` của lịch (`JOIN conversations c … FOR UPDATE OF c, s SKIP LOCKED`), nên nhịp bỏ qua lịch khi một trong hai dòng đang bị giữ, và không bao giờ phải chờ. Thứ tự khoá ở mục 6.5.
2. Với mỗi lịch:
   - lịch đang có lượt `planning` (thường do "Chạy lượt này ngay") → bỏ qua lịch này ở nhịp này, không đổi gì; nhịp sau xét lại, và nếu đã trễ quá 10 phút thì thành lượt lỡ;
   - chủ lịch không còn `active` (`users.status`) → thêm lượt `blocked` ("Tài khoản không còn hoạt động"), chuyển lịch sang `paused` với lý do;
   - `now - next_run_at > 10 phút` → đếm mọi giờ hẹn từ `next_run_at` tới `now` (tối đa 1.000), thêm **một** lượt `missed` có `due_at` = giờ hẹn đầu, `missed_count` = số giờ hẹn;
   - ngược lại → thêm lượt `planning` có `due_at = next_run_at`;
   - `next_run_at` = `nextOccurrence(recurrence, max(now, next_run_at))`; `once` hết lượt → `status = 'completed'`, `next_run_at = NULL`.
3. Commit. Khoá duy nhất `schedule_runs_slot` chặn trùng lượt nếu hai tiến trình cùng chạy.
4. Lập kế hoạch cho từng lượt `planning` vừa tạo, **tuần tự**, ngoài transaction (6.4).

**Tự tạm dừng:** trước khi thêm lượt `planning`, nếu 3 lượt `scheduled` gần nhất đều ở trạng thái suy ra `expired`, lịch chuyển `paused` với lý do "3 lượt liền không được duyệt", không thêm lượt.

**Khởi động lại:** trong cùng bước đối soát lúc khởi động, mọi lượt `planning` thành `interrupted` ("Máy chủ khởi động lại khi đang lập kế hoạch"). Không tự gọi lại model. Lịch quá hạn được nhịp đầu tiên xử lý theo bước 2.

### 6.4. Lập kế hoạch cho một lượt

1. Tạo hội thoại của lượt (chủ = chủ lịch), lưu tin `schedule_run` (mục 5.5), ghi `conv_id` vào lượt.
2. Gọi đúng đường lập kế hoạch của `ChatService` (gồm `bindConnections` cho Gmail) với `userId` của chủ lịch. Không dựng đường thứ hai.
3. Khi có kết quả, một transaction khoá dòng `schedules`:
   - lịch đã đổi `version`, hoặc không còn `active` (với lượt `scheduled`) hoặc đã `cancelled` (với `manual`/`replan`) → lượt `discarded`; lưu tin hệ thống "Lịch đã thay đổi trong lúc lập kế hoạch. Kết quả này bị bỏ." vào hội thoại của lượt; không lưu kế hoạch;
   - kết quả là `plan` → lưu kế hoạch như hiện nay (`createPlan`, hạn 30 phút), lượt `planned`;
   - kết quả là `clarification`, `refusal` hoặc `answer` → lưu tin như hiện nay, lượt `needs_attention`. Người dùng trả lời ngay trong hội thoại của lượt; từ đó là hội thoại thường.
4. Lỗi lập kế hoạch (model quá hạn, lỗi provider, hai lần không qua validator), hoặc quá **180 giây** tính từ lúc bắt đầu lập kế hoạch cho lượt (huỷ bằng `AbortSignal`) → lượt `planning_failed`, lưu tin lỗi như hiện nay.

SCHED-01 dựng `ScheduleRunner` với một hàm lập kế hoạch tiêm vào (`planRun(run)`); test của SCHED-01 dùng hàm giả trả kết quả có kiểm soát. SCHED-02 nối hàm này vào `ChatService`.

**(SCHED-02)** `ChatService.planScheduledRun` làm như sau:
- gọi planner ngoài transaction;
- chuẩn bị kết quả bằng đúng phần dùng chung với đường chat (`bindConnections`, `resourceLabels`, mã băm), chưa ghi gì;
- `persist(client)` ghi bộ nhớ làm việc, kế hoạch và tin trong transaction của runner, đúng thứ tự khoá ở mục 6.5;
- `afterCommit()` phát `plan_preview`/`clarification`/`refusal`/`answer`, rồi `agent_state`. Tin có `replyToMessageId` là tin `schedule_run`;
- `agent_state: planning` và `gather_progress` phát ngay trong lúc lập kế hoạch, như ở đường chat.

Các tin `persist` ghi có chung `created_at`, vì `now()` là giờ bắt đầu transaction. Mỗi lần ghi chỉ có một tin hiện cho người dùng; tin còn lại là `working_memory`, vốn bị ẩn.

Kế hoạch của lượt đi qua đúng luồng duyệt, thực thi, khôi phục hiện có. Không có đường tắt.

### 6.5. Đề xuất và xác nhận

- Kết quả `schedule` của planner lưu thành tin `assistant` có `ScheduleProposalMetadata`. Phát SSE `schedule_proposal` trên hội thoại đó. Lịch sử gửi lại model dạng JSON của `proposal`, như kế hoạch.
  - **(SCHED-02)** Metadata đã lưu và payload SSE có thêm `replyToMessageId` (và `requestId` khi có), như các loại tin khác. Payload là `{ conversationId, messageId, metadata, replyToMessageId, requestId? }`; sau đó là `agent_state: idle`.
  - `nextRuns` là 3 lần chạy tới, tính từ lúc lưu đề xuất. Với `resume`, chúng tính theo `recurrence` của lịch hiện tại; với `pause`/`cancel` thì rỗng.
  - JSON gửi lại model theo thứ tự khoá mà JSONB giữ, không theo thứ tự model viết.
- Mỗi lần lịch đổi trạng thái hoặc phiên bản, lưu tin `assistant` có `metadata.type = 'schedule_state'` ("Lịch "…" đang bật, phiên bản 2, lần chạy tới …"), gửi lại model dạng chữ, và phát SSE `schedule_updated`.
- Xác nhận: một transaction khoá dòng `conversations` (tạo mới) hoặc `schedules` (các action khác):
  - đề xuất phải là tin `schedule_proposal` **mới nhất** của hội thoại, và `baseVersion` bằng `version` hiện tại;
  - `create`: hội thoại chưa có lịch; người dùng có dưới 10 lịch `active` hoặc `paused`;
  - mọi action có `recurrence`: tính lại giờ hẹn lúc xác nhận; `once` mà giờ hẹn đã qua → 409 `SCHEDULE_IN_PAST` (đề xuất có thể được xác nhận muộn);
  - `update`: lịch chưa `cancelled`; ghi đè `name`, `request`, `recurrence`, `services`, tăng `version`, tính lại `next_run_at` nếu `active`. Lịch `completed` (một lần đã chạy) được bật lại thành `active`. **(SCHED-01, review #167)** Bật lại cần chỗ như `create`: người dùng phải có dưới 10 lịch `active` hoặc `paused`, đếm dưới cùng khoá dòng `users`, ngược lại 409 `LIMIT_REACHED`;
  - `pause`/`resume`/`cancel`: đổi trạng thái, tăng `version`. `resume` tính `next_run_at` từ `now`; lượt đã lỡ trong lúc tạm dừng không được ghi.
  - sai điều kiện → 409 với `code` (`STALE_PROPOSAL`, `LIMIT_REACHED`, `CONVERSATION_HAS_SCHEDULE`, `SCHEDULE_CLOSED`); không đổi gì.
  - **(SCHED-01)** xác nhận lại đúng đề xuất đã áp dụng trả 200 với lịch hiện tại và không đổi gì, không ghi tin trạng thái. `schedules.last_proposal_id` lưu đề xuất áp dụng gần nhất. Lý do: bấm Xác nhận hai lần, hoặc hai tab cùng bấm, không nên báo lỗi;
  - **(SCHED-01)** `pause` một lịch đang tạm dừng, `resume` một lịch đang bật, `cancel` một lịch đã hủy: 200, không đổi gì.
- Nút tạm dừng, chạy tiếp, hủy ở danh sách gửi `version` đang thấy; sai → 409 `STALE_VERSION`.
- **(SCHED-01)** Bộ hẹn giờ cũng ghi tin `schedule_state` (và phát `schedule_updated`) khi nó tự tạm dừng lịch, hoặc khi lịch một lần chuyển `completed`. Hai việc này không tăng `version` của chủ lịch tự làm, trừ tạm dừng.
- **Thứ tự khoá (SCHED-01, review #167).** Mọi đường khoá dòng theo một thứ tự và không quay ngược lên:
  1. hội thoại của lịch;
  2. lịch;
  3. chủ lịch (`users`);
  4. lượt;
  5. hội thoại của lượt.

  Đường nào cũng có thể bỏ qua một bậc. Ghi tin (`MessageRepo.createMessage`) khoá dòng hội thoại. Vì vậy, nếu một transaction khoá lịch trước rồi mới ghi tin trạng thái, nó sẽ deadlock với một lượt xác nhận (PostgreSQL trả `40P01`, route trả 500). Áp dụng như sau:
  - nút tạm dừng, chạy tiếp, hủy, "Chạy lượt này ngay" và "Lập lại kế hoạch" khoá hội thoại trước, qua `ScheduleRepo.ownedSchedule(…, lock)`;
  - bộ hẹn giờ khoá cả hai dòng bằng `SKIP LOCKED` (mục 6.3);
  - bước lưu kết quả của lượt (mục 6.4 bước 3) bắt đầu từ dòng lịch, và không ghi vào hội thoại của lịch.

  SCHED-02 giữ đúng thứ tự này.

### 6.6. API

Mọi route cần đăng nhập, chỉ chủ lịch dùng được; ID của người khác hoặc sai định dạng trả 404. Cờ tắt → mọi route dưới đây trả 404.

| Route | Trả về |
|---|---|
| `GET /api/schedules` | `{ schedules: ScheduleView[] }`, gồm cả `cancelled`/`completed` trong 30 ngày |
| `GET /api/schedules/:id/runs?limit=20` | `{ runs: ScheduleRunView[] }`, mới nhất trước, `limit` ≤ 50 |
| `GET /api/schedules/pending-count` | `{ count }`: số lượt `awaiting_approval` của người gọi |
| `POST /api/conversations/:convId/schedule-proposals/:messageId/confirm` | `{ schedule: ScheduleView }` hoặc 409 |
| `POST /api/schedules/:id/pause` · `/resume` · `/cancel`, body `{ version }` | `{ schedule: ScheduleView }` hoặc 409 |
| `POST /api/schedules/:id/run-now` | 201 `{ run: ScheduleRunView }`; lịch `cancelled`/`completed` → 409 `SCHEDULE_CLOSED`; đã có lượt `planning` → 409 `RUN_IN_PROGRESS` |
| `POST /api/schedule-runs/:id/replan` | như trên, `trigger: 'replan'`; chỉ cho lượt `expired`, `planning_failed`, `interrupted`, `missed`, ngược lại 409 `RUN_NOT_REPLANNABLE`. Lịch `completed` vẫn lập lại kế hoạch được cho lượt của nó; lịch `cancelled` thì không |

**(SCHED-01)** Lỗi có dạng `{ error: { code, message } }`: 409 theo bảng mã, 404 `NOT_FOUND`, 400 `BAD_REQUEST` (thiếu `version`), 500 `SERVER_ERROR`. `message` là câu tiếng Việt, cùng câu với bảng 409 của SCHED-03.

`GET /api/health` có `schedulesEnabled: true` khi cờ bật (giống `gmailEnabled`).

`run-now` và `replan` tạo lượt `planning` với `due_at = now`, phiên bản lịch hiện tại, rồi lập kế hoạch ngay (6.4); không đổi `next_run_at`. Mỗi lịch tối đa một lượt `planning` tại một thời điểm (`schedule_runs_one_planning`).

### 6.7. Sandbox

Kịch bản `SANDBOX_SCENARIO=schedule` (cờ bật): planner giả trả đề xuất lịch Calendar → Slack cho câu tạo lịch, đề xuất `update` cho câu "Đổi sang …", và kế hoạch Calendar → Slack soạn sẵn cho tin `schedule_run`. Runner browser bật cờ cho nhóm `schedule` và đặt `off` cho các nhóm khác.

**(SCHED-02)** Kịch bản này luôn chạy planner ở chế độ `llm`, như kịch bản `gmail`. Lý do: Slack sandbox không có kênh nào, nên ở chế độ `regex`, bước tra tên sẽ hỏi lại "Không tìm thấy ati-test" trước khi tới model. Câu bắt đầu bằng `Tạm dừng`, `Chạy tiếp`, `Hủy lịch` cho ra `pause`, `resume`, `cancel`.

## 7. Giao diện (SCHED-03, `longnguyen005`)

Theo design system Agentic và các trang React đã có; không thêm màu ngoài bảng. Chỉ hiện khi `health.schedulesEnabled`.

- **Khoảnh khắc mới `schedule`** trong `services/cockpit-moment.ts`, khi phản hồi mới nhất của hội thoại là `schedule_proposal`:
  - thẻ: tên lịch; thời gian viết tiếng Việt ("Thứ Hai đến thứ Sáu, 08:30, giờ Việt Nam"); việc sẽ làm (`request`); dịch vụ theo `servicePalette`; ba lần chạy tới; câu "Tới giờ, ATI lập kế hoạch mới và chờ bạn duyệt. Chưa có gì được ghi lên công cụ nào.";
  - `update`: hiện phần đổi so với `previous` (cũ gạch, mới đậm);
  - nút **Xác nhận** (gọi confirm), **Sửa** (focus ô nhập), **Bỏ qua** (chỉ ẩn thẻ trong phiên, không gọi API; mở lại hội thoại vẫn thấy đề xuất cho tới khi có tin mới hơn);
  - 409 → câu tiếng Việt theo `code`, nạp lại hội thoại.
- **Trạng thái lịch** trong hội thoại đã tạo lịch, sau xác nhận: "Đang bật · lần chạy tới …" hoặc "Đã tạm dừng: <lý do>", với nút Tạm dừng/Chạy tiếp, Chạy lượt này ngay, Hủy lịch (hộp xác nhận).
- **Hội thoại của lượt:** tin `schedule_run` hiện là "Lịch "<name>" tự gửi lúc 08:30", không hiện như người dùng tự gõ. Kế hoạch đã quá hạn có nút "Lập lại kế hoạch" (gọi `replan`).
- **Trang Nhật ký** (`pages/History`): thêm mục "Lịch chạy" trên danh sách hội thoại: mỗi lịch một hàng (tên, kiểu lặp, trạng thái, lần chạy tới, kết quả lần trước có link tới hội thoại của lượt), mở ra thấy 10 lượt gần nhất; nút như trên.
- **Thanh điều hướng** (`MainNav`): tab Nhật ký có số lượt chờ duyệt khi > 0; tên truy cập "Nhật ký, 1 lượt chờ duyệt". Web gọi `pending-count` mỗi 30 giây và khi tab được focus. **Không thêm tab** (bố cục FE-12 giữ nguyên).
- Không thêm route mới.

## 8. An toàn

- Mỗi lượt có kế hoạch, mã băm, lần duyệt riêng; không lượt nào tự ghi.
- Nội dung đọc từ dịch vụ (tên sự kiện, tin nhắn) chỉ vào kế hoạch của lượt đó, và người dùng duyệt trước khi ghi. Nó không sửa được `request`, giờ, hay dịch vụ của lịch: chỉ câu người dùng gõ trong hội thoại tạo lịch mới tạo đề xuất.
- `request` do người dùng gõ; lớp an toàn của validator áp lên đề xuất.
- Giới hạn chi phí: tối đa 10 lịch `active`/`paused` mỗi người; lập kế hoạch tuần tự; tự tạm dừng sau 3 lượt liền quá hạn.

## 9. Kiểm thử và nghiệm thu

### 9.1. Bắt buộc trong mỗi PR

- TDD: test fail trước, có RED trong log.
- PostgreSQL thật cho mọi logic khoá, khoá duy nhất, CAS phiên bản; không mock repo trong các test này.
- Đồng hồ tiêm được; không dùng `sleep` để chờ giờ hẹn.
- Cờ tắt: SHA-256 prompt không đổi, route 404, bộ hẹn giờ không khởi động, web không gọi API lịch.

**Ca bắt buộc (SCHED-01, SCHED-02):**
- hai `tick()` chạy song song trên hai kết nối → đúng một lượt mỗi giờ hẹn;
- xác nhận đề xuất cũ sau khi có đề xuất mới → 409, không đổi gì; hai lần xác nhận cùng đề xuất song song → đúng một lần áp dụng;
- tạm dừng, sửa, hủy trong lúc lượt đang lập kế hoạch → lượt `discarded`, không có kế hoạch;
- khởi động lại khi có lượt `planning` → `interrupted`, không gọi model;
- tắt máy qua 3 giờ hẹn rồi bật lại → một lượt `missed` với `missed_count = 3`, lần chạy tới ở tương lai;
- model quá hạn khi lập kế hoạch lượt → `planning_failed`; `replan` tạo lượt mới;
- người B không đọc, không xác nhận, không chạy được lịch của A (404);
- `nextOccurrence` ở các ranh giới mục 6.2.

**Đột biến bắt buộc** (mỗi đột biến phải làm ít nhất một test fail): bỏ `SKIP LOCKED`; bỏ khoá duy nhất `schedule_runs_slot`; bỏ so `baseVersion`; bỏ kiểm `version` trước khi lưu kế hoạch của lượt; tính lượt lỡ như lượt thường; `resume` tạo lượt cho giờ hẹn đã qua; cờ tắt vẫn thêm mục lịch vào prompt.

### 9.2. Bộ đo ý định (SCHED-04)

`evaluations/golden-v2/cases-schedule.json`, khoảng 16 câu, label commit **trước** mọi lời gọi model; `EVAL_SET=schedule`, chạy với `SCHEDULES_ENABLED=on`, ×3:
- tạo lịch: một lần, hằng ngày, hằng tuần (tiếng Việt và tiếng Anh);
- không phải lịch: tạo sự kiện Calendar, hạn của card, việc làm ngay;
- hỏi lại: thiếu giờ, hằng tháng, việc chỉ đọc;
- nhiều lượt (`turns`): sửa giờ, sửa ngày, tạm dừng.

Chấm: `kind`, `action`, các trường `recurrence`; với câu không phải lịch, chấm như bộ `services`. Label do reviewer viết, cũng là người viết prompt, nên báo cáo ghi bộ này **không độc lập**.

**Đo lại khi bật cờ:** `core` ×1 và `services` ×1 với `SCHEDULES_ENABLED=on`, cùng **đúng bộ cờ sẽ bật lúc bảo vệ** (`GMAIL_ENABLED`, `PLANNER_READ_ANSWERS` theo kết quả GMAIL-04). Quy tắc bật cờ giống GMAIL-04: nếu một bộ thấp hơn số gần nhất khi cờ tắt quá 2 câu, chạy đối chứng cờ tắt cùng ngày; **không câu hành động nào của `core`/`services` được thành `schedule`**.

### 9.3. Nghiệm thu thật (SCHED-04, nhóm trưởng thao tác)

App live, `ag/gemini-3.8-flash`, PostgreSQL tạm riêng, cờ bật, mọi lệnh ghi do nhóm trưởng duyệt đúng mã băm:
1. Kịch bản demo mục 3, bước 1–2 và 5.
2. "Chạy lượt này ngay" → duyệt → tin trong Slack `#ati-test`; đọc lại bằng tool đọc nếu có.
3. Lịch một lần sau 3 phút, app mở, trình duyệt đóng → tới giờ lượt `awaiting_approval`; mở app thấy số trên tab Nhật ký; duyệt.
4. Lịch một lần, dừng API qua giờ hẹn hơn 10 phút, bật lại → lượt `missed`, không có lệnh ghi.
5. Để một lượt quá hạn → "Lập lại kế hoạch" tạo kế hoạch mới.

Bằng chứng giữ ở `docs/ai-evidence/SCHEDULE-LIVE/` (thêm vào `.gitignore`), không commit.

## 10. Task, lịch và mốc cắt

| Task | Nội dung | Người làm | Merge trước |
|---|---|---|---|
| SCHED-00 | Đặc tả này, task card, ROADMAP, mục 7 của CURRENT-STATE | reviewer | 25/10 (chỉ tài liệu) |
| SCHED-01 | Kiểu dữ liệu (mục 4), migration 0010, repo, `nextOccurrence`, `ScheduleRunner`, API, sandbox, đối soát khởi động | reviewer | 29/10 |
| SCHED-02 | Planner: cờ, prompt, `validateSchedule`, `ChatService` lưu đề xuất, xác nhận, lập kế hoạch cho lượt | reviewer | 30/10 |
| SCHED-03 | Giao diện mục 7, nhóm browser `schedule` | `longnguyen005` | 01/11 |
| SCHED-04 | Bộ đo ý định, đo lại khi bật cờ, nghiệm thu thật, PR bật cờ | reviewer (bộ đo), nhóm trưởng (nghiệm thu) | 04/11 |

- Mã sản phẩm chỉ merge từ 26/10 (sau buổi thử W4-03).
- SCHED-03 bắt đầu được ngay sau khi đặc tả duyệt, dựng trên kiểu dữ liệu mục 4 và kịch bản sandbox; merge sau SCHED-01 và SCHED-02.
- Mỗi PR có review độc lập riêng; reviewer thi công không tự review.

**Mốc cắt:**
- **01/11:** SCHED-01 hoặc SCHED-02 chưa merge → dừng OAuth, dồn sức cho lịch chạy.
- **03/11:** nghiệm thu thật chưa đạt → cờ giữ tắt; báo cáo cuối kỳ ghi lịch chạy là phần đã làm nhưng chưa bật, kèm số đo đã có.
- Long không kịp SCHED-03 trước 31/10 → reviewer nhận phần giao diện, nhóm trưởng quyết.

## 11. Rủi ro

| Rủi ro | Cách giảm |
|---|---|
| Model quá hạn lúc lập kế hoạch lượt (W4-01: 17/124 lần thử) | `planning_failed` + "Lập lại kế hoạch"; demo có "Chạy lượt này ngay" |
| Máy nhóm trưởng ngủ hoặc tắt lúc tới giờ trong buổi bảo vệ | lượt lỡ được ghi; demo dùng lịch hẹn sau vài phút và nút chạy ngay |
| Prompt dài hơn khi bật cờ, độ trễ tăng | đo lại `core`/`services` khi bật cờ (9.2) |
| Gọi model mỗi ngày dù không ai duyệt | giới hạn 10 lịch, tự tạm dừng sau 3 lượt quá hạn |
| Thời gian 26/10–04/11 trùng GMAIL-04, báo cáo W4-03, OAuth | mốc cắt mục 10 |
| Hội thoại của lượt làm danh sách Nhật ký dài | tiêu đề "Lịch: …"; lọc theo lịch để sau |
