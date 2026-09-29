# Thẩm tra độc lập bản khắc phục 7368e2a — 29/09/2026

**Verdict: PARTIALLY REMEDIATED / NEEDS WORK. Không xác nhận VERIFIED PRODUCTION READINESS hoặc ALL GATES PASSED.**

HEAD: `7368e2afdf1aa47fbebcbce7581367ab5f92be69`. Working tree sạch trước kiểm tra. Chỉ thêm tài liệu này, không sửa application code hoặc các acceptance tests.

## Kết quả đã chạy lại

| Kiểm tra | Kết quả xác nhận |
|---|---|
| `npm run test:v3`, DATABASE_URL trỏ DB test `ati_v3`, localhost:55532 | Exit 0, **117/117 tests**, 30 files |
| PostgreSQL integration trong test:v3 | **6/6**, đã tính trong 117, không cộng thêm lần nữa |
| `node --import tsx docs/audits/2026-09-29-v3-review/acceptance-probes.mjs` | Exit 0, **16/16** |
| `npm run typecheck:v3` | Exit 0 |
| Timeout bổ sung qua concrete TrelloAdapter/SlackAdapter | Cả hai nhận abort thực tế, StepRunner trả UNKNOWN |

Các kết quả trên là thật. Tuy nhiên acceptance probes chỉ phủ một số trường hợp cụ thể, không phủ toàn bộ nội dung 14 findings hoặc G0–G5 trong REVIEW.md. Ví dụ probe services chỉ kiểm GET trả 200; probe persistence chỉ kiểm event cuối; probe SSE chỉ kiểm duplicate trong một conversation.

Các phản chứng bổ sung chạy offline bằng `node --import tsx --input-type=module`, dùng code application hiện tại và fixture cho transport ngoài. Riêng race tạo plan và hash approval dùng PostgreSQL `ati_v3` thật. Fixture DB do phản chứng bổ sung tạo được xóa đúng IDs sau kiểm tra; suite có sẵn vẫn giữ dữ liệu test theo cơ chế hiện tại của nó. Không gọi AI/provider hoặc SaaS thật.

## Ma trận đóng/mở findings

| Finding | Phần được xác nhận đã cải thiện | Phần chưa thể đóng |
|---|---|---|
| F01 | demo-token nhận 401; live/production thiếu secrets bị chặn | Default admin vẫn được seed và UI tự đăng nhập; live còn memory/mock fallback; phát hiện password-verification bypass mới |
| F02 | GET conversation khác owner nhận 403; nhiều route được thêm owner checks | POST reject và GET execution status thiếu owner check; đã tái hiện reject chéo user |
| F03 | Async factory được await; live branch nối AdapterFactory thật | Sandbox vẫn thử factory thật trước, nên có credentials thì có thể gọi dịch vụ thật; chưa đạt phân tách runtime như báo cáo |
| F04 | Forward signal và timeout thực tế qua cả hai concrete adapters đã đạt | Overall execution timeout/stop cancellation chưa hoàn chỉnh; không suy rộng thành đóng toàn gate executor |
| F05 | Parent scope lookup trên writes và lọc search cards đã được thêm | Lookup thiếu idBoard cho đi tiếp; search cho card thiếu idBoard qua whitelist. Cần xác định fail-closed và kiểm hợp đồng lỗi |
| F06 | Bốn input của acceptance probe bị reject; câu demo được route cả hai dịch vụ | Chưa validate type/additional properties/args sau resolve; few-shot vẫn dùng channelId thay cho channel |
| F07 | Không có remediation trong diff ở planner/chat-service | Chưa có gather tool execution, memory bị tạo mới mỗi lượt, assistant clarification chưa lưu; thiếu hoàn toàn trong bảng báo cáo người dùng cung cấp |
| F08 | Retry succeeded/running bị chặn; có cờ isRunning | Retry vẫn cho pending/skipped/unknown; chưa đúng tuyên bố chỉ failed/paused; mutex chỉ trong process, recovery chưa bền vững |
| F09 | Expiry trong atomic SQL; concurrent approve 1 win/4 reject; supersede tuần tự | Không verify hash; supersession không atomic, tái hiện hai pending với hai kết nối PostgreSQL |
| F10 | Event exec_done báo failed nếu update step lỗi ở lượt chạy đầu | Chờ DB ở cuối, vẫn thực thi write tiếp; status endpoint trái event/DB; retry/skip không đi qua durable finalization; chưa có transaction/recovery |
| F11 | Services routes tồn tại; bỏ phần mô phỏng execution success trong App | Test connection vẫn giả; ServiceCard timer fake success còn nguyên; save credentials sai contract, chưa encrypt; Settings chưa nối onSave |
| F12 | Dedup seq và text_end trong cùng conversation hoạt động | Set/cursor dùng toàn module, resetSSEState không có caller trong app; conversation tiếp theo bị mất event; reconnect/snapshot vẫn chưa đạt |
| F13 | Không thấy thay đổi tích hợp transport tương ứng | Limiter chưa được gọi, 429 không Retry-After/retry như báo cáo; đã tái hiện |
| F14 | Thêm 6 tests PostgreSQL thật, đây là tiến bộ có bằng chứng | Evaluation/E2E harness gốc không thay đổi; quality gate AI, browser E2E, 3 live scenarios, latency chưa được chứng minh |

