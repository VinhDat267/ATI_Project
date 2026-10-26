# Kế hoạch hoàn thành dự án (26/10 → 11/11/2026)

Viết ngày 26/10/2026, sau merge #170 (`c760aa3`). Tài liệu này dùng khi **không còn reviewer cũ** (phiên lập kế hoạch và review lâu nay). Mọi việc còn lại tới buổi bảo vệ đều có ở đây: ai làm, làm khi nào, xong khi nào, và câu lệnh để giao cho agent.

Đọc theo thứ tự:
1. mục 1 (đang ở đâu), mục 2 (mốc cứng);
2. mục 3 (lịch từng ngày);
3. mục 6 (quy trình khi không còn reviewer cũ), trước khi giao việc đầu tiên.

Khi tài liệu này mâu thuẫn với task card, **task card đúng**. Khi task card mâu thuẫn với đặc tả, **đặc tả đúng**. Hết mỗi ngày, nhóm trưởng đánh dấu dòng đã xong ở mục 3, bằng một commit nhỏ hoặc trong PR ghi bàn giao.

## 1. Đang ở đâu (26/10)

- **Đã merge:**
  - toàn bộ phần lõi (8 dịch vụ, phê duyệt theo mã băm, thực thi, khôi phục, tài khoản, giao diện Agentic);
  - Gmail phần 1–3 và kiểu "trả lời", sau cờ tắt;
  - bộ đo tuần 4 (W4-01, W4-02, W4-04 đã đo);
  - lịch chạy SCHED-01 và SCHED-02, sau cờ `SCHEDULES_ENABLED` tắt;
  - kế hoạch OAuth (#169).
- **PR đang mở:**
  - **#171 SCHED-03** (giao diện lịch, `longnguyen005`): review độc lập ngày 26/10 kết luận **Đạt sau khi sửa nhỏ**, có 3 P3 ([bình luận review](https://github.com/VinhDat267/ATI_Project/pull/171#issuecomment-6415384685)). Long sửa, rồi kiểm lại phần sửa;
  - **#172 OAUTH-01** (kết nối Gmail ngay trong hội thoại): đang review độc lập.
- **Cờ hiện tại, đều tắt mặc định:** `GMAIL_ENABLED`, `PLANNER_READ_ANSWERS`, `SCHEDULES_ENABLED`. Buổi bảo vệ cần quyết bật cờ nào (mục 4).
- **Việc của con người còn mở:**
  - phiếu buổi thử W4-03, để chạy báo cáo;
  - nghiệm thu Google thật của GMAIL-04 (phần 1–3);
  - nghiệm thu thật của SCHED-04.

## 2. Mốc cứng

| Ngày | Mốc | Nếu trễ |
|---|---|---|
| 28/10 (T4) | GMAIL-04: nghiệm thu Google thật xong, PR bật cờ Gmail và kiểu "trả lời" merge | Giữ hai cờ tắt; demo không có Gmail; OAUTH-01 vẫn merge được nhưng không demo |
| 29/10 (T5) | #172 OAUTH-01 merge. Nhóm trưởng quyết **OAUTH-02** và **task độ trễ** (mục 4) | OAUTH-01 trượt sang 30–31/10; quá 01/11 thì để PR mở, ghi vào báo cáo là hướng phát triển |
| 31/10 (T7) | Bộ đo SCHED-04 merge. #171 SCHED-03 merge (hạn 01/11) | SCHED-03 trễ: lịch chạy không có giao diện, cờ giữ tắt |
| 01–02/11 | Đo SCHED-04 bằng model thật, viết báo cáo | Quá 02/11: bỏ đo, cờ lịch giữ tắt |
| 03/11 (T3) | Nghiệm thu thật lịch chạy (5 bước, đặc tả mục 9.3) | Chưa đạt: cờ lịch giữ tắt (đặc tả mục 10) |
| **04/11 (T4)** | **Ngừng thêm tính năng.** PR bật cờ lịch (nếu đạt) merge; gắn tag `demo-2026-11-04` | Sau mốc này chỉ sửa lỗi chặn demo, mỗi lỗi một PR có review |
| 05–06/11 | DEMO-01: môi trường demo dựng lại được, 3 kịch bản chạy 3 lần liên tiếp, diễn tập LLM dự phòng | Bỏ kịch bản yếu nhất, giữ 2 |
| 07/11 (T7) | VIDEO-01: quay video demo dự phòng | Dùng ảnh chụp và log thay video |
| 08/11 (CN) | REPORT-01 bản đủ; SLIDES-01 bản đủ | — |
| 09–10/11 | REHEARSAL-01: hai lần diễn tập, sửa slide và câu trả lời | — |
| 11/11 (T4) | Bảo vệ | — |

**Báo cáo và slide bắt đầu từ 27/10, song song với code.** Các phần không chờ số liệu mới (bài toán, kiến trúc, quy trình) viết trước. Xem REPORT-01.

## 3. Lịch từng ngày

Cột "Ai": NT = nhóm trưởng (`VinhDat267`); Long = `longnguyen005`; TV = các thành viên khác; A-thi công / A-review = hai phiên agent riêng (mục 6.1).

| Ngày | Việc | Ai | Xong khi | Ghi chú |
|---|---|---|---|---|
| 26/10 (T2) | Review độc lập #172 | A-review | Có kết luận trên PR | Đang chạy |
| 26/10 | Sửa 3 P3 của #171 | Long | Push lên #171 | Xem bình luận review |
| 26/10 | Gửi phiếu W4-03 (CSV theo `evaluations/usable-plan/PROTOCOL.md`) | NT | Có file phiếu ở máy | Không commit phiếu |
| 26–27/10 | GMAIL-04 nghiệm thu Google thật phần 1–3 | NT thao tác, A-thi công ghi log | Bằng chứng ở `docs/ai-evidence/GMAIL-LIVE/` | Task card GMAIL-04 bước 5 |
| 27/10 (T3) | Báo cáo W4-03 (`report.ts`), PR kết quả | A-thi công | PR có tỉ lệ và Wilson 95% | Câu lệnh P-W4-03 (mục 7) |
| 27/10 | Kiểm lại phần sửa #171 | A-review | Bình luận "Đạt" | Câu lệnh P-RECHECK |
| 27/10 | Bắt đầu bộ đo SCHED-04 (bước 1 của task card) | A-thi công | PR mở, label đã commit | Câu lệnh P-TASK với SCHED-04 bước 1 |
| 27/10 | REPORT-01: dựng khung, viết chương 1–3 | NT, TV | Bản nháp có mục lục | Song song với code |
| 28/10 (T4) | PR bật cờ GMAIL-04 (bước 6), review, merge | A-thi công, A-review, NT merge | Merge, CI `main` xanh | Theo quy tắc quyết định của task card |
| 28/10 | Sửa theo review #172 (nếu có) | A-thi công trong worktree `ATI_Project-wt-oauth01` | Push lên #172 | |
| 29/10 (T5) | Merge #172 (OAUTH-01) | NT | Merge, CI `main` xanh | |
| 29/10 | **Quyết OAUTH-02 và task độ trễ** | NT | Ghi vào log ghi bàn giao | Mặc định: bỏ cả hai (mục 4) |
| 29/10 | Ghi bàn giao cho các PR đã merge (#171/#172/GMAIL-04/W4-03) | A-review | PR ghi bàn giao merge | Câu lệnh P-RECORD |
| 30/10 (T6) | Review, merge bộ đo SCHED-04 | A-review, NT | Merge | Label phải commit trước mọi lời gọi model |
| 31/10 (T7) | Đệm. Merge #171 nếu chưa xong | NT | — | Hạn SCHED-03 là 01/11 |
| 01/11 (CN) | Đo SCHED-04: `schedule` ×3, `core` ×1, `services` ×1 (cờ bật) | A-thi công trên máy NT | Report trong `docs/ai-evidence/V3-GOLDEN-V2/` | Task card SCHED-04 bước 2 |
| 02/11 (T2) | Báo cáo SCHED-04, PR | A-thi công | PR mở | Bước 3 |
| 03/11 (T3) | Nghiệm thu thật lịch chạy, 5 bước | NT thao tác, A-thi công ghi | Bằng chứng ở `docs/ai-evidence/SCHEDULE-LIVE/` | Bước 4. Quyết bật cờ |
| 04/11 (T4) | PR bật cờ lịch (nếu đạt), merge; tag `demo-2026-11-04`; ghi bàn giao | A-thi công, A-review, NT | Tag trên `main` | **Ngừng thêm tính năng** |
| 05–06/11 | DEMO-01 | NT, A-thi công | `docs/demo/DEMO-RUNBOOK.md` merge; 3 kịch bản × 3 lần đạt | Task card DEMO-01 |
| 05–08/11 | REPORT-01 điền số liệu, hoàn thiện | NT, TV | `.docx` bản đủ | Task card REPORT-01 |
| 07/11 (T7) | VIDEO-01 | NT | Video ≤ 7 phút ở máy và Drive | Task card VIDEO-01 |
| 08/11 (CN) | SLIDES-01 | NT, TV | Bản đủ, khớp số liệu báo cáo | Task card SLIDES-01 |
| 09/11 (T2) | Diễn tập lần 1, sửa | Cả nhóm | Biên bản diễn tập | Task card REHEARSAL-01 |
| 10/11 (T3) | Diễn tập lần 2, kiểm tra trước ngày bảo vệ | Cả nhóm | Checklist ngày bảo vệ đủ | |
| 11/11 (T4) | Bảo vệ | Cả nhóm | — | |

## 4. Quyết định chờ nhóm trưởng

Mỗi quyết định có **mặc định**. Không quyết đúng hạn thì áp dụng mặc định, và ghi vào log của PR ghi bàn giao gần nhất.

| Quyết định | Hạn | Mặc định | Lý do mặc định |
|---|---|---|---|
| Bật `GMAIL_ENABLED` và `PLANNER_READ_ANSWERS` khi bảo vệ | 28/10 | Theo quy tắc quyết định trong GMAIL-04. Số đo 18/10: `gmail` 59/60 (injection 9/9), `answers` 27/30 → bật **nếu nghiệm thu Google thật đạt** | Số đo đã đủ; chỉ còn thiếu nghiệm thu thật |
| Làm OAUTH-02 (Google Calendar riêng) | 29/10 | **Bỏ**, ghi vào báo cáo là hướng phát triển. Nếu làm: [đặc tả](../superpowers/specs/2026-10-26-oauth-02-personal-calendar-design.md) và [task card](tasks/OAUTH-02-personal-calendar.md) đã sẵn; chỉ làm khi đủ ba điều kiện ở đặc tả mục 1.1; mốc cắt 01/11 | Ước lượng 3 ngày công cộng review, trong khi mốc 04/11 sát; ưu tiên SCHED-04 và ổn định demo |
| Làm task độ trễ (model suy nghĩ quá 30 s) | 29/10 | **Không làm mã.** Ghi giới hạn với số đo W4-01 (17/124 lần thử quá hạn) | Đổi deadline cần đo lại nhiều bộ golden. Nếu làm: [LAT-01](tasks/LAT-01-planning-deadline.md), xong trước 04/11 |
| Bật `SCHEDULES_ENABLED` khi bảo vệ | 03/11 | Theo quy tắc quyết định trong SCHED-04 | Đã chốt trong task card |
| Các việc backlog: W2-03 (lỗi thật của ba dịch vụ cũ), FE-10 phần chụp lại cạnh bản mẫu, logo Jira tối, tương phản chữ nhỏ, định tuyến `m4-07`, bước tra tên của `regex`, `timeMax` 23:59:59 | 29/10 | **Không làm trước 04/11.** Ghi vào báo cáo, mục giới hạn | Không chặn demo; mỗi việc cần đo lại hoặc đổi hình thức bản mẫu |
| Kịch bản demo | 04/11 | 3 kịch bản ở DEMO-01 (mục "Kịch bản") | Phủ nhiều dịch vụ, an toàn ghi, và một tính năng mới |

## 5. Mốc cắt và thứ tự bỏ khi thiếu thời gian

Bỏ theo thứ tự này, không bỏ ngược:
1. OAUTH-02 (mặc định đã bỏ).
2. Task độ trễ (mặc định đã bỏ).
3. OAUTH-01: nếu chưa merge trước 01/11, để PR mở.
4. Bật cờ lịch chạy: nếu SCHED-04 chưa đạt trước 03/11, giữ cờ tắt. Phần đã làm vẫn vào báo cáo, kèm số đo.
5. Bật cờ Gmail: nếu nghiệm thu Google thật chưa đạt trước 28/10, giữ tắt.
6. Video dự phòng: thay bằng ảnh chụp và log nếu không kịp.

**Không bao giờ bỏ:**
- quy tắc "chỉ ghi khi người dùng duyệt đúng kế hoạch";
- review độc lập cho mã sản phẩm;
- CI xanh trước khi merge;
- DEMO-01 (môi trường dựng lại được, 3 lần liên tiếp không lỗi);
- báo cáo và slide.

## 6. Quy trình khi không còn reviewer cũ

### 6.1. Vai trò

| Vai trò | Ai | Làm gì | Không làm gì |
|---|---|---|---|
| Nhóm trưởng | `VinhDat267` | Giao việc bằng câu lệnh ở `PROMPTS.md`; thao tác nghiệm thu thật; **merge**; quyết các mục ở mục 4 | Không merge khi chưa có kết luận "Đạt" của A-review và CI xanh |
| A-thi công | Một phiên agent (công cụ nào cũng được), worktree riêng mỗi task | Làm đúng một task card, TDD, mở PR | Không tự review PR của mình; không sửa CURRENT-STATE/ROADMAP |
| A-review | **Một phiên khác**, worktree riêng ở đúng head PR | Review theo `REVIEW-CHECKLIST.md`; kiểm lại phần sửa; **ghi bàn giao sau merge** (CURRENT-STATE, ROADMAP) | Không review PR mà chính phiên đó thi công |
| Long | `longnguyen005` | SCHED-03 và các sửa trên #171 | — |
| Thành viên | — | Báo cáo, slide, diễn tập | — |

A-review thay vai "reviewer" trong `AGENTS.md` và `README.md`: chỉ phiên này được sửa `CURRENT-STATE.md` và `ROADMAP.md`, và chỉ sau khi merge.

### 6.2. Vòng đời của một PR

1. **Giao việc** (nhóm trưởng): dán câu lệnh P-TASK (mục 7) cho A-thi công, kèm đường dẫn task card.
2. **Thi công** (A-thi công):
   - worktree riêng tách từ `origin/main`; TDD;
   - `npm run check` và `npm run test:browser:v3` exit 0 ở máy;
   - mở PR theo mẫu; điền phần "Kết quả" và một log mới.
3. **Review** (A-review, câu lệnh P-REVIEW):
   - worktree riêng ở đúng head; chạy lại check và browser;
   - tự làm đột biến;
   - ghi kết luận lên PR: **Đạt**, **Đạt sau khi sửa nhỏ** hoặc **Chưa đạt**, mỗi lỗi có file:dòng và cách tái hiện.
4. **Sửa** (A-thi công): sửa từng lỗi bằng TDD, ghi log sửa. A-review kiểm lại bằng P-RECHECK.
5. **Merge** (nhóm trưởng), khi có "Đạt" và CI xanh đúng head:
   `gh pr merge <N> --merge --delete-branch --match-head-commit <SHA 40 ký tự>`.
   Gỡ worktree của nhánh trước khi merge, nếu không lệnh xoá nhánh ở máy sẽ lỗi.
6. **Ghi bàn giao** (A-review, P-RECORD): một PR nhỏ sửa CURRENT-STATE (đầu file, mục 3, 4, 5 nếu có) và ROADMAP, kèm log `docs/handoff/log/<ngày>-reviewer-merge-<N>.md`. Nhóm trưởng merge.

Gộp nhiều PR đã merge vào một PR ghi bàn giao trong cùng ngày được, như #170.

### 6.3. Môi trường kiểm cục bộ

- **Không bao giờ dùng DB dev** (cổng 15433, hoặc container `ati-v3-postgres-1` ở 55533). Kiểm `docker ps` trước.
- **DB tạm**, dưới Git Bash:
  ```
  MSYS_NO_PATHCONV=1 docker run -d --name <tên> --tmpfs /var/lib/postgresql/data -p 127.0.0.1:56533:5432 -e POSTGRES_USER=ati_v3 -e POSTGRES_PASSWORD=ati_v3_local_only -e POSTGRES_DB=ati_v3 postgres:16
  ```
- **Check:** `RUNTIME_MODE=sandbox DATABASE_URL=postgresql://ati_v3:ati_v3_local_only@127.0.0.1:56533/ati_v3`, rồi `npm run db:migrate:v3`, rồi `npm run check`.
- **Browser:** dùng DB dựng lại sạch và cổng riêng để khỏi đụng app đang chạy:
  - đặt thêm `V3_LOCAL_DB_PORT=56533 PORT=3999 V3_WEB_PORT=5199 CHAT_ADMIN_EMAIL=ci-browser@localhost.test CHAT_ADMIN_PASSWORD=ci-browser-test-password-2026`;
  - chạy `npm run admin:provision:v3`, rồi `npm run test:browser:v3`.
- **Xong việc:** xoá container.
- **Test chập chờn đã biết** (CURRENT-STATE mục 5):
  - `page.goto` quá 30 s ở `/login`;
  - `auth-02b-email-timing` khi máy tải nặng;
  - lỗi OID ở `gmail-migration`.

  Gặp các lỗi này thì ghi lại, chạy riêng ca đó, rồi chạy lại cả bộ trên DB sạch. **Không sửa assertion hay timeout để cho đạt.** Lỗi ở chính phần PR sửa thì không được gọi là chập chờn.
- **Nội dung có dấu backslash** (regex, PEM) phải ghi bằng công cụ sửa file, không qua heredoc của shell.
- **Bằng chứng ignored ở `.codex/`** phải được sao chép ra ngoài trước khi gỡ worktree, và kiểm SHA-256. Bản lưu cũ ở `ATI_Project/.codex/worktree-archive/`.

### 6.4. Khi 9router hoặc model hỏng

Theo runbook W4-00 (`evaluations/README.md`, mục "W4-00 manual Codex fallback"):
- đổi `LLM_MODEL` sang `cx/gpt-6.1-sol` bằng biến môi trường, rồi khởi động lại app. Không sửa `.env` chính;
- không đổi model giữa một campaign đo. Đang đo mà hỏng thì dừng, và ghi lượt dở dang làm bằng chứng;
- trong buổi bảo vệ: chuyển model theo runbook. Nếu cả hai đường đều hỏng, chiếu video VIDEO-01.

### 6.5. Quy tắc không đổi

- Chỉ ghi ra dịch vụ thật khi nhóm trưởng đã duyệt đúng kế hoạch đó.
- Không commit `.env`, token, `docs/ai-evidence/{V3-LIVE-EXECUTION,AUTH-LIVE,GMAIL-LIVE,SCHEDULE-LIVE}/`, báo cáo môn học, ảnh có dữ liệu thật.
- Mô tả PR và commit viết tiếng Việt, theo `.github/pull_request_template.md`. Không có dòng "Generated with …" hay chữ ký AI. Tài liệu trong repo gọi người review là "reviewer", và ghi tên thành viên thay vì tên công cụ.
- Label golden phải commit **trước** lời gọi model đầu tiên.
- Mỗi task một nhánh, một PR; chỉ `git add` đúng file của task. Thư mục chính có file riêng chưa commit của nhóm trưởng (`PRODUCT.md`, `member-*.json`, `skills-lock.json`): không đụng tới.

## 7. Câu lệnh giao việc

Bản đầy đủ ở [`PROMPTS.md`](PROMPTS.md), mục "Khi không còn reviewer cũ". Tên dùng trong bảng ở mục 3:

| Mã | Dùng khi |
|---|---|
| P-START | Mở đầu mọi phiên agent mới |
| P-TASK | Giao một task card cho A-thi công |
| P-REVIEW | Giao review độc lập một PR |
| P-RECHECK | Kiểm lại phần sửa sau review |
| P-FIX | Giao A-thi công sửa theo review |
| P-RECORD | Ghi bàn giao sau khi merge |
| P-W4-03 | Chạy báo cáo buổi thử W4-03 |
| P-LIVE | Agent ghi bằng chứng khi nhóm trưởng nghiệm thu thật |
| P-PLAN | Lập một task card nhỏ khi phát sinh việc mới |

## 8. Task card của phần còn lại

| Việc | Task card | Ai | Hạn |
|---|---|---|---|
| Nghiệm thu Google thật, bật cờ Gmail | [GMAIL-04](tasks/GMAIL-04-measure-and-live.md) bước 5–6 | NT, A-thi công | 28/10 |
| Báo cáo buổi thử W4-03 | [W4-03](tasks/W4-03-usable-plan-study.md) | A-thi công | 27/10 |
| Giao diện lịch chạy | [SCHED-03](tasks/SCHED-03-schedule-ui.md), PR #171 | Long | 01/11 |
| Kết nối Gmail trong hội thoại | [OAUTH-01](tasks/OAUTH-01-connect-from-chat.md), PR #172 | A-thi công (sửa), A-review | 29/10 |
| Đo, nghiệm thu, bật cờ lịch chạy | [SCHED-04](tasks/SCHED-04-measure-and-live.md) | A-thi công, NT | 04/11 |
| Task độ trễ (tuỳ chọn) | [LAT-01](tasks/LAT-01-planning-deadline.md) | A-thi công | 04/11, chỉ khi NT chọn làm |
| Google Calendar riêng (tuỳ chọn) | [OAUTH-02](tasks/OAUTH-02-personal-calendar.md) | NT (Google Cloud, nghiệm thu), A-thi công | Mã trước 01/11, chỉ khi NT chọn làm |
| Ổn định demo | [DEMO-01](tasks/DEMO-01-demo-stability.md) | NT, A-thi công | 06/11 |
| Báo cáo cuối kỳ | [REPORT-01](tasks/REPORT-01-final-report.md) | NT, TV | 08/11 (hạn nộp theo môn học) |
| Slide | [SLIDES-01](tasks/SLIDES-01-defense-slides.md) | NT, TV | 08/11 |
| Video demo dự phòng | [VIDEO-01](tasks/VIDEO-01-backup-demo-video.md) | NT | 07/11 |
| Diễn tập bảo vệ | [REHEARSAL-01](tasks/REHEARSAL-01-defense-rehearsal.md) | Cả nhóm | 10/11 |
