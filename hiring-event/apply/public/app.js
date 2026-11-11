import { APP_FORM } from './form.js';
import { answerText, isRequired, isShown, visibleSections } from './rules.js';

const STORE = 'lgcy-apply-v1';
const CONTACT = 'contracting@lgcyap.com';
const MAX_UPLOAD = 3_400_000;
const REVIEW = { id: 'review', title: 'Review & Submit', note: 'One look before you send it. Use Edit to change any section.' };
// Answers that open or close other questions; changing one redraws the step.
const CONTROLS = new Set(APP_FORM.flatMap(s => s.items).filter(i => i.showIf).map(i => i.showIf.id).concat(['licenseStatus', 'everLicensed']));
const ITEMS = new Map(APP_FORM.flatMap(s => s.items.map(i => [i.id, i])));
const MESSAGES = {
  required: 'This one is required.',
  invalid: 'Please check this answer.',
  email: 'Enter an email address like name@example.com.',
  phone: 'Enter a 10-digit US mobile number.',
  zip: 'Enter a 5-digit ZIP code.',
  number: 'Enter a number, like 3 or 2.5.',
  full_name: 'Enter your first and last name.',
  too_large: 'That file is too large. Please use a photo, or a PDF under 3 MB.',
  not_supported: 'Please use a photo (JPG, PNG or HEIC) or a PDF.',
  unreadable: 'That file could not be read. Please try another photo.',
};

const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- state ----------
let saved = {};
try { saved = JSON.parse(sessionStorage.getItem(STORE) || '{}') || {}; } catch { saved = {}; }
const A = saved.answers && typeof saved.answers === 'object' ? saved.answers : {};
const startedAt = Number(saved.startedAt) || Date.now();
let current = typeof saved.step === 'string' ? saved.step : 'info';
let license = null; // { blob, name, url, kind: 'image' | 'pdf' }
let submitting = false;
let saveTimer = null;
let finished = false; // once sent, nothing is kept on the device (shared hiring-event tablets)

function persist(now = false) {
  clearTimeout(saveTimer);
  if (finished) return;
  const write = () => { if (finished) return; try { sessionStorage.setItem(STORE, JSON.stringify({ answers: A, startedAt, step: current })); } catch { /* storage full or blocked */ } };
  if (now) write(); else saveTimer = setTimeout(write, 250);
}

function forget() {
  finished = true;
  clearTimeout(saveTimer);
  try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
}

function steps() {
  return [...visibleSections(A), REVIEW];
}

// ---------- rendering ----------
const AUTOCOMPLETE = { legalName: 'name', preferred: 'nickname', email: 'email', phone: 'tel', city: 'address-level2', state: 'address-level1', zip: 'postal-code', signature: 'name' };

function label(item, forId) {
  const req = isRequired(item) ? '<span class="req" aria-hidden="true">*</span>' : '';
  return forId ? `<label class="q" for="${forId}">${esc(item.label)}${req}</label>` : `<legend class="q">${esc(item.label)}${req}</legend>`;
}

function hint(item) {
  return item.hint ? `<span class="hint" id="h-${item.id}">${esc(item.hint)}</span>` : '';
}

function described(item) {
  return `aria-describedby="${item.hint ? `h-${item.id} ` : ''}e-${item.id}"`;
}

