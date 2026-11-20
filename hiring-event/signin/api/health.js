import { handleHealth, methodNotAllowed } from '../lib/handler.mjs';

export function GET() {
  return handleHealth();
}

export function POST() {
  return methodNotAllowed('GET');
}
