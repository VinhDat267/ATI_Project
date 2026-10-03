import { Brand, Icon, ServiceLogo } from "./Brand";
import { useHeroMotion } from "../hooks/use-hero-motion";
import { useId, useState, useLayoutEffect } from "react";
import { useLandingStory } from "../hooks/use-landing-story";
import { PublicFooter } from './PublicFooter';
import { PublicServices } from './PublicServices';
export interface LandingPageViewProps {
  onGoToLogin: () => void;
  isAuthenticated?: boolean;
  onGoToServices?: () => void;
}
export function LandingPageView({ onGoToLogin, onGoToServices, isAuthenticated = false }: LandingPageViewProps) {
  const heroMotion = useHeroMotion();
  const motion = useLandingStory();
  useLayoutEffect(() => {
    // React renders anchor targets after the browser's initial fragment lookup.
    const target = window.location.hash.slice(1);
    if (['services', 'how', 'ecosystem', 'main'].includes(target)) {
      document.getElementById(target)?.scrollIntoView?.({ behavior: 'instant' });
    }
  }, []);
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
          <a className="nav-anchor" href="#services">
            Dịch vụ
          </a>
          <button
            className="btn primary"
            onClick={onGoToLogin}
            aria-label={isAuthenticated ? "Mở workspace" : "Đăng nhập vào hệ thống"}
          >
            {isAuthenticated ? "Mở workspace" : "Đăng nhập"}
            <Icon name="arrow" />
          </button>
        </nav>
      </header>
      <main id="main">
        <section className="hero">
          <div>
            <div className="eyebrow">CÙNG Planora SẮP XẾP CÔNG VIỆC</div>
            <h1>
              Một lời nhắn.
              <br />
              Công việc
              <br />
              <em>được kết nối.</em>
            </h1>
            <p className="hero-copy">
              Biến ý tưởng thành kế hoạch trên những dịch vụ bạn đã quen. Bạn
              kiểm tra, bạn quyết định — Planora phối hợp các bước còn lại.
            </p>
            <div className="hero-cta">
              <button className="btn primary" onClick={onGoToLogin}>
                Bắt đầu cùng Planora
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
                aria-label="Ví dụ quy trình Planora. Kéo ngang để xoay, hoặc dùng phím mũi tên trái và phải."
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
                    <span>WORKSPACE Planora</span>
                    <span>Ví dụ quy trình</span>
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
                      ["github", "Tạo issue trên GitHub", "frontend/web-app"],
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
                  <span className="brand-word">planora</span>
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
          data-landing-reveal
          data-scroll-surface
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
          <p className="story-label">VÍ DỤ: MỘT YÊU CẦU, BA BƯỚC</p>
          <div className="how-grid" ref={motion.story}>
            <div className="workflow-rail" aria-hidden="true">
              <span className="workflow-fill" />
              <span className="workflow-token" />
            </div>
            {[
              [
                "Nói điều bạn cần.",
                "Mô tả công việc bằng một lời nhắn. Planora tìm tài nguyên liên quan và hỏi thêm nếu có điều chưa rõ.",
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
              <article className="how-card" key={title} data-landing-reveal data-scroll-surface>
                <span className="serif">0{i + 1}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
                <div className="workflow-fragment">
                  <WorkflowIllustration step={i} />
                </div>
              </article>
            ))}
          </div>
          <LandingRoadmap />
        </section>
        <PublicServices isAuthenticated={isAuthenticated} onOpen={onGoToServices || onGoToLogin}/>
        <section className="landing-bottom" ref={motion.panel} {...motion.pointer} data-landing-reveal data-scroll-surface>
          <div>
            <h2>Dành chỗ cho điều bạn muốn làm.</h2>
            <p>Bắt đầu trong workspace, duyệt trước khi tạo thay đổi.</p>
          </div>
          <button className="btn primary magnetic-cta" ref={motion.magnet} onClick={onGoToLogin}>
            Bắt đầu cùng Planora
            <Icon name="arrow" />
          </button>
        </section>
      </main>
      <PublicFooter/>
    </div>
  );
}

const illustratedWorkflow = [
  { service: "github", name: "GitHub", action: "Tạo issue", result: "Đã tạo issue", resource: "frontend/web-app" },
  { service: "trello", name: "Trello", action: "Tạo thẻ", result: "Đã tạo thẻ", resource: "Frontend / Cần làm" },
  { service: "slack", name: "Slack", action: "Thông báo nhóm", result: "Đã thông báo nhóm", resource: "#frontend" },
];

/** Static, labelled examples; none of these miniature controls call the API. */
function WorkflowIllustration({ step }: { step: number }) {
  const title = ["Yêu cầu", "Kế hoạch", "Kết quả"][step];
  return (
    <div className={`workflow-preview workflow-preview-${step}`} role="group" aria-label={`Ví dụ về ${title.toLowerCase()}`}>
      <div className="workflow-preview-bar">
        <span><Icon name={["chat", "shield", "check"][step]} />{title}</span>
      </div>
      {step === 0 ? (
        <div className="workflow-chat">
          <div className="workflow-chat-author"><span className="workflow-avatar"><Icon name="chat" /></span><strong>Bạn</strong></div>
          <div className="workflow-chat-message">Tạo issue đăng nhập, thêm vào Trello và báo cho nhóm frontend.</div>
          <div className="workflow-chat-footer">
            <span>Một lời nhắn, nhiều kết nối.</span>
            <span className="workflow-send" aria-hidden="true"><Icon name="send" /></span>
          </div>
        </div>
      ) : (
        <ul className="workflow-preview-rows">
          {illustratedWorkflow.map(({ service, name, action, result, resource }) => (
            <li key={service}>
              <span className="workflow-service-mark"><ServiceLogo name={service} size={20} /></span>
              <div className="workflow-row-copy">
                <strong>{step === 1 ? action : result}</strong>
                <span>{name} · {resource}</span>
              </div>
              <span className={step === 2 ? "workflow-result-check" : "workflow-row-arrow"}>
                <Icon name={step === 2 ? "check" : "arrow"} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {step > 0 && (
        <div className={`workflow-preview-foot ${step === 2 ? "workflow-preview-complete" : ""}`}>
          <Icon name={step === 1 ? "clock" : "check"} />
          <span>{step === 1 ? "Chờ bạn duyệt" : "Công việc đã được kết nối"}</span>
        </div>
      )}
    </div>
  );
}

function LandingRoadmap() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="roadmap-section landing-roadmap" data-landing-reveal data-scroll-surface onKeyDown={(event) => {
      if (event.key === "Escape" && open) { setOpen(false); event.stopPropagation(); }
    }}>
      <div className="section-heading">
        <h2>Những kết nối tiếp theo.</h2>
        <button className="pill ghost roadmap-toggle" aria-expanded={open} aria-controls={id}
          onClick={() => setOpen(!open)} type="button">
          Dự kiến <span className="roadmap-sign" aria-hidden="true">+</span>
        </button>
      </div>
      <p>Dự kiến bổ sung Google Sheets, Google Calendar, Notion, Telegram và Jira.</p>
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
        <p className="roadmap-disclaimer">Các kết nối dự kiến chưa khả dụng.</p>
      </div>
    </div>
  );
}