function fieldHtml(item) {
  const v = A[item.id] ?? '';
  const err = `<p class="err" id="e-${item.id}" role="alert"></p>`;
  const width = item.type === 'long' || item.type === 'check' || item.type === 'yesno' || item.type === 'choice' || item.type === 'file' ? ' wide' : item.short ? ' short' : '';
  const req = isRequired(item) ? ' aria-required="true"' : '';
  const open = `<div class="field${width}" data-field="${item.id}">`;

  if (item.type === 'yesno') {
    const opts = ['yes', 'no'].map(o => `<label class="choice"><input type="radio" name="${item.id}" value="${o}"${v === o ? ' checked' : ''}><span class="dot" aria-hidden="true"></span>${o === 'yes' ? 'Yes' : 'No'}</label>`).join('');
    return `${open}<fieldset ${described(item)}${req}>${label(item)}${hint(item)}<div class="choices yesno">${opts}</div></fieldset>${err}</div>`;
  }
  if (item.type === 'choice') {
    const layout = item.options.length > 3 ? ' grid' : '';
    const opts = item.options.map(o => `<label class="choice"><input type="radio" name="${item.id}" value="${esc(o)}"${v === o ? ' checked' : ''}><span class="dot" aria-hidden="true"></span>${esc(o)}</label>`).join('');
    return `${open}<fieldset ${described(item)}${req}>${label(item)}${hint(item)}<div class="choices${layout}">${opts}</div></fieldset>${err}</div>`;
  }
  if (item.type === 'check') {
    return `${open}<label class="choice cb${item.label.length > 160 ? ' legal' : ''}"><input type="checkbox" name="${item.id}" value="yes"${v === 'yes' ? ' checked' : ''} ${described(item)}${req}><span class="dot" aria-hidden="true"></span><span>${esc(item.label)}${isRequired(item) ? '<span class="req" aria-hidden="true">*</span>' : ''}</span></label>${err}</div>`;
  }
  if (item.type === 'file') {
    return `${open}${label(item, `f-${item.id}`)}${hint(item)}
      <label class="drop" data-drop="${item.id}">
        <input type="file" id="f-${item.id}" name="${item.id}" accept="image/*,application/pdf,.heic,.heif" ${described(item)}${req}>
        <span class="drop-empty"${license ? ' hidden' : ''}><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8.5 6l1.4-2h4.2l1.4 2"/></svg><b>Take or choose a photo</b><small>Front of your driver's license</small></span>
        <span class="drop-busy" hidden><span class="spin" aria-hidden="true"></span>Preparing photo…</span>
        <span class="drop-full"${license ? '' : ' hidden'}>${license ? previewHtml() : ''}</span>
      </label>
      <button type="button" class="remove" data-remove="${item.id}"${license ? '' : ' hidden'}>Remove and choose another</button>${err}</div>`;
  }
  if (item.type === 'select') {
    const ac = AUTOCOMPLETE[item.id] ? ` autocomplete="${AUTOCOMPLETE[item.id]}"` : '';
    const opts = item.options.map(o => `<option value="${esc(o)}"${v === o ? ' selected' : ''}>${esc(o)}</option>`).join('');
    return `${open}${label(item, `f-${item.id}`)}${hint(item)}<select id="f-${item.id}" name="${item.id}"${ac} ${described(item)}${req}><option value=""${v ? '' : ' selected'}>Choose…</option>${opts}</select>${err}</div>`;
  }
  if (item.type === 'long') {
    return `${open}${label(item, `f-${item.id}`)}${hint(item)}<textarea id="f-${item.id}" name="${item.id}" rows="4" maxlength="3000" ${described(item)}${req}>${esc(v)}</textarea>${err}</div>`;
  }
  const type = item.type === 'email' ? 'email' : item.type === 'tel' ? 'tel' : item.type === 'date' ? 'date' : 'text';
  const extra = item.type === 'number' ? ' inputmode="decimal"' : item.id === 'zip' ? ' inputmode="numeric" maxlength="10"' : item.type === 'email' ? ' inputmode="email" autocapitalize="off" spellcheck="false"' : '';
  const ac = AUTOCOMPLETE[item.id] ? ` autocomplete="${AUTOCOMPLETE[item.id]}"` : '';
  return `${open}${label(item, `f-${item.id}`)}${hint(item)}<input type="${type}" id="f-${item.id}" name="${item.id}" value="${esc(v)}" maxlength="${item.type === 'email' ? 254 : 200}"${extra}${ac} ${described(item)}${req}>${err}</div>`;
}

function previewHtml() {
  if (!license) return '';
  if (license.kind === 'image' && license.url) return `<img src="${license.url}" alt="Your driver's license photo"><span class="drop-actions"><span class="pill">Change</span></span>`;
  return `<span class="drop-file"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><b>${esc(license.name)}</b><small>${Math.max(1, Math.round(license.blob.size / 1024))} KB · added</small></span><span class="drop-actions"><span class="pill">Change</span></span>`;
}

function sectionHtml(section, number) {
  const items = section.items.filter(i => isShown(i, A));
  return `<section class="step" aria-labelledby="h-step">
    <p class="sec-num">${String(number).padStart(2, '0')}${section.part2 ? ' · Licensed agents' : ''}</p>
    <h2 class="sec-title" id="h-step" tabindex="-1">${esc(section.part2 ? 'Part 2' : section.title)}</h2>
    ${section.note ? `<p class="sec-note">${esc(section.note)}</p>` : ''}
    <div class="sec-rule"></div>
    <div class="fields">${items.map(fieldHtml).join('')}</div>
    ${navHtml()}
  </section>`;
}

