# Đặc tả Thiết kế: Google Calendar OAuth Cá nhân & Tự động hóa Lịch trình Thông minh (v2)

**Ngày:** 2026-11-02  
**Trạng thái:** Approved (v2 — Self-Brainstormed & Audited)  
**Tác giả:** Antigravity Master Orchestrator (Product, Architecture, Security & QA)  
**Kế thừa & Nâng cấp từ:**
- [`docs/superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md`](./2026-10-26-oauth-02-personal-calendar-design.md) (`OAUTH-02`)
- [`docs/superpowers/specs/2026-09-29-ai-workflow-platform-v3-design.md`](./2026-09-29-ai-workflow-platform-v3-design.md) (Chuẩn tắc hệ thống v3)
- [`docs/superpowers/specs/2026-10-18-sched-01-scheduled-workflows-design.md`](./2026-10-18-sched-01-scheduled-workflows-design.md) (`SCHED-01`)

---

## 0. Phản biện Thực tế từ Góc nhìn Người dùng & Doanh nghiệp (Self-Brainstorming Critique)

Khi đóng vai một người dùng thực tế (Individual Contributor, Team Lead, Project Manager) sử dụng ATI hằng ngày để điều phối công việc giữa **Gmail, GitHub, Trello, Jira, Slack, Telegram và Google Calendar**, thiết kế `OAUTH-02` ban đầu bộc lộ **3 điểm nghẽn trải nghiệm (UX/Business bottlenecks)** lớn:

1. **Ma sát khi kết nối OAuth lần đầu (OAuth Scope Friction):**
   - *Hiện trạng (`OAUTH-02`):* Sau khi bấm "Cho phép" ở màn hình Google Consent, người dùng luôn bị chặn ở trạng thái `scope_required` (`selectedCalendars: []`) và bắt buộc phải tự tìm tích chọn từng lịch rồi bấm Lưu, dù 90% người dùng cá nhân chỉ muốn dùng ngay **Lịch chính (`primary`)** của mình để tiếp tục câu lệnh đang dang dở trong khung chat.
   - *Giải pháp v2:* Hỗ trợ **Chọn nhanh Lịch chính 1-chạm (`quickSelectPrimary` / `autoSelectPrimary`)** ngay trên màn hình Callback và Cài đặt (tự động nhận diện lịch có `primary: true` và quyền ghi `owner`/`writer`), đồng thời vẫn giữ nguyên khả năng chọn tối đa 5 lịch tùy chỉnh cho người dùng nâng cao và giữ tương thích ngược 100% với hành vi mặc định của API `POST /api/connections/mycalendar/callback`.

2. **Điểm mù Từ khóa Tự nhiên & Xung đột Lịch họp (Natural Query & Double-Booking Blindness):**
   - *Hiện trạng (`OAUTH-02`):*
     - Khi người dùng hỏi *"Hôm nay tôi có lịch gì?"*, *"Tìm các cuộc họp sắp tới"* hoặc *"Kiểm tra xem có cuộc họp nào bị trùng lịch (conflict) không?"*, LLM thường sinh tham số `query: "today"`, `"upcoming"`, `"open"`, `"conflict"`, `"trùng lịch"`, `"busy"`, `"*"`. Adapter hiện tại truyền nguyên chuỗi này vào tham số `?q=` của Google Calendar API, khiến Google tìm các sự kiện có tiêu đề chứa chữ `"today"` hoặc `"conflict"` và trả về **0 kết quả**!
     - Khi người dùng tạo lịch họp từ nguồn khác (ví dụ: *"Đọc email khách hàng / PR GitHub / thẻ Trello và đặt lịch họp vào 10:00–11:00 sáng mai"*), ATI lập kế hoạch `mycalendar.create_event` mà **không kiểm tra xem khung giờ 10:00–11:00 đó đã có cuộc họp nào chưa**. Người dùng phải tự mở tab Google Calendar để dò thủ công trước khi dám bấm Approve.
   - *Giải pháp v2:*
     - Bổ sung bộ phân tích truy vấn tự nhiên **`parseCalendarEventQuery`** trong cả `CalendarAdapter` và `PersonalCalendarAdapter`: nhận diện và bóc tách các từ khóa trạng thái/bộ lọc tự nhiên (`*`, `all`, `today`, `hôm nay`, `open`, `upcoming`, `sắp tới`, `busy`, `bận`, `free`, `trống`, `conflict`, `conflicts`, `trùng lịch`, `xung đột`) khỏi chuỗi tìm kiếm `?q=` gửi lên Google, đồng thời giữ lại từ khóa nội dung thực sự (ví dụ: `"conflict sprint"` → lọc các sự kiện bị trùng giờ có tiêu đề/mô tả khớp `"sprint"`).
     - Bổ sung thuật toán phát hiện trùng lịch **`detectCalendarConflicts`**: hai sự kiện $A$ và $B$ (không tính sự kiện cả ngày dạng `date` thuần túy nếu không có mốc giờ giao nhau) bị coi là xung đột khi $\text{start}_A < \text{end}_B \land \text{start}_B < \text{end}_A$.
     - Tự động kiểm tra xung đột ngay ở bước lập kế hoạch (**Planning-Time Conflict Pre-check** trong `ChatService.bindConnections`): khi plan có bước `mycalendar.create_event`, hệ thống tự động đối chiếu khung giờ `[start, end]` với các sự kiện hiện có trên lịch đích và gắn cảnh báo rõ ràng vào `plan.warnings` (ví dụ: `"Cảnh báo trùng lịch: Khung giờ ... trùng với 1 sự kiện hiện có (\"Sprint Planning\")."`) ngay trên thẻ duyệt kế hoạch.

