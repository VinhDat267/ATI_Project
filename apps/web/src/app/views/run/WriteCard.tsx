import type { ReactNode } from "react";
import type { WriteSummary } from "../../../core/writes.js";
import { JsonBlock, TechDisclosure } from "../../components/TechDisclosure";

const COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Exactly what will be (or was) sent, readable; raw JSON behind a disclosure. */
export function WritePayload({ write }: { write: WriteSummary }) {
  if (write.kind === "sheet" && write.rows) {
    const width = Math.max(...write.rows.map((row) => row.length), 0);
    return (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">Nội dung đã gửi: {write.rows.length} dòng</caption>
          <thead>
            <tr className="bg-surface-soft text-left text-muted">
              {Array.from({ length: width }, (_, i) => (
                <th key={i} scope="col" className="px-4 py-2.5 tabular text-caption font-semibold">
                  Cột {COLUMN_LETTERS[i] ?? i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {write.rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="border-t border-hairline-soft px-4 py-3">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (write.kind === "message" && write.text) {
    return (
      <div className="flex items-start gap-3 px-5 pb-5 pt-1">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-overline tracking-normal text-on-primary">
          A
        </span>
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm">
            <span className="font-semibold">ATI bot</span> <span className="text-muted">· {write.target}</span>
          </span>
          <div className="whitespace-pre-wrap rounded-md rounded-tl-xs bg-surface-soft px-4 py-3 text-body-md">
            {write.text}
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export function WriteCard({
  write,
  args,
  footer,
}: {
  write: WriteSummary;
  args: unknown;
  footer?: ReactNode;
}) {
  const payload = <WritePayload write={write} />;
  return (
    <article className="overflow-hidden rounded-md border border-hairline">
      <div className="flex flex-col gap-0.5 px-5 py-4">
        <h3 className="m-0 text-title-md">{write.sentence}</h3>
        <span className="font-mono text-mono-sm text-muted">
          {write.server}.{write.tool}
        </span>
      </div>
      {payload}
      <div className="border-t border-hairline-soft px-5">
        <TechDisclosure summary="Xem JSON gốc">
          <JsonBlock value={args} />
        </TechDisclosure>
      </div>
      {footer}
    </article>
  );
}
