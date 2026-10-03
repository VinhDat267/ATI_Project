import { ServiceLogo, Icon } from "./Brand";
const services = [
  {
    id: "github",
    name: "GitHub",
    category: "MÃ NGUỒN & ISSUE",
    title: "Giữ yêu cầu sát với mã nguồn.",
    body: "Tìm repository, đọc và tìm issue, tạo issue mới trong repository được cấp quyền.",
    actions: ["Tìm issue", "Tạo issue"],
    visual: "issue",
  },
  {
    id: "trello",
    name: "Trello",
    category: "CÔNG VIỆC CỦA NHÓM",
    title: "Đưa kế hoạch vào đúng bảng.",
    body: "Tìm bảng, danh sách và thẻ; tạo thẻ, thêm người phụ trách và cập nhật công việc.",
    actions: ["Tạo thẻ", "Gán thành viên"],
    visual: "board",
  },
  {
    id: "slack",
    name: "Slack",
    category: "TRAO ĐỔI & THÔNG BÁO",
    title: "Để cả nhóm cùng nắm được.",
    body: "Tìm kênh và gửi thông báo tới đúng nơi, kèm liên kết từ các bước trước trong kế hoạch.",
    actions: ["Tìm kênh", "Gửi thông báo"],
    visual: "message",
  },
] as const;
export function PublicServices({
  onOpen,
  isAuthenticated,
}: {
  onOpen: () => void;
  isAuthenticated: boolean;
}) {
  return (
    <section
      className="public-services"
      id="services"
      aria-labelledby="public-services-title"
      data-landing-reveal
    >
      <div className="public-services-heading">
        <div>
          <span className="eyebrow">NHỮNG CÔNG CỤ BẠN ĐÃ QUEN</span>
          <h2 id="public-services-title">
            Mỗi nơi một thế mạnh.
            <br />
            <em>Cùng nhau thành một luồng.</em>
          </h2>
        </div>
        <p>
          Planora kết nối các bước giữa dịch vụ.
          <br />
          Bạn xem nội dung, chọn nơi nhận và duyệt trước khi thực thi.
        </p>
      </div>
      <div className="public-services-grid">
        {services.map((service) => (
          <article
            key={service.id}
            className={`public-service public-service-${service.id}`}
          >
            <header>
              <ServiceLogo name={service.id} size={32} />
              <span>
                {service.name}
                <small>{service.category}</small>
              </span>
            </header>
            <div
              className={`service-vignette vignette-${service.visual}`}
              aria-label={`Ví dụ giao diện ${service.name}`}
            >
              <span className="vignette-label">VÍ DỤ</span>
              {service.visual === "issue" ? (
                <>
                  <div className="vignette-repo">frontend / web-app</div>
                  <strong>
                    <span className="issue-circle" />
                    Cải thiện trang đăng nhập
                  </strong>
                  <span className="vignette-chip">enhancement</span>
                </>
              ) : service.visual === "board" ? (
                <>
                  <div className="mini-board-labels">
                    <span>Cần làm</span>
                    <span>Đang làm</span>
                  </div>
                  <div className="mini-board">
                    <span>
                      Cải thiện đăng nhập<small>Liên kết issue GitHub</small>
                    </span>
                    <i />
                  </div>
                </>
              ) : (
                <>
                  <div className="vignette-channel"># frontend</div>
                  <div className="mini-slack">
                    <span className="mini-slack-avatar">P</span>
                    <div>
                      <strong>Planora</strong>
                      <p>Công việc mới đã sẵn sàng.</p>
                      <span>GitHub issue ↗ &nbsp; Trello card ↗</span>
                    </div>
                  </div>
                </>
              )}
            </div>
            <h3>{service.title}</h3>
            <p>{service.body}</p>
            <div className="public-service-actions">
              {service.actions.map((action) => (
                <span key={action}>{action}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
      <div className="public-services-note">
        <p>
          <Icon name="shield" />
          Chỉ dùng tài nguyên nhóm đã cấp quyền. Kết nối được quản lý trong
          workspace.
        </p>
        <button className="btn" onClick={onOpen}>
          {isAuthenticated ? "Quản lý dịch vụ" : "Đăng nhập để kết nối"}
          <Icon name="arrow" />
        </button>
      </div>
    </section>
  );
}
