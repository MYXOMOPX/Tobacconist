import crypto from 'node:crypto';

export type InitDataResult =
  | { ok: true; telegramId: string; displayName: string }
  | { ok: false; reason: string };

export function verifyInitData(params: {
  initData: string;
  botToken: string;
  maxAgeSeconds?: number;
  now?: Date;
}): InitDataResult {
  const { initData, botToken, maxAgeSeconds = 86400, now = new Date() } = params;

  const parsed = new URLSearchParams(initData);
  const hash = parsed.get('hash');
  if (!hash) return { ok: false, reason: 'missing hash' };
  parsed.delete('hash');

  const pairs = [...parsed.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const computedBuf = Buffer.from(computedHash, 'hex');
  const receivedBuf = Buffer.from(hash, 'hex');
  if (computedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(computedBuf, receivedBuf)) {
    return { ok: false, reason: 'invalid signature' };
  }

  const authDate = Number(parsed.get('auth_date'));
  if (!authDate || now.getTime() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: 'expired' };
  }

  const userJson = parsed.get('user');
  if (!userJson) return { ok: false, reason: 'missing user' };

  let user: unknown;
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: 'invalid user json' };
  }

  if (!user || typeof (user as { id?: unknown }).id !== 'number') {
    return { ok: false, reason: 'invalid user' };
  }

  const typedUser = user as { id: number; first_name?: string; last_name?: string; username?: string };
  const displayName =
    [typedUser.first_name, typedUser.last_name].filter(Boolean).join(' ') || typedUser.username || String(typedUser.id);

  return { ok: true, telegramId: String(typedUser.id), displayName };
}

export interface ChatMemberApi {
  getChatMember(chatId: string | number, userId: number): Promise<{ status: string; is_member?: boolean }>;
}

export async function checkGroupMembership(
  api: ChatMemberApi,
  groupChatId: string,
  telegramUserId: number
): Promise<boolean> {
  try {
    const member = await api.getChatMember(groupChatId, telegramUserId);
    const ACTIVE_STATUSES = new Set(['creator', 'administrator', 'member']);
    if (member.status === 'restricted') return member.is_member === true;
    return ACTIVE_STATUSES.has(member.status);
  } catch {
    return false;
  }
}
