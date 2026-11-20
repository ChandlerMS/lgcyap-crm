/** Page arithmetic for the dashboard panels: page numbers start at 1 and always stay in range. */
export function pageWindow(count, page, size) {
  const rows = Math.max(0, Math.floor(Number(count) || 0));
  const perPage = Math.max(1, Math.floor(Number(size) || 1));
  const pages = Math.max(1, Math.ceil(rows / perPage));
  const current = Math.min(Math.max(1, Math.floor(Number(page) || 1)), pages);
  const start = rows ? (current - 1) * perPage : 0;
  return { page: current, pages, start, end: Math.min(start + perPage, rows), rows };
}

/**
 * Page buttons for a pager: every page when there are seven or fewer, otherwise the first and last pages and
 * those beside the current one, with null for each gap. A gap is never just one page: that page is shown instead.
 */
export function pageNumbers(pages, current) {
  const total = Math.max(1, Math.floor(Number(pages) || 1));
  const page = Math.min(Math.max(1, Math.floor(Number(current) || 1)), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const wanted = new Set([1, total, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach(value => wanted.add(value));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach(value => wanted.add(value));
  const sorted = [...wanted].filter(value => value >= 1 && value <= total).sort((a, b) => a - b);
  return sorted.flatMap((value, index) => {
    const gap = index ? value - sorted[index - 1] : 1;
    return gap === 1 ? [value] : gap === 2 ? [value - 1, value] : [null, value];
  });
}
