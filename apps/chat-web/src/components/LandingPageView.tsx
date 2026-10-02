import { Brand, Icon, ServiceLogo } from "./Brand";
import { useHeroMotion } from "../hooks/use-hero-motion";
import { useId, useState } from "react";
import { useLandingStory } from "../hooks/use-landing-story";
export interface LandingPageViewProps {
  onGoToLogin: () => void;
}
export function LandingPageView({ onGoToLogin }: LandingPageViewProps) {
  const heroMotion = useHeroMotion();
  const motion = useLandingStory();
  return (
    <div className="public-page" ref={motion.root}>
      <a className="skip-link" href="#main">
        Đến nội dung chính
      </a>
      <header className="public-nav">
        <Brand />
        <nav className="public-nav-links" aria-label="Điều hướng chính">
          <a className="nav-anchor" href="#how">
            Cách hoạt động
          </a>
          <a className="nav-anchor" href="#ecosystem">
            Dịch vụ
          </a>
          <button
            className="btn primary"
            onClick={onGoToLogin}
            aria-label="Đăng nhập vào hệ thống"
          >
            Đăng nhập
            <Icon name="arrow" />
          </button>
        </nav>
      </header>
      <main id="main">
        <section className="hero">
          <div>
            <div className="eyebrow">CÙNG ATI SẮP XẾP CÔNG VIỆC</div>
            <h1>
              Một lời nhắn.
              <br />
              Công việc
              <br />
              <em>được kết nối.</em>
            </h1>
            <p className="hero-copy">
              Biến ý tưởng thành kế hoạch trên những dịch vụ bạn đã quen. Bạn
              kiểm tra, bạn quyết định — ATI phối hợp các bước còn lại.
            </p>
            <div className="hero-cta">
              <button className="btn primary" onClick={onGoToLogin}>
                Bắt đầu cùng ATI
                <Icon name="arrow" />
              </button>
              <a className="btn subtle" href="#how">
                Khám phá cách hoạt động
              </a>
            </div>
            <div className="hero-note">
              <Icon name="shield" />
              Mỗi kế hoạch đều chờ bạn duyệt trước khi thực thi.
            </div>
          </div>
          <div className="hero-perspective">
            <div className="hero-float" ref={heroMotion.float}>
              <div
                className="hero-rotator"
                ref={heroMotion.rotator}
                {...heroMotion.events}
                tabIndex={0}
                role="group"
                aria-label="Mẫu quy trình ATI. Kéo ngang để xoay, hoặc dùng phím mũi tên trái và phải."
              >
                {/* Rounded solid slices give the card a visible edge at any angle. */}
                {Array.from({ length: 14 }, (_, index) => (
                  <div
                    className="hero-edge-layer"
                    key={index}
                    aria-hidden="true"
                    style={{
                      transform: `rotateZ(var(--hero-roll)) translateZ(calc(var(--hero-depth) * ${-(index + 1) / 15}))`,
                    }}
                  />
                ))}
                <div className="hero-visual hero-front" ref={heroMotion.front}>
                  <div className="hero-visual-label">
                    <span>WORKSPACE ATI</span>
                    <span>VÍ DỤ MINH HỌA</span>
                  </div>
                  <div className="mini-request">
                    <span className="avatar">L</span>Tạo issue đăng nhập, đưa
                    vào Trello rồi báo cho nhóm trên Slack.
                  </div>
                  <div className="mini-plan">
                    <div className="mini-plan-heading">
                      <h2>Một kế hoạch, ba bước.</h2>
                      <span className="pill pending">
                        <Icon name="clock" />
                        Chờ duyệt
                      </span>
                    </div>
                    {[
                      ["github", "Tạo issue trên GitHub", "ati-demo/web-app"],
                      ["trello", "Tạo thẻ trên Trello", "Frontend / Cần làm"],
                      ["slack", "Thông báo tới nhóm", "#frontend"],
                    ].map(([service, title, resource], index) => (
                      <div className="mini-step" key={service}>
                        <Icon name={service} />
                        <div>
                          <strong>{title}</strong>
                          <span>{resource}</span>
                        </div>
                        <span className="mini-count">0{index + 1}</span>
                      </div>
                    ))}
                    <div className="mini-approve">
                      <span>Bạn luôn giữ quyền quyết định.</span>
                      <span className="btn primary">
                        Duyệt và thực thi
                        <Icon name="arrow" />
                      </span>
                    </div>
                  </div>
                  <p className="visual-caption">
                    Từ một ý tưởng, đến việc của cả nhóm.
                  </p>
                </div>
                <div
                  className="hero-back"
                  ref={heroMotion.back}
                  aria-hidden="true"
                  inert
                >
                  <span className="brand-word">ati</span>
                  <h2>Ý tưởng → Kế hoạch → Hành động</h2>
                  <p>GitHub · Trello · Slack</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section
          className="service-strip"
          id="ecosystem"
          aria-labelledby="integrations-title"
        >
          <h2 className="service-strip-title" id="integrations-title">
            Các dịch vụ đã có tích hợp
          </h2>
          <div className="service-strip-marquee">
            <div className="service-strip-track">
              {[0, 1, 2, 3].map((copy) => (
                <ul className="service-strip-logos" key={copy} aria-hidden={copy > 0 || undefined}>
                  {[
                    ["github", "GitHub"],
                    ["trello", "Trello"],
                    ["slack", "Slack"],
                  ].map(([service, name]) => (
                    <li className="service-strip-brand" key={service}>
                      <ServiceLogo
                        name={service}
                        size={32}
                        className="service-logo-mark"
                      />
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </section>
        <section className="how-section" id="how">
          <div className="how-title" ref={motion.title} data-landing-reveal>
            <div>
              <div className="eyebrow">ĐƠN GIẢN, TỪ ĐẦU ĐẾN CUỐI</div>
              <h2>
                <span className="heading-mask"><span>Công việc rõ ràng hơn.</span></span>
                <span className="heading-mask"><span>Bắt đầu cũng nhẹ nhàng hơn.</span></span>
              </h2>
            </div>
            <p>
              Một luồng làm việc có thể đọc, kiểm tra và theo dõi. Không cần tự
              chuyển qua lại giữa từng dịch vụ.
            </p>
          </div>
          <p className="story-label">QUY TRÌNH MINH HỌA</p>
          <div className="how-grid" ref={motion.story}>
            <div className="workflow-rail" aria-hidden="true">
              <span className="workflow-fill" />
              <span className="workflow-token" />
            </div>
            {[
              [
                "Nói điều bạn cần.",
                "Mô tả công việc bằng một lời nhắn. ATI tìm tài nguyên liên quan và hỏi thêm nếu có điều chưa rõ.",
              ],
              [
                "Xem trước, rồi quyết định.",
                "Kiểm tra từng hành động, nội dung và nơi nhận. Duyệt kế hoạch hoặc điều chỉnh ngay qua chat.",
              ],
              [
                "Theo dõi đến kết quả.",
                "Xem tiến trình từng bước. Khi có lỗi hoặc chưa rõ kết quả, bạn được hướng dẫn xử lý trước khi tiếp tục.",
              ],
            ].map(([title, copy], i) => (
              <article className="how-card" key={title}>
                <span className="serif">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
                <div className="workflow-fragment">
                  {i === 0 ? (
                    <q>Tạo issue đăng nhập và báo cho nhóm frontend.</q>
                  ) : (
                    <ul>
                      {(i === 1 ? [
                        ["GitHub", "Tạo issue"], ["Trello", "Tạo thẻ"], ["Slack", "Thông báo nhóm"],
                      ] : [
                        ["GitHub", "Đã tạo issue"], ["Trello", "Đã tạo thẻ"], ["Slack", "Đã thông báo nhóm"],
                      ]).map(([service, action]) => (
                        <li key={service}>
                          <span aria-hidden="true">{i === 1 ? "→" : "✓"}</span>
                          <strong>{service}</strong><span>{action}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            ))}
          </div>
          <LandingRoadmap />
        </section>
        <section className="landing-bottom" ref={motion.panel} {...motion.pointer} data-landing-reveal>
          <div>
            <h2>Dành chỗ cho điều bạn muốn làm.</h2>
            <p>Bắt đầu trong workspace, duyệt trước khi tạo thay đổi.</p>
          </div>
          <button className="btn primary magnetic-cta" ref={motion.magnet} onClick={onGoToLogin}>
            Bắt đầu cùng ATI
            <Icon name="arrow" />
          </button>
        </section>
      </main>
      <footer className="public-footer">
        <span>ati · Từ ý tưởng đến hành động.</span>
        <span>AI Workflow Automation Platform</span>
      </footer>
    </div>
  );
}

function LandingRoadmap() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="roadmap-section landing-roadmap" onKeyDown={(event) => {
      if (event.key === "Escape" && open) { setOpen(false); event.stopPropagation(); }
    }}>
      <div className="section-heading">
        <h2>Những kết nối tiếp theo.</h2>
        <button className="pill ghost roadmap-toggle" aria-expanded={open} aria-controls={id}
          onClick={() => setOpen(!open)} type="button">
          Roadmap <span className="roadmap-sign" aria-hidden="true">+</span>
        </button>
      </div>
      <p>Google Sheets, Google Calendar, Notion, Telegram và Jira nằm trong kế hoạch mở rộng.</p>
      <div className="roadmap-unfold" id={id} hidden={!open}>
        <div className="roadmap-route">
          <div className="roadmap-stop">
            <span className="roadmap-phase">Đã tích hợp</span>
            <p>GitHub · Trello · Slack</p>
          </div>
          <span className="roadmap-connector" aria-hidden="true" />
          <div className="roadmap-stop">
            <span className="roadmap-phase">Đang lên kế hoạch</span>
            <p>Google Sheets · Google Calendar · Notion · Telegram · Jira</p>
          </div>
        </div>
        <p className="roadmap-disclaimer">Chưa thể cấu hình các dịch vụ dự kiến. Thời điểm phát hành chưa được xác định.</p>
      </div>
    </div>
  );
}
