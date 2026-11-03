# Đo SCHED-04 — Bộ câu lịch chạy (`schedule`) và đo lại `core` / `services` khi bật cờ — 03/11/2026

Thực hiện trên máy nhóm trưởng qua cổng cục bộ 9router (`http://localhost:20128/v1`). Không có lượt chạy nào bị dừng giữa chừng hay đổi model.

## Nguồn gốc

- **Source:** `80621466706541559b4b2dec2878c5fa8c050bd3` (nhánh `feat/sched-04-measure-and-rollout` tách từ `main` `44680364`).
  - Tree `packages/planner`: `42a1015a59a290ac0788af03fc127b0a7d224bb2`
  - Tree `packages/tool-schemas`: `e23d6843345b96fb45d99ef7a5c9234f61fa62ab`
- **Model:**
  - yêu cầu `ag/gemini-3.8-flash` qua 9router (`http://localhost:20128/v1`);
  - mọi lời gọi thành công trong cả 5 chiến dịch đều được phục vụ bởi `gemini-3.8-flash-n`.
- **Cấu hình:** `PLANNER_SEARCH_MODE=llm`, concurrency 2, deadline 30 s mỗi lần thử và tối đa 1 lần thử lại theo cấu hình production.
- **Golden:**
  - chỉ lập kế hoạch trên fixture, không gọi dịch vụ bên ngoài, không thực thi kế hoạch;
  - fixture SHA-256 `b8bcd784b40f47ba9a78105b71809f63e19530901277a44f57faa28b14281d55` cho mọi bộ;
  - catalog 33 tool (8 dịch vụ chung), SHA-256 `81931aec7ab39ffdb50f64e9b33978b1dadcd5cc96c3b4d820ec5806477667a0`.
- **Thứ tự chạy:** chạy nối tiếp từ 15:55Z đến 16:48Z ngày 03/11/2026 (UTC), không chiến dịch nào trùng giờ với chiến dịch khác.

| Lượt | Thư mục | Label (commit, SHA-256) | Cờ (`SCHEDULES` / `READ_ANSWERS`) | Lượt chạy | UTC | Lời gọi / lần thử / quá hạn |
|---|---|---|---|---|---|---|
| `schedule` ×3 | `schedule-llm-2026-11-03T15-55-41-605Z` | `cases-schedule.json` `80621466`, `c33ec2ad521d…` | `on` / `off` | 3/3, 48/48 | 15:55:41–16:06:10 | 48 / 68 / 23 (3 câu trượt deadline) |
| `core` ×1 (bật lịch) | `core-llm-answers-on-schedules-on-2026-11-03T16-08-05-437Z` | `cases.json` `1ab7f08`, `7edeac39d653…` | `on` / `on` | 1/1, 50/50 | 16:08:05–16:18:17 | 57 / 73 / 22 (6 câu trượt deadline) |
| `services` ×1 (bật lịch) | `services-llm-answers-on-schedules-on-2026-11-03T16-18-41-200Z` | `cases-services.json` `795229e`, `6281f0869a6c…` | `on` / `on` | 1/1, 44/44 | 16:18:41–16:28:31 | 48 / 66 / 24 (6 câu trượt deadline) |
| `core` ×1 (đối chứng tắt lịch) | `core-llm-answers-on-2026-11-03T16-28-57-241Z` | `cases.json` `1ab7f08`, `7edeac39d653…` | `off` / `on` | 1/1, 50/50 | 16:28:57–16:39:57 | 56 / 78 / 27 (5 câu trượt deadline) |
| `services` ×1 (đối chứng tắt lịch) | `services-llm-answers-on-2026-11-03T16-40-11-058Z` | `cases-services.json` `795229e`, `6281f0869a6c…` | `off` / `on` | 1/1, 44/44 | 16:40:11–16:48:45 | 49 / 62 / 20 (7 câu trượt deadline) |

**Label đăng ký trước.** Commit `80621466` (`2026-11-03T15:53:48Z`) đăng ký `evaluations/golden-v2/cases-schedule.json` trước lời gọi model đầu tiên (`2026-11-03T15:55:41Z`). Không có bất kỳ chỉnh sửa label hay prompt nào sau khi bắt đầu gọi model.

## Kết quả tổng hợp

