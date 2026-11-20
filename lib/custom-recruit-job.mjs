import { createCustomRecruitProvider, CustomRecruitSyncError } from './custom-recruit-provider.mjs';
import { reconcileCustomRecruit } from './custom-recruit-reconcile.mjs';
import { initializeCustomRecruitStore, createCustomRecruitStore, withCustomRecruitLock } from '../db/custom-recruit-sync.mjs';
import { parseApplicationNote } from './applications.mjs';
import { stageIdForKey } from './recruiting-config.mjs';
export function customRecruitSyncEnabled(env = process.env) {
  return env.VERCEL === '1' && env.VERCEL_ENV === 'production' && env.RECRUITING_WRITES_ENABLED === 'true' && env.RECRUITING_CUSTOM_SYNC_ENABLED === 'true' && typeof env.BETTER_AUTH_SECRET === 'string' && env.BETTER_AUTH_SECRET.length >= 32 && Boolean(env.DATABASE_URL);
}
async function prepareIntake(ticketId, provider, store) {
  const ticket = await provider.readTicket(ticketId), p = ticket.properties;
  if (!p.recruiting_path) {
    const applied = await store.hasApplication(ticketId);
    const signed = p.source_type === 'FORM' && (String(p.content ?? '').startsWith('Hiring event sign-in') || p.hs_pipeline_stage === stageIdForKey('hiring-event'));
    const path = signed ? 'genpop' : applied ? 'mass_recruiting' : null;
    if (path) {
      const fresh = await provider.readTicket(ticketId);
      if (fresh.properties.recruiting_path || fresh.properties.hs_pipeline_stage !== p.hs_pipeline_stage) throw new CustomRecruitSyncError('source_changed');
      await provider.patchTicket(ticketId, { recruiting_path: path });
    }
  }
}
export async function syncCustomRecruit(ticketId, { pool, provider, secret, store = createCustomRecruitStore(pool) }) {
  return withCustomRecruitLock(pool, `ticket:${ticketId}`, async () => {
    try {
      await prepareIntake(ticketId, provider, store);
      let result = await reconcileCustomRecruit(ticketId, { provider, store, secret });
      if (result.status === 'synced') {
        const ticket = await provider.readTicket(ticketId);
        if (ticket.properties.hs_pipeline_stage === stageIdForKey('hiring-event') && ticket.properties.recruiting_path === 'genpop' && await store.hasApplication(ticketId)) {
          // Applying advances only the Hiring Event step. Later progress and closed outcomes are preserved.
          const fresh = await provider.readTicket(ticketId);
          if (fresh.properties.hs_pipeline_stage === ticket.properties.hs_pipeline_stage && fresh.properties.recruiting_path === ticket.properties.recruiting_path) {
            await provider.patchTicket(ticketId, { hs_pipeline_stage: stageIdForKey('application') });
            result = await reconcileCustomRecruit(ticketId, { provider, store, secret });
          }
        }
        if (result.status === 'synced' && result.recruitId) {
          await provider.linkRecruit(ticketId, result.recruitId);
          await provider.syncSourceMetadata(ticketId, result.recruitId);
        }
      }
      return result;
    } catch (error) {
      const status = error instanceof CustomRecruitSyncError ? error.code : 'unavailable';
      const state = await store.get(ticketId) ?? {};
      await store.put(ticketId, { ...state, status });
      return { status };
    }
  });
}
export async function runCustomRecruitJob({ pool, accessToken, secret, fetchImpl = fetch, now = Date.now, provider: supplied = undefined }) {
  await initializeCustomRecruitStore(pool);
  return withCustomRecruitLock(pool, 'job', async () => {
    const store = createCustomRecruitStore(pool), job = await store.job();
    const deadline = now() + 50000;
    const provider = supplied ?? createCustomRecruitProvider({ accessToken, fetchImpl, deadline, now });
    const summary = { status: 'synced', processed: 0, synced: 0, attention: 0, applications: 0, remaining: false };
    let cursor = job.cursor_id, applicationCursor = job.application_cursor, customCursor = job.custom_cursor ?? '0';
    try {
      await provider.verifyAndSetup();
      const pending = new Set();
      let notes = { records: [], more: true };
      const inBudget = async (end, work) => {
        try {
          if (now() >= end) { summary.remaining = true; return; }
          if (provider.withBudget) await provider.withBudget(end, work); else await work();
        } catch { summary.attention++; summary.remaining = true; }
      };
      const noteEnd = Math.min(now() + 8000, deadline - 30000);
      await inBudget(noteEnd, async () => {
        notes = await provider.applicationNotes(applicationCursor);
        const retries = await store.retryApplications();
        const extra = [];
        for (const id of retries.filter(id => !notes.records.some(note => note.id === id))) {
          try { extra.push(await provider.applicationNote(id)); }
          catch { await store.deferApplication(id, 'unavailable'); summary.attention++; }
        }
        const newIds = new Set(notes.records.map(note => note.id));
        for (const note of [...notes.records, ...extra]) {
          if (now() >= noteEnd) { summary.remaining = true; break; }
          const application = parseApplicationNote(note.properties.hs_note_body);
          if (application) {
            try {
              const contacts = await provider.associations('notes', note.id, 'contacts');
              if (contacts.length !== 1) throw new CustomRecruitSyncError('ambiguous_application_contact');
              const contactId = contacts[0];
              const result = await withCustomRecruitLock(pool, `contact:${contactId}`, async () => {
                const ticketId = await provider.applicationTicket({ ...application, id: note.id, contact: { id: contactId } }, store);
                await store.markApplication(note.id, ticketId, contactId);
                return { ticketId };
              });
              if (!result.ticketId) throw new CustomRecruitSyncError('busy');
              await store.clearApplicationRetry(note.id);
              pending.add(result.ticketId); summary.applications++;
            } catch (error) { await store.deferApplication(note.id, error instanceof CustomRecruitSyncError ? error.code : 'unavailable'); summary.attention++; summary.status = 'needs_attention'; }
          }
          if (newIds.has(note.id)) applicationCursor = note.id;
        }
      });
      const since = job.checked_at ? new Date(job.checked_at).getTime() - 120000 : now() - 48 * 60 * 60 * 1000;
      const changed = await provider.changedTickets(since);
      changed.records.forEach(record => pending.add(record.id));
      const customEnd = Math.min(now() + 7000, deadline - 25000);
      await inBudget(customEnd, async () => {
        const customPage = await provider.listRecruits(customCursor);
        const visitedCustom = new Set();
        const processCustom = async records => {
          for (const recruit of records) {
            if (visitedCustom.has(recruit.id)) continue;
            if (now() >= customEnd) { summary.remaining = true; break; }
            visitedCustom.add(recruit.id);
            try {
              if (/^[1-9]\d{0,19}$/.test(recruit.properties.crm_ticket_id ?? '')) { pending.add(recruit.properties.crm_ticket_id); continue; }
              const contacts = await provider.associations('2-72246945', recruit.id, 'contacts');
              if (contacts.length !== 1) { summary.attention++; continue; }
              const result = await withCustomRecruitLock(pool, `contact:${contacts[0]}`, async () => ({ ticketId: await provider.nativeTicket(recruit, store) }));
              if (result.ticketId) pending.add(result.ticketId);
            } catch { summary.attention++; }
          }
        };
        await processCustom(customPage.records);
        for (const record of customPage.records) { if (!visitedCustom.has(record.id)) break; customCursor = record.id; }
        if (!customPage.more && customPage.records.every(record => visitedCustom.has(record.id))) customCursor = '0';
        summary.remaining ||= customPage.more;
        // Recent searches can stall too: commit full-scan progress before attempting them.
        if (now() < customEnd) await processCustom((await provider.changedRecruits(since)).records);
      });
      const page = await provider.listTickets(cursor);
      const ids = [...pending], interleaved = [];
      for (let i = 0; i < Math.max(ids.length, page.records.length); i++) { if (ids[i]) interleaved.push(ids[i]); if (page.records[i]) interleaved.push(page.records[i].id); }
      const processed = new Set();
      for (const ticketId of new Set(interleaved)) {
        if (now() > deadline - 10000) { summary.remaining = true; break; }
        const result = await syncCustomRecruit(ticketId, { pool, store, provider, secret });
        processed.add(ticketId); summary.processed++;
        if (result.status === 'synced') summary.synced++; else summary.attention++;
      }
      for (const ticket of page.records) { if (!processed.has(ticket.id)) break; cursor = ticket.id; }
      if (!page.more && page.records.every(record => processed.has(record.id))) cursor = '0';
      summary.remaining ||= page.more || notes.more;
      summary.status = summary.attention ? 'needs_attention' : 'synced';
    } catch (error) { summary.status = error instanceof CustomRecruitSyncError ? error.code : 'unavailable'; summary.remaining = true; }
    await store.finishJob(cursor, applicationCursor, summary, customCursor);
    return summary;
  });
}
export async function customRecruitReadStatus(pool, recruits) {
  const ids = recruits.map(record => record.id);
  const rows = (await pool.query('SELECT ticket_id,recruit_id,state,checked_at FROM recruit_custom_sync WHERE ticket_id=ANY($1::text[])', [ids])).rows;
  const byId = new Map(rows.map(row => [row.ticket_id, row]));
  const job = (await pool.query('SELECT summary,checked_at FROM recruit_custom_job WHERE id=1')).rows[0];
  return { recruits: recruits.map(record => {
    const state = byId.get(record.id);
    return { ...record, ...(state?.recruit_id && /^[1-9]\d{0,19}$/.test(state.recruit_id) ? { customRecruitUrl: `https://app.hubspot.com/contacts/50894788/record/2-72246945/${state.recruit_id}` } : {}), customRecruitSync: { status: state?.state?.status ?? 'pending', checkedAt: state?.checked_at ?? null } };
  }), customRecruitSync: { ...job?.summary, checkedAt: job?.checked_at ?? null } };
}