function reviewHtml() {
  const blocks = visibleSections(A).map(section => {
    const rows = section.items.filter(i => isShown(i, A) && i.type !== 'file').map(i => {
      const text = i.id === 'certify' ? (A.certify === 'yes' ? 'Certified' : '') : answerText(i, A[i.id]);
      const shortLabel = i.label.length > 110 ? i.label.slice(0, 107).trimEnd() + '…' : i.label;
      return `<div class="row"><dt>${esc(shortLabel)}</dt><dd${text ? '' : ' class="empty"'}>${text ? esc(text) : 'Not answered'}</dd></div>`;
    }).join('');
    const thumb = section.id === 'info' && license
      ? `<div class="thumbs">${license.kind === 'image' && license.url ? `<img src="${license.url}" alt="Driver's license">` : `<span class="file-chip">${esc(license.name)}</span>`}</div>` : '';
    return `<div class="review"><div class="review-head"><h3>${esc(section.part2 ? 'Part 2 · Licensed agents' : section.title)}</h3><button type="button" class="edit" data-edit="${section.id}">Edit<span class="sr-only"> ${esc(section.title)}</span></button></div><dl>${rows}</dl>${thumb}</div>`;
  }).join('');
  return `<section class="step" aria-labelledby="h-step">
    <h2 class="sec-title" id="h-step" tabindex="-1">Review &amp; Submit</h2>
    <p class="sec-note">${esc(REVIEW.note)}</p>
    <div class="sec-rule"></div>
    ${blocks}
    <div id="submitError" class="submit-error" role="alert" hidden></div>
    ${navHtml()}
  </section>`;
}

function navHtml() {
  const list = steps();
  const index = list.findIndex(s => s.id === current);
  const last = index === list.length - 1;
  const back = index > 0 ? '<button type="button" class="btn-back" data-nav="back">Back</button>' : '';
  const next = last
    ? `<button type="submit" class="btn-next" id="submitBtn"${submitting ? ' disabled' : ''}>${submitting ? 'Sending…' : 'Submit my application'}</button>`
    : `<button type="button" class="btn-next" data-nav="next">${index === list.length - 2 ? 'Review' : 'Continue'}</button>`;
  return `<div class="nav">${back}<span class="spacer"></span>${next}</div>`;
}

function render({ focus = true, keep } = {}) {
  const list = steps();
  let index = list.findIndex(s => s.id === current);
  if (index < 0) { current = list[0].id; index = 0; }
  const step = list[index];
  $('#step').innerHTML = step.id === 'review' ? reviewHtml() : sectionHtml(step, index + 1);
  $('#intro').hidden = index !== 0;
  $('#stepName').textContent = step.part2 ? 'Part 2 · Licensed agents' : step.title;
  $('#stepCount').textContent = `Step ${index + 1} of ${list.length}`;
  const bar = $('#bar');
  bar.setAttribute('aria-valuenow', String(index + 1));
  bar.setAttribute('aria-valuemax', String(list.length));
  bar.firstElementChild.style.width = `${((index + 1) / list.length) * 100}%`;
  if (keep) {
    const el = document.querySelector(keep);
    if (el) el.focus({ preventScroll: true });
  } else if (focus) {
    $('#h-step')?.focus({ preventScroll: true });
    $('#progress').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  persist();
}

// ---------- validation ----------
function check(item) {
  const v = A[item.id];
  if (item.type === 'file') return license ? '' : 'required';
  const empty = v === undefined || v === '' || (item.type === 'check' && v !== 'yes');
  if (empty) return isRequired(item) ? 'required' : '';
  const s = String(v).trim();
  if (item.type === 'email' && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s)) return 'email';
  if (item.type === 'tel') {
    let d = s.replace(/\D/g, '');
    if (d.length === 11 && d[0] === '1') d = d.slice(1);
    if (d.length !== 10 || /^[01]/.test(d) || /^\d{3}[01]/.test(d) || /[^\d\s().+-]/.test(s)) return 'phone';
  }
  if (item.type === 'number' && !/^\d{1,4}(\.\d{1,2})?$/.test(s)) return 'number';
  if (item.id === 'zip' && !/^\d{5}(-\d{4})?$/.test(s)) return 'zip';
  if (item.id === 'legalName' && s.split(/\s+/).filter(Boolean).length < 2) return 'full_name';
  return '';
}

