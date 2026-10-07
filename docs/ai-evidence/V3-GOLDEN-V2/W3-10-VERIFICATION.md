# W3-10 — kiểm chứng offline, đo model chưa chạy

Ngày 07/10/2026. Base `8155c03d5e93f7491c5d6136f121bf03dd3c4e3f`, worktree
`C:/Users/VinhDat/orca/workspaces/ATI_Project/w3-10-read-only-latency`, nhánh
`fix/w3-10-read-only-latency`. Chỉ A/B và mục 7 được thi công; task chưa nghiệm thu.

## Thứ tự commit và lời gọi

```text
7bec3d0 fix(planner): measure model attempts and clarify read-only workflows
795229e test(eval): preregister read-only labels per product policy of 2026-10-05
2c47eb9 test(planner): normalize read-only regression fixture text
```

Commit label đầy đủ: `795229e24c64a38902e7efdce0680c729f37348a`.
Lý do commit là chính sách sản phẩm chốt 05/10, trước mọi lời gọi model của task.
Không có commit chứa báo cáo model W3-10: số lời gọi model thật là **0**.
Audit đối chiếu JSON với base: đúng sáu case read_only bỏ `expect.searches`,
44/44 prompt không đổi; mọi trường còn lại giữ nguyên.

## TDD và gate

| Lệnh / ca | Output thật |
|---|---|
| RED phần A, runner | 2 failed / 5 passed, exit 1: chưa có `modelCalls` |
| RED tổng hợp thời gian / lỗi public | 2 failed / 7 passed, exit 1: thiếu summary và lỗi còn chép nội dung từ provider |
| RED phần B, read-only policy | 10 failed / 1 passed, exit 1: ba plan lịch sử còn hợp lệ và directory chạy trước clarification |
| RED assertion label trước sửa JSON | 1 failed / 29 passed, exit 1 |
| GREEN planner + evaluations offline | 376/376, 33 files, exit 0 |
| GREEN planner + runner + Telegram integration | 217/217, 21 files, exit 0 |
| GREEN regression chỉ đọc cuối cùng | 11/11, exit 0 |
| `npx tsc -p evaluations/golden-v2/tsconfig.json --noEmit` | exit 0 |
| `npm run check` trên source `2c47eb9` | exit 0: 47 + 340 + 207 + 25 + 349 + 450 = **1418 v3**, **169 eval**; typecheck/build/bundle-security/launcher/node checks đạt |
| `npm run test:browser:v3` trên cùng source | exit 0, **61/61 qua 11 scenario**: default44, auth02 2, auth04 5, clarification2, partial_failure2, sáu scenario liên dịch vụ mỗi scenario1 |
| `git diff --check` | exit 0 sau chuẩn hóa LF; commit `2c47eb9` sửa encoding/newline của fixture test, không đổi production |

Ca quá hạn dùng tín hiệu hủy thật: lần thử đầu chờ listener `abort`, tín hiệu
hủy theo deadline 30 ms, rồi lần thử thứ hai thành công. Báo cáo một lời gọi
`generatePlan` chứa hai attempt, một timeout, duration và token fixture. Có ca
429 → thành công và search round riêng. Test lỗi provider đưa nội dung nhạy cảm
giả vào error body và kiểm public evidence chỉ giữ HTTP status.

Ba plan của W3-06 lấy trực tiếp từ report lịch sử (sh07 lần 1/3, ca01 lần 1),
không chép lại hoặc sửa plan: validator từ chối không có bước ghi; planner trả
clarification không gọi sửa plan. Mixed read/write vẫn đạt; validator không cấm
từng bước đọc khi plan có ghi. Clarification ở mode llm không prefetch/search;
regex giữ thứ tự gather cũ, cũng có fallback cho plan không ghi.

Các lần gate trung gian chưa đạt được giữ ngoài repo: sáu test extension dựa
vào eager prefetch, sau đó assertion Telegram đọc sai lượt hội thoại. Fixture
model nay yêu cầu search trước rồi plan; SQL, HTTP, quyền phạm vi và negative
grounding vẫn kiểm thật. Không sửa production API hoặc frontend.

Môi trường: container riêng `ati-w3-10-pg`, postgres16, tmpfs
`/var/lib/postgresql/data`, bind `127.0.0.1:55533`; sandbox, tài khoản ứng dụng
test của CI. Check dùng mật khẩu DB test CI; browser guard local yêu cầu mật khẩu
DB test local nên chỉ mật khẩu role trong container tạm được điều chỉnh. Lần
browser đầu dừng ở guard trước khi có scenario; không sửa guard để bỏ qua.
Không truy cập DB dev15433. Logs ngoài repo tại `C:/Users/VinhDat/.codex/w3-10-*.txt`.

## Preflight 9router: dừng trước đo

GET `/v1/models` tại `http://localhost:20128/v1` sử dụng biến LLM đọc từ `.env`
gốc của người dùng bằng `node --env-file`. Không in biến, không sao chép `.env`.
Kết quả: exit 1, `ECONNREFUSED` trên cả `::1:20128` và `127.0.0.1:20128`.
Theo yêu cầu người dùng, dừng phần đo; không tự khởi động hay sửa 9router, không
chuyển model hoặc tài khoản, không gọi model `cx/`.

Core 50 × 3, freeform 18 × 3, services 44 × 3 và lượt services concurrency1:
**NOT_RUN**. Chưa xác minh 18/18 câu chỉ đọc có đúng một call/không search,
strict parity 150/150 và 51/54, hoặc p95 services <15 s. Không có campaign dở
dang vì preflight thất bại trước khi lập campaign. Không suy đoán nguyên nhân
đuôi chậm và không đổi deadline/retry khi chưa có số liệu thực tế của phần A.

README có bảng trước/sau theo nhóm và phân rã thời gian, mọi ô sau đo ghi
NOT_RUN. Mẫu số tool/argument đổi do sáu case bỏ search labels được ghi rõ.
Request hedging/thinking variants từng không có lợi được giữ là bằng chứng
lịch sử, không được mô tả như phép thử mới.
