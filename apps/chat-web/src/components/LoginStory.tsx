import { PlanoraMark } from "./Brand";

export function LoginStory() {
  return (
    <aside className="login-editorial" aria-labelledby="login-editorial-title">
      <div className="login-editorial-top">
        <span className="eyebrow">MỘT KHOẢNG TRỐNG CHO Ý TƯỞNG</span>
        <span className="editorial-edition">P / 01</span>
      </div>
      <h2 id="login-editorial-title">
        Điều lớn lao,
        <br />
        <em>từ một khởi đầu nhỏ.</em>
      </h2>
      <div className="planora-paper-art" aria-hidden="true">
        <svg viewBox="0 0 500 350" fill="none">
          <ellipse
            cx="250"
            cy="300"
            rx="155"
            ry="13"
            fill="#324d35"
            opacity=".06"
          />
          <g className="paper-art-stack">
            <path
              d="M83 220 251 271 425 191 257 133Z"
              fill="#d4dcc4"
              stroke="#b5c0a2"
            />
            <path
              d="M82 201 250 252 425 173 257 115Z"
              fill="#edf0e3"
              stroke="#c0c9b0"
            />
            <path
              d="M82 181 250 233 425 153 257 95Z"
              fill="#faf9f0"
              stroke="#cbd2bd"
            />
            <path d="M250 233V171L425 153" fill="#e0e6d3" />
            <path d="M250 233V171L425 153" stroke="#c0c9b0" />
            <path
              d="M135 176 249 205 367 154"
              stroke="#819176"
              strokeWidth="1.2"
              strokeDasharray="3 6"
            />
            <circle cx="135" cy="176" r="4" fill="#39573f" />
            <circle cx="367" cy="154" r="4" fill="#39573f" />
            <g transform="translate(216 55) rotate(-10 35 35)">
              <g className="paper-art-seal">
                <rect width="70" height="70" rx="18" fill="#39573f" />
                <g transform="translate(14 13) scale(1.35)" color="#faf8ef">
                  <PlanoraMark />
                </g>
              </g>
            </g>
            <path d="M251 136V161" stroke="#809075" strokeWidth="1.2" />
            <circle cx="251" cy="166" r="3" fill="#39573f" />
          </g>
        </svg>
        <span className="paper-art-caption">
          một khởi đầu nhỏ. một hướng đi rõ.
        </span>
      </div>
      <div className="editorial-quiet-note">
        <span className="quiet-note-line" />
        <p>
          Bớt những việc rời rạc.
          <br />
          Thêm chỗ cho điều bạn muốn làm.
        </p>
      </div>
      <div className="editorial-bottom">
        <span className="brand-word">planora</span>
        <span>Từ ý tưởng đến hành động.</span>
      </div>
    </aside>
  );
}
