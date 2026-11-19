/**
 * Height a scrolling table wrapper needs so its header and the first `rows` body rows show
 * before it scrolls. Rows differ in height (two-line titles, wrapped links), so this measures
 * the real rows instead of assuming one. Returns null when every row fits without scrolling.
 */
export function rowLimitHeight(wrap, rows = 10) {
  const body = wrap.querySelectorAll(':scope > table > tbody > tr');
  if (body.length <= rows) return null;
  const top = wrap.getBoundingClientRect().top + wrap.clientTop;
  // Adding scrollTop back keeps the measurement right while the panel is scrolled.
  return Math.ceil(body[rows - 1].getBoundingClientRect().bottom - top + wrap.scrollTop) + 1;
}

/** Keeps `wrap` sized to `rows` rows as its rows, their contents or its width change. Returns a cleanup. */
export function watchRowLimit(wrap, rows = 10) {
  let frame = 0;
  const fit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const height = rowLimitHeight(wrap, rows);
      const value = height === null ? 'none' : `${height}px`;
      if (wrap.style.maxHeight !== value) wrap.style.maxHeight = value;
    });
  };
  const resize = new ResizeObserver(fit);
  const watchTable = () => { resize.disconnect(); resize.observe(wrap); const table = wrap.querySelector(':scope > table'); if (table) resize.observe(table); };
  const mutations = new MutationObserver(() => { watchTable(); fit(); });
  watchTable();
  mutations.observe(wrap, { childList: true, subtree: true, characterData: true });
  fit();
  return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); };
}
