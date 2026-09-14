# TH-04 — nghiệm thu create_card

**PASS trong phạm vi TH-04.** Antigravity triển khai bằng Gemini 3.8 Flash High trong conversation đã audit repo. Codex đọc diff so với trạng thái TH-03 đã nghiệm thu, gửi các điểm cần sửa trong tests và chạy probe độc lập sau full suite.

## Hành vi đã xác minh

- `create_card` dùng receiver transaction và approval/operation/receipt gate hiện có. Board/list/member được kiểm theo owner và board, giữ `FOR KEY SHARE`; kiểm expiry bằng DB clock sau khi chờ khóa. Card ID do PostgreSQL tạo.
- Mutation, kiểm output và ghi receipt nằm trong cùng transaction. Ghi receipt thất bại rollback card. Receipt replay được kiểm schema; dữ liệu receipt hỏng trả `INTERNAL_ERROR`, input không hợp lệ vẫn trả `BAD_ARGS`.
- Cùng operation/payload gửi đồng thời hoặc gửi lại sau MCP restart chỉ tạo một card và một receipt; operation khác là intent khác. Thay payload hoặc workflow version làm approval không hợp lệ.
- Optional fields không được tự thêm vào input trước fingerprint; chỉ storage nhận description rỗng và due_date/assignee NULL. `due_date` dùng calendarDate năm 0001–9999 giống since/until; năm 0000 và ngày không tồn tại bị từ chối trước SQL.
- Bảy tool live khớp built definitions và reviewed catalog. Ba schema tool cũ giữ nguyên. `move_card` chưa bật; engine chỉ thêm policy `create_card:write`.

## Kiểm chứng

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| RED trước implementation | 12 failed, 2 passed, 27 skipped | [red-01.log](../TH-04/red-01.log) |
| Targeted lần đầu | 12 passed, 2 failed do fixture users thiếu password_hash | [targeted-01.log](../TH-04/targeted-01.log) |
| Targeted sau bổ sung review | 15 passed, 0 failed, 27 test ngoài bộ lọc skipped | [targeted-02.log](../TH-04/targeted-02.log) |
| Full check:engine do Antigravity chạy | 113 passed, 0 failed, 0 skipped: 39 DSL + 49 DB/MCP + 25 engine; typecheck/build/generation thành công | [check-01.log](../TH-04/check-01.log) |
| Probe do Codex trực tiếp chạy | 10 nhóm kiểm chứng PASS, exit 0; có dữ liệu card và counts thực tế | [probe result](probe-1789296500990.json), [command](command-01.json), [script](probe.mjs) |
| Bảo toàn | 91/91 hash khớp trước/sau probe, gồm evidence lịch sử, 4 migrations và lockfile | [baseline](before.json) |

Full log được Codex đọc và đối chiếu với diff; không dùng lời báo PASS của agent thay cho probe. Probe chạy sau khi full suite đã kết thúc, trong DB riêng `g1_it_f45d5c54d0394114a343bb430aee3d35` đã dọn sạch. Không migrate/seed/reset demo DB.

Probe độc lập dùng **synthetic receiver approval fixture**, không phải controller create workflow. Nó kiểm 9 giá trị due_date tại schema (4 hợp lệ, 5 không hợp lệ), từ chối cả 5 input không hợp lệ qua MCP mà không tăng card/receipt; kiểm trực tiếp DB round-trip hai biên 0001/9999. Hai call đồng thời và replay sau restart trả cùng ID với tổng 3 card gồm 2 seed + 1 mới, cùng 1 receipt. Intent thứ hai sinh ID khác. Trigger lỗi receipt và receipt.result={} đều được kiểm với oracle số card/receipt không đổi; receipt hỏng được phục hồi trong finally.

## Các điểm đã chỉnh trong review

- Tách fixture sai owner/cùng board và cùng owner/sai board; thêm workflow version drift thật.
- Replay/concurrency kiểm tổng số card và receipt, tránh chỉ đếm theo PK được trả về.
- Lock test quan sát blocking trong database suite qua pg_blocking_pids và đợi DB clock vượt expires_at trước nhả khóa, có cleanup finally.
- Test receipt failure ban đầu có thể pass khi tool còn disabled vì chỉ assert isError; đã bổ sung oracle `INTERNAL_ERROR`. Hai pass trong RED không được coi là bằng chứng đầy đủ cho các nhánh tương ứng.
- Kiểm receipt replay bị hỏng, phục hồi rồi xác nhận replay thành công.

Không tìm thấy finding cần sửa thêm trong code TH-04 đã đọc/chạy. Không claim G1 tổng thể hoàn tất: `move_card` thuộc TH-05, create/move qua controller thật và fault workflow thuộc TH-06. HTTP/UI/LLM ngoài phạm vi. Không stage/commit/push trong lượt này.
