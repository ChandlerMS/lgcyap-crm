import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyBotPosition } from '../app/legacy-bot-position.mjs';

test('opens above and aligned with the launcher rather than a fixed screen corner', () => {
  assert.deepEqual(legacyBotPosition({ left: 700, right: 850, top: 700, bottom: 754 }, { width: 400, height: 600 }, { width: 1200, height: 800 }), { left: 450, top: 88 });
  assert.deepEqual(legacyBotPosition({ left: 100, right: 250, top: 700, bottom: 754 }, { width: 400, height: 600 }, { width: 1200, height: 800 }), { left: 12, top: 88 });
});
test('opens below a launcher near the top of the screen', () => {
  assert.deepEqual(legacyBotPosition({ left: 700, right: 850, top: 20, bottom: 74 }, { width: 400, height: 600 }, { width: 1200, height: 800 }), { left: 450, top: 86 });
});
test('keeps a large chat within a narrow or short viewport', () => {
  assert.deepEqual(legacyBotPosition({ left: 190, right: 340, top: 580, bottom: 624 }, { width: 400, height: 700 }, { width: 360, height: 640 }), { left: 12, top: 12 });
  const moved = legacyBotPosition({ left: 900, right: 1050, top: 350, bottom: 404 }, { width: 400, height: 600 }, { width: 800, height: 500 });
  assert.deepEqual(moved, { left: 388, top: 12 });
});

test('keeps the chat above every launcher when the bottom-right dock wraps', () => {
  assert.deepEqual(legacyBotPosition({ left: 700, right: 850, top: 700, bottom: 754 }, { width: 400, height: 400 }, { width: 1200, height: 800 }, { top: 600 }), { left: 450, top: 188 });
});