function showError(id, code) {
  const field = document.querySelector(`[data-field="${id}"]`);
  if (!field) return;
  field.classList.toggle('invalid', Boolean(code));
  const err = $(`#e-${id}`, field);
  if (err) err.textContent = code ? (MESSAGES[code] ?? MESSAGES.invalid) : '';
  field.querySelectorAll('input:not([type=radio]):not([type=checkbox]), textarea, fieldset, input[type=checkbox]').forEach(el => el.setAttribute('aria-invalid', code ? 'true' : 'false'));
}

function validateStep(stepId) {
  const section = APP_FORM.find(s => s.id === stepId);
  if (!section) return true;
  let first = null;
  for (const item of section.items.filter(i => isShown(i, A))) {
    const code = check(item);
    showError(item.id, code);
    if (code && !first) first = item.id;
  }
  if (first) focusField(first);
  return !first;
}

function focusField(id) {
  const field = document.querySelector(`[data-field="${id}"]`);
  if (!field) return;
  field.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const control = field.querySelector('input:not([type=hidden]), select, textarea');
  if (control) setTimeout(() => control.focus({ preventScroll: true }), 250);
}

function go(stepId) {
  current = stepId;
  render();
}

function move(delta) {
  const list = steps();
  const index = list.findIndex(s => s.id === current);
  if (delta > 0 && !validateStep(current)) return;
  const next = list[index + delta];
  if (next) go(next.id);
}

// ---------- input ----------
const form = $('#form');

form.addEventListener('input', event => {
  const t = event.target;
  if (!t.name || t.name === 'website' || t.type === 'file') return;
  if (t.type === 'radio' || t.type === 'checkbox') return;
  A[t.name] = t.value;
  if (document.querySelector(`[data-field="${t.name}"].invalid`)) showError(t.name, check(ITEMS.get(t.name)));
  persist();
});

form.addEventListener('change', async event => {
  const t = event.target;
  if (!t.name || t.name === 'website') return;
  if (t.type === 'file') { await addFile(t); return; }
  if (t.type === 'radio') A[t.name] = t.value;
  else if (t.type === 'checkbox') A[t.name] = t.checked ? 'yes' : '';
  else return;
  // Onboard opens Part 2 automatically for a licensed answer.
  if (CONTROLS.has(t.name)) {
    const selector = t.type === 'radio' ? `input[name="${t.name}"][value="${CSS.escape(t.value)}"]` : `input[name="${t.name}"]`;
    render({ keep: selector });
  } else {
    showError(t.name, document.querySelector(`[data-field="${t.name}"].invalid`) ? check(ITEMS.get(t.name)) : '');
    persist();
  }
});

form.addEventListener('click', event => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { move(nav.dataset.nav === 'next' ? 1 : -1); return; }
  const edit = event.target.closest('[data-edit]');
  if (edit) { go(edit.dataset.edit); return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) { clearLicense(); render({ keep: '#f-dlPhoto' }); }
});

form.addEventListener('submit', event => {
  event.preventDefault();
  if (current === 'review') submit();
  else move(1);
});

// ---------- license file ----------
// A stalled decode or encode must never leave someone stuck on "Preparing photo".
function withTimeout(promise, ms = 10000) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

function toBlob(canvas, quality) {
  return withTimeout(new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality)));
}

// Re-encode photos to a JPEG no larger than 1800px on the long edge, so uploads stay small on
// event Wi-Fi and under the server limit. Browsers apply EXIF rotation when drawing.
async function prepareImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await withTimeout(img.decode());
    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    let blob = await toBlob(canvas, 0.86);
    if (blob && blob.size > 1_800_000) blob = await toBlob(canvas, 0.7);
    if (!blob || blob.size < 2000) throw new Error('encode');
    return { blob, name: 'drivers-license.jpg', kind: 'image', url: URL.createObjectURL(blob) };
  } catch {
    // Some browsers cannot decode HEIC. Send the original if it is small enough; the server
    // checks the file type itself.
    if (file.size <= MAX_UPLOAD && /^image\/|\.(heic|heif)$/i.test(file.type || file.name)) return { blob: file, name: file.name.slice(-80) || 'drivers-license', kind: 'file' };
    throw new Error(file.size > MAX_UPLOAD ? 'too_large' : 'unreadable');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clearLicense() {
  if (license?.url) URL.revokeObjectURL(license.url);
  license = null;
}

async function addFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const id = input.name;
  const drop = document.querySelector(`[data-drop="${id}"]`);
  drop.querySelector('.drop-empty').hidden = true;
  drop.querySelector('.drop-full').hidden = true;
  drop.querySelector('.drop-busy').hidden = false;
  showError(id, '');
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      if (file.size > MAX_UPLOAD) throw new Error('too_large');
      clearLicense();
      license = { blob: file, name: file.name.slice(-80) || 'drivers-license.pdf', kind: 'pdf' };
    } else {
      const prepared = await prepareImage(file);
      clearLicense();
      license = prepared;
    }
    render({ keep: '#f-dlPhoto' });
  } catch (error) {
    render({ keep: '#f-dlPhoto' });
    showError(id, MESSAGES[error.message] ? error.message : 'unreadable');
  }
}

