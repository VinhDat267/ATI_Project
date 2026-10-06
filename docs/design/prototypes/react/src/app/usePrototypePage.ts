import { useLayoutEffect } from 'react';

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

// Dựng lại phần <head>/<html>/<body> của từng bản mẫu khi vào trang và gỡ khi rời trang,
// để CSS riêng của trang này không ảnh hưởng trang khác.
export function usePrototypePage(meta: PageMeta) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const htmlClasses = split(meta.htmlClass);
    document.title = meta.title;
    html.dataset.protoPage = meta.id;
    html.classList.add(...htmlClasses);
    document.body.className = meta.bodyClass;
    const style = document.createElement('style');
    style.dataset.protoPageCss = meta.id;
    style.textContent = meta.css;
    document.head.insertBefore(style, document.querySelector('meta[name="proto-css-anchor"]'));
    return () => {
      style.remove();
      html.classList.remove(...htmlClasses);
      document.body.className = '';
      delete html.dataset.protoPage;
    };
  }, [meta]);
}
