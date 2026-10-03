import { PlanoraMark, Icon } from "./Brand";
import "../public-details.css";
export function PublicFooter() {
  return (
    <footer className="planora-footer" aria-label="Chân trang Planora">
      <div className="footer-main">
        <a
          className="footer-signature"
          href="/?view=landing"
          aria-label="Planora — trang giới thiệu"
        >
          <span className="brand-symbol">
            <PlanoraMark />
          </span>
          <span className="brand-word">planora</span>
        </a>
        <p>
          Cho ý tưởng một hướng đi.
          <br />
          <em>Cho công việc một mạch chung.</em>
        </p>
        <nav aria-label="Khám phá Planora">
          <a href="/?view=landing#how">
            Cách hoạt động
            <Icon name="arrow" />
          </a>
          <a href="/?view=landing#services">
            Dịch vụ
            <Icon name="arrow" />
          </a>
          <a href="/?view=login">
            Vào không gian làm việc
            <Icon name="arrow" />
          </a>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>Từ ý tưởng đến hành động.</span>
        <a href="#main">Về đầu trang ↑</a>
      </div>
    </footer>
  );
}
