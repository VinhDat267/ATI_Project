import { Component, type ReactNode } from "react";

export class ViewBoundary extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="services-body">
          <div className="service-notice" role="alert">
            Không tải được giao diện {this.props.label || "dịch vụ"}. Hãy tải lại trang để thử lại.
          </div>
          <button className="btn" onClick={() => window.location.reload()}>
            Tải lại trang
          </button>
        </section>
      );
    return this.props.children;
  }
}
