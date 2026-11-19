/** Page arithmetic for the dashboard panels: page numbers start at 1 and always stay in range. */
export function pageWindow(count, page, size) {
  const rows = Math.max(0, Math.floor(Number(count) || 0));
  const perPage = Math.max(1, Math.floor(Number(size) || 1));
  const pages = Math.max(1, Math.ceil(rows / perPage));
  const current = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
  const start = rows ? (current - 1) * perPage : 0;
  return { page: current, pages, start, end: Math.min(start + perPage, rows), rows };
}
