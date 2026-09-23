import { useEffect, useRef, useState } from "react";
import { routeToHash } from "../../core/navigation.js";
import {
  HISTORY_GROUPS,
  countByGroup,
  filterRuns,
  formatClock,
  type HistoryGroup,
} from "../../core/presentation.js";
import { cn } from "@/lib/cn";
import { useApp } from "../context";
import { Button, ButtonLink } from "../components/Button";
import { Icon } from "../components/Icon";
import { RunRow } from "../components/RunRow";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { useAttention, useRuns } from "../hooks";

const PAGE = 50;

interface HistoryFilters {
  group: HistoryGroup;
  query: string;
  shown: number;
  scrollY: number;
}

// Filters survive a visit to run detail within the same session (spec V04),
// in memory only; a new session starts clean.
const remembered = new Map<number, HistoryFilters>();
const initial: HistoryFilters = { group: "all", query: "", shown: PAGE, scrollY: 0 };

export function HistoryView() {
  const { generation } = useApp();
  const list = useRuns();
  const attention = useAttention();
  const [filters, setFilters] = useState<HistoryFilters>(
    () => remembered.get(generation) ?? initial,
  );
  const restoredScroll = useRef(false);

  useEffect(() => {
    remembered.set(generation, filters);
  }, [generation, filters]);

  useEffect(() => {
    const onScroll = (): void => {
      const saved = remembered.get(generation);
      if (saved) remembered.set(generation, { ...saved, scrollY: window.scrollY });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [generation]);

  useEffect(() => {
    if (!restoredScroll.current && list.data && filters.scrollY > 0) {
      restoredScroll.current = true;
      window.scrollTo(0, filters.scrollY);
    }
  }, [list.data, filters.scrollY]);

  const update = (patch: Partial<HistoryFilters>): void =>
    setFilters((current) => ({ ...current, shown: PAGE, ...patch }));
  const reset = (): void => update({ group: "all", query: "" });

  const loadedAt = list.dataUpdatedAt
    ? formatClock(new Date(list.dataUpdatedAt).toISOString(), "Asia/Ho_Chi_Minh")
    : null;

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-display-md-mobile desk:text-display-md">Danh sách công việc</h1>
        {loadedAt ? (
          <p className="m-0 text-body-md text-muted">
            <span className="tabular">Tải lúc {loadedAt}</span> · thời gian hiển thị theo lúc tạo yêu cầu
          </p>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
        >
          <Icon name="refresh-cw" className={cn(list.isFetching && "animate-spin")} />
          {list.isFetching ? "Đang tải…" : "Làm mới"}
        </Button>
        <ButtonLink href={routeToHash({ page: "new" })} size="sm">
          <Icon name="plus" />
          Tạo yêu cầu
        </ButtonLink>
      </div>
    </div>
  );

  if (list.isPending) {
    return (
      <>
        {header}
        <LoadingState label="Đang tải danh sách công việc…" />
      </>
    );
  }
  if (list.isError) {
    return (
      <>
        {header}
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      </>
    );
  }

  const runs = list.data;
  if (runs.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon="history"
          title="Chưa có công việc nào"
          action={<ButtonLink href={routeToHash({ page: "new" })}>Tạo yêu cầu đầu tiên</ButtonLink>}
        >
          Mỗi yêu cầu bạn gửi sẽ xuất hiện ở đây, kèm kết quả và chứng cứ thực thi.
        </EmptyState>
      </>
    );
  }

  const counts = countByGroup(runs);
  const matches = filterRuns(runs, filters.group, filters.query);
  const visible = matches.slice(0, filters.shown);
  const groupLabel = HISTORY_GROUPS.find((g) => g.id === filters.group)?.label ?? "";
  const filtered = filters.group !== "all" || filters.query.trim() !== "";

  return (
    <>
      {header}

      <div className="flex flex-col gap-4">
        <div role="group" aria-label="Nhóm trạng thái" className="hidden flex-wrap gap-2 desk:flex">
          {HISTORY_GROUPS.map((group) => {
            const pressed = filters.group === group.id;
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => update({ group: group.id })}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-button-sm",
                  pressed ? "border-ink bg-ink text-on-primary" : "border-hairline bg-canvas hover:border-ink",
                )}
              >
                {group.label}
                <span className={cn("tabular", pressed ? "text-on-primary" : "text-muted")}>
                  {counts[group.id]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 desk:hidden">
          <label htmlFor="history-group" className="text-title-md">
            Nhóm trạng thái
          </label>
          <div className="flex gap-2">
            <select
              id="history-group"
              value={filters.group}
              onChange={(event) => update({ group: event.target.value as HistoryGroup })}
              className="h-12 min-w-0 flex-1 rounded-sm border border-border-control bg-canvas px-3 text-body-lg"
            >
              {HISTORY_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label} · {counts[group.id]}
                </option>
              ))}
            </select>
            {filtered ? (
              <Button variant="secondary" onClick={reset}>
                Bỏ lọc
              </Button>
            ) : null}
          </div>
        </div>

        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-4 top-4 text-muted" />
          <label htmlFor="history-search" className="sr-only">
            Tìm lần chạy
          </label>
          <input
            id="history-search"
            type="search"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
            placeholder="Tìm theo nội dung yêu cầu hoặc mã run"
            className="h-12 w-full rounded-sm border border-border-control bg-canvas pl-11 pr-4 text-body-lg placeholder:text-muted"
          />
        </div>

        <p aria-live="polite" className="m-0 text-body-sm text-muted">
          {matches.length} kết quả
        </p>
      </div>

      {matches.length === 0 ? (
        <EmptyState
          icon="search"
          title="Không có lần chạy nào khớp"
          action={
            <Button variant="secondary" onClick={reset}>
              Bỏ lọc
            </Button>
          }
        >
          {`Nhóm “${groupLabel}”${filters.query.trim() ? `, từ khoá “${filters.query.trim()}”` : ""}. Tìm kiếm đã bỏ qua dấu và chữ hoa.`}
        </EmptyState>
      ) : (
        <>
          <ul className="m-0 list-none border-t border-hairline p-0">
            {visible.map((run) => (
              <RunRow
                key={run.run_id}
                run={run}
                reconciliation={attention.reconciliation.get(run.run_id)}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-body-sm text-muted">
              Đang hiển thị {visible.length} / {matches.length} công việc đã tải · mới nhất trước
            </p>
            {visible.length < matches.length ? (
              <Button
                variant="secondary"
                onClick={() => setFilters((current) => ({ ...current, shown: current.shown + PAGE }))}
              >
                Hiển thị thêm
              </Button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