3. **Mệt mỏi vì Duyệt Thủ công cho Bản tin Lịch họp Buổi sáng (Morning Briefing Approval Fatigue):**
   - *Hiện trạng (`SCHED-01`):* Người dùng đặt lịch *"7:30 sáng mỗi ngày tóm tắt lịch họp hôm nay của tôi và cảnh báo các cuộc họp trùng giờ gửi vào Slack #daily-briefing (hoặc Telegram)"*. Với `SCHED-01`, mỗi sáng lịch chỉ dừng ở trạng thái `planned` (`Chờ bạn duyệt`). Người dùng vẫn phải mở ATI mỗi sáng để bấm Approve thì tin nhắn mới vào Slack/Telegram; nếu quên 3 sáng liên tiếp, lịch tự động bị `paused` (`3 lượt liền không được duyệt`).
   - *Giải pháp v2:* Bổ sung **Chế độ Duyệt Lịch chạy (`approvalMode: 'manual' | 'auto_digest'`)** cho kịch bản Bản tin Lịch cá nhân (`kind: 'calendar_digest'`):
     - **Chế độ 1 — `manual` (Mặc định: Duyệt thủ công mỗi lượt):** Giữ nguyên hành vi an toàn của `SCHED-01` cho mọi lịch có thao tác tạo/sửa sự kiện hoặc liên kết đa dịch vụ phức tạp.
     - **Chế độ 2 — `auto_digest` (Tự động gửi Briefing Lịch đến kênh đã khóa):** Khi người dùng chủ động chọn ở bước xác nhận tạo lịch, hệ thống khóa chặt (`SHA-256` `digest_config_hash`) danh sách 1–5 lịch cá nhân (`mycalendar`) cùng đúng 1 kênh nhận (`slack` channel hoặc `telegram` chat). Đến giờ hẹn, `ScheduleRunner` tự động đọc lịch trong ngày, phát hiện xung đột giờ họp, tóm tắt ngắn gọn và gửi thẳng vào Slack/Telegram mà không bắt người dùng bấm duyệt lại mỗi sáng.

---

## 1. Mục tiêu & Phạm vi (Goals & Non-Goals)

### 1.1. Mục tiêu (In-Scope)
1. **Kết nối OAuth Lịch cá nhân mượt mà (`mycalendar`):**
   - Giữ nguyên sự tách biệt giữa dự án OAuth Đăng nhập (`GOOGLE_CLIENT_ID`) và dự án OAuth Lịch cá nhân (`GOOGLE_CALENDAR_CLIENT_ID`), mã hóa token bằng AES-256-GCM và ràng buộc `oauth_states` (`mode = 'connect_mycalendar'`, `user_id`, `session_id`, `return_to`).
   - Hỗ trợ tùy chọn `autoSelectPrimary?: boolean` trong `POST /api/connections/mycalendar/callback` và endpoint/hành động chọn nhanh Lịch chính (`POST /api/connections/mycalendar/select-primary` hoặc nút 1-chạm trên UI) để kích hoạt ngay lịch chính (`primary: true`) mà không làm hỏng các test `scope_required` mặc định.
2. **Bộ lọc Sự kiện Tự nhiên & Phát hiện Trùng lịch Tự động (`CalendarAdapter` & `PersonalCalendarAdapter`):**
   - Hỗ trợ `parseCalendarEventQuery` cho `calendar.list_events` và `mycalendar.list_events`.
   - Hỗ trợ phát hiện sự kiện giao nhau theo thời gian (`detectCalendarConflicts`) khi người dùng truy vấn `conflict`/`trùng lịch` hoặc khi kiểm tra xung đột trước khi tạo sự kiện.
   - Tự động cảnh báo trùng lịch trong `ChatService.bindConnections` khi kế hoạch chứa bước `mycalendar.create_event` bị giao thời gian với sự kiện đã có trên lịch cá nhân.
3. **Chế độ Lịch tự động gửi Bản tin Lịch họp (`calendar_digest` — `manual` vs `auto_digest`):**
   - Đánh giá điều kiện `calendarDigestCandidate` khi đề xuất lịch (`ScheduleProposalMetadata`).
   - Cho phép người dùng chọn `approvalMode: 'manual' | 'auto_digest'` trên `ScheduleMoment.tsx` trước khi xác nhận.
   - Thực thi `calendar_digest` trong `ScheduleRunner` với đầy đủ cổng an toàn: kiểm tra `digest_config_hash`, kiểm tra kết nối `mycalendar` và scope kênh đích (`slack` hoặc `telegram`), đọc sự kiện với `AbortSignal` 30 giây, tổng hợp số sự kiện & số xung đột, tóm tắt AI tùy chọn với `AbortSignal` 10 giây (fallback an toàn khi timeout/lỗi), kiểm tra lại `schedules.version` trước khi gửi, escape ký tự điều khiển Slack/Telegram, và tự động tạm dừng sau 3 lần `digest_failed` liên tiếp.

