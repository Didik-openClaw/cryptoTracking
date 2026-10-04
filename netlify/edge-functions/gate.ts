import type { Config, Context } from '@netlify/edge-functions';
import { gate } from '../../server/access.ts';

declare const Netlify: { env: { get(name: string): string | undefined } };

/**
 * Paywall in front of the terminal: every file outside the public paths is
 * only served to a browser holding a valid access session.
 */
export default async function accessGate(req: Request, context: Context): Promise<Response> {
  const result = await gate(req, { sessionSecret: Netlify.env.get('SESSION_SECRET') ?? '', adminPassword: '' });
  if (!result.pass) return result.response;
  const res = await context.next();
  // Paid files may be cached by the buyer's browser, never by shared caches.
  const html = (res.headers.get('content-type') ?? '').includes('text/html');
  res.headers.set('Cache-Control', html ? 'private, no-store' : 'private, max-age=0, must-revalidate');
  return res;
}

export const config: Config = {
  path: '/*',
  excludedPath: ['/beli', '/beli/*', '/demo', '/demo/*', '/admin', '/admin/*', '/api/*', '/favicon.svg'],
};