| Lượt | Strict pass | Đạt trên số câu hoàn tất (không tính timeout 60s) | Tool | Tham số (khi đúng tool) | Câu không phải lịch bị thành `schedule` | Câu hành động bị thành `answer` | p50 / p95 / max | Dưới 15 s |
|---|---|---|---|---|---|---|---|---|
| `schedule` ×3 (`SCHEDULES=on`) | **45/48 (93,8%)** | **45/45 (100%)** | 91,7% | 100% | **0** | **0** | 15,9 / 60,0 / 60,1 s | 23/48 |
| `core` ×1 (`SCHEDULES=on`, `ANSWERS=on`) | **44/50 (88,0%)** | **44/44 (100%)** | 85,7% | 100% | **0** | **0** | 10,8 / 60,0 / 84,7 s | 31/50 |
| `core` ×1 (đối chứng `SCHEDULES=off`, `ANSWERS=on`) | **45/50 (90,0%)** | **45/45 (100%)** | 91,4% | 100% | **0** | **0** | 14,0 / 65,9 / 72,3 s | 25/50 |
| `services` ×1 (`SCHEDULES=on`, `ANSWERS=on`) | **34/44 (77,3%)** | **34/34 câu ngoài `read_only` (100%)** | 89,3% | 100% | **0** | **0** | 13,9 / 60,0 / 63,5 s | 23/44 |
| `services` ×1 (đối chứng `SCHEDULES=off`, `ANSWERS=on`) | **32/44 (72,7%)** | **32/33 câu ngoài `read_only` (97,0%)** | 82,1% | 100% | **0** | **0** | 12,2 / 60,0 / 60,0 s | 25/44 |

### 1. Bộ câu lịch chạy (`EVAL_SET=schedule`, 16 câu × 3 lượt = 48 lần thử)

- **Tổng điểm:** đạt **45/48 (93,8%)** strict pass (lượt 1: `16/16`, lượt 2: `14/16`, lượt 3: `15/16`), vượt ngưỡng quyết định bật cờ (`≥ 40/48`).
- **Theo từng nhóm câu:**
  - **Tạo lịch (`sc_create01`–`06`, 6 câu × 3 lượt = 18):** đạt **17/18 (94,4%)**. Bao gồm `once` (`sc_create01` VI, `sc_create02` EN), `daily` (`sc_create03` VI, `sc_create04` EN) và `weekly` (`sc_create05` VI, `sc_create06` EN). Mọi câu hoàn tất đều khớp chính xác `kind: 'schedule'`, `action: 'create'` và `recurrence` (`type`, `time`, `date`, `days`). Chỉ `sc_create01` ở lượt 2 bị quá hạn 60,1 s sau 2 lần thử 30 s.
  - **Không phải lịch (`sc_plan01`–`04`, 4 câu × 3 lượt = 12):** đạt **11/12 (91,7%)**. Cả hai câu tạo sự kiện Google Calendar (`sc_plan01`, `sc_plan02`), câu tạo card Trello có hạn chót (`sc_plan03`) và câu gửi tin Slack ngay lập tức (`sc_plan04`) đều trả `kind: 'plan'` với đúng tool và tham số; **không lượt nào bị phân loại nhầm thành `schedule`**. Chỉ `sc_plan03` ở lượt 2 bị quá hạn 60,0 s.
  - **Hỏi lại (`sc_clar01`–`03`, 3 câu × 3 lượt = 9):** đạt **8/9 (88,9%)**:
    - thiếu giờ (`sc_clar01`): đạt `3/3`;
    - chu kỳ hằng tháng chưa hỗ trợ (`sc_clar02`): đạt `2/3` (lượt 3 quá hạn 60,0 s);
    - lịch chỉ đọc không ghi đi đâu (`sc_clar03`): đạt `3/3`.
  - **Nhiều lượt có `turns` (`sc_turn01`–`03`, 3 câu × 3 lượt = 9):** đạt **9/9 (100%)**:
    - đổi giờ từ 08:00 sang 08:30 (`sc_turn01`): đạt `3/3` (`action: 'update'`, `type: 'daily'`, `time: '08:30'`);
    - đổi sang thứ Hai đến thứ Sáu lúc 08:30 (`sc_turn02`): đạt `3/3` (`action: 'update'`, `type: 'weekly'`, `time: '08:30'`, `days: [1, 2, 3, 4, 5]`);
    - tạm dừng lịch (`sc_turn03`): đạt `3/3` (`action: 'pause'`).

### 2. Đo lại `core` và `services` khi bật cờ + đối chứng tắt cờ cùng ngày