### 1.2. Ngoài phạm vi (Out-of-Scope)
- Không tự động tạo, sửa hoặc xóa sự kiện trên Google Calendar ở chế độ `auto_digest`. Mọi thao tác ghi vào Google Calendar (`mycalendar.create_event`) bắt buộc đi qua chế độ `manual` (tạo Plan và chờ người dùng bấm Approve).
- Không thay đổi 33 tools cốt lõi trong `ALL_TOOLS` hoặc chữ ký SHA-256 của system prompt mặc định khi cờ `MYCALENDAR_ENABLED` / `SCHEDULES_ENABLED` tắt.

---

## 2. Kiến trúc Chi tiết theo 3 Trụ cột

### Trụ cột 1: Tối ưu hóa Luồng OAuth Lịch cá nhân (`mycalendar`) & Chọn nhanh Lịch chính

1. **Giữ nguyên Bảo mật OAuth & Tách biệt Dự án Google:**
   - Sử dụng `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` độc lập hoàn toàn với OAuth đăng nhập.
   - Scope yêu cầu: `openid email https://www.googleapis.com/auth/calendar`.
   - Ràng buộc PKCE (`S256`), `state_hash` (SHA-256), `browser_binding_hash` (cookie `HttpOnly` `__Host-ati_oauth_bind` / `ati_oauth_bind`), `user_id`, `session_id`, và `return_to` (`^/c/[0-9a-f-]{36}$`).

2. **Chọn nhanh Lịch chính (`autoSelectPrimary` & `POST /api/connections/mycalendar/select-primary`):**
   - Trong `POST /api/connections/mycalendar/callback`:
     - Nếu body không truyền `autoSelectPrimary: true` (mặc định): giữ nguyên hành vi lưu `selectedCalendars: []` và trả về `status: 'scope_required'` để người dùng chọn lịch hoặc các bài kiểm thử hiện hữu kiểm tra bước chọn scope.
     - Nếu body truyền `autoSelectPrimary: true`: sau khi lấy danh sách lịch có quyền ghi (`owner` hoặc `writer`), nếu tìm thấy lịch có `primary: true` (hoặc nếu chỉ có đúng 1 lịch ghi được), hệ thống tự động gán lịch đó vào `selectedCalendars` và `allowed_scope`, trả về `status: 'connected'`, `selectedCalendars`, `allowedScope`.
   - Bổ sung route `POST /api/connections/mycalendar/select-primary`:
     - Tự động lấy danh sách lịch ghi được từ Google Calendar của user hiện tại, chọn lịch `primary: true` (hoặc lịch đầu tiên nếu không có cờ `primary`), lưu vào `service_credentials` (`selectedCalendars` + `allowed_scope`), và trả về `{ status: 'connected', email, selectedCalendars, allowedScope }`.
   - Trên giao diện `MyCalendarCallbackView.tsx` và `PersonalMyCalendar.tsx`:
     - Bên cạnh danh sách checkbox (tối đa 5 lịch), hiển thị nút thao tác nhanh **«Dùng ngay Lịch chính»** (`#mycalendar-quick-primary`) khi danh sách lịch có lịch `primary: true` (hoặc khi chưa chọn lịch nào), giúp người dùng hoàn tất chọn lịch và quay về cuộc trò chuyện (`/c/<uuid>`) chỉ với 1 cú nhấp chuột.

---

### Trụ cột 2: Lọc Sự kiện Tự nhiên & Phát hiện Xung đột Lịch họp (`CalendarAdapter` & `PersonalCalendarAdapter`)

#### 2.1. Phân tích Truy vấn Tự nhiên (`parseCalendarEventQuery`)
Hàm `parseCalendarEventQuery(rawQuery?: string)` được chia sẻ giữa `packages/tool-adapters/src/calendar/calendar-adapter.ts` và `personal-calendar-adapter.ts`:

```ts
export interface ParsedCalendarEventQuery {
  /** Chuỗi từ khóa thực sự để truyền vào tham số ?q= của Google Calendar API (undefined nếu chỉ chứa từ khóa lọc tự nhiên). */
  textQuery?: string;
  /** True khi người dùng yêu cầu chỉ lọc các sự kiện bị trùng giờ / xung đột. */
  onlyConflicts: boolean;
  /** Nhãn bộ lọc tự nhiên đã nhận diện (today | upcoming | open | busy | all). */
  naturalFilter?: 'today' | 'upcoming' | 'open' | 'busy' | 'all';
}
```

