import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
for (const theme of ['light','dark'] as const) for (const width of [1440,375]) {
  test(`FE-05: real sandbox request approval receipt and accessible dialogs ${theme} ${width}`, async ({page},info) => {
    await page.setViewportSize({width,height:900}); await page.emulateMedia({colorScheme:theme});
    await page.goto('/login'); await page.getByLabel('Email').fill(process.env.CHAT_ADMIN_EMAIL!); await page.getByLabel('Mật khẩu').fill(process.env.CHAT_ADMIN_PASSWORD!); await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
    const input=page.getByRole('textbox', { name: /Mô tả công việc bạn muốn thực hiện|Nhập câu trả lời làm rõ yêu cầu/ });
    await expect(input).toBeVisible(); await expect(page.locator('textarea:visible')).toHaveCount(1); await expect(page.getByText('Yêu cầu hiện tại',{exact:true})).toBeHidden();
    const overflow = async () => { const measured=await page.evaluate(()=>{const main=document.querySelector<HTMLElement>('#stage-container')!; return {scroll:document.documentElement.scrollWidth,viewport:window.innerWidth,mainScroll:main.scrollWidth,mainClient:main.clientWidth}; }); expect(measured.scroll).toBeLessThanOrEqual(measured.viewport); expect(measured.mainScroll).toBeLessThanOrEqual(measured.mainClient); return measured; };
    const requestDimensions=await overflow(); await page.screenshot({path:info.outputPath(`FE05-request-${theme}-${width}.png`),animations:'disabled'});
    const history=page.getByRole('button',{name:'Mở danh sách hội thoại'}); await history.click(); const drawer=page.getByRole('dialog',{name:'Lịch sử yêu cầu'}); await expect(drawer.getByRole('searchbox',{name:'Tìm hội thoại theo tiêu đề'})).toBeVisible(); await page.screenshot({path:info.outputPath(`FE05-history-${theme}-${width}.png`),animations:'disabled'}); await page.keyboard.press('Escape'); await expect(history).toBeFocused();
    const request=`Tạo công việc Trello và thông báo Slack FE05 ${theme} ${width}`;
    await input.fill(request); await input.press('Enter'); await expect(page.getByRole('button',{name:'Duyệt kế hoạch',exact:true})).toBeVisible();
    await expect(page.getByText('Yêu cầu hiện tại',{exact:true})).toBeVisible(); await expect(page.locator('textarea:visible')).toHaveCount(0); await page.getByRole('button',{name:'Sửa qua Chat'}).click(); await expect(page.locator('textarea:visible')).toHaveCount(1);
    await input.fill('Bản nháp giữ nguyên'); const chat=page.getByRole('button',{name:'Xem hội thoại',exact:true}); await chat.click();
    const log=page.getByRole('dialog',{name:'Nhật ký hội thoại'}); await expect(log).toBeVisible(); await expect(page.locator('textarea:visible')).toHaveCount(1); await expect(log.getByRole('textbox')).toHaveValue('Bản nháp giữ nguyên');
    await page.screenshot({path:info.outputPath(`FE05-conversation-${theme}-${width}.png`),animations:'disabled'});
    const closeChat=log.getByRole('button',{name:'Đóng Nhật ký hội thoại'}); await expect(closeChat).toBeFocused(); await closeChat.press('Shift+Tab'); await expect(log.getByRole('button',{name:'Gửi tin nhắn',exact:true})).toBeFocused();
    await page.keyboard.press('Escape'); await expect(chat).toBeFocused(); await expect(input).toHaveValue('Bản nháp giữ nguyên');
    const preview=page.getByRole('button',{name:'Xem trước',exact:true}).first(); await preview.click(); const dialog=page.getByRole('dialog',{name:'Xem trước nội dung'}); await expect(dialog).toBeVisible(); await expect(dialog.getByText(/Đích:/)).toBeVisible(); await page.screenshot({path:info.outputPath(`FE05-content-preview-${theme}-${width}.png`),animations:'disabled'}); await page.keyboard.press('Escape'); await expect(preview).toBeFocused();
    const contrast=await preview.evaluate(element=>{ let background=element.parentElement!; while(background.parentElement && getComputedStyle(background).backgroundColor==='rgba(0, 0, 0, 0)') background=background.parentElement; return {foreground:getComputedStyle(element).color,background:getComputedStyle(background).backgroundColor}; });
    const luminance=(text:string)=>{ const values=text.match(/[\d.]+/g)!.slice(0,3).map(Number).map(value=>value/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4); return .2126*values[0]+.7152*values[1]+.0722*values[2]; };
    const foreground=luminance(contrast.foreground),background=luminance(contrast.background),ratio=(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05); expect(Number.isFinite(ratio)).toBe(true); // Spec 1.2: prototype cockpit has its own palette; record rendered contrast.
    await info.attach('preview-rendered-contrast',{body:JSON.stringify({...contrast,ratio}),contentType:'application/json'});
    const previewDimensions=await overflow(); await page.screenshot({path:info.outputPath(`FE05-preview-${theme}-${width}.png`),animations:'disabled'});
    await page.getByRole('button',{name:'Duyệt kế hoạch',exact:true}).click(); await expect(page.getByRole('heading',{name:/^Đã xong \d+ việc trên \d+ công cụ$/,exact:true})).toBeVisible();
    const link=page.locator('#receipt-chain a[href="https://trello.com/c/sandbox/card"]'); await expect(link).toBeVisible(); await expect(link).toHaveAttribute('target','_blank'); await expect(link).toHaveAttribute('rel','noopener noreferrer');
    await expect(page.getByText(/^Trong .+ giây$/)).toBeVisible(); await expect(page.getByText(/đã xác nhận/i)).toHaveCount(0); await expect(page.locator('textarea:visible')).toHaveCount(1);
    const dimensions=await overflow(); await info.attach('overflow-and-dialogs',{body:JSON.stringify({theme,width,...dimensions,chatFocusTrap:true,chatFocusReturn:true,historyFocusReturn:true,previewFocusReturn:true,visibleComposer:1}),contentType:'application/json'});
    await writeFile(info.outputPath('FE05-measurements.json'),JSON.stringify({theme,width,contrast:{...contrast,ratio},requestDimensions,previewDimensions,receiptDimensions:dimensions,chatFocusTrap:true,chatFocusReturn:true,historyFocusReturn:true,previewFocusReturn:true,visibleComposer:1},null,2));
    await page.getByRole('heading',{name:/^Đã xong \d+ việc trên \d+ công cụ$/,exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`FE05-receipt-${theme}-${width}.png`),animations:'disabled'});
  });
}
