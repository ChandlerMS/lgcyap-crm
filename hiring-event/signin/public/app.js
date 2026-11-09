(() => {
  'use strict';

  const STEP_TITLES = ['Your Information', 'About You', "Driver's License", 'Review & Submit'];
  const OFFICES = { orlando: 'Orlando', miami: 'Miami', tampa: 'Tampa' };
  const HEARD = {
    referral: 'Referred by someone I know', indeed: 'Indeed', facebook: 'Facebook', instagram: 'Instagram',
    linkedin: 'LinkedIn', tiktok: 'TikTok', google: 'Google search', ziprecruiter: 'ZipRecruiter',
    job_fair: 'Job fair or event', other: 'Other',
  };
  const STEP_FIELDS = [
    ['firstName', 'lastName', 'email', 'phone', 'office'],
    ['heardAbout', 'referredBy', 'heardAboutOther', 'licenseStatus', 'contractedBefore', 'npn'],
    ['licenseFront', 'licenseBack', 'consent'],
    [],
  ];
  const MESSAGES = {
    firstName: { required: 'Enter your first name.', invalid: 'Use letters only.' },
    lastName: { required: 'Enter your last name.', invalid: 'Use letters only.' },
    email: { required: 'Enter your email address.', invalid: 'Enter a valid email, like name@email.com.' },
    phone: { required: 'Enter your mobile number.', invalid: 'Enter a 10-digit US phone number.' },
    office: { required: 'Choose an office.' },
    heardAbout: { required: 'Choose one.' },
    referredBy: { required: 'Enter the name of the person who referred you.', invalid: 'Keep it under 120 characters.' },
    heardAboutOther: { required: 'Tell us where you heard about us.', invalid: 'Keep it under 120 characters.' },
    licenseStatus: { required: 'Choose Licensed or Unlicensed.' },
    contractedBefore: { required: 'Choose Yes or No.' },
    npn: { invalid: 'Your NPN is numbers only, up to 10 digits.' },
    licenseFront: { required: 'Add a photo of the front of your license.' },
    consent: { required: 'Check this box so we can keep your license on file.' },
  };
  const FILE_MESSAGES = {
    too_large: 'That photo is too large. Try taking a new one.',
    not_image: 'We could not read that file. Please take a photo or choose a JPG or PNG.',
    unreadable: 'We could not read that photo. Please take a new photo or choose a JPG.',
    invalid: 'We could not read that photo. Please take a new photo.',
  };

  const form = document.getElementById('form');
  const steps = [...form.querySelectorAll('.step')];
  const params = new URLSearchParams(location.search);
  const source = ['room', 'lobby'].includes(params.get('s')) ? params.get('s') : 'direct';
  const files = { licenseFront: null, licenseBack: null };
  let started = performance.now();
  let current = 0;
  let submitting = false;

  const $ = id => document.getElementById(id);
  const value = name => {
    const el = form.elements[name];
    if (!el) return '';
    if (el instanceof RadioNodeList) return el.value;
    if (el.type === 'checkbox') return el.checked ? el.value : '';
    return el.value.trim().replace(/\s+/g, ' ');
  };

  // ---------- conditional fields ----------
  function applyConditions() {
    form.querySelectorAll('[data-show-if]').forEach(el => {
      const [name, expected] = el.dataset.showIf.split('=');
      const show = value(name) === expected;
      el.hidden = !show;
      if (!show) el.classList.remove('invalid');
    });
  }
  form.addEventListener('change', event => {
    if (event.target.name) {
      applyConditions();
      const field = event.target.closest('.field');
      if (field?.classList.contains('invalid')) validateField(field.dataset.field);
    }
  });

  // ---------- phone formatting ----------
  const phone = $('phone');
  phone.addEventListener('input', () => {
    let d = phone.value.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    d = d.slice(0, 10);
    const pretty = d.length > 6 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d.length > 3 ? `(${d.slice(0, 3)}) ${d.slice(3)}` : d;
    if (phone.value !== pretty && !/[a-z]/i.test(phone.value)) phone.value = pretty;
  });

  // ---------- validation (mirrors the server) ----------
  const NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .,-]*$/u;
  const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
  function phoneOk(v) {
    let d = v.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    return d.length === 10 && !/^[01]/.test(d) && !/^\d{3}[01]/.test(d);
  }

  function check(name) {
    const v = value(name);
    switch (name) {
      case 'firstName': case 'lastName': return !v ? 'required' : !NAME.test(v) ? 'invalid' : null;
      case 'email': return !v ? 'required' : !EMAIL.test(v.toLowerCase()) ? 'invalid' : null;
      case 'phone': return !v ? 'required' : !phoneOk(v) ? 'invalid' : null;
      case 'office': case 'heardAbout': case 'licenseStatus': case 'contractedBefore': return v ? null : 'required';
      case 'referredBy': case 'heardAboutOther': return !v ? 'required' : v.length > 120 ? 'invalid' : null;
      case 'npn': return v && !/^\d{1,10}$/.test(v.replace(/[\s-]/g, '')) ? 'invalid' : null;
      case 'licenseFront': return files.licenseFront ? null : 'required';
      case 'consent': return v ? null : 'required';
      default: return null;
    }
  }

  function fieldEl(name) { return form.querySelector(`.field[data-field="${name}"]`); }

  function showError(name, code) {
    const field = fieldEl(name);
    if (!field) return;
    const message = code ? (MESSAGES[name]?.[code] ?? FILE_MESSAGES[code] ?? 'Check this answer.') : '';
    field.classList.toggle('invalid', Boolean(code));
    const err = $(`err-${name}`);
    if (err) err.textContent = message;
    field.querySelectorAll('input').forEach(input => {
      if (input.type !== 'radio' || input === field.querySelector('input')) input.setAttribute('aria-invalid', code ? 'true' : 'false');
    });
  }

  function validateField(name) {
    const field = fieldEl(name);
    if (!field || field.hidden || field.closest('[hidden]:not(.step)')) { showError(name, null); return true; }
    const code = check(name);
    showError(name, code);
    return !code;
  }

  function validateStep(index) {
    let first = null;
    for (const name of STEP_FIELDS[index]) {
      if (!validateField(name) && !first) first = name;
    }
    if (first) focusField(first);
    return !first;
  }

  function focusField(name) {
    const field = fieldEl(name);
    const input = field?.querySelector('input:not([type=hidden])');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 250);
  }

  form.addEventListener('focusout', event => {
    const field = event.target.closest('.field');
    if (field && ['text', 'email', 'tel'].includes(event.target.type) && event.target.value) validateField(field.dataset.field);
  });

  // ---------- steps ----------
  function showStep(index, { focus = true } = {}) {
    current = index;
    steps.forEach((step, i) => { step.hidden = i !== index; });
    $('intro').hidden = index !== 0;
    $('stepName').textContent = STEP_TITLES[index];
    $('stepCount').textContent = `Step ${index + 1} of ${steps.length}`;
    $('bar').setAttribute('aria-valuenow', String(index + 1));
    $('bar').firstElementChild.style.width = `${((index + 1) / steps.length) * 100}%`;
    if (index === 3) buildReview();
    if (focus) {
      $('card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $(`h-step${index}`).focus({ preventScroll: true }), 50);
    }
  }

  form.addEventListener('click', event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      if (nav.dataset.nav === 'next' && validateStep(current)) showStep(current + 1);
      if (nav.dataset.nav === 'back') showStep(Math.max(0, current - 1));
      return;
    }
    const edit = event.target.closest('[data-edit]');
    if (edit) showStep(Number(edit.dataset.edit));
    const remove = event.target.closest('[data-remove]');
    if (remove) clearFile(remove.dataset.remove);
  });

  // Enter in a text box moves forward instead of submitting early.
  form.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('input[type=text], input[type=email], input[type=tel]')) {
      event.preventDefault();
      if (current < 3 && validateStep(current)) showStep(current + 1);
    }
  });

  // ---------- license photos ----------
  // Decoding and encoding can stall while the page is hidden (for example while the
  // phone's camera is open), so every step gives up after 10 seconds.
  function withTimeout(promise, ms = 10000) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  }

  function toBlob(canvas, quality) {
    return withTimeout(new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality)));
  }

  // Re-encode to a JPEG no larger than 1800px on its long edge, so uploads stay small
  // on event Wi-Fi and under the server's limit. Browsers apply EXIF rotation when drawing.
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
      return { blob, preview: true };
    } catch {
      // Some browsers cannot decode HEIC. Send the original if it is small enough;
      // the server checks the file type itself.
      if (file.size <= 2_000_000 && /^image\//.test(file.type)) return { blob: file, preview: false };
      throw new Error(file.size > 2_000_000 ? 'too_large' : 'unreadable');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function setDropState(name, state) {
    const drop = form.querySelector(`[data-drop="${name}"]`);
    drop.querySelector('.drop-empty').hidden = state !== 'empty';
    drop.querySelector('.drop-full').hidden = state !== 'full';
    drop.querySelector('.drop-busy').hidden = state !== 'busy';
    drop.classList.toggle('filled', state === 'full');
    form.querySelector(`[data-remove="${name}"]`).hidden = state !== 'full';
  }

  function clearFile(name) {
    if (files[name]?.url) URL.revokeObjectURL(files[name].url);
    files[name] = null;
    $(name).value = '';
    const img = form.querySelector(`[data-drop="${name}"] .drop-full img`);
    img.removeAttribute('src');
    setDropState(name, 'empty');
  }

  ['licenseFront', 'licenseBack'].forEach(name => {
    const input = $(name);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      setDropState(name, 'busy');
      showError(name, null);
      try {
        const { blob, preview } = await prepareImage(file);
        if (files[name]?.url) URL.revokeObjectURL(files[name].url);
        const url = URL.createObjectURL(blob);
        files[name] = { blob, url, preview };
        const img = form.querySelector(`[data-drop="${name}"] .drop-full img`);
        img.src = preview ? url : '/photo-added.svg';
        setDropState(name, 'full');
      } catch (error) {
        clearFile(name);
        showError(name, error.message in FILE_MESSAGES ? error.message : 'unreadable');
      }
    });
  });

  // ---------- review ----------
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

  function buildReview() {
    const licensed = value('licenseStatus') === 'licensed';
    const heard = value('heardAbout') === 'referral' ? `${HEARD.referral} — ${value('referredBy')}`
      : value('heardAbout') === 'other' ? `Other — ${value('heardAboutOther')}` : HEARD[value('heardAbout')];
    const groups = [
      { step: 0, title: 'Your Information', rows: [
        ['Name', `${value('firstName')} ${value('lastName')}`], ['Email', value('email').toLowerCase()],
        ['Mobile phone', value('phone')], ['Office', OFFICES[value('office')]],
      ] },
      { step: 1, title: 'About You', rows: [
        ['How you heard about us', heard],
        ['Florida life license', licensed ? 'Licensed' : 'Unlicensed'],
        ...(licensed ? [['Contracted with an agency before', value('contractedBefore') === 'yes' ? 'Yes' : 'No'], ['NPN', value('npn') || 'Not given']] : []),
      ] },
    ];
    let html = groups.map(g => `<div class="review"><div class="review-head"><h3>${esc(g.title)}</h3><button type="button" class="edit" data-edit="${g.step}">Edit<span class="sr"> ${esc(g.title)}</span></button></div><dl>${
      g.rows.map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></div>`).join('');
    const thumbs = ['licenseFront', 'licenseBack'].filter(n => files[n]).map(n => `<img src="${files[n].preview ? files[n].url : '/photo-added.svg'}" alt="${n === 'licenseFront' ? 'Front' : 'Back'} of license">`).join('');
    html += `<div class="review"><div class="review-head"><h3>Driver's License</h3><button type="button" class="edit" data-edit="2">Edit<span class="sr"> driver's license</span></button></div><div class="thumbs">${thumbs}</div></div>`;
    $('review').innerHTML = html;
  }

  // ---------- submit ----------
  const SUBMIT_MESSAGES = {
    CLOSED: '<b>Sign-in is closed right now.</b> Please let a team member know you are here.',
    NOT_CONFIGURED: '<b>Sign-in is not connected yet.</b> Please let a team member know you are here.',
    HUBSPOT_ACCESS: '<b>Sign-in is not connected yet.</b> Please let a team member know you are here.',
    TOO_LARGE: '<b>Your photos are too large to send.</b> Go back and take new photos of your license.',
    FORBIDDEN: '<b>This page needs a refresh.</b> Reload the page and try again.',
  };
  const RETRY_MESSAGE = '<b>We could not save your sign-in.</b> Check your connection and tap Submit again. If it keeps failing, let a team member know you are here.';

  function showSubmitError(html) {
    const box = $('submitError');
    box.innerHTML = html;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || current !== 3) return;
    for (let i = 0; i < 3; i += 1) {
      if (!validateStep(i)) { showStep(i); validateStep(i); return; }
    }
    submitting = true;
    const button = $('submitBtn');
    button.disabled = true;
    button.textContent = 'Submitting…';
    $('submitError').hidden = true;

    const data = new FormData();
    ['firstName', 'lastName', 'email', 'phone', 'office', 'heardAbout', 'licenseStatus', 'consent', 'website'].forEach(n => data.append(n, value(n)));
    if (value('heardAbout') === 'referral') data.append('referredBy', value('referredBy'));
    if (value('heardAbout') === 'other') data.append('heardAboutOther', value('heardAboutOther'));
    if (value('licenseStatus') === 'licensed') { data.append('contractedBefore', value('contractedBefore')); data.append('npn', value('npn')); }
    data.append('source', source);
    data.append('elapsedMs', String(Math.round(performance.now() - started)));
    data.append('licenseFront', files.licenseFront.blob, 'license-front.jpg');
    if (files.licenseBack) data.append('licenseBack', files.licenseBack.blob, 'license-back.jpg');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch('/api/submit', { method: 'POST', body: data, signal: controller.signal, credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) { showDone(); return; }
      if (response.status === 422 && body.fields) {
        let firstStep = null;
        for (const [name, code] of Object.entries(body.fields)) {
          showError(name, code);
          const step = STEP_FIELDS.findIndex(list => list.includes(name));
          if (step >= 0 && (firstStep === null || step < firstStep)) firstStep = step;
        }
        if (firstStep !== null) { showStep(firstStep); setTimeout(() => focusField(Object.keys(body.fields).find(n => STEP_FIELDS[firstStep].includes(n))), 300); }
        return;
      }
      if (response.status === 413) { showSubmitError(SUBMIT_MESSAGES.TOO_LARGE); return; }
      showSubmitError(SUBMIT_MESSAGES[body.code] ?? RETRY_MESSAGE);
    } catch {
      showSubmitError(RETRY_MESSAGE);
    } finally {
      clearTimeout(timer);
      submitting = false;
      button.disabled = false;
      button.textContent = 'Submit Sign In';
    }
  });

  function showDone() {
    form.hidden = true;
    $('progress').hidden = true;
    $('intro').hidden = true;
    const first = value('firstName');
    $('doneTitle').innerHTML = `You Are <span class="gold">Checked In</span>`;
    $('doneLine1').textContent = source === 'lobby'
      ? `Thanks${first ? `, ${first}` : ''} — your sign-in is in. Head up to the 4th floor and our team will meet you there.`
      : `Thanks${first ? `, ${first}` : ''} — your sign-in is in. A member of the Legacy team will be with you shortly.`;
    // Drop the license photos from memory now that they are sent.
    ['licenseFront', 'licenseBack'].forEach(clearFile);
    $('done').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('doneTitle').focus({ preventScroll: true }), 50);
  }

  $('again').addEventListener('click', () => {
    form.reset();
    ['licenseFront', 'licenseBack'].forEach(clearFile);
    form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
    $('review').innerHTML = '';
    $('submitError').hidden = true;
    $('done').hidden = true;
    form.hidden = false;
    $('progress').hidden = false;
    started = performance.now();
    applyConditions();
    showStep(0, { focus: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('firstName').focus({ preventScroll: true });
  });

  applyConditions();
  showStep(0, { focus: false });
})();
