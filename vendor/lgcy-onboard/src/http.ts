import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

// Responses carry the same headers the original Worker sent: JSON and HTML are never cached.
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export const html = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export const redirect = (to: string, headers: Record<string, string> = {}): Response =>
  new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store', ...headers } });

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Request bodies are small JSON objects, except the CRM record (PUT /api/state), which has its own limit.
export async function readJson<T>(req: Request, max = 64 * 1024): Promise<T | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) return null;
  const text = await req.text();
  if (text.length > max) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

export const nowIso = (): string => new Date().toISOString();

export const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(d).toString('hex');
}

// Compare two secrets in constant time (hash first so lengths match).
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  return timingSafeEqual(new Uint8Array(x), new Uint8Array(y));
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const isEmail = (s: unknown): s is string => typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export const list = (s: string | undefined): string[] =>
  String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...data }));
}
