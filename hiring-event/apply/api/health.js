import { handleHealth } from '../lib/handler.mjs';

export function GET() {
  return handleHealth();
}
