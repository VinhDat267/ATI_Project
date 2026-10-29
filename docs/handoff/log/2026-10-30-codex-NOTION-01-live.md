# 30/10/2026 · Codex · NOTION-01 nghiệm thu OAuth/setup thật

**Ủy quyền:** tiếp tục yêu cầu Slack OAuth và Notion OAuth. Chủ dự án đã cho phép HTTPS công khai tạm thời vào bản thử riêng, tự tạo apps, điền client credentials tại cache ignored, thực hiện consent và xác nhận đã lưu phạm vi. Reviewer do chủ dự án giao. Nhánh `codex/notion-oauth`, đầu phiên `4ada2f664107b8b4a76871de507e131ab94b472e`, PR nháp [#189](https://github.com/VinhDat267/ATI_Project/pull/189), base PR Slack [#184](https://github.com/VinhDat267/ATI_Project/pull/184). Không sửa CURRENT-STATE/ROADMAP hoặc mã sản phẩm.

## Kết quả quan sát

- Bản thử hoàn toàn riêng: gateway production assets, DB tmpfs riêng, tài khoản/JWT/encryption riêng; không đọc root environment, không dùng DB phát triển. Chỉ login/OAuth/setup; chat/plans/schedules/admin/signup bị chặn, model disabled. HTTPS public proof13/13PASS trước consent. URL tunnel, credentials, token, workspace/owner/database IDs và dữ liệu người dùng không đưa vào log/PR.
- Người dùng gặp trang Notion Developer tải mãi. Console do người dùng cung cấp báo `missingSpacePointerForNotionUserRequest` và đọc `spaceId` từ undefined. Hướng dẫn mở workspace trong cùng phiên rồi quay lại portal; chưa có bằng chứng để quy nguyên nhân chính xác cho tài khoản hoặc dịch vụ. Công cụ GUI bị dừng vì không xác minh được URL Edge; không vượt cơ chế này. Người dùng sau đó tự hoàn tất cấu hình và cấp quyền.
- Lượt đầu sau consent: API Notion check200, status `scope_required`,0 database đã lưu; search metadata trả200 và5 database, hasMorefalse. Đã hướng dẫn người dùng chọn rồi lưu phạm vi; không tự chọn thay người dùng.
- Sau người dùng xác nhận lưu: **API Notion check200, status `connected`,5 database đã chọn, identityVersion2, toolsAvailablefalse**. PostgreSQL riêng xác nhận statusactive,5 database, config mã hóa không rỗng, refresh_in_flightfalse. Search metadata qua token đã cấp trả200. Không đọc nội dung database/pages hoặc gọi model.
- Kiểm đồng thời Slack:1 kết nối active, check200 qua Slack auth.test,10 scopes, missingScopes rỗng, processingStatuspending, identityVersion1; config mã hóa được lưu. Không đọc tin nhắn hoặc gửi tin.
- Thời điểm bằng chứng cuối: `2026-10-29T18:58:10.977Z` (01:58:10 ngày30/10 Asia/Saigon) cho Notion và `2026-10-29T18:58:11.892Z` cho Slack.

## Kiểm chứng và giới hạn

- `node node_modules/.cache/oauth/verify-notion-live.mjs` và `verify-slack-live.mjs`: exit0, actual authenticated ATI API + official provider metadata + PostgreSQL readback; chỉ xuất status/count, không log token. Raw proof và helper ở cache ignored. Không dùng fixture để kết luận OAuth thật.
- GitHub API xác nhận CIv3SUCCESS đúng Notion `4ada2f664107b8b4a76871de507e131ab94b472e` và Slack `ac448dd39fd8b9188c4ebc967cb735454bbc803d`. Commit checkpoint này chỉ đổi tài liệu; CI của head mới theo dõi riêng. Không chạy lại full suite vì không đổi mã; bằng chứng fullcheck/browser cây mã tích hợp đã ghi trong log29/10.
- Đã đạt đường thành công live của OAuth/setup và lưu phạm vi Notion. **Không đóng toàn bộ SLACK-02 hoặc full integration:** provider thật nhiều workspace/refresh/rotation/revoke/permission-loss còn chưa nghiệm thu; ca tương ứng hiện có test DB/HTTP fixture. Slack processing consent/provider evidence và content tools chưa mở; Notion personal workflow ở NOTION-02 còn backlog. Review độc lập, merge và rollout chưa thực hiện.
- HTTPS tunnel công khai chỉ dùng trong đợt nghiệm thu được cho phép; dừng khi kết thúc bước thử. DB/config thử được giữ riêng để có thể phục vụ reviewer sau này; mở lại tunnel sẽ cần callback mới. Không gọi revoke hoặc xóa kết nối thay người dùng.
