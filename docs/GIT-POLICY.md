# File nào được đưa vào Git

Áp dụng cho ATI_Project và mọi agent làm việc trong repo. Commit là một checkpoint đã được review; push là thao tác riêng theo yêu cầu người dùng. Repo private vẫn cần kiểm tra nội dung trước khi đưa lên mạng.

| Nhóm | Quy tắc |
|---|---|
| Source trong apps/, packages/; tests và scripts | Commit phần thuộc task, cùng test liên quan. Không đưa dist/, node_modules/ hoặc generated/ vào Git. |
| package.json, package-lock.json, tsconfig, Vitest và cấu hình Docker | Commit để tái tạo môi trường. Kiểm cấu hình chỉ chứa thông tin demo hoặc placeholder, không chứa credential thật. |
| db/migrations/*.sql | Commit migration mới. Giữ nguyên migration cũ và .gitattributes để bảo toàn checksum. Không bỏ qua mọi file SQL vì migration là source chuẩn. |
| README, CONTRIBUTING, docs/spec/plan/status và tài liệu thiết kế | Commit khi thay đổi phục vụ task. Giữ nhãn VERIFIED/PROPOSED/NOT_RUN đúng bằng chứng. |
| testdata/ và fixture do project viết | Commit dữ liệu tổng hợp; không thay holdout để làm test xanh. Không đưa dữ liệu cá nhân hoặc bản sao database thật vào fixture. |
| .env.example, .gitignore, .gitattributes | Commit. .env.example chỉ chứa giá trị demo/placeholder hoặc để trống secret. |
| docs/openapi.yaml | Là generated artifact được chủ động version: chỉ cập nhật bằng npm run api:generate khi source contract đổi. API types/schema dưới generated/ không commit. |
| Báo cáo và JSON evidence trong docs/*-evidence/ | Chọn đúng checkpoint cần nghiệm thu. Kiểm nội dung, loại credential/dữ liệu ngoài scope; không thêm mọi capture tạm hoặc ghi đè evidence lịch sử. Không sửa log để biến thất bại thành thành công. |
| Log nghiệm thu mới | Mặc định ignore. Sau khi review nội dung và chọn đúng file, dùng git add -f với đường dẫn file cụ thể. Không force-add cả thư mục. |
| Archive lịch sử | Giữ docs/archive/pre-fix-2026-09-13.zip đang được theo dõi: đây là bằng chứng trước sửa. ZIP/backup mới mặc định ignore; không tạo ZIP mỗi task thay cho Git. |
| .env thật, private key, credential; DB local/dump; cache/build; cấu hình IDE cá nhân | Không commit. .gitignore loại các dạng thông dụng; credential nằm trong source/JSON/log vẫn cần review thủ công. |

## Quy trình trước mỗi commit

1. Kiểm git status và diff từ đầu task. Giữ thay đổi của người khác, không tự revert/reset.
2. Stage từng đường dẫn thuộc task bằng git add -- <file1> <file2>. Không dùng git add . hoặc git add -A trong workflow thông thường.
3. Xem git diff --cached --name-status, git diff --cached --stat và git diff --cached. Đối chiếu danh sách với task report; không chỉ kiểm tên file.
4. Kiểm secret/dữ liệu thật, output không cần thiết và các file lớn/binary. Chỉ bổ sung log đã review bằng git add -f -- <exact-file.log>.
5. Chạy kiểm tra phù hợp với thay đổi; ghi lệnh, kết quả và NOT_RUN chính xác. Một commit chỉ gắn với một checkpoint rõ ràng.
6. Commit khi checkpoint đã được review. Không dùng git commit -a để vô tình đưa thay đổi ở file đã tracked vào commit. Kiểm git status sau commit. Không tự push/force-push hoặc viết lại lịch sử remote nếu chưa được giao.

## Giới hạn của ignore và trạng thái ban đầu

Tại commit 1cd5726, repo có 161 file, gồm 16 log nghiệm thu và một ZIP lịch sử. Các file này đã tracked nên vẫn có thể xuất hiện trong diff, dù quy tắc mới match *.log hoặc *.zip. Không tự untrack/xóa chúng vì spec và manifest hiện tham chiếu bằng chứng đó.

.gitignore không gỡ file đã tracked, không ngăn git add -f, và không quét secret trong nội dung. Quy định stage từng file và review staged diff là phần bắt buộc của workflow; chưa có hook tự động để cưỡng chế. Nếu phát hiện credential thật trong lịch sử Git, chỉ thêm ignore hoặc xóa ở commit sau chưa xử lý được nội dung cũ; báo rõ phát hiện trước khi thay đổi lịch sử hay credential.

Tham khảo: [gitignore chính thức](https://git-scm.com/docs/gitignore).