// ---------- submit ----------
function showSubmitError(html) {
  const box = $('#submitError');
  if (!box) return;
  box.innerHTML = html;
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function submit() {
  if (submitting) return;
  const list = steps();
  for (const section of list.slice(0, -1)) {
    const missing = section.items.filter(i => isShown(i, A)).some(i => check(i));
    if (missing) { go(section.id); setTimeout(() => validateStep(section.id), 50); return; }
  }
  submitting = true;
  render({ focus: false });

  const answers = {};
  for (const section of visibleSections(A)) {
    for (const item of section.items) if (item.type !== 'file' && isShown(item, A) && A[item.id] !== undefined && A[item.id] !== '') answers[item.id] = A[item.id];
  }
  const data = new FormData();
  data.append('answers', JSON.stringify(answers));
  if (license) data.append('dlPhoto', license.blob, license.name);
  data.append('website', form.elements.website.value);
  data.append('elapsedMs', String(Date.now() - startedAt));

  let response;
  let body = null;
  try {
    response = await fetch('/api/submit', { method: 'POST', body: data, headers: { Accept: 'application/json' } });
    body = await response.json().catch(() => null);
  } catch {
    response = null;
  }
  submitting = false;

  if (response && response.ok && body && body.ok) { showDone(body); return; }
  render({ focus: false });
  if (response && response.status === 422 && body && body.fields) {
    const ids = Object.keys(body.fields);
    const target = list.find(s => s.items?.some(i => ids.includes(i.id)));
    if (target) {
      go(target.id);
      setTimeout(() => ids.forEach(id => showError(id, body.fields[id] === 'invalid' && ITEMS.get(id)?.type === 'tel' ? 'phone' : body.fields[id])), 60);
      return;
    }
  }
  if (response && response.status === 413) { go('info'); setTimeout(() => showError('dlPhoto', 'too_large'), 60); return; }
  showSubmitError(`<b>We could not send your application just now.</b> Your answers are still here. Please try again in a minute. If it keeps happening, email <a href="mailto:${CONTACT}">${CONTACT}</a>.`);
}

function showDone(result) {
  const first = String(A.preferred || A.legalName || '').trim().split(/\s+/)[0] || 'there';
  const failed = Array.isArray(result.failed) ? result.failed : [];
  forget();
  const tick = '<div class="tick" aria-hidden="true"><svg width="32" height="24" viewBox="0 0 30 22" fill="none"><path d="M2 11l9 9L28 2" stroke="#D4AF37" stroke-width="3" stroke-linecap="square"/></svg></div>';
  $('#done').innerHTML = result.pass
    ? `<div class="done">${tick}<h2 tabindex="-1">Thank you, <span class="gold">${esc(first)}</span>.</h2>
        <p>Your application is in. Our contracting &amp; licensing team will reach out within the next 24-48 business hours for the next steps.</p>
        <p class="next">Questions? Please email <a href="mailto:${CONTACT}">${CONTACT}</a></p>
        <button type="button" class="btn-back again" id="again">Start a new application</button></div>`
    : `<div class="done"><h2 tabindex="-1">Thank you, <span class="gold">${esc(first)}</span>.</h2>
        <p>We reviewed your answers and we are not able to move forward at this time, because the role requires ${esc(failed.join('; '))}.</p>
        <p>If that changes, you are welcome to apply again.</p>
        <button type="button" class="btn-back again" id="again">Start a new application</button></div>`;
  form.hidden = true;
  $('#progress').hidden = true;
  $('#intro').hidden = true;
  $('#done').hidden = false;
  $('#done h2').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('#again').addEventListener('click', () => { clearLicense(); window.location.reload(); });
}

render({ focus: false });
