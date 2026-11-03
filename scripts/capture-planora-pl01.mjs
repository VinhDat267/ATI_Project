import { createServer } from 'vite';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const webDir = path.resolve(rootDir, 'apps/chat-web');
const outDir = path.resolve(rootDir, 'docs/evidence/PL-01');

fs.mkdirSync(outDir, { recursive: true });

async function run() {
  console.log('Khởi động Vite dev server trên cổng 5199...');
  const server = await createServer({
    root: webDir,
    server: { port: 5199 },
    configFile: path.resolve(webDir, 'vite.config.ts'),
  });
  await server.listen();
  console.log('Vite server đang chạy tại http://localhost:5199');

  const browser = await chromium.launch({ headless: true });
  const samples = [
    { id: 'landing', name: '1. Landing' },
    { id: 'chat-plan', name: '2. Chat có plan' },
    { id: 'settings-scope', name: '3. Settings OAuth & Scope' },
    { id: 'history-schedule', name: '4. Nhật ký có lịch' },
  ];

  const results = [];

  for (const sample of samples) {
    console.log(`\n--- Đang chụp mẫu: ${sample.name} (${sample.id}) ---`);

    // 1. Desktop 1440x900 Light
    {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:5199/showcase.html?sample=${sample.id}`);
      await page.waitForLoadState('networkidle');

      const fileLight = path.join(outDir, `${sample.id}-1440x900-light.png`);
      await page.screenshot({ path: fileLight, fullPage: false });
      console.log(`Đã lưu: ${path.basename(fileLight)}`);

      // 2. Desktop 1440x900 Dark
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
      });
      await page.waitForTimeout(100);
      const fileDark = path.join(outDir, `${sample.id}-1440x900-dark.png`);
      await page.screenshot({ path: fileDark, fullPage: false });
      console.log(`Đã lưu: ${path.basename(fileDark)}`);
      await context.close();
    }

    // 3. Mobile 375x812 Light & Dark
    {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:5199/showcase.html?sample=${sample.id}`);
      await page.waitForLoadState('networkidle');

      const fileMobileLight = path.join(outDir, `${sample.id}-375x812-light.png`);
      await page.screenshot({ path: fileMobileLight, fullPage: false });
      console.log(`Đã lưu: ${path.basename(fileMobileLight)}`);

      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
        document.documentElement.style.colorScheme = 'dark';
      });
      await page.waitForTimeout(100);
      const fileMobileDark = path.join(outDir, `${sample.id}-375x812-dark.png`);
      await page.screenshot({ path: fileMobileDark, fullPage: false });
      console.log(`Đã lưu: ${path.basename(fileMobileDark)}`);
      await context.close();
    }

    // 4. Overflow check at 320px
    {
      const context = await browser.newContext({ viewport: { width: 320, height: 600 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:5199/showcase.html?sample=${sample.id}`);
      await page.waitForLoadState('networkidle');

      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.clientWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const bodyScrollWidth = document.body.scrollWidth;
        const maxScroll = Math.max(scrollWidth, bodyScrollWidth);
        return {
          docWidth,
          maxScroll,
          hasOverflow: maxScroll > docWidth + 1,
        };
      });

      console.log(`Kiểm tra tràn ngang tại 320px (${sample.id}): width=${overflow.docWidth}, scrollWidth=${overflow.maxScroll}, hasOverflow=${overflow.hasOverflow}`);
      results.push({ sample: sample.id, ...overflow });
      await context.close();
    }
  }

  await browser.close();
  await server.close();

  console.log('\n=== TỔNG HỢP KIỂM CHỨNG HÌNH THỨC & TRANH CHẤP TRÀN TRANG (OVERFLOW) ===');
  let allPass = true;
  for (const r of results) {
    const status = !r.hasOverflow ? 'PASS (Không tràn ngang)' : 'FAIL (Bị tràn ngang)';
    if (r.hasOverflow) allPass = false;
    console.log(`- Mẫu [${r.sample}]: ${status} (320px viewport, scrollWidth: ${r.maxScroll}px)`);
  }

  console.log(`\nKết quả toàn bộ: ${allPass ? 'TẤT CẢ ĐẠT (EXIT 0)' : 'CÓ LỖI (EXIT 1)'}`);
  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error('Lỗi khi chụp màn hình:', err);
  process.exit(1);
});
