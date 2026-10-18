// Who is asking. Two kinds of principal, the same strings the client's
// permissions.ts understands:
//   a user id            from `Authorization: Bearer <api token>`
//   "link:<share token>" from `X-Share-Token` (+ `X-Share-Password` when the link has one)
//
// Bearer tokens stand in for the spec's auth provider (OAuth / magic link):
// whatever issues sessions later only has to map a request to a user id.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Queryable } from './db';

export interface Principal {
  id: string; // user id or "link:<token>"
  kind: 'user' | 'link';
  userId: string | null;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Salted scrypt hash, for share-link passwords. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(secret, salt, 32).toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(secret, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function issueApiToken(q: Queryable, userId: string, token = newToken(), label = ''): Promise<string> {
  await q.query('insert into api_tokens (token_hash, user_id, label) values ($1, $2, $3) on conflict (token_hash) do nothing', [sha256(token), userId, label]);
  return token;
}

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

export async function resolvePrincipal(q: Queryable, headers: Record<string, string | string[] | undefined>): Promise<Principal> {
  const auth = String(headers['authorization'] ?? '');
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  if (bearer) {
    const row = (await q.query<{ user_id: string }>('select user_id from api_tokens where token_hash = $1', [sha256(bearer)])).rows[0];
    if (!row) throw new AuthError(401, 'Invalid token');
    return { id: row.user_id, kind: 'user', userId: row.user_id };
  }
  const share = headers['x-share-token'];
  if (typeof share === 'string' && share) {
    const link = (await q.query<{ enabled: boolean; password_hash: string | null }>(
      'select enabled, password_hash from share_links where token = $1', [share],
    )).rows[0];
    if (!link || !link.enabled) throw new AuthError(401, 'Unknown or disabled share link');
    if (link.password_hash) {
      const pw = headers['x-share-password'];
      if (typeof pw !== 'string' || !verifySecret(pw, link.password_hash)) throw new AuthError(401, 'Share link password required');
    }
    return { id: 'link:' + share, kind: 'link', userId: null };
  }
  throw new AuthError(401, 'Missing credentials');
}
