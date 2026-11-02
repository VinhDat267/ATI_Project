# 31/10/2026 · JIRA-00 · Duyệt thiết kế và chuyển sang JIRA-01

Chủ dự án trả lời “Được thực hiện giúp tôi đi” sau bản thiết kế ca142d4. Cập nhật trạng thái thiết kế và card JIRA-00, thêm kế hoạch thi công có TDD cho subsystem JIRA-01 và card riêng. Không sửa CURRENT-STATE/ROADMAP.

JIRA-01 là cổng provider đã được duyệt: chưa có bằng chứng identity-only/no-site hay hai site thật thì chưa chuyển sang runtime JIRA-02–11. Chủ dự án xác nhận chưa có app OAuth Atlassian, đang được hướng dẫn tạo app; không yêu cầu gửi secret qua chat. Kiểm tên key cấu hình, không in giá trị; chưa thấy Jira OAuth client config. `gh auth status` báo chưa đăng nhập.

Thực thi trực tiếp tuần tự trong session; independent code review cuối phần có thể kiểm được. Không spawn implementer để né ranh giới module. Kết quả thi công và bằng chứng JIRA-01 sẽ có log riêng; log này chỉ ghi phê duyệt/kế hoạch.
