import { Buffer } from 'node:buffer';
import { GoogleError, teamReady, teamToken, gapi } from './google';
import { esc } from './http';
import { TEMPLATES } from './shared.generated';

// Email goes out through the Gmail API as MAIL_FROM (the agency sender), with the person who acted on Reply-To.
export const mailReady = (env: Env): boolean => teamReady(env) && !!env.MAIL_FROM;

// Addresses that are never really emailed (sample candidates, tests).
export const isTestAddress = (e: string): boolean => /@(example\.(com|org|net)|[^@\s]+\.(test|invalid|example|localhost))$/i.test(e);

export interface Mail { to: string[]; cc?: string[]; replyTo?: string; subject: string; html: string }

const header = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();
const word = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const b64lines = (s: string): string => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');

export async function sendMail(env: Env, m: Mail): Promise<void> {
  if (!mailReady(env)) throw new GoogleError('not_configured');
  const boundary = 'lgcy' + crypto.randomUUID().replace(/-/g, '');
  const lines = [
    `From: ${word(header(env.MAIL_FROM_NAME || 'Legacy Agency Partners'))} <${header(env.MAIL_FROM)}>`,
    `To: ${m.to.map(header).join(', ')}`,
    ...(m.cc && m.cc.length ? [`Cc: ${m.cc.map(header).join(', ')}`] : []),
    ...(m.replyTo ? [`Reply-To: ${header(m.replyTo)}`] : []),
    `Subject: ${word(header(m.subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(toText(m.html)),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64lines(wrap(m.html)),
    `--${boundary}--`, '',
  ];
  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
  await gapi(await teamToken(env), 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw });
}

// The CRM's templates use {placeholders} and three classes: .h (heading), .var (a filled-in value), .btn (a button).
export function fromTemplate(key: keyof typeof TEMPLATES, vars: Record<string, string>, link?: string): { subject: string; html: string } {
  const t = TEMPLATES[key] as { subject?: string; body: string };
  const fill = (s: string, escape: boolean) => s.replace(/\{([a-z_]+)\}/g, (all, k: string) => (vars[k] === undefined ? all : escape ? esc(vars[k]) : vars[k]));
  const body = fill(t.body, true)
    .replace(/<div class="h">([\s\S]*?)<\/div>/g, '<h2 style="margin:0 0 12px;font:600 20px/1.3 Arial,sans-serif;color:#1d1503">$1</h2>')
    .replace(/<span class="var">([\s\S]*?)<\/span>/g, '$1')
    .replace(/<span class="btn">([\s\S]*?)<\/span>/g, (_, label: string) => (link ? button(link, label) : ''));
  return { subject: fill(t.subject || '', false), html: body };
}

export const button = (href: string, label: string): string =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="display:inline-block;background:#d9ae4a;color:#1d1503;text-decoration:none;font:700 15px Arial,sans-serif;padding:12px 20px;border-radius:8px;border:1px solid #8a6516">${label}</a></p>`;

function wrap(body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4eee2;padding:24px 12px"><div style="max-width:560px;margin:0 auto;background:#fffdf8;border:1px solid #e2d6bd;border-radius:12px;padding:24px 26px;font:15px/1.55 Arial,sans-serif;color:#2a2418">`
    + `<div style="font:700 13px Arial,sans-serif;letter-spacing:.18em;color:#a8781c;border-bottom:1px solid #e2d6bd;padding-bottom:12px;margin-bottom:18px">LEGACY AGENCY PARTNERS</div>`
    + body + `</div></body></html>`;
}

function toText(htmlBody: string): string {
  return htmlBody
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '$2: $1')
    .replace(/<(br|\/p|\/li|\/h2|\/div|\/ol|\/ul)[^>]*>/g, '\n').replace(/<li[^>]*>/g, '- ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