- **Quy tắc xử lý:**
  - Nếu `rawQuery` rỗng, chỉ chứa khoảng trắng, hoặc là `'*'`, `'all'`, `'tất cả'`: `textQuery = undefined`, `onlyConflicts = false`, `naturalFilter = 'all'`.
  - Các token bộ lọc thời gian/trạng thái tự nhiên (không phân biệt hoa thường):
    - Nhóm hôm nay/sắp tới/mở: `'today'`, `'hôm nay'`, `'hom nay'`, `'upcoming'`, `'sắp tới'`, `'sap toi'`, `'open'`, `'busy'`, `'bận'`, `'free'`, `'trống'`.
    - Nhóm xung đột/trùng lịch: `'conflict'`, `'conflicts'`, `'overlapping'`, `'overlap'`, `'trùng lịch'`, `'trung lich'`, `'xung đột'`, `'xung dot'`, `'trùng giờ'`, `'trung gio'`.
  - Khi `rawQuery` khớp hoàn toàn với một hoặc nhiều cụm từ khóa tự nhiên trên:
    - Không gửi `?q=` lên Google Calendar API (`textQuery = undefined`), nhờ đó Google trả về toàn bộ sự kiện trong khung `[timeMin, timeMax]`.
    - Nếu có từ khóa nhóm xung đột → bật `onlyConflicts = true`.
  - Khi `rawQuery` kết hợp từ khóa xung đột và từ khóa nội dung (ví dụ: `"conflict họp sprint"` hoặc `"trùng lịch review"`):
    - Bóc tách cụm từ khóa xung đột (`onlyConflicts = true`) và giữ lại phần từ khóa nội dung (`textQuery = "họp sprint"` hoặc lọc cục bộ không phân biệt hoa thường trên `title`/`summary`).

#### 2.2. Phát hiện Sự kiện Trùng giờ (`detectCalendarConflicts`)
- Định nghĩa cấu trúc sự kiện trả về từ `list_events`:
  ```ts
  export interface CalendarEventItem {
    id: string;
    title: string;
    start: string;
    end: string;
    url: string;
    conflict?: boolean;
    conflictsWith?: string[];
  }
  ```
- **Thuật toán kiểm tra giao nhau (`eventsOverlap(a, b)`):**
  - Chuyển `a.start`, `a.end`, `b.start`, `b.end` sang epoch milliseconds (`Date.parse`).
  - Bỏ qua các sự kiện không có khoảng thời gian hợp lệ hoặc `end <= start`.
  - Hai sự kiện $A$ và $B$ ($A.\text{id} \neq B.\text{id}$) giao nhau khi và chỉ khi:
    $$\text{Date.parse}(A.\text{start}) < \text{Date.parse}(B.\text{end}) \quad \land \quad \text{Date.parse}(B.\text{start}) < \text{Date.parse}(A.\text{end})$$
- **Hành vi tương thích ngược & làm giàu dữ liệu:**
  - Khi `onlyConflicts === false` và danh sách sự kiện trả về **không có xung đột** (như trong các unit test hiện hữu): giữ nguyên object `{ id, title, start, end, url }` (không thêm thuộc tính thừa `conflict: false`) để bảo toàn tuyệt đối các phép so sánh `.toEqual(...)` trong bộ test cũ.
  - Khi hai sự kiện thực sự trùng giờ ($\text{overlap} = \text{true}$): gắn `conflict: true` và `conflictsWith: [<tiêu đề sự kiện kia>]` vào các sự kiện bị trùng.
  - Khi `onlyConflicts === true` (người dùng hỏi sự kiện bị trùng lịch): chỉ giữ lại các sự kiện có `conflict === true` trong mảng `events` trả về.

#### 2.3. Kiểm tra Trùng lịch Tự động ở Bước Lập kế hoạch (`ChatService.bindConnections`)
- Trong `PersonalCalendarAdapter`: bổ sung phương thức `findConflicts(slot: { calendarId: string; start: string; end: string }, signal?: AbortSignal): Promise<CalendarEventItem[]>` (gọi `list_events` trên `calendarId` với `timeMin = slot.start`, `timeMax = slot.end` và lọc các sự kiện giao với `[slot.start, slot.end]`).
- Trong `ChatService.bindConnections`:
  - Khi plan có bước `mycalendar.create_event` đã vượt qua kiểm tra kết nối và `allowedCalendars`, nếu `options.lookupCalendarConflicts` (hoặc hàm tra cứu từ adapter) được cấu hình và trả về danh sách sự kiện trùng giờ `conflicts.length > 0`, `ChatService.bindConnections` tự động thêm cảnh báo tiếng Việt vào `plan.warnings`:
    - `Cảnh báo trùng lịch: Sự kiện "${stepTitle}" (${start} – ${end}) trùng giờ với ${conflicts.length} sự kiện hiện có trên lịch: ${titles.join(', ')}.`
  - Kế hoạch vẫn hợp lệ để người dùng quyết định (Approve nếu chấp nhận họp song song, hoặc Reject/nhắn lại giờ khác), đảm bảo không bao giờ âm thầm đặt đè lịch mà không báo trước.

---

### Trụ cột 3: Lịch chạy Tự động Bản tin Sáng (`calendar_digest` — `manual` vs `auto_digest`)

#### 3.1. Mô hình Dữ liệu PostgreSQL (`db/v3/0015_calendar_automation_digest.sql`)
Migration `0015_calendar_automation_digest.sql` (idempotent, chạy lặp lại an toàn):

