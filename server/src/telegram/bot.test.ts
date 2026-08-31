import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor } from '../domain/vendors';
import { getActiveOrderForVendor, createOrder } from '../domain/orders';
import { users } from '../db/schema';
import { handleStartOrderCommand, handleStartOrderCallback } from './bot';

const ADMIN_ID = '555';
const GROUP_ID = '-1001';
const MINI_APP_URL = 'https://example.com/app';

function fakeCommandCtx(fromId: number | undefined, chatId: string | number | undefined) {
  return {
    from: fromId !== undefined ? { id: fromId } : undefined,
    chat: chatId !== undefined ? { id: chatId } : undefined,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('handleStartOrderCommand', () => {
  it('does nothing when the sender is not the admin', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(999, GROUP_ID);
    await handleStartOrderCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('does nothing when the message is outside the configured group', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(555, '-999');
    await handleStartOrderCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('replies with an inline keyboard of vendors for the admin in the group', async () => {
    const db = createTestDb();
    await createVendor(db, 'Vasya');
    await createVendor(db, 'Petya');
    const ctx = fakeCommandCtx(555, GROUP_ID);
    await handleStartOrderCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [, opts] = ctx.reply.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: 'Vasya', callback_data: 'start_order:1' }],
      [{ text: 'Petya', callback_data: 'start_order:2' }],
    ]);
  });
});

function fakeCallbackCtx(fromId: number | undefined, data: string | undefined) {
  return {
    from: fromId !== undefined ? { id: fromId } : undefined,
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('handleStartOrderCallback', () => {
  it('acknowledges the callback but opens nothing for a non-admin sender', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(999, `start_order:${vendor.id}`);
    await handleStartOrderCallback(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID, miniAppUrl: MINI_APP_URL });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(await getActiveOrderForVendor(db, vendor.id)).toBeNull();
  });

  it('opens the round, edits the picker message, and announces with a web_app button', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(555, `start_order:${vendor.id}`);
    const order = await handleStartOrderCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      groupChatId: GROUP_ID,
      miniAppUrl: MINI_APP_URL,
    });
    expect(order?.vendorId).toBe(vendor.id);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = ctx.api.sendMessage.mock.calls[0];
    expect(chatId).toBe(GROUP_ID);
    expect(text).toContain('Vasya');
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Заказать',
      web_app: { url: `${MINI_APP_URL}?order=${order!.id}` },
    });
  });

  it('refuses a second order at a vendor that already has one', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const [admin] = await db
      .insert(users)
      .values({ telegramId: ADMIN_ID, displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
      .returning()
      .all();
    await createOrder(db, vendor.id, admin.id);

    const ctx = fakeCallbackCtx(555, `start_order:${vendor.id}`);
    const result = await handleStartOrderCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      groupChatId: GROUP_ID,
      miniAppUrl: MINI_APP_URL,
    });

    // Reported in the chat rather than thrown at the user as a crash.
    expect(result).toBeUndefined();
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const errorMessage = ctx.editMessageText.mock.calls[0][0];
    expect(errorMessage).toContain('Ошибка');
    expect(errorMessage).toContain('already has an active order');
  });

  it('allows a second order as long as it is at a different vendor', async () => {
    const db = createTestDb();
    const vendor1 = await createVendor(db, 'Vasya');
    const vendor2 = await createVendor(db, 'Petya');
    const [admin] = await db
      .insert(users)
      .values({ telegramId: ADMIN_ID, displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
      .returning()
      .all();
    await createOrder(db, vendor1.id, admin.id);

    const ctx = fakeCallbackCtx(555, `start_order:${vendor2.id}`);
    const result = await handleStartOrderCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      groupChatId: GROUP_ID,
      miniAppUrl: MINI_APP_URL,
    });

    expect(result?.vendorId).toBe(vendor2.id);
  });
});
