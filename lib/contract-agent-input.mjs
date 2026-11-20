import { editableFields } from './hubspot-tool-edit-config.mjs';
export const CONTRACT_AGENT_CREATE_FIELDS = editableFields('contract-agents').filter(field => !field.owner).map(field => ({ ...field, required: field.property === 'full_name' }));
export function validateContractAgent(input) {
  const fail = message => { const error = new Error(message); error.code = 'INVALID_AGENT'; error.status = 400; throw error; };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'properties'].includes(key)) || typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) fail('Start a new agent form before saving.');
  const fields = new Map(CONTRACT_AGENT_CREATE_FIELDS.map(field => [field.property, field]));
  if (!input.properties || typeof input.properties !== 'object' || Array.isArray(input.properties) || Object.keys(input.properties).some(key => !fields.has(key))) fail('Only the displayed agent fields can be created.');
  /** @type {Record<string, string>} */
  const properties = {};
  for (const field of fields.values()) {
    const raw = input.properties[field.property] ?? '';
    if (typeof raw !== 'string') fail(`Enter a valid ${field.label.toLowerCase()}.`);
    let value = raw.trim();
    if (/[\u0000-\u001f\u007f]/.test(value) || value.length > field.maxLength || field.required && !value) fail(`Enter a valid ${field.label.toLowerCase()}.`);
    if (field.type === 'email') { value = value.toLowerCase(); if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail('Enter a valid email address.'); }
    if (field.type === 'tel' && value && !/\d/.test(value)) fail('Enter a valid phone number.');
    if (field.type === 'select' && !field.options.some(option => option.value === value)) fail('Choose a valid agent status.');
    if (value) properties[field.property] = value;
  }
  return { requestId: input.requestId.toLowerCase(), properties };
}