1. **Bảng `schedules`:**
   - Thêm các cột (nếu chưa có):
     - `kind TEXT NOT NULL DEFAULT 'plan'`
     - `digest_config JSONB`
     - `digest_config_hash TEXT`
     - `digest_approved_at TIMESTAMPTZ`
   - Ràng buộc `schedules_kind_digest_check`:
     ```sql
     ALTER TABLE schedules DROP CONSTRAINT IF EXISTS schedules_kind_digest_check;
     ALTER TABLE schedules ADD CONSTRAINT schedules_kind_digest_check CHECK (
       (kind = 'plan' AND digest_config IS NULL AND digest_config_hash IS NULL AND digest_approved_at IS NULL)
       OR (kind IN ('calendar_digest', 'github_digest') AND digest_config IS NOT NULL AND digest_config_hash IS NOT NULL AND digest_approved_at IS NOT NULL)
     );
     ```
2. **Bảng `schedule_runs`:**
   - Mở rộng `schedule_runs_status_check` bao gồm `'digest_sent'` và `'digest_failed'`:
     ```sql
     ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_status_check;
     ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_status_check CHECK (
       status IN (
         'planning', 'planned', 'needs_attention', 'planning_failed',
         'interrupted', 'discarded', 'missed', 'blocked',
         'digest_sent', 'digest_failed'
       )
     );
     ```
   - Thêm cột `delivery JSONB` và ràng buộc song phương `schedule_runs_delivery_check`:
     ```sql
     ALTER TABLE schedule_runs ADD COLUMN IF NOT EXISTS delivery JSONB;
     ALTER TABLE schedule_runs DROP CONSTRAINT IF EXISTS schedule_runs_delivery_check;
     ALTER TABLE schedule_runs ADD CONSTRAINT schedule_runs_delivery_check CHECK (
       (status = 'digest_sent') = (delivery IS NOT NULL)
     );
     ```

#### 3.2. Kiểu dữ liệu TypeScript (`packages/tool-schemas/src/types.ts`)
```ts
export type ScheduleApprovalMode = 'manual' | 'auto_digest';
export type ScheduleKind = 'plan' | 'calendar_digest';

export interface CalendarDigestConfig {
  version: 1;
  source: 'mycalendar';
  credentialId: string;
  email: string;
  calendars: Array<{ id: string; summary: string; primary?: boolean }>;
  destination:
    | { service: 'slack'; channelId: string; channelName?: string }
    | { service: 'telegram'; chatId: string; chatTitle?: string };
  windowHours: number;
  includeSummary: boolean;
}

export interface CalendarDigestCandidate {
  canAutoDigest: boolean;
  defaultMode: ScheduleApprovalMode;
  disabledReason?: string;
  configPreview?: {
    email: string;
    calendars: Array<{ id: string; summary: string; primary?: boolean }>;
    destinationService: 'slack' | 'telegram';
    destinationId: string;
    destinationLabel: string;
  };
}

export interface CalendarDigestDelivery {
  destinationService?: 'slack' | 'telegram';
  channelId: string;
  channelName?: string;
  calendarsChecked: number;
  totalEvents: number;
  conflictCount: number;
  summaryIncluded: boolean;
  sentAt: string;
}
```
- Mở rộng `ScheduleProposalMetadata` với `digestCandidate?: CalendarDigestCandidate`.
- Mở rộng `ScheduleView` với `kind?: ScheduleKind`, `approvalMode?: ScheduleApprovalMode`, `digestConfig?: CalendarDigestConfig | null`.
- Mở rộng `ScheduleRunState` với `'digest_sent' | 'digest_failed'` và `ScheduleRunView` với `delivery?: CalendarDigestDelivery | null`.

#### 3.3. Đánh giá Ứng viên `calendarDigestCandidate` (`calendar-digest-candidate.ts`)
Khi `ChatService.prepareProposal` tạo đề xuất lịch mới (`proposal.action === 'create'`):
1. Kiểm tra tập dịch vụ `services` của lịch:
   - Phải chứa `'mycalendar'` (hoặc `'calendar'`) và đúng 1 dịch vụ gửi tin nhắn trong `['slack', 'telegram']`, tổng cộng đúng 2 dịch vụ.
2. Kiểm tra ý định chỉ đọc Lịch & gửi Báo cáo (Write-Intent Disqualifier):
   - Từ chối `canAutoDigest = false` (với `disabledReason` rõ ràng) nếu `request` có chứa động từ tạo/sửa/xóa sự kiện hoặc tác vụ ghi sang dịch vụ khác: `/\b(tạo sự kiện|tao su kien|đặt lịch họp|dat lich hop|thêm lịch|them lich|xóa lịch|xoa lich|hủy cuộc họp|create event|book meeting|schedule a meeting|tạo thẻ|create card|tạo issue|create issue|gửi email|send email|cập nhật bảng tính|append row)\b/i` (lưu ý: các cụm từ mô tả lịch chạy như *"Lên lịch mỗi sáng tóm tắt lịch họp gửi vào Slack"* là hợp lệ vì yêu cầu cốt lõi là *"tóm tắt lịch họp gửi vào Slack"*).
