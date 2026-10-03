import { PlanoraMark, Icon } from "./Brand";
export interface MissionControlLaunchpadProps {
  onSendMessage: (message: string) => void;
}
export function MissionControlLaunchpad(_: MissionControlLaunchpadProps) {
  const prefill = (text: string) =>
    window.dispatchEvent(new CustomEvent("chat:prefill", { detail: { text } }));
  return (
    <section className="empty-workspace">
      <span className="ati-avatar">
        <PlanoraMark />
      </span>
      <div className="eyebrow">CÙNG Planora SẮP XẾP CÔNG VIỆC</div>
      <h2>Bắt đầu bằng một lời nhắn.</h2>
      <p>
        Điều bạn muốn làm, những nơi bạn đang làm việc.
        <br />
        Planora giúp nối chúng thành một kế hoạch rõ ràng.
      </p>
      <div className="suggestions">
        <button
          className="btn"
          onClick={() =>
            prefill(
              "Tạo issue trên GitHub, tạo thẻ cùng tên trên Trello rồi thông báo qua Slack. Hãy hỏi tôi tên tài nguyên cần dùng.",
            )
          }
        >
          <Icon name="arrow" />
          GitHub → Trello → Slack
        </button>
        <button
          className="btn"
          onClick={() =>
            prefill(
              "Tạo thẻ công việc trên Trello. Hãy hỏi tôi tên bảng, danh sách và nội dung.",
            )
          }
        >
          <Icon name="trello" />
          Tạo thẻ công việc
        </button>
        <button
          className="btn"
          onClick={() =>
            prefill(
              "Tìm issue trên GitHub. Hãy hỏi tôi tên repository và nội dung cần tìm.",
            )
          }
        >
          <Icon name="github" />
          Tìm issue trên GitHub
        </button>
      </div>
      <p className="empty-note">
        Chọn một gợi ý hoặc viết điều bạn muốn làm.
      </p>
    </section>
  );
}
