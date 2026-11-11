// Application rules shared by the page and the server, matching the live LGCY Onboard /apply page:
// which questions are shown, when Part 2 opens, and how answers are evaluated.
import { APP_FORM } from './form.js';

export const LICENSED_STATUS = /^(florida 2-1[45]|licensed in)/i;

/** Part 2 opens for anyone who holds a license (Florida 2-14, 2-15, or another state). */
export function isLicensed(answers) {
  return answers.everLicensed === 'yes' || LICENSED_STATUS.test(answers.licenseStatus || '');
}

export function isShown(item, answers) {
  if (!item.showIf) return true;
  const value = answers[item.showIf.id] || '';
  return item.showIf.in ? item.showIf.in.includes(value) : value === item.showIf.eq;
}

export function visibleSections(answers) {
  return APP_FORM.filter(section => !section.part2 || isLicensed(answers));
}

export function visibleItems(answers) {
  return visibleSections(answers).flatMap(section => section.items
    .filter(item => isShown(item, answers))
    .map(item => ({ ...item, section: section.id })));
}

export function isRequired(item) {
  return Boolean(item.req || item.essential);
}

/**
 * The same evaluation as Onboard's evaluateApplication: an "essential" answer that does not match
 * fails the application; a "review" answer flags it for a private conversation.
 */
export function evaluateApplication(answers) {
  const items = visibleItems(answers);
  const failed = items.filter(item => item.essential && (answers[item.id] || '') !== item.essential).map(item => item.fail || item.label);
  const review = items.filter(item => item.review && (answers[item.id] || '') === item.review).map(item => item.label);
  return { pass: failed.length === 0, failed, review };
}

/** Display text for a stored answer. */
export function answerText(item, value) {
  // A checkbox is always answered: unticked means No.
  if (item.type === 'check') return value === 'yes' ? 'Yes' : 'No';
  if (value === undefined || value === null || value === '') return '';
  if (item.type === 'yesno') return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : '';
  if (item.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${m}/${d}/${y}`;
  }
  return String(value);
}
