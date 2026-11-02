# 31/10/2026 · JIRA-01 · Bộ kiểm chứng OAuth local

**Task:** [JIRA-01](../tasks/JIRA-01-oauth-feasibility.md). **Kế hoạch:** [OAuth feasibility](../../superpowers/plans/2026-10-31-jira-oauth-feasibility.md).
**Nhánh:** `codex/jira-01-oauth-feasibility`. **Base:** `c713eaf18ba74fdc73d72ecfc91fa55110bf76a8` (thiết kế đã được chủ dự án duyệt).
**Commits mã:** `7b4e2d4`, `7a58219`, `6a91183`; sửa review `b49334a`.

## Đã triển khai

- Diagnostic tooling riêng trong `packages/tool-adapters/scripts/jira-probe/`: HTTP client, memory session, browser loopback server, CLI, env template và hướng dẫn app.
- Client cố định endpoint live, fixture chỉ loopback, JSON token grant, `/me`, accessible-resources, global ADMINISTER read, response limit, chặn redirect, HTTP deadline thật và safe errors.
- State dùng một lần/gắn browser, generation bảo vệ callback/refresh về muộn, identity match, token rotation và disconnect. Đây là memory probe, không phải PostgreSQL production token store.
- Server chỉ 127.0.0.1, cookie HttpOnly/SameSite, Host/Origin checks, code-free redirect, report không chứa token/code/identity/site/raw error. Không có route tạo issue/comment.
- Package test command chạy cả Vitest cũ và Node probe, không phải suite mới chỉ chạy tay ngoài CI.
- [Facts](../../ai-evidence/JIRA-01-PROVIDER-FACTS.md) tách DOCUMENTED/FIXTURE_VERIFIED/LIVE_OBSERVED/OPERATOR_ATTESTED/NOT_RUN.

## Bằng chứng kiểm thực

| Lượt | Kết quả |
|---|---|
| Client foundation RED | missing module trước implementation; không gọi là behavioral RED cho từng guard |
| HTTP client GREEN | 8/8, exit 0; sandbox fetch bị chặn, phải chạy loopback ngoài sandbox; lỗi môi trường không tính RED |
| Session RED/GREEN | 8 ca cũ green, các ca session fail khi module chưa có; 18/18 sau implementation |
| Provenance regression | Trước freeze client: Missing expected exception; sau sửa 19/19 |
| Runner RED/GREEN | 19 pass/6 fail trước runner; sau runner có 1 fail do scope text bị phản chiếu; filter scope đã biết →25/25 |
| Package trước review | 18 file/443 Vitest +25 Node, exit 0 |
| Review independent | Tại6a91183: 0 Critical,2 P2,1 P3; reviewer chạy lại443+25 và các reproduction HTTP thật |
| Parent review RED/GREEN | 23/28 sau thêm assertion bắt lỗi; sửa→28/28; thêm hai in-flight races và provider-error/listener-close characterization→31/31 |
| Package cuối sau sửa | `RUNTIME_MODE=sandbox npm test -w @wap/tool-adapters`:443 Vitest +31 Node PASS, exit0 |
| Mutations cuối |12/12 killed, từng lượt exit1 do assertion/protocol failure thật; source gốc giữ nguyên, chạy trên bản sao |
| CLI synthetic smoke | Start loopback4197, Ctrl+C, sau đó fetch xác nhận listener đóng; PTY host trả exit1 do interrupt; không gọi Atlassian |
| Config thực cuối | Thiếu JIRA_PROBE_CLIENT_ID/JIRA_PROBE_CLIENT_SECRET, exit2; chỉ in tên key, không giá trị |
| Static cuối | Bốn document/13 local links PASS; `node --check` bốn module, `git diff --check` đạt; `.env.jira-probe` được Git ignore |

Dependencies được cài bằng `npm ci --offline --ignore-scripts --no-audit --no-fund`:302 package, exit0; không thêm dependency. Hai deprecation warning từ lockfile được giữ nguyên, không đổi version để xử lý ngoài scope.

