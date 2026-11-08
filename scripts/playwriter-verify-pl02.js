const fs = require('fs');
const path = require('path');

async function main() {
  const page = context.pages()[0] || await context.newPage();
  const evidenceDir = path.resolve(process.cwd(), 'docs/evidence/PL-02/playwriter');
  fs.mkdirSync(evidenceDir, { recursive: true });

  const consoleLogs = [];
  const consoleErrors = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    } else {
      consoleLogs.push(text);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.message);
  });

  const baseUrl = 'http://127.0.0.1:5201';
  const results = [];

  // Helper to test a viewport and theme
  async function testView(name, width, height, theme, actions = null) {
    await page.setViewportSize({ width, height });
    await page.goto(`${baseUrl}/?view=workspace`, { waitUntil: 'networkidle' });

    // Set theme via localStorage and document class
    await page.evaluate((t) => {
      localStorage.setItem('ati-theme', t);
      if (t === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      window.dispatchEvent(new CustomEvent('ati:theme', { detail: { theme: t } }));
    }, theme);

    await page.waitForTimeout(400);

    if (actions) {
      await actions();
    }

    // Geometry measurements
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const sidebar = document.querySelector('.planora-sidebar');
      const sidebarRect = sidebar ? sidebar.getBoundingClientRect() : null;
      const dropdown = document.querySelector('[role="menu"]');
      const dropdownRect = dropdown ? dropdown.getBoundingClientRect() : null;
      const modal = document.querySelector('[role="dialog"]:not(.planora-sidebar)');
      const modalRect = modal ? modal.getBoundingClientRect() : null;

      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollWidth: doc.scrollWidth,
        hasHorizontalOverflow: doc.scrollWidth > window.innerWidth,
        sidebarWidth: sidebarRect ? Math.round(sidebarRect.width) : null,
        sidebarVisible: sidebar ? getComputedStyle(sidebar).visibility : null,
        dropdownRect: dropdownRect ? {
          x: Math.round(dropdownRect.x),
          width: Math.round(dropdownRect.width),
          right: Math.round(dropdownRect.right)
        } : null,
        modalRect: modalRect ? {
          x: Math.round(modalRect.x),
          width: Math.round(modalRect.width),
          right: Math.round(modalRect.right)
        } : null,
        activeElement: document.activeElement ? {
          tagName: document.activeElement.tagName,
          id: document.activeElement.id || null,
          role: document.activeElement.getAttribute('role') || null,
          ariaLabel: document.activeElement.getAttribute('aria-label') || null
        } : null
      };
    });

    const filename = `${name}-${theme}.png`;
    const tempPath = `C:/Users/Admin/AppData/Local/Temp/${filename}`;
    await page.screenshot({ path: tempPath, fullPage: false });

    // Copy to evidence dir
    const evidencePath = path.join(evidenceDir, filename);
    fs.copyFileSync(tempPath, evidencePath);

    results.push({
      view: name,
      theme,
      width,
      height,
      filename,
      metrics
    });
  }

  // 1. Desktop 1440x900 (Light & Dark)
  await testView('shell-desktop-1440', 1440, 900, 'light');
  await testView('shell-desktop-1440', 1440, 900, 'dark');

  // 2. Desktop 1440x900 Workspace Dropdown (Light & Dark)
  await testView('dropdown-desktop-1440', 1440, 900, 'light', async () => {
    const wsBtn = page.getByRole('button', { name: /Không gian Cá nhân|Workspace/i });
    if (await wsBtn.isVisible()) {
      await wsBtn.click();
      await page.waitForTimeout(300);
    }
  });
  await testView('dropdown-desktop-1440', 1440, 900, 'dark', async () => {
    const wsBtn = page.getByRole('button', { name: /Không gian Cá nhân|Workspace/i });
    if (await wsBtn.isVisible()) {
      await wsBtn.click();
      await page.waitForTimeout(300);
    }
  });

  // 3. Tablet 1024x900 (Light & Dark)
  await testView('shell-tablet-1024', 1024, 900, 'light');
  await testView('shell-tablet-1024', 1024, 900, 'dark');

  // 4. Mobile 375x812 Drawer Closed (Light & Dark)
  await testView('mobile-closed-375', 375, 812, 'light');
  await testView('mobile-closed-375', 375, 812, 'dark');

  // 5. Mobile 375x812 Drawer Open (Light & Dark)
  await testView('mobile-drawer-open-375', 375, 812, 'light', async () => {
    const menuBtn = page.getByRole('button', { name: 'Mở menu thanh điều hướng' });
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(400);
    }
  });
  await testView('mobile-drawer-open-375', 375, 812, 'dark', async () => {
    const menuBtn = page.getByRole('button', { name: 'Mở menu thanh điều hướng' });
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(400);
    }
  });

  // 6. Mobile 375x812 Create Org Modal via Portal (Light & Dark)
  await testView('mobile-create-modal-375', 375, 812, 'light', async () => {
    const menuBtn = page.getByRole('button', { name: 'Mở menu thanh điều hướng' });
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(300);
    }
    const wsBtn = page.getByRole('button', { name: /Không gian Cá nhân|Workspace/i });
    if (await wsBtn.isVisible()) {
      await wsBtn.click();
      await page.waitForTimeout(300);
    }
    const createBtn = page.getByRole('button', { name: /Tạo không gian tổ chức mới/i });
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await page.waitForTimeout(400);
    }
  });
  await testView('mobile-create-modal-375', 375, 812, 'dark', async () => {
    const menuBtn = page.getByRole('button', { name: 'Mở menu thanh điều hướng' });
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(300);
    }
    const wsBtn = page.getByRole('button', { name: /Không gian Cá nhân|Workspace/i });
    if (await wsBtn.isVisible()) {
      await wsBtn.click();
      await page.waitForTimeout(300);
    }
    const createBtn = page.getByRole('button', { name: /Tạo không gian tổ chức mới/i });
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await page.waitForTimeout(400);
    }
  });

  return {
    results,
    consoleErrors,
    consoleLogsCount: consoleLogs.length
  };
}

return await main();
