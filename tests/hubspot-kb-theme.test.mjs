import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_SOURCE, buildSnippet, minifyCss } from '../scripts/hubspot-kb-theme.mjs';

const source = readFileSync(THEME_SOURCE, 'utf8');
const css = minifyCss(source);
const snippet = buildSnippet(source);

function selectorsOf(minified) {
  const selectors = [];
  // Drop @media wrappers so every remaining "selector{" is a style rule.
  const flat = minified.replace(/@media[^{]*\{/g, '');
  for (const match of flat.matchAll(/(?:^|[{}])([^{}@]+)\{/g)) selectors.push(...match[1].split(','));
  return selectors.map(selector => selector.trim()).filter(Boolean);
}

test('the knowledge base snippet is one ASCII style tag HubSpot can store', () => {
  assert.match(snippet, /^<style id="legacy-crm-theme">[^<]+<\/style>$/);
  assert.doesNotMatch(snippet, /[^\x20-\x7e]/);
  assert.ok(snippet.length < 65000, `snippet is ${snippet.length} characters`);
});

test('every rule is scoped to knowledge base pages', () => {
  for (const selector of selectorsOf(css)) {
    assert.ok(selector.includes('.kb-body-wrapper'), `unscoped selector: ${selector}`);
  }
});

test('the category "See more" button is never hidden', () => {
  // HubSpot keeps "-hidden" on this button while it shows "See more"; hiding it
  // would hide every article past the first five in a category.
  for (const selector of selectorsOf(css)) {
    assert.ok(!/hs-kb-category-article-list__toggle[^ ]*\.-hidden/.test(selector), `hides See more: ${selector}`);
  }
});

test('support form overrides match HubSpot ID selectors so the form stays readable', () => {
  assert.match(css, /#hs_form_target_kb_support_form input\.hs-input/);
  assert.match(css, /#hs_form_target_kb_support_form label\.hs-error-msg\{/);
  assert.match(css, /#hs_form_target_kb_support_form input\.hs-button/);
});

test('buildSnippet rejects input HubSpot would mangle', () => {
  assert.throws(() => buildSnippet('.kb-body-wrapper a{content:"·"}'), /ASCII/);
  assert.throws(() => buildSnippet('.kb-body-wrapper a{content:"</style>"}'), /<\/style/);
  assert.throws(() => buildSnippet('.kb-body-wrapper a{color:red'), /unbalanced/);
});