## Các blocker và phản chứng quan trọng

### R1 — P1: Password verifier chấp nhận mật khẩu mặc định cho mọi hash bắt đầu `$2`

`apps/chat-api/src/db/repositories/user-repo.ts:16–23` trả `password === 'password123'` nếu storedHash bắt đầu `$2`, thay vì verify hash. Probe dùng bản ghi fixture có chuỗi `$2b$12$not-a-real-bcrypt-hash` và gọi login qua Express nhận **HTTP 200**. Điều kiện khai thác là có bản ghi password mang prefix này; không khẳng định đã có tài khoản như vậy trong DB hiện tại.

Hàm hashPassword tại dòng 12 dùng salt cố định `wap_v3_salt`; tên test “salt generation” không chứng minh salt ngẫu nhiên theo user. Server vẫn seed admin có mật khẩu hardcode ở `server.ts:59`; frontend tự gửi tài khoản đó tại `App.tsx:35–50` mà không phân biệt live/sandbox. Xóa demo-token là sửa đúng nhưng chưa làm auth production-ready.

### R2 — P1: User A vẫn hủy được plan của user B

`apps/chat-api/src/routes/execution-routes.ts:29–46` gọi rejectPlan sau khi chỉ kiểm identity và plan tồn tại. Không dùng ownership guard của ExecutionService. Probe JWT A, plan B, convRepo khai owner B: **reject HTTP 200**, repository nhận lệnh reject plan B.

GET execution status tại dòng 142 cũng không truyền hoặc kiểm user. Cần áp dụng cùng resource authorization cho mọi hành động mới, không chỉ GET conversation/approve/retry/skip/stop.

### R3 — P1: Live không fail-closed; sandbox có thể sử dụng adapter thật

`apps/chat-api/src/server.ts:65–156`: mọi lỗi kết nối DB đều vào fallback repositories memory, không kiểm RUNTIME_MODE. `server.ts:248–254`: lỗi planner ở mọi mode đều chuyển sang backup mock. `server.ts:289–290`: sandbox vẫn thử realAdapterFactory trước, chỉ fallback khi có lỗi. Đây là bằng chứng đọc control flow, không chạy server live hay gọi external services để chứng minh.

Cần đảm bảo live lỗi trả lỗi/dừng đúng chỗ, còn sandbox không tới real external write transport; mode có nhãn không đủ tạo ranh giới.

### R4 — P1: Credentials route chưa mã hóa và truyền nhầm allowedScope vào userId

`apps/chat-api/src/routes/services-routes.ts:97` gọi `saveCredentials(service, credentials, allowedScope)`; chữ ký repository ở `db/repositories/credential-repo.ts:14` là `(service, config: string, userId?: string)`.

Probe qua Express và **CredentialRepo thật với SQL transport recorder**: HTTP 200, tham số INSERT `config` là object credentials nguyên bản, không phải chuỗi AES-GCM `v1:...`. Đây là xác nhận đường truyền dữ liệu, không phải kiểm tra persisted credential thật. Nếu có allowedScope object, nó bị truyền vào cột UUID user_id; nếu không có thì object bị serialize thành JSON text và không thể decrypt theo contract hiện tại.

Service test ở `services-routes.ts:61–74` chỉ kiểm có record, không decrypt hoặc call provider, rồi trả `healthy`, latency cố định **45ms**. Probe record `invalid-ciphertext` vẫn nhận healthy. `ServiceCard.tsx:26–32` vẫn tự báo **“Kết nối tốt (Ping: 120ms)”** sau timer; SettingsModal vẫn không truyền onSave.

### R5 — P1: Approval nhận hash sai; supersession có race thật

