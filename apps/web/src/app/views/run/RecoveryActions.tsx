import { useState } from "react";
import type { RecoveryOption, RecoveryPlan } from "../../../core/recovery.js";
import type { RequestDraft } from "../../../core/draft.js";
import { routeToHash } from "../../../core/navigation.js";
import { useApp } from "../../context";
import { ButtonLink } from "../../components/Button";
import { Icon } from "../../components/Icon";

const NEW_HASH = routeToHash({ page: "new" });

/** Links that hand a prefilled draft to the composer (in memory only). */
function useDraftLink() {
  const { drafts } = useApp();
  return (draft: RequestDraft) => () => drafts.set(draft);
}

function Option({ option }: { option: RecoveryOption }) {
  const handoff = useDraftLink();
  const body = (
    <span className="flex flex-col gap-0.5 text-left">
      <span className="text-title-md">{option.label}</span>
      <span className="text-body-sm text-muted">{option.effect}</span>
    </span>
  );
  if (!option.draft) return null;
  return (
    <a
      href={NEW_HASH}
      onClick={handoff(option.draft)}
      aria-describedby="recovery-note"
      className="grid grid-cols-[minmax(0,1fr)_18px] items-center gap-3 rounded-sm border border-ink bg-canvas px-4 py-3 text-ink no-underline hover:bg-surface-soft hover:text-ink"
    >
      {body}
      <Icon name="chevron-right" size={18} />
    </a>
  );
}

function DiffersOption({ option }: { option: RecoveryOption }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="conflict-guide"
        onClick={() => setOpen((value) => !value)}
        className="grid grid-cols-[minmax(0,1fr)_18px] items-center gap-3 rounded-sm border border-ink bg-canvas px-4 py-3 text-left aria-expanded:ring-1 aria-expanded:ring-ink"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-title-md">{option.label}</span>
          <span className="text-body-sm text-muted">{option.effect}</span>
        </span>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      <div id="conflict-guide" hidden={!open} className="rounded-sm bg-surface-soft px-4 py-3.5 text-body-sm">
        Hệ thống không sửa dòng đã có trên nơi nhận. Sửa trực tiếp trên bảng cho khớp nội dung đã gửi, rồi chọn “Đã thấy, đúng như đã gửi” nếu vẫn cần báo nhóm.
      </div>
    </>
  );
}

export function RecoveryActions({ plan }: { plan: RecoveryPlan }) {
  const handoff = useDraftLink();
  if (plan.kind === "question") {
    return (
      <div role="group" aria-labelledby="recovery-q" className="flex flex-col gap-2.5">
        <span id="recovery-q" className="text-title-md leading-6">
          {plan.prompt}
        </span>
        {plan.options.map((option) =>
          option.id === "differs" ? (
            <DiffersOption key={option.id} option={option} />
          ) : option.draft ? (
            <Option key={option.id} option={option} />
          ) : (
            <p key={option.id} className="m-0 rounded-sm border border-hairline px-4 py-3 text-body-sm">
              <span className="block text-title-md">{option.label}</span>
              {option.effect}
            </p>
          ),
        )}
        <span id="recovery-note" className="text-center text-body-sm text-muted">
          {plan.note}
        </span>
      </div>
    );
  }
  if (plan.kind === "primary") {
    return (
      <div className="flex flex-col gap-2.5">
        <ButtonLink
          href={NEW_HASH}
          onClick={handoff(plan.draft)}
          aria-describedby="recovery-primary-note"
          block
        >
          <Icon name={plan.label.includes("thông báo") ? "send" : "rotate-ccw"} size={18} />
          {plan.label}
        </ButtonLink>
        <span id="recovery-primary-note" className="text-center text-body-sm text-muted">
          {plan.note}
        </span>
        {plan.secondary ? (
          <a
            href={NEW_HASH}
            onClick={handoff(plan.secondary.draft)}
            className="inline-flex min-h-11 items-center justify-center text-button-sm"
          >
            {plan.secondary.label}
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <ButtonLink href={NEW_HASH} variant="secondary" block>
      <Icon name="plus" size={18} />
      Tạo yêu cầu mới
    </ButtonLink>
  );
}
