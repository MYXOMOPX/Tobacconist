import { Bot } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { listVendors } from '../domain/vendors.js';
import { createOrder, type Order } from '../domain/orders.js';
import { createOrderAnnouncer } from './notify.js';

export interface StartOrderCtx {
  from?: { id: number };
  chat?: { id: number | string };
  reply(text: string, opts?: unknown): Promise<unknown>;
}

export async function handleStartOrderCommand(
  ctx: StartOrderCtx,
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
      inline_keyboard: vendors.map((v) => [{ text: v.name, callback_data: `start_order:${v.id}` }]),
    },
  });
}

export interface StartOrderCallbackCtx {
  from?: { id: number };
  callbackQuery?: { data?: string };
  answerCallbackQuery(): Promise<unknown>;
  editMessageText(text: string): Promise<unknown>;
  api: { sendMessage(chatId: string | number, text: string, opts?: unknown): Promise<unknown> };
}

async function ensureAdminUser(db: Db, adminTelegramId: string) {
  const existing = await db.select().from(users).where(eq(users.telegramId, adminTelegramId)).get();
  if (existing) return existing;
  try {
    const [row] = await db
      .insert(users)
      .values({ telegramId: adminTelegramId, displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
      .returning()
      .all();
    return row;
  } catch (err) {
    // Handle race condition: another request may have inserted the same user concurrently
    // Re-select the now-existing row
    const reselect = await db.select().from(users).where(eq(users.telegramId, adminTelegramId)).get();
    if (!reselect) {
      throw err; // Not a duplicate key error, re-throw
    }
    return reselect;
  }
}

export async function handleStartOrderCallback(
  ctx: StartOrderCallbackCtx,
  deps: { db: Db; adminTelegramId: string; groupChatId: string; miniAppUrl: string }
): Promise<Order | undefined> {
  await ctx.answerCallbackQuery();

  if (!ctx.from || String(ctx.from.id) !== deps.adminTelegramId) return undefined;
  const match = ctx.callbackQuery?.data?.match(/^start_order:(\d+)$/);
  if (!match) return undefined;

  try {
    const vendorId = Number(match[1]);
    const adminUser = await ensureAdminUser(deps.db, deps.adminTelegramId);
    const order = await createOrder(deps.db, vendorId, adminUser.id);

    const vendor = (await listVendors(deps.db, { includeArchived: true })).find((v) => v.id === vendorId);

    await ctx.editMessageText('Заказ открыт ✅');
    await createOrderAnnouncer({
      sender: ctx.api,
      groupChatId: deps.groupChatId,
      miniAppUrl: deps.miniAppUrl,
    }).announceOrderOpened(vendor?.name ?? '', order.id);

    return order;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to start the order';
    await ctx.editMessageText(`Ошибка: ${message}`);
    return undefined;
  }
}

export function createBot(deps: {
  botToken: string;
  db: Db;
  adminTelegramId: string;
  groupChatId: string;
  miniAppUrl: string;
  botInfo?: UserFromGetMe;
}): Bot {
  const bot = new Bot(deps.botToken, deps.botInfo ? { botInfo: deps.botInfo } : undefined);
  bot.command('start_order', (ctx) => handleStartOrderCommand(ctx as unknown as StartOrderCtx, deps));
  bot.callbackQuery(/^start_order:\d+$/, (ctx) =>
    handleStartOrderCallback(ctx as unknown as StartOrderCallbackCtx, deps)
  );
  return bot;
}
