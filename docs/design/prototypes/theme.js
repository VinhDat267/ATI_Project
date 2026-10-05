/* ATI — chuyển giao diện Sáng / Tối dùng chung cho các trang.
   Nạp đồng bộ trong <head> (trước Tailwind) để không nháy giao diện sáng khi tải trang.
   Lựa chọn lưu ở localStorage "ati-theme" ("light" | "dark"); chưa chọn thì theo hệ điều hành. */
(function () {
  var KEY = 'ati-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'dark' || v === 'light' ? v : null;
    } catch (e) { return null; }
  }

  function preferred() {
    return saved() || (media && media.matches ? 'dark' : 'light');
  }

  function apply(theme) {
    var dark = theme === 'dark';
    root.classList.toggle('dark', dark);
    root.setAttribute('data-theme', theme);
    var btn = document.getElementById('ati-theme-toggle');
    if (btn) {
      var label = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
    }
  }

  function announce(text) {
    var live = document.getElementById('ati-theme-live');
    if (!live) return;
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  function toggle() {
    var next = root.classList.contains('dark') ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch (e) { /* vẫn đổi được trong phiên này */ }
    apply(next);
    announce(next === 'dark' ? 'Đã chuyển sang giao diện tối' : 'Đã chuyển sang giao diện sáng');
  }

  apply(preferred());

  if (media && media.addEventListener) {
    media.addEventListener('change', function (e) { if (!saved()) apply(e.matches ? 'dark' : 'light'); });
  }
  // Đổi ở một tab thì các tab khác của ATI đổi theo.
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(preferred()); });

  var MOON = '<svg class="ati-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  var SUN = '<svg class="ati-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path stroke-linecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41"/></svg>';

  function mountButton() {
    if (document.getElementById('ati-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'ati-theme-toggle';
    btn.className = 'ati-theme-toggle';
    btn.innerHTML = MOON + SUN;
    btn.addEventListener('click', toggle);

    var live = document.createElement('span');
    live.id = 'ati-theme-live';
    live.setAttribute('aria-live', 'polite');
    live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
    document.body.appendChild(live);

    // Gắn vào cụm bên phải của thanh trên; cụm đó bị ẩn (màn hình nhỏ) thì gắn thẳng vào hàng, đẩy sang phải.
    var row = document.querySelector('header > div');
    var right = row && row.lastElementChild;
    if (right && getComputedStyle(right).display !== 'none' && right.children.length) {
      right.insertBefore(btn, right.firstElementChild);
    } else if (row) {
      btn.style.marginLeft = 'auto';
      row.appendChild(btn);
    } else {
      btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:60';
      document.body.appendChild(btn);
    }
    apply(preferred());
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();

  window.atiTheme = { toggle: toggle, apply: apply };
})();
