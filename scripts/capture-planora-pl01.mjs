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

      // Check desktop composer visibility inside 900px viewport for chat-plan
      if (sample.id === 'chat-plan') {
        const composerBounds = await page.evaluate(() => {
          const composer = document.querySelector('.planora-chat-composer-dock');
          if (!composer) return null;
          const rect = composer.getBoundingClientRect();
          return { y: rect.y, height: rect.height, bottom: rect.bottom, visibleInViewport: rect.bottom <= 900 };
        });
        console.log(`[F1 Desktop Check] Vị trí composer đáy viewport 900px:`, composerBounds);
        results.push({
          check: 'chat-composer-desktop-docked',
          pass: composerBounds?.visibleInViewport === true,
          details: composerBounds,
        });
      }

      await context.close();
    }

    // 3. Mobile 375x812 Light & Dark
    {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      const page = await context.newPage();
      await page.goto(`http://localhost:5199/showcase.html?sample=${sample.id}`);
      await page.waitForLoadState('networkidle');

      // Check critical control bounding boxes on 375px mobile
      if (sample.id === 'chat-plan') {
        const bounds = await page.evaluate(() => {
          const vpWidth = window.innerWidth;
          const approveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Phê duyệt'));
          const textarea = document.querySelector('.planora-chat-composer-dock textarea');
          const sendBtn = document.querySelector('.planora-chat-composer-dock button[aria-label="Gửi yêu cầu"]');

          const getBox = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, right: r.x + r.width, clipped: r.x < 0 || r.x + r.width > vpWidth + 1 };
          };

          return {
            vpWidth,
            approveBtn: getBox(approveBtn),
            textarea: getBox(textarea),
            sendBtn: getBox(sendBtn),
          };
        });

        console.log(`[F1 Mobile 375px Check] Bounding boxes:`, bounds);
        const noClipping = !bounds.approveBtn?.clipped && !bounds.textarea?.clipped && !bounds.sendBtn?.clipped;
        results.push({
          check: 'chat-mobile-375-no-clipping',
          pass: noClipping,
          details: bounds,
        });
      }

      // Check table scrollability on 375px mobile
      if (sample.id === 'history-schedule') {
        const tableScroll = await page.evaluate(() => {
          const wrapper = document.querySelector('.planora-table-scroll');
          if (!wrapper) return null;
          const style = window.getComputedStyle(wrapper);
          return {
            clientWidth: wrapper.clientWidth,
            scrollWidth: wrapper.scrollWidth,
            overflowX: style.overflowX,
            hasHorizontalScroll: wrapper.scrollWidth > wrapper.clientWidth && (style.overflowX === 'auto' || style.overflowX === 'scroll'),
          };
        });

        console.log(`[F2 Mobile 375px Table Scroll Check]:`, tableScroll);
        results.push({
          check: 'history-table-scroll-375',
          pass: tableScroll?.hasHorizontalScroll === true,
          details: tableScroll,
        });
      }

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

      if (sample.id === 'chat-plan') {
        const bounds320 = await page.evaluate(() => {
          const vpWidth = window.innerWidth;
          const approveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Phê duyệt'));
          const textarea = document.querySelector('.planora-chat-composer-dock textarea');
          const sendBtn = document.querySelector('.planora-chat-composer-dock button[aria-label="Gửi yêu cầu"]');

          const getBox = (el) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, right: r.x + r.width, clipped: r.x < 0 || r.x + r.width > vpWidth + 1 };
          };

          return {
            vpWidth,
            approveBtn: getBox(approveBtn),
            textarea: getBox(textarea),
            sendBtn: getBox(sendBtn),
          };
        });

        console.log(`[F1 Mobile 320px Check] Bounding boxes:`, bounds320);
        const noClipping320 = !bounds320.approveBtn?.clipped && !bounds320.textarea?.clipped && !bounds320.sendBtn?.clipped;
        results.push({
          check: 'chat-mobile-320-no-clipping',
          pass: noClipping320,
          details: bounds320,
        });
      }

      if (sample.id === 'history-schedule') {
        const tableScroll320 = await page.evaluate(() => {
          const wrapper = document.querySelector('.planora-table-scroll');
          if (!wrapper) return null;
          const style = window.getComputedStyle(wrapper);
          return {
            clientWidth: wrapper.clientWidth,
            scrollWidth: wrapper.scrollWidth,
            overflowX: style.overflowX,
            hasHorizontalScroll: wrapper.scrollWidth > wrapper.clientWidth && (style.overflowX === 'auto' || style.overflowX === 'scroll'),
          };
        });

        console.log(`[F2 Mobile 320px Table Scroll Check]:`, tableScroll320);
        results.push({
          check: 'history-table-scroll-320',
          pass: tableScroll320?.hasHorizontalScroll === true,
          details: tableScroll320,
        });
      }

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
      results.push({ check: `overflow-320-${sample.id}`, pass: !overflow.hasOverflow, sample: sample.id, ...overflow });
      await context.close();
    }
  }

  // 5. Test Theme Contract Persistence & Reload (F3 Check)
  console.log(`\n--- Kiểm tra Hợp đồng Theme Showcase & Reload (F3) ---`);
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    // Set dark theme in localStorage before loading
    await page.addInitScript(() => {
      localStorage.setItem('ati-theme', 'dark');
    });

    await page.goto('http://localhost:5199/showcase.html?sample=landing');
    await page.waitForLoadState('networkidle');

    const themeState = await page.evaluate(() => {
      return {
        hasDarkClass: document.documentElement.classList.contains('dark'),
        dataTheme: document.documentElement.getAttribute('data-theme'),
        colorScheme: document.documentElement.style.colorScheme,
        storageTheme: localStorage.getItem('ati-theme'),
      };
    });

    console.log('[F3 Check] Theme state sau reload khi storage=dark:', themeState);
    const themeContractPass = themeState.hasDarkClass === true && themeState.dataTheme === 'dark';
    results.push({
      check: 'theme-contract-reload-dark',
      pass: themeContractPass,
      details: themeState,
    });

    await context.close();
  }

  await browser.close();
  await server.close();

  console.log('\n=== TỔNG HỢP KIỂM CHỨNG TOÀN DIỆN (EVIDENCE VERIFICATION) ===');
  let allPass = true;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) allPass = false;
    console.log(`- [${r.check}]: ${status} ${r.details ? JSON.stringify(r.details) : ''}`);
  }

  console.log(`\nKết quả toàn bộ: ${allPass ? 'TẤT CẢ ĐẠT (EXIT 0)' : 'CÓ LỖI (EXIT 1)'}`);
  process.exit(allPass ? 0 : 1);
}

run().catch(err => {
  console.error('Lỗi khi chụp màn hình:', err);
  process.exit(1);
});
