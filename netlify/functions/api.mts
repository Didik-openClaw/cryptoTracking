import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { handleApi, type Store } from '../../server/access.ts';

/** Access codes, orders and sales settings live in a site-wide Netlify Blobs store. */
function blobStore(): Store {
  const blobs = getStore({ name: 'dty-access', consistency: 'strong' });
  return {
    get: async <T,>(key: string) => ((await blobs.get(key, { type: 'json' })) as T | null) ?? null,
    set: async (key, value) => {
      await blobs.setJSON(key, value);
    },
    delete: async (key) => {
      await blobs.delete(key);
    },
    list: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
  };
}

export default async function api(req: Request): Promise<Response> {
  return handleApi(
    req,
    { sessionSecret: Netlify.env.get('SESSION_SECRET') ?? '', adminPassword: Netlify.env.get('ADMIN_PASSWORD') ?? '' },
    blobStore(),
  );
}

export const config: Config = { path: '/api/*' };
