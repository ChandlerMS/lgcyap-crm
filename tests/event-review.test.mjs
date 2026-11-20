import test from 'node:test';
import assert from 'node:assert/strict';
import {eventReviewHtml,parseEventReview} from '../lib/event-review.mjs';
import {keepEventReviewRequest} from '../lib/event-review-model.mjs';
const secret='synthetic-review-signing-secret-0123456789';
const value={ticketId:'101',status:'denied',requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',reviewedAt:'2026-11-18T22:00:00.000Z',secret};
const note={id:'22',properties:{hs_note_body:eventReviewHtml(value),hs_timestamp:value.reviewedAt}};
test('review proof rejects text, tampering, timestamp changes and wrong keys',()=>{
 assert.equal(parseEventReview(note,[secret]).status,'denied');
 assert.equal(parseEventReview(note,['wrong-key-012345678901234567890123456789']),null);
 assert.equal(parseEventReview({...note,properties:{...note.properties,hs_note_body:note.properties.hs_note_body.replace(/</g,'&lt;')}},[secret]),null);
 assert.equal(parseEventReview({...note,properties:{...note.properties,hs_timestamp:'2026-11-18T23:00:00Z'}},[secret]),null);
 const altered=note.properties.hs_note_body.replace(/(\.)([a-f0-9]{64})(<)/,(_,a,b,c)=>a+(b[0]==='0'?'1':'0')+b.slice(1)+c);
 assert.equal(parseEventReview({...note,properties:{...note.properties,hs_note_body:altered}},[secret]),null);
 assert.equal(parseEventReview(note,['new-key-012345678901234567890123456789',secret]).status,'denied');
});
test('retries rotate terminal failed requests but retain uncertain and in-progress requests',()=>{
 assert.equal(keepEventReviewRequest(409,'QUICK_ACTION_FAILED'),false);
 assert.equal(keepEventReviewRequest(400,'HUBSPOT_REJECTED'),false);
 assert.equal(keepEventReviewRequest(409,'QUICK_ACTION_BUSY'),true);
 assert.equal(keepEventReviewRequest(502,'SAVE_UNCERTAIN'),true);
 assert.equal(keepEventReviewRequest(503,'UNAVAILABLE'),true);
});
