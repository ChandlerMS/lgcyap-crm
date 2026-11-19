import { PORTAL_ID } from './recruiting-config.mjs';

export function hubspotEmailHandoff({ contactId, route }) {
  if (typeof contactId !== 'string' || !/^\d{1,20}$/.test(contactId)) throw new Error('Invalid HubSpot contact.');
  const templates = route === 'licensed'
    ? [{ id: 'licensed', name: 'Licensed Offer', url: `https://app.hubspot.com/templates/${PORTAL_ID}/edit/135101045` }]
    : route === 'not_licensed'
      ? [{ id: 'unlicensed', name: 'Unlicensed - Offer', url: `https://app.hubspot.com/templates/${PORTAL_ID}/edit/135103624` }]
      : [];
  return { contactUrl: `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-1/${contactId}`, templates };
}
