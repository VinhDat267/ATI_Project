# 2026-10-02 · Codex · W3-00

- **Task:** `docs/handoff/tasks/W3-00-generic-service-plumbing.md`.
- **Base:** `9d262c6`; implementation: `e33177cf781d55ad9cfb77c538738ae937a0ac81`.
- **Branch:** `vinhdat/refactor-w3-00-generic-service-plumbing`.
- **PR:** [#29](https://github.com/VinhDat267/ATI_Project/pull/29).

## Đã làm

- ServiceDefinition dùng scopeKey tùy ý, scopeLabel, scopePattern và credential multiline; AllowedScope giữ nguyên JSON cũ.
- Tách định nghĩa vào tool-schemas/registry và HTTP transport vào chat-api/services/transports. Core liệt kê/configure/factory đọc đăng ký chung.
- Allowlist dùng một đường kiểm tra; GitHub giữ thông báo lỗi cũ. Regex repo thuộc metadata GitHub.
- Tách sandbox fake results theo service và các plan vào scenarios, giữ luồng default/clarification/partial_failure/three_service.
- Live harness và runner đọc bảng live-services; giữ nguyên tên env và thông báo skip.
- Grounding giữ trường key. Đóng baseline định tuyến bằng snapshot 72 câu, hai catalog; guard keyword và static guard có ngoại lệ file/pattern/lý do.
- Demo extension chứng minh HTTP + PostgreSQL + scoped adapter + router + planner + prefetch mà không sửa core.

## Bằng chứng

- Baseline: npm run check exit 0, 526 v3 +66 offline evaluations.
- RED: 8/14 core failures; 4/32 extension/guard failures; 2/2 extraction failures. Keyword negative fixtures bắt mọi từ cấm và nguồn trùng; registry metadata thiếu scopeLabel là RED.
- GREEN: 48/48 bài test mới.
- npm run check exit 0: 569 v3 (39 schema, 58 adapters, 129 planner, 25 executor, 157 API, 161 web), 71 offline evaluations; typecheck, build, secret scan, 1 launcher và 3 local-env pass.
- npm run test:browser:v3 exit 0: 9/9, HTTP/SSE và PostgreSQL thật, adapters/planner sandbox. FE-01 đã tăng từ 8 lên 9 ca.
- Credentials JSON cũ boards/channels/repos được insert trực tiếp SQL, decrypt đúng, factory tạo được ba adapter; ciphertext đọc lại giữ nguyên.
- Test cũ chỉ đổi hai argument scopeKey trong crypto-ratelimit.test.ts theo chữ ký mới.
- Review độc lập e33177c: NEEDS_WORK vì một guard định tuyến dùng snapshot có thể sửa làm baseline; không có lỗi production khác. Fix 08431be85aae5cb1fefcc74b1c76a5a3d56c778e: RED 1/2 → GREEN 2/2, legacy nonempty kiểm độc lập snapshot; full check 569 +71 exit 0. Reviewer tự chạy full check trước fix 569 +70 và browser9/9, exit0. Không có re-review; fix được xác minh bằng TDD + full suite.
- Log chi tiết lưu ngoài repo trong Codex W3-00 evidence directory; không commit raw logs.

## Trước/sau khi thêm service

Đếm file sản phẩm hiện có phải sửa, không tính file mới và test; phần UI W3-00b được tách riêng.

| Phạm vi | Trước | Sau |
|---|---|---|
| Schema/types/registry/catalog | types.ts, services.ts, index.ts (3) | registry/index.ts, index.ts (2), thêm file định nghĩa riêng |
| Adapter chung/export | base-adapter.ts, index.ts (2) | index.ts (1), thêm adapter riêng |
| API registration/transport | registered-services.ts (1) | registered-services.ts (1), thêm transport riêng |
| Sandbox và browser scenario | server.ts (1) | sandbox/index.ts, sandbox/scenarios.ts (2), thêm fake-results và plan riêng |
| Live evaluation | harness.ts, run.ts (2) | live-services.ts (1) |
| **Tổng** | **9** | **7 file: 6 nối đăng ký và 1 thêm kịch bản sandbox/browser; không thêm nhánh theo service trong lõi** |

## Giới hạn và việc tiếp theo

- Chưa gọi LLM/provider hay dịch vụ thật; không dùng credentials thật hoặc thực hiện ghi ngoài hệ thống.
- Không thêm service thật, không đổi prompt/routing policy, không sửa v2 hoặc frontend.
- Bất biến keyword đúng từ baseline: giữ nguyên dữ liệu và dùng 27 fixture sai kiểm guard.
- Dùng task card trực tiếp làm brief/ledger vì card không có task số cho script kế hoạch; không thay đổi phạm vi.
- Sau khi CI và review đạt, người dùng merge W3-00; reviewer cập nhật CURRENT-STATE/ROADMAP. W3-01 → W3-05 chỉ bắt đầu từ main đã có W3-00.
- Trước W3-02 cần quyết định cho rf06: đăng ký Calendar chưa cấu hình làm câu này trở thành [], trong khi item8 cấm mọi 50/18 câu từ có service thành []. Giữ nguyên guard/policy W3-00; không tự thay nhãn hoặc ngoại lệ. Chi phí nếu chưa chốt: W3-02 bị gate chặn.
- W3-00b dùng scopeLabel API và xử lý các ngoại lệ frontend; không chặn các task service.
- Worktree FE-01 đã archive sau khi xác minh PR #27 merged, checkout sạch. Primary main và thay đổi ngoài task được giữ nguyên.
