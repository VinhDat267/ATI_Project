import { useState } from "react";
import type { ActivePlan } from "../types";
import { PlanStepItem } from "./PlanStepItem";
import { Icon } from "./Brand";
export interface PlanPreviewProps {
  plan: ActivePlan;
  onApprove?: () => void;
  onEdit?: () => void;
  onCancel?: () => void;
  isApproving?: boolean;
  hideActions?: boolean;
  readOnly?: boolean;
}
export function PlanActions({
  plan,
  onApprove,
  onEdit,
  onCancel,
  isApproving = false,
}: PlanPreviewProps) {
  return (
    <footer className="plan-footer">
      <p className="plan-note">
        Kiểm tra nội dung và nơi nhận trước khi duyệt.
        {!plan.id && (
          <span className="field-error"> Chưa có ID kế hoạch hợp lệ.</span>
        )}
      </p>
      <div className="plan-actions">
        {onCancel && (
          <button
            className="btn subtle danger"
            disabled={isApproving}
            onClick={onCancel}
          >
            Hủy
          </button>
        )}
        {onEdit && (
          <button className="btn" disabled={isApproving} onClick={onEdit}>
            <Icon name="edit" />
            Sửa qua chat
          </button>
        )}
        {onApprove && (
          <button
            className="btn primary"
            disabled={isApproving || !plan.id}
            onClick={onApprove}
          >
            {isApproving ? (
              <>
                <span className="spinner" />
                Đang gửi duyệt…
              </>
            ) : (
              <>
                <Icon name="arrow" />
                Duyệt và thực thi
              </>
            )}
          </button>
        )}
      </div>
    </footer>
  );
}
export function PlanPreview(props: PlanPreviewProps) {
  const { plan, hideActions, readOnly, isApproving } = props;
  const [thinking, setThinking] = useState(false);
  return (
    <section className="plan-card" aria-label="Kế hoạch thực thi">
      <div className="plan-card-header">
        <div>
          <div className="eyebrow">
            {readOnly ? "KẾ HOẠCH ĐÃ DUYỆT" : "BẢN KẾ HOẠCH"}
          </div>
          <h2>{plan.summary || "Kế hoạch thực thi"}</h2>
        </div>
        <span className={"pill " + (readOnly ? "ghost" : "pending")}>
          <Icon name="clock" />
          {readOnly
            ? `${plan.steps.length} bước`
            : isApproving
              ? "Đang gửi duyệt"
              : "Chờ duyệt"}
        </span>
      </div>
      <p className="plan-description">
        {plan.steps.length} bước, thực hiện theo thứ tự và tham chiếu kết quả
        của nhau.
      </p>
      {plan.thinking && (
        <div className="plan-thinking">
          <button
            className="btn subtle"
            onClick={() => setThinking(!thinking)}
            aria-expanded={thinking}
          >
            Phân tích & lập luận của AI {thinking ? "−" : "+"}
          </button>
          {thinking && <p>{plan.thinking}</p>}
        </div>
      )}
      {plan.warnings?.length !== undefined && plan.warnings.length > 0 && (
        <div className="recovery-note">
          {plan.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      <div className="plan-grid">
        {plan.steps.map((step, index) => (
          <PlanStepItem
            key={step.id}
            step={step}
            index={index}
            isLast={index === plan.steps.length - 1}
          />
        ))}
      </div>
      {!hideActions && !readOnly && <PlanActions {...props} />}
    </section>
  );
}