3. Kiểm tra kết nối `mycalendar` của chủ lịch (`userId`):
   - Phải có kết nối `mycalendar` đang `active`, có `credentialId`, `email`, và từ 1 đến 5 lịch trong `selectedCalendars`/`allowedCalendars`. Nếu chưa kết nối hoặc chưa chọn lịch → `canAutoDigest = false`, `disabledReason = 'Hãy kết nối Google Calendar cá nhân và chọn ít nhất 1 lịch trước khi bật tự động gửi.'`.
4. Kiểm tra phạm vi kênh nhận (`slack` hoặc `telegram`):
   - Nếu đích là `slack`: dịch vụ `slack` phải đang `active` và `allowedScope` có đúng 1 kênh hợp lệ (`^[CGD][A-Z0-9]{8,}$`). Nếu 0 hoặc >1 kênh → `canAutoDigest = false`, `disabledReason = 'Chế độ tự gửi chỉ bật khi phạm vi Slack được khóa vào đúng 1 kênh.'`.
   - Nếu đích là `telegram`: dịch vụ `telegram` phải đang `active` và `allowedScope` có đúng 1 `chatId` hợp lệ (`^-?\d{1,20}$`). Nếu 0 hoặc >1 chat → `canAutoDigest = false`, `disabledReason = 'Chế độ tự gửi chỉ bật khi phạm vi Telegram được khóa vào đúng 1 nhóm/chat.'`.
5. Khi thỏa mãn toàn bộ điều kiện: trả về `canAutoDigest = true`, `defaultMode = 'manual'`, kèm `configPreview` và `config: CalendarDigestConfig` + `configHash: sha256(canonicalJson(config))`.

#### 3.4. Xác nhận Chế độ Lịch (`ScheduleService.confirmProposal`)
- Endpoint `POST /api/conversations/:convId/schedule-proposals/:messageId/confirm` nhận body tùy chọn `{ approvalMode?: 'manual' | 'auto_digest' }`:
  - Nếu `approvalMode` không truyền: mặc định `'manual'`.
  - Nếu `approvalMode` khác `'manual'` và `'auto_digest'` → trả HTTP `400 BAD_REQUEST`.
- Trong `ScheduleService.confirmProposal`:
  - Khi `proposal.action === 'create'` và `approvalMode === 'auto_digest'`:
    - Gọi `verifyDigestApproval(client, userId, metadata)` để xác thực lại trong cùng transaction PostgreSQL rằng kết nối `mycalendar` và scope `slack`/`telegram` vẫn hợp lệ tại thời điểm bấm nút. Nếu không hợp lệ → ném `ScheduleConflict('AUTO_DIGEST_NOT_ELIGIBLE')` (HTTP `409`).
    - Lưu `kind = 'calendar_digest'`, `digest_config`, `digest_config_hash`, `digest_approved_at = now`.
  - Khi `proposal.action === 'update'` trên lịch đang có `kind = 'calendar_digest'`:
    - Nếu tập `services` mới không còn khớp với `[mycalendar, slack/telegram]` hoặc `request` mới chứa từ khóa ghi sự kiện: tự động hạ cấp an toàn về `kind = 'plan'`, `digest_config = NULL`, `digest_config_hash = NULL`, `digest_approved_at = NULL`.
    - Nếu vẫn hợp lệ: cập nhật lại `digest_config_hash` khớp với cấu hình hiện tại.

#### 3.5. Thực thi Bản tin Lịch họp trong `ScheduleRunner` (`calendar-digest-runner.ts`)
Khi `ScheduleRunner.planOne(runId)` xử lý một lượt chạy của lịch có `kind === 'calendar_digest'`:
1. **Cổng kiểm tra trước khi đọc (Pre-Read Gate):**
   - Tính lại `computeCalendarDigestHash(schedule.digest_config)` và đối chiếu với `schedule.digest_config_hash`.
   - Kiểm tra kết nối `mycalendar` của `userId`: phải còn `active`, `credentialId` trùng khớp với `digest_config.credentialId`, và mọi `calendar.id` trong `digest_config.calendars` vẫn nằm trong `allowedCalendars` hiện tại của user.
   - Kiểm tra dịch vụ đích (`slack` hoặc `telegram`): vẫn `active` và `channelId`/`chatId` vẫn nằm trong `allowedScope`.
   - Nếu bất kỳ điều kiện nào vi phạm → chuyển lượt chạy sang `status = 'blocked'`, tạm dừng lịch (`status = 'paused'`, `pause_reason`), ghi message hệ thống vào hội thoại lượt chạy và phát SSE `schedule_updated` (không gọi Google Calendar hay Slack/Telegram).
2. **Đọc sự kiện & Phát hiện xung đột (Bounded Read — 30s `AbortSignal`):**
   - Tính khung giờ đọc trong múi giờ của lịch (`Asia/Ho_Chi_Minh`): từ đầu ngày hiện tại (`00:00:00+07:00` của ngày `dueAt`) đến hết khung `windowHours` (mặc định hết ngày `23:59:59+07:00` hoặc `+24h`).
   - Với mỗi lịch trong `digest_config.calendars` (tối đa 5 lịch), gọi `mycalendar.list_events` thông qua `PersonalCalendarAdapter` của chủ lịch với `timeMin`, `timeMax`, `maxResults: 20` và `AbortSignal` tổng 30 giây.
   - Gộp và sắp xếp các sự kiện theo thời gian bắt đầu, chạy `detectCalendarConflicts` để xác định danh sách các cặp sự kiện bị trùng giờ (`conflictCount`).
