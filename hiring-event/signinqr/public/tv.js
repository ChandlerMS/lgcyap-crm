(() => {
  'use strict';

  // Keep the TV awake while the page is up. Ignored where unsupported.
  let lock = null;
  function hold() {
    if (!('wakeLock' in navigator) || lock) return;
    navigator.wakeLock.request('screen').then(l => {
      lock = l;
      l.addEventListener('release', () => { lock = null; });
    }).catch(() => {});
  }
  hold();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') hold(); });

  // Full screen on click or F. Browsers only allow it after a user gesture.
  const hint = document.getElementById('hint');
  function toggleFullscreen() {
    hold();
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  }
  document.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', event => { if (event.key === 'f' || event.key === 'F') toggleFullscreen(); });
  function updateHint() {
    const show = !document.fullscreenElement && document.fullscreenEnabled;
    hint.hidden = !show;
    hint.classList.remove('fade');
    if (show) setTimeout(() => hint.classList.add('fade'), 8000);
  }
  document.addEventListener('fullscreenchange', updateHint);
  updateHint();

  // Hide the cursor when the mouse is still.
  let idleTimer;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  }
  document.addEventListener('mousemove', wake);
  wake();

  // Shift the whole layout a few pixels every two minutes so nothing sits in exactly
  // the same place for hours (limits burn-in on OLED and plasma panels).
  const screen = document.getElementById('screen');
  const offsets = [[0, 0], [4, 2], [2, -3], [-3, 3], [-4, -2], [3, 4]];
  let i = 0;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(() => {
      i = (i + 1) % offsets.length;
      screen.style.transform = `translate(${offsets[i][0]}px, ${offsets[i][1]}px)`;
    }, 120000);
  }

  // Reload once a day (around 4 AM) so a TV left on for days picks up any update.
  const now = new Date();
  const next = new Date(now); next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  setTimeout(() => location.reload(), next - now);
})();
