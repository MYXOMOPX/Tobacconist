import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { users } from '../db/schema';
import { listVendors } from '../domain/vendors';
import { openRound, type Round } from '../domain/rounds';

export interface StartRoundCtx {
  from?: { id: number };
  chat?: { id: number | string };
  reply(text: string, opts?: unknown): Promise<unknown>;
}

export async function handleStartRoundCommand(
  ctx: StartRoundCtx,
  deps: { db: Db; adminTelegramId: string; groupChatId: string }
) {
  if (!ctx.from || String(ctx.from.id) !== deps.adminTelegramId) return;
  if (!ctx.chat || String(ctx.chat.id) !== deps.groupChatId) return;

  const vendors = await listVendors(deps.db);
  if (vendors.length === 0) {
    await ctx.reply('Нет ни одного барыги. Сначала добавь через мини-апп.');
    return;
  }

  await ctx.reply('Выбери барыгу:', {
    reply_markup: {
      inline_keyboard: vendors.map((v) => [{ text: v.name, callback_data: `start_round:${v.id}` }]),
    },
  });
}

export interface StartRoundCallbackCtx {
  from?: { id: number };
  callbackQuery?: { data?: string };
  answerCallbackQuery(): Promise<unknown>;
  editMessageText(text: string): Promise<unknown>;
  api: { sendMessage(chatId: string | number, text: string, opts?: unknown): Promise<unknown> };
}

async function ensureAdminUser(db: Db, adminTelegramId: string) {
  const existing = await db.select().from(users).where(eq(users.telegramId, adminTelegramId)).get();
  if (existing) return existing;
  const [row] = await db
    .insert(users)
    .values({ telegramId: adminTelegramId, displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
    .returning()
    .all();
  return row;
}

export async function handleStartRoundCallback(
  ctx: StartRoundCallbackCtx,
  deps: { db: Db; adminTelegramId: string; groupChatId: string; miniAppUrl: string }
): Promise<Round | undefined> {
  await ctx.answerCallbackQuery();

  if (!ctx.from || String(ctx.from.id) !== deps.adminTelegramId) return undefined;
  const match = ctx.callbackQuery?.data?.match(/^start_round:(\d+)$/);
  if (!match) return undefined;

  const vendorId = Number(match[1]);
  const adminUser = await ensureAdminUser(deps.db, deps.adminTelegramId);
  const round = await openRound(deps.db, vendorId, adminUser.id);

  await ctx.editMessageText('Раунд начат ✅');
  await ctx.api.sendMessage(deps.groupChatId, '🛍 Заказ открыт! Жми, чтобы сформировать свой заказ:', {
    reply_markup: {
      inline_keyboard: [[{ text: '🛍 Заказать', web_app: { url: deps.miniAppUrl } }]],
    },
  });

  return round;
}

export function createBot(deps: {
  botToken: string;
  db: Db;
  adminTelegramId: string;
  groupChatId: string;
  miniAppUrl: string;
}): Bot {
  const bot = new Bot(deps.botToken);
  bot.command('start_round', (ctx) => handleStartRoundCommand(ctx as unknown as StartRoundCtx, deps));
  bot.callbackQuery(/^start_round:\d+$/, (ctx) =>
    handleStartRoundCallback(ctx as unknown as StartRoundCallbackCtx, deps)
  );
  return bot;
}
