import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.CHAT_ADMIN_EMAIL!);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(process.env.CHAT_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hôm nay bạn muốn nhờ việc gì?');
}

test('MYSHEETS off: settings and health omit mysheets, start endpoint returns 404, no apis.google.com calls', async ({ page }) => {
  const googleRequests: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('apis.google.com')) googleRequests.push(req.url());
  });

  await page.goto('/');
  await expect(page.getByText('Google Sheets · Của riêng bạn')).toHaveCount(0);

  await login(page);
  await page.goto('/settings');
  await expect(page.locator('#service-row-mysheets')).toHaveCount(0);
  await expect(page.locator('#mysheets')).toHaveCount(0);

  // Check GET /api/health does not contain mysheetsEnabled
  const healthRes = await page.request.get('/api/health');
  expect(healthRes.ok()).toBe(true);
  const healthJson = await healthRes.json();
  expect(healthJson.mysheetsEnabled).toBeUndefined();

  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  // Check POST /api/connections/mysheets/start returns 404
  const startRes = await page.request.post('/api/connections/mysheets/start', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(startRes.status()).toBe(404);

  // Guide does not show mysheets
  await page.goto('/guide');
  await expect(page.getByText('Google Sheets · Của riêng bạn')).toHaveCount(0);

  expect(googleRequests).toHaveLength(0);
});

