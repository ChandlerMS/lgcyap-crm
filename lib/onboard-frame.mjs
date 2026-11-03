// The uploaded app is left untouched. This controller owns only the frame's
// first navigation, before the user can interact with or edit its contents.
export function onboardFrameState(frame) {
  try {
    const doc = frame.contentDocument;
    if (!doc || doc.URL === 'about:blank' || doc.readyState === 'loading') return 'loading';
    const main = doc.getElementById('main');
    if (!main || !doc.getElementById('me')) return 'failed';
    if (doc.querySelector('#syncSt.bad')) return 'failed';
    return main.childElementCount && doc.getElementById('signOut') ? 'ready' : 'loading';
  } catch {
    return 'loading';
  }
}

/**
 * Start after React has mounted the host, so the iframe cannot begin loading
 * while streamed HTML is still being placed in the document. Stop watching
 * permanently at readiness: an open app must never be reloaded over edits.
 * @param {() => HTMLIFrameElement} createFrame Mount a new frame on every attempt.
 * @param {{onState: (state: 'loading' | 'ready' | 'failed') => void, timeoutMs?: number, maxAttempts?: number}} options
 */
export function startOnboardFrame(createFrame, { onState, timeoutMs = 15000, maxAttempts = 3 }) {
  let frame;
  let attempt = 0;
  let stopped = false;
  let deadline;
  let poll;
  let retry;
  let previousDocument;

  const clear = () => {
    clearTimeout(deadline);
    clearInterval(poll);
    clearTimeout(retry);
  };
  const stop = () => {
    stopped = true;
    clear();
    frame?.removeEventListener('load', inspect);
  };
  const recover = () => {
    if (stopped || retry) return;
    clear();
    if (attempt >= maxAttempts) {
      stop();
      onState('failed');
      return;
    }
    retry = setTimeout(() => { retry = undefined; navigate(); }, 500);
  };
  function inspect() {
    if (stopped || retry) return;
    // A navigation leaves the previous document accessible until the next
    // response commits. Do not mistake that old failure for another failure.
    if (frame.contentDocument === previousDocument) return;
    const state = onboardFrameState(frame);
    if (state === 'ready') { stop(); frame.inert = false; onState('ready'); }
    else if (state === 'failed') recover();
  }
  function navigate() {
    if (stopped) return;
    attempt++;
    frame?.removeEventListener('load', inspect);
    // Failed frame navigations can leave an unusable browsing context behind.
    // Recreate only this not-yet-ready frame, just as a refresh would, without
    // reloading the parent page or touching a running app.
    frame = createFrame();
    previousDocument = frame.contentDocument;
    frame.addEventListener('load', inspect);
    frame.src = attempt === 1 ? '/v2/app' : `/v2/app?startup=${attempt}`;
    poll = setInterval(inspect, 200);
    deadline = setTimeout(() => {
      inspect();
      if (!stopped) recover();
    }, timeoutMs);
  }

  onState('loading');
  navigate();
  return stop;
}
