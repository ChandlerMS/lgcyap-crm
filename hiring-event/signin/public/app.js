(() => {
  'use strict';

  const APPLY_URL = 'https://lgcyap-apply.vercel.app/';
  const OFFICES = { orlando: 'Orlando', miami: 'Miami' };
  // Every question, in page order. Hidden ones are skipped when checking.
  const FIELDS = ['firstName', 'lastName', 'email', 'phone', 'office', 'heardAbout', 'referredBy', 'heardAboutDetail', 'jobDetail',
    'heardAboutOther', 'licenseStatus', 'contractedBefore', 'contractedWith', 'npn', 'photoId', 'consent'];
  const MESSAGES = {
    firstName: { required: 'Enter your first name.', invalid: 'Use letters only.' },
    lastName: { required: 'Enter your last name.', invalid: 'Use letters only.' },
    email: { required: 'Enter your email address.', invalid: 'Enter a valid email, like name@email.com.' },
    phone: { required: 'Enter your mobile number.', invalid: 'Enter a 10-digit US phone number.' },
    office: { required: 'Choose an office.' },
    heardAbout: { required: 'Choose one.' },
    referredBy: { required: 'Choose who referred you, or pick Other and type their name.', invalid: 'Keep it under 120 characters.' },
    heardAboutDetail: { required: 'Choose one.' },
    jobDetail: { required: 'Choose one.' },
    heardAboutOther: { required: 'Tell us where you heard about us.', invalid: 'Keep it under 120 characters.' },
    licenseStatus: { required: 'Choose Licensed or Unlicensed.' },
    contractedBefore: { required: 'Choose Yes or No.' },
    contractedWith: { required: 'Tell us who you are contracted with.', invalid: 'Keep it under 120 characters.' },
    npn: { invalid: 'Your NPN is numbers only, up to 10 digits.' },
    photoId: { required: 'Add a photo of your ID.' },
    consent: { required: 'Check this box so we can keep your ID on file for building security.' },
  };
  const FILE_MESSAGES = {
    too_large: 'That photo is too large. Try taking a new one.',
    not_image: 'We could not read that file. Please take a photo or choose a JPG or PNG.',
    unreadable: 'We could not read that photo. Please take a new photo or choose a JPG.',
    invalid: 'We could not read that photo. Please take a new photo.',
  };

  const form = document.getElementById('form');
  const params = new URLSearchParams(location.search);
  const source = ['room', 'lobby'].includes(params.get('s')) ? params.get('s') : 'direct';
  let photo = null;
  let started = performance.now();
  let submitting = false;

  const $ = id => document.getElementById(id);
  const value = name => {
    const el = form.elements[name];
    if (!el) return '';
    if (el instanceof RadioNodeList) return el.value;
    if (el.type === 'checkbox') return el.checked ? el.value : '';
    return el.value.trim().replace(/\s+/g, ' ');
  };
  const referredBy = () => (value('referredAgent') === '__other' ? value('referredByOther') : value('referredAgent'));
  const heardDetail = () => (value('heardAbout') === 'social' ? value('socialDetail') : value('heardAbout') === 'job_posting' ? value('jobDetail') : '');

  // ---------- agent roster for in-house referrals ----------
  fetch('/roster.json', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(data => {
      const names = Array.isArray(data?.agents) ? data.agents.filter(n => typeof n === 'string') : [];
      const select = $('referredAgent');
      const other = select.querySelector('option[value="__other"]');
      for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.insertBefore(option, other);
      }
    })
    .catch(() => { /* "Other (type a name)" still works */ });

  // ---------- conditional questions ----------
  // A question shows when its trigger has the expected answer and the trigger itself is showing.
  function applyConditions() {
    form.querySelectorAll('[data-show-if]').forEach(el => {
      const [name, expected] = el.dataset.showIf.split('=');
      const trigger = form.querySelector(`[data-field="${name}"]`);
      const show = value(name) === expected && !(trigger && trigger.hidden);
      el.hidden = !show;
      if (!show) el.classList.remove('invalid');
    });
    $('referredByOther').hidden = value('referredAgent') !== '__other';
  }
  form.addEventListener('change', event => {
    if (!event.target.name) return;
    applyConditions();
    const field = event.target.closest('.field');
    if (field?.classList.contains('invalid')) validateField(field.dataset.field);
    if (event.target.id === 'referredAgent' && value('referredAgent') === '__other') $('referredByOther').focus();
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
  const textCheck = v => (!v ? 'required' : v.length > 120 ? 'invalid' : null);

  function check(name) {
    switch (name) {
      case 'firstName': case 'lastName': { const v = value(name); return !v ? 'required' : !NAME.test(v) ? 'invalid' : null; }
      case 'email': { const v = value(name); return !v ? 'required' : !EMAIL.test(v.toLowerCase()) ? 'invalid' : null; }
      case 'phone': { const v = value(name); return !v ? 'required' : !phoneOk(v) ? 'invalid' : null; }
      case 'office': case 'heardAbout': case 'licenseStatus': case 'contractedBefore': return value(name) ? null : 'required';
      case 'heardAboutDetail': return value('socialDetail') ? null : 'required';
      case 'jobDetail': return value('jobDetail') ? null : 'required';
      case 'referredBy': return textCheck(referredBy());
      case 'heardAboutOther': case 'contractedWith': return textCheck(value(name));
      case 'npn': { const v = value(name); return v && !/^\d{1,10}$/.test(v.replace(/[\s-]/g, '')) ? 'invalid' : null; }
      case 'photoId': return photo ? null : 'required';
      case 'consent': return value(name) ? null : 'required';
      default: return null;
    }
  }

  const fieldEl = name => form.querySelector(`.field[data-field="${name}"]`);

  function showError(name, code) {
    // The server reports social and job-posting choices as one field.
    if (name === 'heardAboutDetail' && value('heardAbout') === 'job_posting') name = 'jobDetail';
    const field = fieldEl(name);
    if (!field) return;
    const message = code ? (MESSAGES[name]?.[code] ?? FILE_MESSAGES[code] ?? 'Check this answer.') : '';
    field.classList.toggle('invalid', Boolean(code));
    const err = $(`err-${name}`);
    if (err) err.textContent = message;
    field.querySelectorAll('input, select').forEach(input => {
      if (input.type !== 'radio' || input === field.querySelector('input')) input.setAttribute('aria-invalid', code ? 'true' : 'false');
    });
  }

  function validateField(name) {
    const field = fieldEl(name);
    if (!field || field.hidden) { showError(name, null); return true; }
    const code = check(name);
    showError(name, code);
    return !code;
  }

  function validateAll() {
    let first = null;
    for (const name of FIELDS) if (!validateField(name) && !first) first = name;
    if (first) focusField(first);
    return !first;
  }

  function focusField(name) {
    const field = fieldEl(name);
    const input = field?.querySelector('input:not([type=hidden]):not([hidden]), select');
    field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 250);
  }

  form.addEventListener('focusout', event => {
    const field = event.target.closest('.field');
    if (field && ['text', 'email', 'tel'].includes(event.target.type) && event.target.value) validateField(field.dataset.field);
  });

  form.addEventListener('click', event => {
    if (event.target.closest('[data-remove]')) clearPhoto();
  });

  // ---------- photo ID ----------
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

  function setDropState(state) {
    const drop = form.querySelector('[data-drop="photoId"]');
    drop.querySelector('.drop-empty').hidden = state !== 'empty';
    drop.querySelector('.drop-full').hidden = state !== 'full';
    drop.querySelector('.drop-busy').hidden = state !== 'busy';
    drop.classList.toggle('filled', state === 'full');
    form.querySelector('[data-remove="photoId"]').hidden = state !== 'full';
  }

  function clearPhoto() {
    if (photo?.url) URL.revokeObjectURL(photo.url);
    photo = null;
    $('photoId').value = '';
    form.querySelector('[data-drop="photoId"] .drop-full img').removeAttribute('src');
    setDropState('empty');
  }

  $('photoId').addEventListener('change', async () => {
    const file = $('photoId').files?.[0];
    if (!file) return;
    setDropState('busy');
    showError('photoId', null);
    try {
      const prepared = await prepareImage(file);
      if (photo?.url) URL.revokeObjectURL(photo.url);
      photo = { ...prepared, url: URL.createObjectURL(prepared.blob) };
      form.querySelector('[data-drop="photoId"] .drop-full img').src = photo.preview ? photo.url : '/photo-added.svg';
      setDropState('full');
    } catch (error) {
      clearPhoto();
      showError('photoId', error.message in FILE_MESSAGES ? error.message : 'unreadable');
    }
  });

  // ---------- submit ----------
  const SUBMIT_MESSAGES = {
    CLOSED: '<b>Sign-in is closed right now.</b> Please let a team member know you are here.',
    NOT_CONFIGURED: '<b>Sign-in is not connected yet.</b> Please let a team member know you are here.',
    HUBSPOT_ACCESS: '<b>Sign-in is not connected yet.</b> Please let a team member know you are here.',
    TOO_LARGE: '<b>Your photo is too large to send.</b> Take a new photo of your ID.',
    FORBIDDEN: '<b>This page needs a refresh.</b> Reload the page and try again.',
  };
  const RETRY_MESSAGE = '<b>We could not save your sign-in.</b> Check your connection and tap Sign In again. If it keeps failing, let a team member know you are here.';

  function showSubmitError(html) {
    const box = $('submitError');
    box.innerHTML = html;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    applyConditions();
    if (!validateAll()) return;
    submitting = true;
    const button = $('submitBtn');
    button.disabled = true;
    button.textContent = 'Signing in…';
    $('submitError').hidden = true;

    const data = new FormData();
    ['firstName', 'lastName', 'email', 'phone', 'office', 'heardAbout', 'licenseStatus', 'consent', 'website'].forEach(n => data.append(n, value(n)));
    if (value('heardAbout') === 'referral') data.append('referredBy', referredBy());
    if (heardDetail()) data.append('heardAboutDetail', heardDetail());
    if (value('heardAbout') === 'other') data.append('heardAboutOther', value('heardAboutOther'));
    if (value('licenseStatus') === 'licensed') {
      data.append('contractedBefore', value('contractedBefore'));
      if (value('contractedBefore') === 'yes') data.append('contractedWith', value('contractedWith'));
      data.append('npn', value('npn'));
    }
    data.append('source', source);
    data.append('elapsedMs', String(Math.round(performance.now() - started)));
    data.append('photoId', photo.blob, 'photo-id.jpg');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70000);
    try {
      const response = await fetch('/api/submit', { method: 'POST', body: data, signal: controller.signal, credentials: 'same-origin' });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok) { showDone(); return; }
      if (response.status === 422 && body.fields) {
        const names = Object.keys(body.fields);
        for (const name of names) showError(name, body.fields[name]);
        const first = FIELDS.find(n => names.includes(n)) ?? names[0];
        if (first) focusField(first);
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
      button.textContent = 'Sign In';
    }
  });

  // The application opens with what was entered here. The details travel in the link's #fragment,
  // which browsers never send to a server, and the application removes it from the address bar.
  function applicationLink() {
    const prefill = {
      legalName: `${value('firstName')} ${value('lastName')}`,
      email: value('email').toLowerCase(),
      phone: value('phone'),
      office: OFFICES[value('office')] ?? '',
    };
    if (value('licenseStatus') === 'licensed' && value('npn')) prefill.npn = value('npn').replace(/[\s-]/g, '');
    const json = JSON.stringify(prefill);
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `${APPLY_URL}#prefill=${b64}`;
  }

  function showDone() {
    $('applyLink').href = applicationLink();
    form.hidden = true;
    $('intro').hidden = true;
    const first = value('firstName');
    $('doneTitle').innerHTML = 'You Are <span class="gold">Checked In</span>';
    $('doneLine1').textContent = source === 'lobby'
      ? `Thanks${first ? `, ${first}` : ''} — your sign-in is in. Head up to the 4th floor and our team will meet you there.`
      : `Thanks${first ? `, ${first}` : ''} — your sign-in is in. A member of the LGCY team will be with you shortly.`;
    clearPhoto();
    $('done').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => $('doneTitle').focus({ preventScroll: true }), 50);
  }

  $('again').addEventListener('click', () => {
    form.reset();
    clearPhoto();
    form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
    $('submitError').hidden = true;
    $('done').hidden = true;
    $('applyLink').href = APPLY_URL;
    form.hidden = false;
    $('intro').hidden = false;
    started = performance.now();
    applyConditions();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('firstName').focus({ preventScroll: true });
  });

  applyConditions();
})();
