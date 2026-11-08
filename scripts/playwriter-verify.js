const fs = require('fs');
const path = require('path');

const outDir = 'C:/Users/Admin/AppData/Local/Temp/playwriter-evidence';
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Ensure state object
state.consoleLogs = state.consoleLogs || [];
state.consoleErrors = state.consoleErrors || [];

if (!state.page) {
  state.page = await context.newPage();
  state.page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      state.consoleErrors.push(`[Console Error] ${text}`);
      console.error(`[Console Error] ${text}`);
    } else {
      state.consoleLogs.push(`[${msg.type()}] ${text}`);
    }
  });
  state.page.on('pageerror', err => {
    state.consoleErrors.push(`[Page Error] ${err.toString()}`);
    console.error(`[Page Error] ${err.toString()}`);
  });
}

const page = state.page;
const baseUrl = 'http://127.0.0.1:5200';

console.log('--- Bắt đầu kiểm thử giao diện Planora PL-01 qua Playwriter ---');

const samples = [
  { id: 'landing', name: 'Landing' },
  { id: 'chat-plan', name: 'Chat có plan' },
  { id: 'settings-scope', name: 'Settings OAuth & Scope' },
  { id: 'history-schedule', name: 'Nhật ký có lịch' }
];

const results = [];

for (const sample of samples) {
  console.log(`\nKiểm thử mẫu: ${sample.name} (${sample.id})`);
  
  // 1. Desktop 1440x900 Light
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/showcase.html?sample=${sample.id}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Set Light theme
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.waitForTimeout(200);

  const fileDesktopLight = path.join(outDir, `${sample.id}-1440x900-light.png`);
  await page.screenshot({ path: fileDesktopLight, fullPage: false });
  console.log(`- Đã chụp Desktop Light: ${path.basename(fileDesktopLight)}`);

  // 2. Desktop 1440x900 Dark
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';
  });
  await page.waitForTimeout(200);

  const fileDesktopDark = path.join(outDir, `${sample.id}-1440x900-dark.png`);
  await page.screenshot({ path: fileDesktopDark, fullPage: false });
  console.log(`- Đã chụp Desktop Dark: ${path.basename(fileDesktopDark)}`);

  // 3. Mobile 375x812 Light
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = 'light';
  });
  await page.waitForTimeout(200);

  const fileMobileLight = path.join(outDir, `${sample.id}-375x812-light.png`);
  await page.screenshot({ path: fileMobileLight, fullPage: false });
  console.log(`- Đã chụp Mobile Light: ${path.basename(fileMobileLight)}`);

  // 4. Mobile 375x812 Dark
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.style.colorScheme = 'dark';
  });
  await page.waitForTimeout(200);

  const fileMobileDark = path.join(outDir, `${sample.id}-375x812-dark.png`);
  await page.screenshot({ path: fileMobileDark, fullPage: false });
  console.log(`- Đã chụp Mobile Dark: ${path.basename(fileMobileDark)}`);

  // 5. Check Overflow & Element bounds at 375px
  const metrics = await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const bodyScrollWidth = document.body.scrollWidth;
    return {
      docWidth,
      scrollWidth,
      bodyScrollWidth,
      hasDocOverflow: Math.max(scrollWidth, bodyScrollWidth) > docWidth + 1
    };
  });

  results.push({
    id: sample.id,
    name: sample.name,
    metrics
  });
}

console.log('\n--- TỔNG HỢP KIỂM THỬ PLAYWRITER ---');
console.log(`Tổng số lỗi console/page: ${state.consoleErrors.length}`);
if (state.consoleErrors.length > 0) {
  state.consoleErrors.forEach((err, i) => console.log(`  ${i + 1}. ${err}`));
} else {
  console.log('  Không có lỗi console hoặc page error nào.');
}

console.log('\nĐo lường tràn trang tại viewport 375px:');
results.forEach(r => {
  console.log(`  - [${r.name}] clientWidth: ${r.metrics.docWidth}px, scrollWidth: ${r.metrics.scrollWidth}px, bodyScrollWidth: ${r.metrics.bodyScrollWidth}px (Tràn: ${r.metrics.hasDocOverflow ? 'CÓ' : 'KHÔNG'})`);
});

// Close page when done
await page.close();
state.page = null;
console.log('\nĐã đóng tab kiểm thử Playwriter.');