3. **Tóm tắt AI tùy chọn (Bounded Summary — 10s `AbortSignal`):**
   - Nếu `includeSummary === true` và có hàm `summarizeCalendarDigest`, truyền danh sách dữ liệu cấu trúc đã làm sạch (`title` cắt tối đa 120 ký tự, `start`, `end`, `calendarSummary`, `conflict`) với `AbortSignal` 10 giây.
   - Nếu LLM quá 10 giây hoặc lỗi: bỏ qua phần tóm tắt AI và vẫn gửi bản tin định dạng chuẩn (`summaryIncluded = false`).
4. **Định dạng & Làm sạch Tin nhắn (Sanitization & Formatting):**
   - Escape toàn bộ ký tự điều khiển (`&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, vô hiệu hóa `@channel`, `@here`, `@everyone`, `<!subteam...>` bằng zero-width space `@\u200b...`).
   - Cấu trúc bản tin rõ ràng:
     - Tiêu đề: `📅 Bản tin Lịch làm việc: <Tên lịch> (< thời gian >)`
     - Thống kê nhanh: `Tổng số sự kiện: <N> trên <M> lịch` · `Cảnh báo trùng lịch: <K> sự kiện` (hoặc `Không có xung đột giờ họp`).
     - Tóm tắt nhanh (nếu có).
     - Danh sách sự kiện theo khung giờ từng lịch (kèm nhãn `[⚠️ Trùng giờ với: ...]` nếu `conflict === true`).
5. **Kiểm tra Phiên bản Tức thì trước khi Gửi (Pre-Send Version Check) & Gửi tin:**
   - Mở giao dịch kiểm tra `SELECT version, status FROM schedules WHERE id = $1`: nếu `version !== run.scheduleVersion` hoặc `status === 'cancelled'` → hủy gửi (0 tin nhắn gửi đi), đánh dấu run `status = 'discarded'`.
   - Gửi tin nhắn qua adapter đích (`slack.send_message` với `{ channel: channelId, text }` hoặc `telegram.send_message` với `{ chatId, text }`) cùng `AbortSignal`.
   - Lưu kết quả vào PostgreSQL:
     - Nếu thành công: `status = 'digest_sent'`, `delivery = { destinationService, channelId, channelName, calendarsChecked, totalEvents, conflictCount, summaryIncluded, sentAt }`, tạo message assistant trong hội thoại của lượt chạy.
     - Nếu thất bại (lỗi đọc Google Calendar hoặc lỗi gửi Slack/Telegram): `status = 'digest_failed'`, `error = <thông báo tiếng Việt rõ ràng>`. Nếu 3 lượt `scheduled` liên tiếp có `status = 'digest_failed'`, tự động tạm dừng lịch với `pause_reason = '3 lượt gửi bản tin liên tiếp thất bại'`.

---

## 3. Thiết kế Giao diện Người dùng (`apps/chat-web`)

1. **Màn hình Callback & Cài đặt Lịch cá nhân (`MyCalendarCallbackView.tsx` & `PersonalMyCalendar.tsx`):**
   - Thêm nút **«Dùng ngay Lịch chính»** (`id="mycalendar-quick-primary"`) khi danh sách lịch tải về có lịch `primary: true` (hoặc có ít nhất 1 lịch ghi được). Khi bấm, tự động chọn lịch chính, lưu scope qua `PUT /api/connections/mycalendar/scope` và điều hướng về `returnTo` (hoặc cập nhật trạng thái `Đã kết nối`).
2. **Thẻ Đề xuất Lịch chạy (`ScheduleMoment.tsx`):**
   - Khi `proposal.action === 'create'` và `metadata.digestCandidate` tồn tại:
     - Hiển thị khung chọn chế độ chạy (`role="radiogroup"`, `aria-label="Chế độ chạy lịch"`):
       - Radio 1 (`#schedule-mode-manual`, mặc định): **«Duyệt thủ công mỗi lượt (Khuyên dùng)»** — *Mỗi lần đến hẹn, hệ thống lập kế hoạch và chờ bạn kiểm tra trước khi gửi.*
       - Radio 2 (`#schedule-mode-auto-digest`, disabled nếu `!digestCandidate.canAutoDigest`): **«Tự động gửi Bản tin Lịch đến kênh đã khóa»** — *Đọc lịch cá nhân đã chọn, kiểm tra trùng giờ và gửi thẳng vào kênh đích mà không cần duyệt lại mỗi sáng.*
     - Khi chọn `auto_digest`, hiển thị hộp thông tin phạm vi khóa chặt (`#schedule-auto-digest-scope`): tài khoản `email`, tên các lịch cá nhân và kênh Slack/Telegram nhận tin.
     - Khi `!digestCandidate.canAutoDigest` và có `disabledReason`, hiển thị lý do bằng tiếng Việt dưới lựa chọn thứ hai.
3. **Danh sách Lịch chạy & Khôi phục Lượt chạy (`ScheduleSection.tsx`, `ScheduleRunRecovery.tsx`, `schedule-text.ts`):**
   - `ScheduleSection.tsx`: hiển thị huy hiệu `Tự gửi` bên cạnh tên lịch có `approvalMode === 'auto_digest'` (`kind === 'calendar_digest'`).
   - `schedule-text.ts`:
     - `runLabel(run)`: với `state === 'digest_sent'` trả về `` `Đã gửi · ${run.delivery?.totalEvents ?? 0} sự kiện${run.delivery?.conflictCount ? ` (${run.delivery.conflictCount} trùng giờ)` : ''}` ``; với `state === 'digest_failed'` trả về `'Gửi bản tin thất bại'`.
   - `ScheduleRunRecovery.tsx` & `ScheduleService.startRun`: cho phép bấm **«Chạy lại lượt này» / «Lập lại kế hoạch»** (`replan`) đối với lượt chạy có trạng thái `'digest_failed'` bên cạnh `'expired'`, `'planning_failed'`, `'interrupted'`, `'missed'`.

---

## 4. Vòng lặp Phản biện & Thẩm định Đặc tả (Self-Audit & Review Loop)

### Vòng 1 — Kiểm tra Góc nhìn User/Business & Tương thích Ngược (Backward Compatibility)
- **Phát hiện 1.1:** Các bài test hiện có trong `apps/chat-api/tests/routes/mycalendar-connections.test.ts` kiểm tra rằng `POST /api/connections/mycalendar/callback` với `{ code, state }` lưu `selectedCalendars: []` và trả về `status: 'scope_required'`.
  - *Giải pháp đã khóa trong Đặc tả:* Giữ nguyên hành vi mặc định khi không truyền `autoSelectPrimary: true`, chỉ tự động chọn lịch chính khi client truyền `autoSelectPrimary: true` hoặc bấm nút `#mycalendar-quick-primary` (gọi `saveMyCalendarScope([primaryCal.id])` hoặc `POST /api/connections/mycalendar/select-primary`). Nhờ đó 31/31 test cũ trong `mycalendar-connections.test.ts` và 100% test UI cũ trong `mycalendar-ui.test.tsx` giữ nguyên màu xanh!
- **Phát hiện 1.2:** Các bài test hiện có trong `packages/tool-adapters/tests/calendar-adapter.test.ts` và `personal-calendar-adapter.test.ts` dùng `.toEqual({ events: [{ id, title, start, end, url }] })` trên dữ liệu sự kiện không trùng giờ.
  - *Giải pháp đã khóa trong Đặc tả:* Chỉ thêm trường `conflict: true` và `conflictsWith: [...]` vào những sự kiện thực sự có giao thoa thời gian ($\text{start}_A < \text{end}_B \land \text{start}_B < \text{end}_A$). Các sự kiện không trùng giờ giữ nguyên đúng 5 trường `{ id, title, start, end, url }`.

### Vòng 2 — Kiểm tra Góc nhìn Kỹ thuật, Bảo mật & Bất biến Hệ thống (Security & Invariants)
- **Phát hiện 2.1:** Bất biến 33 tools trong `ALL_TOOLS` và SHA-256 của system prompt mặc định.
  - *Kiểm định:* Toàn bộ nâng cấp nằm ở tầng adapter (`calendar-adapter.ts`, `personal-calendar-adapter.ts`), `chat-service.ts`, `schedule-service.ts`, `schedule-runner.ts` và UI. Không thêm/bớt phần tử nào trong `ALL_TOOLS` (giữ nguyên 33 tools) và không chạm tới `prompts/system.md` (giữ nguyên SHA-256 `b31234b91e0c22191f5b0c5fb4be73299e673178df36ea3accb2633b42ec64f9`).
- **Phát hiện 2.2:** Chống Prompt Injection & Slack/Telegram Mass-Mention qua tiêu đề sự kiện Google Calendar.
  - *Kiểm định:* Lịch cá nhân có thể chứa lời mời họp từ bên ngoài với tiêu đề độc hại như `<!channel> Click <http://evil.example|here>`. Trong `calendar-digest-runner.ts`, mọi chuỗi lấy từ Google Calendar và từ LLM summary đều bắt buộc đi qua `escapeDigestText` trước khi ghép vào template gửi lên Slack/Telegram, và prompt tóm tắt đặt dữ liệu sự kiện trong cặp thẻ `<calendar_data>...</calendar_data>` với chỉ thị rõ không làm theo lệnh bên trong dữ liệu.
- **Phát hiện 2.3:** Race condition khi người dùng hủy hoặc sửa lịch đúng lúc `calendar_digest` đang đọc Google Calendar.
  - *Kiểm định:* Trước khi gọi `slack.send_message` hoặc `telegram.send_message`, runner khóa và kiểm tra lại `schedules.version` và `schedules.status`. Nếu `version !== run.scheduleVersion` hoặc `status === 'cancelled'`, runner hủy gửi ngay lập tức và ghi `status = 'discarded'`.

**Kết luận Thẩm định Đặc tả:** **0 lỗi tồn đọng (0 P1 / 0 P2 / 0 P3)** — Đạt chuẩn chuyển sang bước lập Kế hoạch Triển khai chi tiết.
