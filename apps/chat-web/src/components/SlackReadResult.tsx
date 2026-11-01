const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
/** Project display fields explicitly: observation/policy records belong to the server guards. */
export function SlackReadResult({ value }: { value: unknown }) {
  if (!record(value)) return <p>Không có kết quả trong phạm vi đã duyệt.</p>;
  const rows: unknown[] = ['messages', 'channels', 'users', 'members'].flatMap(key => Array.isArray(value[key]) ? value[key] as unknown[] : []);
  for (const key of ['channel', 'user']) if (record(value[key])) rows.push(value[key]);
  let permalink: string | undefined;
  if (typeof value.permalink === 'string') try { const url = new URL(value.permalink); if (url.protocol === 'https:' && !url.username && !url.password) permalink = url.href; } catch { /* Invalid output links are not navigable. */ }
  return <div className="mt-3 text-sm text-text-secondary [overflow-wrap:anywhere]">
    {rows.length ? <ol aria-label="Kết quả đọc Slack" className="space-y-3">{rows.map((row, index) => <li key={index} className="rounded-lg border border-border p-3">
      {record(row) ? <>{(row.name || row.realName || row.displayName || row.id) && <p className="font-medium">{text(row.name || row.realName || row.displayName || row.id)}</p>}{typeof row.text === 'string' && <p className="whitespace-pre-wrap">{row.text}</p>}{(row.user || row.ts) && <p className="mt-1 text-xs">{[text(row.user), text(row.ts)].filter(Boolean).join(' · ')}</p>}</> : <p>{text(row)}</p>}
    </li>)}</ol> : !permalink && <p>Không có kết quả trong phạm vi đã duyệt.</p>}
    {permalink && <a href={permalink} target="_blank" rel="noopener noreferrer" className="underline">Mở tin nhắn trên Slack</a>}
  </div>;
}
