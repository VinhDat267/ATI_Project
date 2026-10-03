# 2026-10-03 · Codex · Review độc lập W3-08

**Kết luận: CHƯA ĐẠT — 2 lỗi P2 đã tái hiện, chưa sửa sản phẩm.**

## Phạm vi

- Review PR #39 (đã merge `c5ce8a0`), code commit `fbab62b`; đối chiếu task card W3-08 và REVIEW-CHECKLIST.
- Chạy trên checkout riêng của `main` `b13ca2e`, đã chứa AUTH-01/FE-02. `git diff --exit-code fbab62b HEAD -- packages/planner packages/tool-adapters packages/tool-schemas evaluations/golden-v2/fixtures-services.test.ts` exit 0: mã W3-08 được kiểm tra còn nguyên.
- Đọc đủ diff 15 file, đường gọi AIPlanner → search → adapter, formatter, token exchange và các test mới. CI lịch sử #39 `37123947952` SUCCESS tại `4e8bd99`; đó là dữ liệu bổ sung, không thay bằng chứng chạy lại dưới đây.

## P2 · Ngân sách search không bao gồm được args dài

- Vị trí: `packages/planner/src/search.ts:148–157` (nhánh preview ở 160–167 cũng giữ nguyên args).
- `boundedOutcome` cắt result nhưng giữ nguyên `tool`/`args`, rồi trả cả khi envelope tối thiểu đã vượt 20.000 ký tự. `slack.search_channels` chấp nhận query dài vì schema không đặt maxLength.
- Probe chạy đúng AIPlanner ở searchMode=llm, provider theo kịch bản, SlackAdapter thật gọi HTTP loopback: query gồm 30.000 ký tự `x`, response Slack nhỏ, không có kênh khớp. Sau hai lượt provider và một HTTP read, JSON search result gửi lại model dài **30.290**, dù result là `[]`. Probe kỳ vọng ≤20.000, exit 1. Query 20 ký tự đối chứng chỉ tạo 143 ký tự JSON, đạt.
- Ảnh hưởng: lớp bảo vệ chung không giữ được trần đã công bố; một search có args lớn vẫn làm tăng context ở lượt tiếp theo dù đã bỏ toàn bộ kết quả.
- Hướng sửa: ràng buộc toàn bộ biểu diễn đưa vào prompt, gồm args/tool/metadata và nhánh error, hoặc từ chối args quá lớn trước lookup; kiểm tra lại kích thước sau fallback. Không thay đổi ngầm args thực thi. Thêm regression qua AIPlanner cho args dài và trường hợp envelope không còn ngân sách dành cho result.

## P2 · Hủy khi đọc body token Google bị coi là lỗi máy chủ

- Vị trí: `packages/tool-adapters/src/google/service-account.ts:56`.
- Catch của `response.json()` biến mọi lỗi thành SERVER_ERROR. Nếu response 200 đã về nhưng body chưa đọc xong, native fetch ném AbortError khi AbortController bị hủy; lệnh kiểm signal ở dòng 59 không được chạy.
- Probe dùng HTTP loopback thật trả header 200 và một phần JSON, rồi hủy signal sau khi bắt đầu đọc body. Kết quả: **signal.aborted=true, native AbortError, category=SERVER_ERROR**, một request; kỳ vọng NETWORK theo task card, exit 1. Probe ngắt socket giữa body cũng thành SERVER_ERROR (native TypeError). Đối chứng JSON sai cú pháp thật trả SERVER_ERROR đúng yêu cầu.
- Ảnh hưởng: luồng hủy/timeout trong lúc đọc token báo sai loại lỗi; test hiện tại chỉ hủy trước dispatch nên không bắt trường hợp này.
- Hướng sửa: phân biệt signal bị hủy/lỗi transport khi đọc body với JSON sai cú pháp hoặc nội dung token không hợp lệ; giữ thông báo đã làm sạch, không lưu body/key/assertion trong error. Thêm test AbortSignal với body đang stream.

## Bằng chứng chạy lại

- `npm ci`, migration và `npm run check` exit 0; **948/948 v3** = 47 schema + 317 adapters + 172 planner + 25 executor + 203 API + 184 web; **165/165 evaluation**; typecheck/build/credential scan/launcher/environment guards đạt.
- `npm run test:browser:v3` canonical, môi trường sandbox với PostgreSQL 16 tmpfs riêng ở 127.0.0.1:55533: **20/20**, đủ 9 scenario, exit 0. Không dùng DB người dùng ở 15433.
- Mutation trên worktree riêng, khôi phục nguyên bytes trong finally: bỏ budget planner → 3 assertion fail; bỏ giới hạn cột Sheets → 300 thay vì 26, fail; coi mọi Calendar403 là rate limit → hai ca forbidden/insufficientPermissions timeout 5 giây vì chờ retry, fail. **3/3 mutation bị bắt**, không gọi timeout này là lỗi của bản gốc. Sau khôi phục, 49/49 test trong ba file bounded-results/search-bounds/fixtures-services đạt, exit 0; diff sản phẩm rỗng.
- Các probe lỗi ở trên nằm ngoài suite hiện tại: 3/5 ca của probe token/formatter không đạt; probe AIPlanner không đạt. Không gộp các probe này vào số test xanh của repo.
- Bằng chứng và script tái hiện lưu ngoài repository trong thư mục `w3-08-review` của phiên Codex; không đưa token/key/trace riêng tư lên GitHub.

## Giới hạn

Không gọi Google/Slack/Notion hoặc model thật, không chứng nhận W3-07 hay parity/latency W3-06. Không tái dựng toàn bộ RED lịch sử hoặc chạy lại cả 10 mutation cũ; ba mutation nêu trên được chứng kiến mới. Phiên này chỉ review và cập nhật bàn giao; task card và log thi công cũ giữ nguyên lịch sử. Cần sửa hai finding rồi review lại phần sửa trước khi đóng W3-08.
