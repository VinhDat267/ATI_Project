# Tách project Google cho kết nối cá nhân

Áp dụng cho Gmail, Calendar/Meet và Sheets/Docs/Drive/Picker trong `RUNTIME_MODE=live`. Quyết định: giữ khả năng thu hồi quyền độc lập theo đặc tả OAUTH-02 §1.2. Không cần migration SQL.

## Chuẩn bị Cloud

Ba project có thể thuộc ba tài khoản Google quản trị khác nhau. Người kết nối ATI có thể dùng cùng một Google Account ở cả ba project; với Audience **External / Testing**, thêm tài khoản thử đó vào Test users của từng project. Không đưa client secret lên PR hoặc chat.

| Project riêng | API cần bật | Scope yêu cầu | Redirect Web client hiện dùng ở local |
|---|---|---|---|
| Gmail | Gmail API | `https://www.googleapis.com/auth/gmail.modify` | `http://localhost:5174/connections/gmail/callback` |
| Calendar / Meet | Google Calendar API | `https://www.googleapis.com/auth/calendar.events` và `https://www.googleapis.com/auth/calendar.readonly` | `http://localhost:5174/connections/mycalendar/callback` |
| Sheets / Docs / Drive | Google Sheets API, Google Drive API, Google Docs API, Google Picker API | `https://www.googleapis.com/auth/drive.file` | `http://localhost:5174/connections/mysheets/callback` |

1. Tạo project, ghi **Project ID** và **Project number** từ Project settings. Nếu quota chặn tạo mới, dùng project trống được chỉ định hoặc xin quota; không xóa/tái sử dụng project ứng dụng khác để đi tiếp.
2. Tại Google Auth Platform, cấu hình Branding, Audience, Data Access; dùng tên riêng cho ba ứng dụng để phân biệt consent. Thêm test user khi ở Testing.
3. Tạo OAuth client loại **Web application**, đăng ký redirect chính xác theo môi trường ATI. Đăng ký origin web đang dùng khi tạo browser client. Google sign-in tiếp tục client/project thứ tư hiện có.
4. Download JSON khi tạo client, giữ tại nơi lưu secret riêng. Đọc lại `project_id`, `client_id`, redirect và project đang chọn trong Console; tên hiển thị khác nhau không chứng minh project khác nhau.
5. Riêng Sheets, tạo Picker API key trong chính project đó; `MYSHEETS_PICKER_APP_ID` là **Project number**, không phải Project ID hay client ID. Hạn chế key cho Picker API và các HTTP referrer được Google Picker yêu cầu, gồm origin ATI và `https://docs.google.com/*`; xác minh lại bằng native Picker.

Các biến cần thay trong cấu hình ngoài git:

```text
GMAIL_OAUTH_PROJECT_ID
GMAIL_OAUTH_CLIENT_ID
GMAIL_OAUTH_CLIENT_SECRET
GMAIL_OAUTH_REDIRECT_URI
MYCALENDAR_OAUTH_PROJECT_ID
MYCALENDAR_OAUTH_CLIENT_ID
MYCALENDAR_OAUTH_CLIENT_SECRET
MYCALENDAR_OAUTH_REDIRECT_URI
MYSHEETS_OAUTH_PROJECT_ID
MYSHEETS_OAUTH_CLIENT_ID
MYSHEETS_OAUTH_CLIENT_SECRET
MYSHEETS_OAUTH_REDIRECT_URI
MYSHEETS_PICKER_API_KEY
MYSHEETS_PICKER_APP_ID
```

## Chuyển cấu hình và kết nối lại

1. Dừng các process ATI dùng cấu hình cũ trước khi đổi; không chạy lẫn phiên bản cũ/mới trên nhiều instance. Giữ bản cấu hình cũ trong kho secret được bảo vệ. Không bật scheduler để thử OAuth.
2. Thay đúng các biến của ba dịch vụ, giữ nguyên cấu hình khác. Kiểm tra thay đổi đồng thời trước khi ghi `.env`. Không xóa hoặc revoke client/grant cũ để thử.
3. Chạy validation trên bản vá. Live từ chối project khai báo trùng, client trùng/cùng phần số đầu, client không kiểm tra được, và Picker app ID không khớp phần số của client Sheets. Xét cả dịch vụ tắt nhưng còn client cấu hình và Google sign-in. Đây là kiểm tra từ chối bảo thủ; vẫn phải xác minh ownership trong Cloud.
4. Credential cũ thiếu `oauthClientId` hoặc thuộc client khác hiển thị `reconnect_required`; không refresh, không dùng cache và không đưa vào chọn tài nguyên. Bấm kết nối mới cho từng dịch vụ.
5. Calendar: chọn lại lịch được phép dùng. Sheets: dùng Picker chọn lại bảng tính/file hoặc tạo tài nguyên thử mới. Quyền `drive.file` của ứng dụng cũ không tự chuyển sang project mới. Các plan đã preview với credential cũ phải lập lại.
6. Ngắt một kết nối tại ATI: xóa row/state và vô hiệu hóa provider/cache tương ứng. Remote revoke chỉ được thử khi client gốc khớp và không có peer Google credential/flow có thể dùng chung grant. Legacy/unknown/mismatch giữ grant phía Google; thành công xóa local không đồng nghĩa Google đã revoke.

## Nghiệm thu

- Đọc lại ba cặp project/client và API enabled trong Cloud; Picker key/app ID cùng project Sheets. Lưu artifact riêng đã loại credential.
- Consent mới thành công cho cả ba dịch vụ qua app production, đúng session/browser binding; DB ghi encrypted origin tương ứng. Không dùng authorize URL HTTP 200 thay bằng chứng exchange thành công.
- Trên tài nguyên thử, đọc Gmail, Calendar, Sheets/Docs/Drive và chọn file bằng Picker. Ngắt một dịch vụ rồi kiểm tra các dịch vụ còn lại vẫn dùng được; chỉ thử trên grant/tài nguyên được chỉ định.
- Ghi head, CI, account/workspace thử, provider readback và trạng thái từng ca. Thiếu bước nào thì ghi `NOT_RUN`, giữ FLOW-07 mở.

Giới hạn: bản vá bảo vệ các peer credential/flow Google của cùng một ATI user. Việc nhiều ATI user kết nối cùng một Google Account ở cùng một dịch vụ vẫn chịu phạm vi grant của Google; chưa chứng nhận độc lập giữa các ATI user này. Không suy ra native acceptance từ fixture HTTP hoặc CI.

## Nguồn hợp đồng

- [Google OAuth token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke): phạm vi thu hồi theo project.
- [Google Auth audience](https://support.google.com/cloud/answer/15549945?hl=en): External và Test users.
- [Google Picker configuration](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample): client/app ID cùng project và cấu hình key/referrer.
- [Google OIDC identity](https://developers.google.com/identity/openid-connect/reference): email có thể thay đổi, không dùng để chứng minh hai grant khác tài khoản.

Ngày 06/11/2026: Console tài khoản hiện hành chặn tạo project mới do free trial project limit. Chưa tạo client/project mới, chưa thay cấu hình live, chưa chạy consent mới; native migration còn mở.
