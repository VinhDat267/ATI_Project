# Kết quả sửa audit v3 sau rà soát lại

**Ngày:** 29/09/2026

**Phạm vi:** code v3 trong worktree `v3-audit-remediation`; không sửa mã nguồn v2.
**Đánh giá:** Các lỗi tái hiện trong test cục bộ đã được sửa. **Chưa chứng nhận production readiness.**

## Những thay đổi đã kiểm chứng

- Xác thực: loại đường đăng nhập mặc định và hash giả, dùng PBKDF2 có salt, cấp user qua lệnh `npm run admin:provision -w @wap/chat-api`; các route plan/execution/SSE kiểm tra chủ sở hữu.
- Kế hoạch: approve ràng buộc hash, thời hạn và chủ sở hữu trong SQL; tạo plan tuần tự theo conversation và unique index ngăn hai plan pending; retry chỉ với bước failed có kết quả xác định.
- Thực thi: chờ ghi trạng thái bước trước write kế tiếp; abort được chuyển tới adapter; lỗi persistence khiến plan failed; stop trong lúc write cuối không báo completed. Write bị hủy với kết quả chưa rõ được giữ ở trạng thái `reconciliation_required`; sau restart status đọc kế hoạch bền vững thay vì trả 404.
- Runtime: live fail-closed nếu thiếu cấu hình/DB/provider, sandbox không gọi provider thật; credentials mã hóa, lưu nguyên tử và giới hạn admin; kiểm tra dịch vụ bằng request đọc thật.
- Adapter/planner: giới hạn Trello board cho reads/writes, member search yêu cầu board; limiter và 429 retry có giới hạn; Gather/Clarify lưu working memory; validator kiểm schema/args.
- UI/SSE: không tự đăng nhập admin, settings phản ánh response thật và hiển thị allowlist lưu trữ; event cursor theo conversation và epoch, từ chối token trong URL.

## Lệnh và kết quả chạy thực tế

| Kiểm tra | Kết quả |
|---|---|
| `DATABASE_URL=... npm run db:migrate:v3` trên PostgreSQL 16 `ati_v3` | Exit 0, áp dụng 0001 và 0002; chạy lại exit 0 |
| `npm run test:v3` | Exit 0, **198/198** tests: schemas 5, adapters 39, planner 30, executor 17, API 78, web 29 |
| PostgreSQL tests trong API | 13 tests qua trên container `ati_v3`, gồm cạnh tranh plan/credentials, unique pending, hash/password và lịch sử >100 message |
| `npm run typecheck:v3` | Exit 0 |
| `npm run build:v3` | Exit 0 |
| `node --import tsx docs/audits/2026-09-29-v3-review/acceptance-probes.mjs` | 16/16 selected legacy probes; không đại diện cho toàn bộ 14 finding |
| `npx vitest run evaluations/eval.test.ts` | 2/2 offline fixture tests, không đo chất lượng live |
| `git diff --check` | Exit 0 |

Các kiểm thử HTTP và provider trong test suite dùng fixture/mock hoặc read-only stub. Không gọi write thật tới Trello/Slack, không gọi LLM trả phí.

## Giới hạn còn mở

- Chưa có bằng chứng vận hành live với credentials thật, Gemini/Trello/Slack thật, quota và lỗi mạng thực tế.
- Khôi phục execution sau process crash vẫn chưa có; controller và trạng thái cuối vẫn có phần nằm trong bộ nhớ tiến trình. Bước write đang chạy khi mất kết nối có thể cần đối soát thủ công.
- SSE replay chỉ giữ 100 sự kiện trong bộ nhớ mỗi conversation. Epoch tránh nuốt sự kiện khi server restart, nhưng không thể phục hồi sự kiện đã mất khi process chết hoặc cursor vượt cửa sổ buffer.
- Chưa chạy đánh giá chất lượng LLM live trên 50 prompts và chưa xác nhận các ngưỡng accuracy/latency trong `PROJECT-REPORT.md`.
- Trước khi triển khai vào database khác, chạy `npm run db:migrate:v3` với `DATABASE_URL` của môi trường đó. Migration unique sẽ dừng nếu dữ liệu cũ có bản ghi trùng; không tự xóa credentials hay plans.

Do đó kết luận phù hợp là **đã khắc phục và kiểm chứng cục bộ các lỗi tái hiện**, còn **production readiness: NOT VERIFIED**.