Artifacts ignored: `.superpowers/sdd/2026-10-31-jira-oauth-feasibility/` gồm ledger, briefs, red/green logs, package logs, review diff và mutation results/logs. Giữ lại để tiếp tục native gate, không xóa khi task chưa xong.

## Review và xử lý

- P2 observations lẫn tài khoản: reset khi bắt đầu consent hoặc disconnect; operator lưu report từng case trước khi chuyển lượt. Không trình bày lịch sử như quyền của kết nối hiện tại.
- P2 duplicate cloudId: deduplicate row giống nhau; URL/name/scope xung đột thì fail closed. Một cloudId không được thành bằng chứng hai site hoặc gọi permissions hai lần.
- P3 callback lỗi: duplicate params và browser mismatch đều chuyển sang URL không code/state; không trao đổi code ở nhánh bị từ chối.
- Reviewer còn kiểm hai race mid-profile/new account và old-refresh/new consent: source cũ đúng; đã giữ thành test để bảo vệ. Provider-error UI và server close cũng có test HTTP mới.
- Không review lại fix pass theo phương thức inline; bằng chứng sau sửa là regression và full package của parent. Verdict independent cũ vẫn là CHƯA ĐẠT tại head cũ; không tuyên bố review xanh cho head mới hoặc sẵn sàng merge.

## Rulings và giới hạn được giữ lại

1. Triển khai inline theo yêu cầu thực hiện đã có, không hỏi lại quyền triển khai. Giá phải trả nếu lựa chọn phương thức không đúng ý chủ dự án: có thể đổi phương thức ở gate tiếp theo, không đổi sản phẩm.
2. Dùng escalation cho metadata Git/MSYS/HTTP loopback do sandbox chặn, không sửa Git config. Chi phí: quyền chạy lệnh local rộng hơn sandbox cho đúng thao tác đã ghi; không gọi service live.
3. Sửa P3 ngay vì cleanup thuộc thiết kế đã duyệt và AGENTS yêu cầu sửa lỗi trước bước kế. Chi phí: nhánh callback bị từ chối dùng303 thay400/403; guard owner/state giữ nguyên.
4. Observations theo consent hiện tại. Chi phí: operator phải lưu từng safe report, probe không làm kho lịch sử bằng chứng.
5. Dedupe cloudId chính xác, xung đột fail closed. Chi phí: provider trả metadata không nhất quán thì phải điều tra, không đếm lạc quan.
6. Native consent/no-site/grant type/two-site/ADMINISTER vẫn NOT_RUN; SQL multi-process/crash recovery/encryption/revoke production ở JIRA-03/04. Chi phí: chưa được triển khai các consumer hoặc tuyên bố hoàn tất OAuth Jira.
7. `connected` chỉ là diagnostic grant đang dùng được, không khẳng định Create Issues/Add Comments. Chi phí: nghiệm thu ghi native vẫn phải làm riêng bằng plan được duyệt.
8. Giữ safe errors và identity-only không gọi resources. Chi phí: không có raw provider diagnostics, không suy luận membership từ report.
9. Không suy ra direct CLI live-error stderr hay Node graceful-exit0 từ process tests help/config hoặc PTY smoke; HTTP error/close đã kiểm. Chi phí: vận hành live của owner vẫn cần quan sát.
10. Hai race được reviewer kiểm đúng trở thành regression, không thêm behavior mới. Chi phí: thêm test maintenance nhỏ.
11. Không re-review trong fix pass; giữ verdict và bằng chứng hồi quy riêng. Chi phí: merge sau này vẫn cần đáp ứng review/CI đúng head theo repo.

## Chưa xong / bước tiếp

Chủ dự án đang được hướng dẫn tạo app OAuth ATI, điền `.env.jira-probe` local rồi chạy runner. Chưa có credential hay browser consent thật; không có provider/model/live write, migration hay runtime API/UI mới. Cổng identity-before-site và hai site native chưa hoàn tất. Xem runbook để thu từng case và quay lại chốt khả thi trước JIRA-02.

GitHub CLI chưa đăng nhập nên chưa push/tạo PR; không có CI hay merge. Không sửa CURRENT-STATE/ROADMAP, code các dịch vụ khác, shared checkout hoặc flags.