test('MYSHEETS: Flow 1 - connect from settings, select scope with fake picker, re-select scope', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mysheets', { headers: { Authorization: `Bearer ${token}` } });

  await page.goto('/settings#mysheets');
  const row = page.locator('#service-row-mysheets');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Chưa kết nối');

  // Connect from settings
  await row.getByRole('button', { name: 'Kết nối Google Sheets', exact: true }).click();

  // Redirected through fake Google to callback
  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // Click picker button to open FakeSheetsPicker modal
  const openPickerBtn = page.getByRole('button', { name: 'Chọn bảng tính trong Google Drive', exact: true });
  await expect(openPickerBtn).toBeVisible();
  await openPickerBtn.click();

  // Fake picker modal opens
  const pickerModal = page.getByRole('dialog', { name: /Chọn bảng tính/i });
  await expect(pickerModal).toBeVisible();

  // Select "Việc của tôi" (writable) and "Tiến độ cá nhân" (read-only)
  const workCheckbox = pickerModal.getByRole('checkbox', { name: 'Việc của tôi' });
  await expect(workCheckbox).not.toBeChecked();
  await workCheckbox.check();

  const progressCheckbox = pickerModal.getByRole('checkbox', { name: 'Tiến độ cá nhân' });
  await expect(progressCheckbox).not.toBeChecked();
  await progressCheckbox.check();

  // Submit picker modal
  const pickSubmitBtn = pickerModal.getByRole('button', { name: /Chọn \(2\)/i });
  await pickSubmitBtn.click();

  // Modal closes, list appears in callback view
  await expect(pickerModal).not.toBeVisible();
  await expect(page.getByText('Việc của tôi')).toBeVisible();
  await expect(page.getByText('Tiến độ cá nhân')).toBeVisible();
  await expect(page.getByText('Chỉ xem')).toBeVisible();

  // Remove "Tiến độ cá nhân"
  const removeProgressBtn = page.getByRole('button', { name: /Bỏ bảng tính Tiến độ cá nhân/i });
  await removeProgressBtn.click();
  await expect(page.getByText('Tiến độ cá nhân')).not.toBeVisible();

  // Save and complete (no returnTo -> lands on /settings?mysheets=connected#mysheets)
  const doneBtn = page.getByRole('button', { name: 'Xong', exact: true });
  await expect(doneBtn).toBeVisible();
  await doneBtn.click();

  await expect(page).toHaveURL(/.*\/settings.*#mysheets/);
  await expect(row).toContainText('Đã kết nối');
  await expect(row).toContainText('Việc của tôi');

  // Re-select scope
  await row.getByRole('button', { name: 'Chọn lại bảng tính', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();
  await expect(page.getByText('Việc của tôi')).toBeVisible();

  // Add another sheet
  const addMoreBtn = page.getByRole('button', { name: 'Thêm bảng tính', exact: true });
  await addMoreBtn.click();
  await expect(pickerModal).toBeVisible();

  const reportCheckbox = pickerModal.getByRole('checkbox', { name: 'Báo cáo tuần' });
  await reportCheckbox.check();
  await pickerModal.getByRole('button', { name: /^Chọn/ }).click();
  await expect(pickerModal).not.toBeVisible();

  await expect(page.getByText('Báo cáo tuần')).toBeVisible();
  await page.getByRole('button', { name: 'Xong', exact: true }).click();

  await expect(page).toHaveURL(/.*\/settings.*#mysheets/);
  await expect(row).toContainText('Đã kết nối');
  await expect(row).toContainText('Việc của tôi');
  await expect(row).toContainText('Báo cáo tuần');

  expect(pageErrors).toEqual([]);
});

test('MYSHEETS: Flow 2 - disconnect, connect from chat refusal, plan and receipt', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mysheets', { headers: { Authorization: `Bearer ${token}` } });

  // Go to chat and request personal spreadsheet write while disconnected
  await page.goto('/');
  await page.getByRole('textbox').fill("Ghi một dòng vào bảng tính riêng của tôi: Chuẩn bị slide bảo vệ, hạn 05/11");
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();

  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const conversationUrl = page.url();

  // RefusalMoment renders
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi chưa làm được yêu cầu này');
  const connectBtn = page.getByRole('link', { name: /Kết nối Google Sheets/i });
  await expect(connectBtn).toBeVisible();

  // Click connect from chat (passes returnTo)
  await connectBtn.click();

  // Redirected to callback
  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();

  // Open fake picker
  await page.getByRole('button', { name: 'Chọn bảng tính trong Google Drive', exact: true }).click();
  const pickerModal = page.getByRole('dialog', { name: /Chọn bảng tính/i });
  await expect(pickerModal).toBeVisible();

  // Select "Việc của tôi"
  await pickerModal.getByRole('checkbox', { name: 'Việc của tôi' }).check();
  await pickerModal.getByRole('button', { name: /Chọn \(1\)/i }).click();
  await expect(pickerModal).not.toBeVisible();

  // Done button says "Xong, quay lại hội thoại"
  const doneBtn = page.getByRole('button', { name: 'Xong, quay lại hội thoại', exact: true });
  await expect(doneBtn).toBeVisible();
  await doneBtn.click();

  // Lands back on conversation URL
  await expect(page).toHaveURL(conversationUrl);

  // RefusalMoment shows status update and "Gửi lại yêu cầu"
  await expect(page.getByText(/Google Sheets của bạn đã được kết nối/i)).toBeVisible();
  const resendBtn = page.getByRole('button', { name: 'Gửi lại yêu cầu', exact: true });
  await expect(resendBtn).toBeVisible();

  // Click "Gửi lại yêu cầu"
  await resendBtn.click();

  // PlanMoment displays plan with resolved spreadsheet and connected account
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 1 việc, theo thứ tự');
  await expect(page.getByText(/Google Sheets của bạn\)/i)).toBeVisible();
  const approvedAccount = await page.getByText(/^Tài khoản: .+ \(Google Sheets của bạn\)$/).innerText();
  await expect(page.locator('#plan-cards-container p').filter({ hasText: 'Đích đến:' })).toContainText('Việc của tôi');

  // Approve plan
  await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();

  // ReceiptMoment renders
  await expect(page.locator('#moment-6')).toBeVisible();
  await expect(page.locator('#moment-6').getByText(approvedAccount, { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mở bảng tính' })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('MYSHEETS: Flow 3 - scope_required state recovery from refusal without re-running OAuth', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mysheets', { headers: { Authorization: `Bearer ${token}` } });

  // Initiate conversation to get refusal
  await page.goto('/');
  await page.getByRole('textbox').fill("Ghi một dòng vào bảng tính riêng của tôi: Chuẩn bị slide bảo vệ, hạn 05/11");
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();
  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);
  const conversationUrl = page.url();

  // Click Connect
  await page.getByRole('link', { name: /Kết nối Google Sheets/i }).click();

  // Once callback page opens, OAuth callback completed -> state is now scope_required
  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();

  // User navigates back to conversation without selecting spreadsheets
  await page.goto(conversationUrl);

  // RefusalMoment now displays scope_required status
  await expect(page.getByText(/Đã cấp quyền · Chưa chọn bảng tính/i)).toBeVisible();
  const selectScopeLink = page.getByRole('link', { name: /Chọn bảng tính/i });
  await expect(selectScopeLink).toBeVisible();

  // Clicking "Chọn bảng tính" navigates directly to callback?mode=select without Google consent
  await selectScopeLink.click();
  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();

  // Select spreadsheet and save
  const openPickerBtn = page.getByRole('button', { name: /Chọn bảng tính trong Google Drive|Thêm bảng tính/i });
  await expect(openPickerBtn).toBeVisible();
  await openPickerBtn.click();
  const pickerModal = page.getByRole('dialog', { name: /Chọn bảng tính/i });
  await pickerModal.getByRole('checkbox', { name: 'Việc của tôi' }).check();
  await pickerModal.getByRole('button', { name: /^Chọn/ }).click();

  await page.getByRole('button', { name: 'Xong, quay lại hội thoại', exact: true }).click();

  // Back in conversation, connected and ready to resend
  await expect(page).toHaveURL(conversationUrl);
  await expect(page.getByRole('button', { name: 'Gửi lại yêu cầu', exact: true })).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('MYSHEETS: Flow 4 - cancel picker leaves list unchanged', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  await page.goto('/connections/mysheets/callback?mode=select');
  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();

  // Wait for loading to finish and picker button to be visible
  const pickerBtn = page.getByRole('button', { name: /Chọn bảng tính trong Google Drive|Thêm bảng tính/i });
  await expect(pickerBtn).toBeVisible();

  const countBefore = await page.locator('[role="group"][aria-label="Danh sách bảng tính đã chọn"] > div').count();

  // Open picker
  await pickerBtn.click();

  const pickerModal = page.getByRole('dialog', { name: /Chọn bảng tính/i });
  await expect(pickerModal).toBeVisible();

  // Click cancel
  await pickerModal.getByRole('button', { name: 'Huỷ', exact: true }).click();
  await expect(pickerModal).not.toBeVisible();

  const countAfter = await page.locator('[role="group"][aria-label="Danh sách bảng tính đã chọn"] > div').count();
  expect(countAfter).toBe(countBefore);

  expect(pageErrors).toEqual([]);
});

test('MYSHEETS: Flow 5 - /guide?service=mysheets and Landing card', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  // Landing page displays personal Google Sheets card when unauthenticated
  await page.goto('/');
  await expect(page.getByText('Google Sheets · Của riêng bạn')).toBeVisible();
  const guideCardLink = page.getByRole('link', { name: 'Cách kết nối và mẫu câu Google Sheets' });
  await expect(guideCardLink).toBeVisible();

  await login(page);

  // /guide?service=mysheets selects mysheets
  await page.goto('/guide?service=mysheets');
  await expect(page.getByRole('heading', { name: 'Google Sheets của bạn' })).toBeVisible();
  const connectGuideLink = page.getByRole('link', { name: 'Kết nối Google Sheets →' });
  await expect(connectGuideLink).toBeVisible();
  expect(await connectGuideLink.getAttribute('href')).toBe('/settings#mysheets');

  expect(pageErrors).toEqual([]);
});

for (const width of [1440, 375]) {
  for (const theme of ['light', 'dark']) {
    test(`MYSHEETS: Flow 6 - viewports ${width}x${width === 375 ? 812 : 900} in ${theme} mode`, async ({ page }) => {
      const pageErrors: Error[] = [];
      page.on('pageerror', (err) => pageErrors.push(err));

      const height = width === 375 ? 812 : 900;
      await page.setViewportSize({ width, height });
      await page.addInitScript((val) => localStorage.setItem('ati-theme', val), theme);

      await login(page);

      // Verify Settings page has zero overflow
      await page.goto('/settings#mysheets');
      await expect(page.locator('#service-row-mysheets')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Verify Callback page has zero overflow
      await page.goto('/connections/mysheets/callback?mode=select');
      await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      expect(pageErrors).toEqual([]);
    });
  }
}

test('MYSHEETS: Flow 7 - URL paste in settings, 4-step two-way closed-loop workflow (search, upsert, update, create tab), rich previews and receipt metrics', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('wap_access_token'));
  await page.request.delete('/api/connections/mysheets', { headers: { Authorization: `Bearer ${token}` } });

  // 1. Connect and grant "Việc của tôi" via Fake Picker, then paste URL in Settings to discover tab list
  await page.goto('/settings#mysheets');
  const row = page.locator('#service-row-mysheets');
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Kết nối Google Sheets', exact: true }).click();

  await expect(page.getByRole('heading', { name: /Chọn bảng tính cho Planora/i })).toBeVisible();
  await page.getByRole('button', { name: 'Chọn bảng tính trong Google Drive', exact: true }).click();
  const pickerModal = page.getByRole('dialog', { name: /Chọn bảng tính/i });
  await expect(pickerModal).toBeVisible();
  await pickerModal.getByRole('checkbox', { name: 'Việc của tôi' }).check();
  await pickerModal.getByRole('button', { name: /Chọn \(1\)/i }).click();
  await expect(pickerModal).not.toBeVisible();
  await page.getByRole('button', { name: 'Xong', exact: true }).click();

  await expect(page).toHaveURL(/.*\/settings.*#mysheets/);
  await expect(row).toContainText('Đã kết nối');

  const urlInput = row.locator('#mysheets-settings-url-input');
  await expect(urlInput).toBeVisible();
  await urlInput.fill('https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit');
  await row.getByRole('button', { name: 'Thêm từ liên kết', exact: true }).click();

  await expect(row).toContainText('Việc của tôi');
  await expect(row).toContainText('(Sheet1, Tasks)');
  const externalSheetLink = row.getByRole('link', { name: 'Mở bảng tính Việc của tôi trên Google Sheets' });
  await expect(externalSheetLink).toBeVisible();
  expect(await externalSheetLink.getAttribute('href')).toBe(
    'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit'
  );

  // 2. Navigate to Cockpit and send closed-loop 2-way prompt
  await page.goto('/');
  await page.getByRole('textbox').fill('Thực hiện quy trình khép kín trên bảng tính riêng của tôi Việc của tôi');
  await page.getByRole('button', { name: 'Gửi yêu cầu', exact: true }).click();

  await page.waitForURL(/\/c\/[0-9a-f-]{36}/);

  // 3. Verify 4-step PlanMoment
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tôi sẽ làm 4 việc, theo thứ tự');
  await expect(page.locator('#plan-cards-container')).toContainText('Lọc các dòng đã hoàn thành trong Sheet1');
  await expect(page.locator('#plan-cards-container')).toContainText('Đồng bộ dòng công việc (Upsert chống trùng khóa)');
  await expect(page.locator('#plan-cards-container')).toContainText('Cập nhật trạng thái dòng Write spec');
  await expect(page.locator('#plan-cards-container')).toContainText('Tạo trang tính Sprint 15 mới');

  // 4. Open PreviewModal for Step 1 (search_rows)
  await page.locator('#preview-search_step').click();
  const previewModal = page.locator('#preview-modal');
  await expect(previewModal).toBeVisible();
  await expect(previewModal.getByTestId('spreadsheet-search-preview')).toBeVisible();
  await expect(previewModal).toContainText('Tra cứu có cấu trúc (Hỗ trợ gán cột theo tiêu đề)');
  await expect(previewModal).toContainText('Status');
  await expect(previewModal).toContainText('Bằng (=)');
  await expect(previewModal).toContainText('Done');
  await previewModal.getByRole('button', { name: 'Đóng Xem trước nội dung', exact: true }).click();
  await expect(previewModal).not.toBeVisible();

  // 5. Open PreviewModal for Step 2 (append_rows with Upsert + Row 1 column headers)
  await page.locator('#preview-upsert_step').click();
  await expect(previewModal).toBeVisible();
  await expect(previewModal.getByTestId('spreadsheet-grid-preview')).toBeVisible();
  await expect(previewModal).toContainText('Cập nhật dòng trùng khóa (Upsert)');
  await expect(previewModal).toContainText('Cột A · Task');
  await expect(previewModal).toContainText('Cột B · Status');
  await previewModal.getByRole('button', { name: 'Đóng Xem trước nội dung', exact: true }).click();
  await expect(previewModal).not.toBeVisible();

  // 6. Open PreviewModal for Step 3 (update_rows)
  await page.locator('#preview-update_step').click();
  await expect(previewModal).toBeVisible();
  await expect(previewModal.getByTestId('spreadsheet-update-preview')).toBeVisible();
  await expect(previewModal).toContainText('Cập nhật cột chọn lọc (Bảo toàn công thức)');
  await expect(previewModal).toContainText('Task = Write spec');
  await expect(previewModal).toContainText('Verified');
  await previewModal.getByRole('button', { name: 'Đóng Xem trước nội dung', exact: true }).click();
  await expect(previewModal).not.toBeVisible();

  // 7. Open PreviewModal for Step 4 (create_sheet)
  await page.locator('#preview-create_tab_step').click();
  await expect(previewModal).toBeVisible();
  await expect(previewModal.getByTestId('spreadsheet-create-preview')).toBeVisible();
  await expect(previewModal).toContainText('Sprint 15');
  await expect(previewModal).toContainText('Cột A · Mã thẻ');
  await expect(previewModal).toContainText('Cột B · Trạng thái');
  await previewModal.getByRole('button', { name: 'Đóng Xem trước nội dung', exact: true }).click();
  await expect(previewModal).not.toBeVisible();

  // 8. Approve plan and verify ReceiptMoment metrics
  await page.getByRole('button', { name: 'Duyệt kế hoạch', exact: true }).click();

  const receipt = page.locator('#moment-6');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Khớp 1 dòng');
  await expect(receipt).toContainText('Đã cập nhật 1 dòng (1 ô)');
  await expect(receipt).toContainText('Tab mới: Sprint 15');

  expect(pageErrors).toEqual([]);
});