- **Không câu nào bị biến thành `schedule`:** cả `core` (50 câu) lẫn `services` (44 câu) đều ghi nhận `Schedules: 0` và `Non-schedule cases that got a schedule: none`.
- **Không câu hành động nào bị biến thành `answer`:** cả hai bộ đều ghi nhận `Action cases that got an answer: none`.
- **Đối chứng cùng ngày trên `core`:**
  - Bật cờ (`SCHEDULES_ENABLED=on`): `44/50` strict pass (6 câu trượt đều do quá hạn 60 s ở cổng upstream: `ss09`, `ms03`, `ms08`, `cs06`, `cs12`, `cl06`; `44/44` câu có phản hồi đều đạt 100%).
  - Tắt cờ (`SCHEDULES_ENABLED=off`): `45/50` strict pass (5 câu trượt đều do quá hạn 60 s ở cổng upstream: `ss04`, `cs05`, `cs11`, `cl02`, `rf06`; `45/45` câu có phản hồi đều đạt 100%).
  - Chênh lệch giữa bật cờ và tắt cờ cùng ngày chỉ là **1 câu** (`44/50` so với `45/50`, nằm trong ngưỡng `≤ 2 câu`), và độ chính xác trên các câu hoàn tất ở cả hai lượt đều là **100%**.
- **Đối chứng cùng ngày trên `services`:**
  - Bật cờ (`SCHEDULES_ENABLED=on`): `34/44` strict pass. Trong 10 câu không qua: 6 câu thuộc nhóm `read_only` (`sh01`, `sh07`, `ca01`, `no01`, `tg01`, `ji01`) trả `answer` theo đúng thiết kế khi `PLANNER_READ_ANSWERS=on` (hoặc quá hạn ở bước đọc), và 4 câu còn lại (`sh03`, `ca04`, `no03`, `no07`) đều quá hạn 60 s ở cổng upstream. Trên 34 câu ngoài `read_only` có phản hồi, độ chính xác đạt **34/34 (100%)**.
  - Tắt cờ (`SCHEDULES_ENABLED=off`): `32/44` strict pass (gồm 6 câu `read_only`, 5 câu quá hạn 60 s `sh03`, `ca03`, `no02`, `tg07`, `wf01`, và `ca04` từ chối lời mời Calendar như ở W3-10/GMAIL-04).
  - Lượt bật cờ đạt cao hơn lượt đối chứng tắt cờ cùng ngày **+2 câu** (`34/44` so với `32/44`).

## Đối chiếu quy tắc bật cờ (`SCHED-04`)

| Điều kiện | Ngưỡng yêu cầu | Kết quả đo thực tế | Trạng thái |
|---|---|---|---|
| `schedule` ×3 | `≥ 40/48` | **45/48 (93,8%)** (`45/45` trên các câu không timeout) | **Đạt** |
| Không câu nào của `core` / `services` thành `schedule` | `0` câu | **0/50** ở `core`, **0/44** ở `services` | **Đạt** |
| `core` / `services` khi bật cờ so với đối chứng tắt cờ cùng ngày | Không thấp hơn quá 2 câu | `core`: `44/50` vs `45/50` (-1 câu); `services`: `34/44` vs `32/44` (+2 câu) | **Đạt** |
| Kiểm tra rò rỉ prompt / bí mật trong bản public | `0` câu rò rỉ | Quét toàn bộ 5 thư mục `report.json` và `summary.md`: `0` rò rỉ | **Đạt** |

## Giới hạn

- **Tính độc lập của bộ câu `schedule`:** 16 câu và label trong `evaluations/golden-v2/cases-schedule.json` do cùng tác giả với prompt lịch chạy thiết kế, nên bộ đo này **không độc lập** (tương tự giới hạn đã ghi nhận ở đặc tả mục 9.2).
- **Dao động độ trễ cổng upstream:** trong khung giờ đo 15:55–16:48Z ngày 03/11/2026, cổng upstream có các nhịp trễ trên 30 s mỗi lần thử khiến một số lời gọi chạm trần 60 s (2 lần thử × 30 s) ở cả lượt bật cờ lẫn lượt đối chứng tắt cờ.
- **Số lượt đo đối chứng:** `core` và `services` được đo 1 lượt khi bật cờ và 1 lượt đối chứng tắt cờ cùng ngày theo đúng quy định của task card `SCHED-04`. Các bộ `W4-01`, `W4-03`, `W4-04` nằm ngoài phạm vi đo lại khi bật cờ.
- **Nghiệm thu thật 5 bước (mục 9.3):** phần thao tác tay của nhóm trưởng với dịch vụ ngoài được tách riêng theo mục 9.3; trong PR này cờ `SCHEDULES_ENABLED` được chuyển sang mặc định `on` (tự động tắt an toàn khi khởi động không có PostgreSQL, giống `GMAIL_ENABLED`).
