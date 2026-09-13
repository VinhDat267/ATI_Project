# Bằng chứng controller/engine

Đợt tiếp sau G1 receiver, kiểm trên Windows với DB test riêng và ba tool MCP stdio thật. Các ID trong observations thuộc database test đã được dọn; không phải run còn truy cập được trong DB demo.

| File | Nội dung |
|---|---|
| [npm-ci.log](npm-ci.log) | Cài từ package lock, exit 0 |
| [check-engine.log](check-engine.log) | Typecheck/build/schema/OpenAPI và 39 DSL + 15 DB/MCP + 24 engine tests |
| [controller-observations.json](controller-observations.json) | B02 preview/approval/trace/events/data; lost response; subprocess crash/recovery/receipt inspection |
| [mcp-observations.json](mcp-observations.json) | Discovery và receiver round trip trong suite G1 chạy lại ở profile engine |
| [runtime-check.log](runtime-check.log) | Live read-only kiểm services, migrations và MCP read trên demo |
| [runtime-snapshot.json](runtime-snapshot.json) | Node/PostgreSQL/vector/container identity, hashes, demo data snapshot |
| [artifact-verification.json](artifact-verification.json) | Static schema/reference/status/link checks và source hashes; không thay runtime checks |
| [verify-artifacts.mjs](verify-artifacts.mjs) | Script tái chạy kiểm static artifacts |
| [review.md](review.md) | Findings được tái hiện và xử lý |

Tái chạy từ root khi Docker G1 đang bật:

```powershell
npm run check:engine
$env:ATI_TEST_EVIDENCE_PROFILE = 'engine'
node scripts/g1-status.mjs
Remove-Item Env:ATI_TEST_EVIDENCE_PROFILE
node docs/engine-evidence/2026-09-13/verify-artifacts.mjs
```

`check:engine` tự đặt evidence profile engine cho các suite. Không chạy nhiều suite đồng thời vì chúng ghi chung observations. Runtime script chỉ đọc demo; integration suites tạo/dọn DB riêng. Kết quả này không chứng minh HTTP/UI/LLM/BullMQ hoặc đầy đủ catalog 8+2. Không sửa bằng chứng G1/fix cũ để gắn kết quả mới vào lịch sử.
