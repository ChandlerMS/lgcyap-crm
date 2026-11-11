import { handleSubmit, methodNotAllowed } from '../lib/handler.mjs';

export function POST(request) {
  return handleSubmit(request);
}

export function GET() {
  return methodNotAllowed('POST');
}