`apps/chat-api/src/services/execution-service.ts:49–95` không verify hash. Dùng PlanRepo thật tạo plan với `plan_hash='intentionally-wrong-hash'`, service với mock external adapter vẫn trả **approval 200, toolCalls 1, completed**. DB thật, không có external write.

`db/repositories/plan-repo.ts:25–34` dùng UPDATE supersede rồi INSERT riêng, không lock conversation/constraint unique pending. Phản chứng dùng **hai PostgreSQL connections**, đồng bộ barrier sau khi cả hai UPDATE trên conversation chưa có plan; cả hai INSERT/COMMIT xong có **2 pending plans**. Đây không phải counter mock; SQL được thực thi trên DB thật. Fixture được dọn theo UUID do probe tạo.

### R6 — P1: Persist lỗi vẫn chạy tiếp write; các nguồn status mâu thuẫn

`apps/chat-api/src/services/execution-service.ts:146–198` tích lũy persistence promises, chỉ await sau khi controller chạy xong. Probe hai write steps, mọi updateStepStatus ném lỗi: **cả hai write đều được gọi**, exec_done báo failed nhưng `getExecutionStatus` báo **completed**. Không có transaction step+plan hay recovery state machine.

Việc đánh failed cuối cùng cải thiện báo lỗi nhưng chưa ngăn side effects tiếp tục khi không có durable evidence. Test PostgreSQL cuối chỉ gọi StepRepo và PlanRepo tuần tự; không test transaction của ExecutionService, DB outage giữa steps hoặc crash-after-write.

### R7 — P1: F07 bị bỏ sót, AI quality gate chưa đạt

Diff không sửa `packages/planner/src/planner.ts`, `apps/chat-api/src/services/chat-service.ts`, `evaluations/` hoặc hệ prompt. Planner vẫn generatePlan/validate/retry; ChatService dòng 91 tạo WorkingMemory mới mỗi turn. Evaluator dòng 150 dựng output bằng expected labels; chưa có bằng chứng AI thật, argument-quality rubric hay held-out evaluation.

Bảng báo cáo có **13 hàng F-ID**, thiếu F07. Gán nhãn G5 cho 6 DB integration tests cũng không thay thế G5 trong REVIEW.md (AI evaluation, browser/live scenarios, performance, evidence docs).

### R8 — P2: F13 chưa nối limiter/429 policy

`packages/tool-adapters/src/trello/base.ts` và `rate-limiter.ts` không đổi trong commit. Probe inject limiter đếm lời gọi, fake HTTP trả 429 + Retry-After 0: **limiterCalls 0, transportCalls 1, RATE_LIMIT error**. Slack request vẫn ném lỗi 429 trực tiếp. Unit test limiter độc lập không chứng minh adapter transport sử dụng nó.

### R9 — P2: SSE mất dữ liệu khi đổi conversation

`apps/chat-web/src/hooks/use-sse.ts:6–22` dùng Set toàn module; `resetSSEState` chỉ được định nghĩa, không được gọi khi đổi conversation hoặc store reset. Probe xử lý plan A seq=1, gọi store.reset như New Conversation, rồi xử lý plan B seq=1: **activePlan vẫn null** do seq bị coi là duplicate. Cần cursor/dedup theo conversation và kiểm reconnect/snapshot.

### R10 — P1: Schema checks vẫn chấp nhận sai type

Probe trello.create_card có `listId: 123`, `title: { malformed: true }`, kèm property extra vẫn trả **valid: true**. Bản sửa validator tại dòng 163 chỉ kiểm required-field presence, chưa kiểm JSON Schema. Không thể dùng bốn negative examples hiện tại làm bằng chứng validator đủ chặt.

## Đánh giá cuối và việc cần làm tiếp

Nên thay kết luận nghiệm thu bằng: **“117 tests và 16 acceptance probes passed; một phần findings đã khắc phục; còn blocker và chưa đạt toàn bộ gates.”** Giữ ghi nhận tích cực cho JWT bypass removal, owner checks đã thêm, async factory, signal forwarding/timeout, expiry SQL và 6 DB tests thật.

Ưu tiên sửa auth/password/default account và ownership routes; ranh giới live/sandbox; credential encryption/configuration; atomic plan/execution state. Sau đó hoàn thành F07, evaluation và browser/live acceptance. Không đóng F01–F14 chỉ vì acceptance script tự xuất `allPassed: true`.

**NOT_RUN:** browser visual/E2E, deploy, live Gemini/Trello/Slack, throughput/latency, restart recovery. **Không dùng điểm số production readiness hoặc tỷ lệ đóng finding để thay thế bằng chứng.**
