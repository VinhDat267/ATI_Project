// Từ docs/design/prototypes/react/src/app/usePrototypePage.ts (FE-04b), thêm ba điểm cho app:
// - theme.css của bản mẫu chỉ nạp khi đang có trang bản mẫu (đếm số trang đang mở), để màn chưa chuyển không bị ghi đè;
// - rời trang thì trả lại class của <body> và tiêu đề trước đó, thay vì xoá trắng;
// - không có mốc proto-css-anchor (ví dụ khi test) thì chèn ở đầu <head>, vẫn trước stylesheet của app.
import { useLayoutEffect } from 'react';
import themeCss from './theme.css?raw';

export interface PageMeta {
  /** Tên file bản mẫu không có .html; khoá token theo trang trong tokens.css. */
  id: string;
  title: string;
  /** Class của <html> trong bản mẫu (ngoài "dark" do theme quản lý). */
  htmlClass: string;
  bodyClass: string;
  /** Nội dung các thẻ <style> của bản mẫu. */
  css: string;
}

const split = (value: string) => value.split(/\s+/).filter(Boolean);
function insertBeforeAnchor(style: HTMLStyleElement) {
  const anchor = document.head.querySelector('meta[name="proto-css-anchor"]');
  if (anchor) document.head.insertBefore(style, anchor);
  else document.head.prepend(style);
}

let themeUsers = 0;
let themeStyle: HTMLStyleElement | null = null;

// Dựng lại phần <head>/<html>/<body> của bản mẫu khi vào trang và trả lại khi rời trang.
export function usePrototypePage(meta: PageMeta) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const previous = { title: document.title, body: document.body.className };
    const htmlClasses = split(meta.htmlClass);
    if (themeUsers++ === 0) {
      themeStyle = document.createElement('style');
      themeStyle.dataset.protoTheme = '';
      themeStyle.textContent = themeCss;
      insertBeforeAnchor(themeStyle);
    }
    const style = document.createElement('style');
    style.dataset.protoPageCss = meta.id;
    style.textContent = meta.css;
    insertBeforeAnchor(style);
    document.title = meta.title;
    html.dataset.protoPage = meta.id;
    html.classList.add(...htmlClasses);
    document.body.className = meta.bodyClass;
    return () => {
      style.remove();
      html.classList.remove(...htmlClasses);
      delete html.dataset.protoPage;
      document.body.className = previous.body;
      document.title = previous.title;
      if (--themeUsers === 0) {
        themeStyle?.remove();
        themeStyle = null;
      }
    };
  }, [meta]);
}
