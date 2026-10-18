# 18/10/2026 · Đo GMAIL-04, W4-02 và W4-04 bằng model thật

**Người viết:** reviewer. Nhóm trưởng yêu cầu "đo bằng model thật: GMAIL-04, W4-02, W4-04" ngày 18/10, sớm hơn lịch 21–22/10. **Nhánh:** `eval/measure-2026-10-18`, base `31166cb`. Task: [GMAIL-04](../tasks/GMAIL-04-measure-and-live.md) bước 4, [W4-02](../tasks/W4-02-multi-turn-eval.md) bước 3–4, [W4-04](../tasks/W4-04-frontend-latency.md) bước 4. [Báo cáo](../../ai-evidence/V3-GOLDEN-V2/2026-10-18-GMAIL-04-W4-02-W4-04-REPORT.md).

## Chuẩn bị

- 9router ở `http://localhost:20128/v1` trả HTTP 200 với `/models`. `.env` có `LLM_MODEL=ag/gemini-3.8-flash`. Chỉ kiểm tên biến, không in giá trị bí mật.
- Chạy từ thư mục chính, đã fast-forward lên `31166cb`. Các đường dẫn label và mã mà runner kiểm (`evaluations/golden-v2`, `golden-independent`, `packages/planner`, `packages/tool-schemas`) đều sạch.

## Thứ tự chạy (UTC)

Mỗi bước chạy xong mới tới bước sau, để không hai phép đo nào dùng 9router cùng lúc.

1. **Golden** (`node --env-file=.env --import tsx evaluations/golden-v2/run.ts`, `LIVE_EVAL=1`, `PLANNER_SEARCH_MODE=llm`, `EVAL_CONCURRENCY=2`). Nếu một lượt dừng thì cả chuỗi dừng.
   - 05:59–06:05: `EVAL_SET=gmail`, `PLANNER_READ_ANSWERS=off`, 3 lượt;
   - 06:05–06:09: `answers`, `on`, 3 lượt;
   - 06:09–06:11: `multiturn`, `off`, 3 lượt;
   - 06:11–06:14: `core`, `on`, 1 lượt;
   - 06:14–06:18: `services`, `on`, 1 lượt.

   Cả năm lượt exit 0, `complete: true`.
2. **W4-04**, 06:18–06:25:
   - PostgreSQL 16 tmpfs riêng ở 55533. `DATABASE_URL` đặt trên dòng lệnh để ghi đè giá trị của `.env`, vốn trỏ vào DB dev 15433; DB dev không chạy và không bị đụng tới;
   - `db:migrate:v3`, `admin:provision:v3`;
   - app chạy bằng `RUNTIME_MODE=live GMAIL_ENABLED=off PLANNER_READ_ANSWERS=off npm run up`. Đã kiểm DB tạm có kết nối của app;
   - `setup-credentials.ts`: 8 dịch vụ lưu khoá, kết nối đều `healthy`;
   - `LIVE_APP_LATENCY=1 LIVE_APP_RUN_DIR=docs/ai-evidence/V3-LIVE-EXECUTION/W4-04-2026-10-18 … latency.config.ts`: exit 0, 1 passed (6,3 phút);
   - đọc lại trong DB tạm: 23 kế hoạch `rejected`, 0 `execution_steps`, 24 hội thoại.
3. **Đối chứng `services` cờ tắt**, 06:25–06:29, 1 lượt. Quy tắc của task card GMAIL-04 yêu cầu lượt này, vì lượt services bật cờ đạt 37/44, thấp hơn W3-10 quá 2 câu. Đối chứng đạt 43/44.

## Kết quả

Chi tiết và nguồn gốc (commit, SHA-256 label và catalog) nằm trong báo cáo.

- **GMAIL-04:**
  - `gmail` 59/60; injection **9/9**;
  - `answers` 27/30;
  - `core` bật cờ 50/50;
  - `services` bật cờ 37/44, đối chứng 43/44. Không câu hành động nào thành câu trả lời.
- **W4-02:** `multiturn` **36/36**.
- **W4-04:** 23/24 dưới 15 s; p50/p95/max 9,6/14,7/15,8 s; 0 lệnh ghi.
- **Câu trượt do label**, giữ nguyên điểm theo label đã đăng ký:
  - `gm04` lượt 3: nội dung tiếng Việt cho câu yêu cầu tiếng Anh;
  - `an_ca01` cả 3 lượt: `timeMax` 23:59:59, label đòi 00:00:00.
- `ca04` của services trả `refusal` ở cả hai lượt, như ở W3-10.

## Kiểm bản public

- Sáu thư mục report quét theo các chuỗi đã parse:
  - không có giá trị bí mật nào của `.env` (các biến chứa KEY/TOKEN/SECRET/PASSWORD/PRIVATE);
  - không có prompt hay câu người dùng ở lượt trước, trừ `"To Do"` và `"acme/web"` của bộ `multiturn`. Hai câu trả lời ngắn này trùng tên list và repo của fixture, nên xuất hiện trong dòng của các câu khác. Trong dòng của chính chúng, chuỗi vẫn bị che.
- Bằng chứng W4-04 có ID hội thoại và tên tài nguyên thật, nên giữ ở máy (ignore):
  - `batch.json` SHA-256 `cced019527fbef4c07acdfae8b7848aca604f745b4e25c7b494fd12e5f2893a8`;
  - `summary.md` `032df9ae5b758f8bab352bfafacb78efb971ce4dbb4cb55183ab790d1b2e6524`.

## Dọn sau khi đo

- Đã dừng app: launcher `start-v3.mjs`, API ở 3000 và web ở 5174. Đã kiểm dòng lệnh của từng tiến trình trước khi dừng. Cả hai cổng đã đóng.
- Đã dừng DB tạm `pg-w404`.
- Bản gốc của sáu thư mục report được chép sang worktree PR này, đối chiếu SHA-256 khớp 12/12 file, rồi cất vào kho lưu `.codex/worktree-archive/2026-10-18-measurements/` (ignore) ở thư mục chính.

## Chưa làm

- Nghiệm thu GMAIL-04 với Google thật (phần 1–3) và PR bật cờ, trước 28/10.
- W4-04 đo trước mốc chốt catalog 20/10, theo yêu cầu nhóm trưởng. Nếu catalog đổi trước 20/10 thì phải đo lại.
