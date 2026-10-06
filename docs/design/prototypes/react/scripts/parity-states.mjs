// Các trạng thái cần so cho từng trang, ngoài trạng thái lúc mở trang.
// Mỗi bước chạy y hệt trên bản HTML gốc và bản React, nên selector chỉ dùng id/văn bản có ở cả hai bản.
//   ['click', selector] · ['fill', selector, giá trị] · ['press', selector, phím] · ['wait', ms]
// `query` mở trang kèm chuỗi truy vấn (ví dụ '?type=server').
// Trạng thái thao tác chạy ở 1440 sáng và 375 tối; trạng thái mở trang chạy đủ 4 tổ hợp.
export const STATES = {
  'auth-action': [
    ...['verify-expired', 'verify-used', 'reset-password', 'reset-success', 'google-pending', 'google-ready', 'google-error',
      'blocked-pending', 'blocked-locked', 'blocked-attempts'].map(mode => ({ name: mode, steps: [['click', `#tab-${mode}`]] })),
    { name: 'google-ready-toast', steps: [['click', '#tab-google-ready'], ['wait', 1700]] },
    { name: 'menu-demo', steps: [['click', '#btn-toggle-demo-menu']] },
    { name: 'doi-tai-khoan', steps: [['click', '#btn-toggle-demo-menu'], ['click', '#demo-menu-dropdown >> text=Tuấn Đặng']] },
    { name: 'dang-gui-lai', steps: [['click', '#tab-verify-expired'], ['click', '#btn-submit-resend']] },
    { name: 'da-gui-lai', steps: [['click', '#tab-verify-expired'], ['click', '#btn-submit-resend'], ['wait', 900]] },
    { name: 'mat-khau-ngan', steps: [['click', '#tab-reset-password'], ['fill', '#new-password-input', 'abc']] },
    { name: 'mat-khau-manh-khop', steps: [['click', '#tab-reset-password'], ['fill', '#new-password-input', 'MatKhau!2026xyz'], ['fill', '#confirm-password-input', 'MatKhau!2026xyz']] },
    { name: 'mat-khau-lech', steps: [['click', '#tab-reset-password'], ['fill', '#new-password-input', 'matkhaudaikhongso'], ['fill', '#confirm-password-input', 'khac']] },
    { name: 'hien-mat-khau', steps: [['click', '#tab-reset-password'], ['fill', '#new-password-input', 'MatKhau2026xyz'], ['click', '[aria-label="Ẩn hiện mật khẩu"]']] },
    // Không so "lưu khi mật khẩu quá ngắn": minlength của ô nhập chặn form trước khi JS chạy, Chrome hiện bong bóng
    // kiểm tra của chính trình duyệt (ngoài nội dung trang, có hiệu ứng mờ dần nên ảnh chụp lệch vài pixel mỗi lần).
    { name: 'dang-luu', steps: [['click', '#tab-reset-password'], ['fill', '#new-password-input', 'MatKhau!2026xyz'], ['fill', '#confirm-password-input', 'MatKhau!2026xyz'], ['click', '#btn-submit-reset-password']] },
    { name: 'da-luu', steps: [['click', '#tab-reset-password'], ['fill', '#new-password-input', 'MatKhau!2026xyz'], ['fill', '#confirm-password-input', 'MatKhau!2026xyz'], ['click', '#btn-submit-reset-password'], ['wait', 900]] },
    { name: 'url-mode', query: '?mode=blocked-attempts', steps: [] },
    { name: 'url-state', query: '?state=google-pending', steps: [] },
  ],
  errors: [
    { name: 'mat-mang-chung', steps: [['click', '#btn-sub-offline-general']] },
    { name: 'dung-ke-hoach', steps: [['click', 'button:has-text("Dừng kế hoạch")']] },
    { name: 'het-phien', steps: [['click', '#tab-session']] },
    { name: 'hien-mat-khau', steps: [['click', '#tab-session'], ['fill', '#quick-password', 'matkhau123'], ['click', '[aria-label="Hiện hoặc ẩn mật khẩu"]']] },
    { name: 'dang-nhap-lai', steps: [['click', '#tab-session'], ['fill', '#quick-password', 'matkhau123'], ['click', '#btn-submit-relogin']] },
    { name: 'model-cham', steps: [['click', '#tab-timeout']] },
    { name: 'cho-them', steps: [['click', '#tab-timeout'], ['click', '#btn-continue-wait']] },
    { name: 'loi-may-chu', steps: [['click', '#tab-server']] },
    { name: 'thu-lai', steps: [['click', '#tab-server'], ['click', '#btn-retry-server']] },
    { name: 'trang-404', steps: [['click', '#tab-404']] },
    { name: 'menu-demo', steps: [['click', '#btn-toggle-demo-menu']] },
    { name: 'menu-chon-tinh-huong', steps: [['click', '#btn-toggle-demo-menu'], ['click', '#demo-menu-dropdown >> text=4. Lỗi máy chủ (500)']] },
    { name: 'mo-phong-mat-mang', steps: [['click', '#btn-toggle-demo-menu'], ['click', '#btn-demo-toggle-offline']] },
    { name: 'url-server', query: '?type=server', steps: [] },
  ],
  // responses: đổi tình huống thì bản mẫu focus tiêu đề sau 50ms; chờ 150ms trước khi bấm tiếp để kết quả focus không phụ thuộc thời điểm.
  responses: [
    { name: 'bien-the', steps: [['click', '#s1-toggle-variant-btn']] },
    { name: 'thanh-vien', steps: [['click', '#btn-toggle-demo-menu'], ['click', '#demo-role-member']] },
    { name: 'tinh-huong-2', steps: [['click', '#scenario-tab-2']] },
    { name: 'sua-yeu-cau', steps: [['click', '#scenario-tab-2'], ['wait', 150], ['click', '#scenario-content-2 >> text=Sửa yêu cầu']] },
    { name: 'tinh-huong-3-chon', steps: [['click', '#scenario-tab-3'], ['wait', 150], ['click', 'text=Gửi danh sách lên Slack #ati-test']] },
    { name: 'tinh-huong-4', steps: [['click', '#scenario-tab-4']] },
    // Menu demo vẫn mở sau khi chọn vai trò (như bản mẫu); bấm ra ngoài để đóng rồi mới chuyển tình huống.
    { name: 'tinh-huong-4-thanh-vien', steps: [['click', '#btn-toggle-demo-menu'], ['click', '#demo-role-member'], ['click', '#response-card-title'], ['click', '#scenario-tab-4']] },
    { name: 'gui-chat', steps: [['fill', '#chat-prompt-input', 'Tạo card mới cho lỗi đăng nhập'], ['press', '#chat-prompt-input', 'Enter']] },
  ],
};
