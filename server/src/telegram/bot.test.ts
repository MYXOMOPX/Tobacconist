import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor } from '../domain/vendors';
import { getActiveOrderForVendor, createOrder } from '../domain/orders';
import { users } from '../db/schema';
import { handleStartOrderCommand, handleStartOrderCallback, handleChatAccessCommand } from './bot';
import { allowChat, disallowChat, isChatAllowed } from './allowedChats';

const ADMIN_ID = '555';
const GROUP_ID = '-1001';
const MINI_APP_LINK = 'https://t.me/testbot/order';

function fakeCommandCtx(fromId: number | undefined, chatId: string | number | undefined) {
  return {
    from: fromId !== undefined ? { id: fromId } : undefined,
    chat: chatId !== undefined ? { id: chatId, type: 'supergroup' } : undefined,
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

describe('chat access commands', () => {
  it('lets the configured admin activate two chats and deactivate one', async () => {
    const db = createTestDb();
    await handleChatAccessCommand(fakeCommandCtx(555, '-1001'), { db, adminTelegramId: ADMIN_ID }, 'start');
    await handleChatAccessCommand(fakeCommandCtx(555, '-1002'), { db, adminTelegramId: ADMIN_ID }, 'start');
    expect(await isChatAllowed(db, '-1001')).toBe(true);
    expect(await isChatAllowed(db, '-1002')).toBe(true);
    await handleChatAccessCommand(fakeCommandCtx(555, '-1001'), { db, adminTelegramId: ADMIN_ID }, 'stop');
    expect(await isChatAllowed(db, '-1001')).toBe(false);
    expect(await isChatAllowed(db, '-1002')).toBe(true);
  });

  it('ignores non-admins and private chats', async () => {
    const db = createTestDb();
    await handleChatAccessCommand(fakeCommandCtx(999, '-1001'), { db, adminTelegramId: ADMIN_ID }, 'start');
    const privateCtx = { ...fakeCommandCtx(555, 555), chat: { id: 555, type: 'private' } };
    await handleChatAccessCommand(privateCtx, { db, adminTelegramId: ADMIN_ID }, 'start');
    expect(await isChatAllowed(db, '-1001')).toBe(false);
    expect(await isChatAllowed(db, '555')).toBe(false);
  });
});

describe('handleStartOrderCommand', () => {
  it('does nothing when the sender is not the admin', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(999, GROUP_ID);
    await allowChat(db, GROUP_ID);
    await handleStartOrderCommand(ctx, { db, adminTelegramId: ADMIN_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('does nothing when the message is outside the configured group', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(555, '-999');
    await allowChat(db, GROUP_ID);
    await handleStartOrderCommand(ctx, { db, adminTelegramId: ADMIN_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('replies with an inline keyboard of vendors for the admin in the group', async () => {
    const db = createTestDb();
    await createVendor(db, 'Vasya');
    await createVendor(db, 'Petya');
    const ctx = fakeCommandCtx(555, GROUP_ID);
    await allowChat(db, GROUP_ID);
    await handleStartOrderCommand(ctx, { db, adminTelegramId: ADMIN_ID });
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
    chat: { id: GROUP_ID },
    callbackQuery: { data },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  };
}

describe('handleStartOrderCallback', () => {
  it('acknowledges the callback but opens nothing for a non-admin sender', async () => {
    const db = createTestDb();
    await allowChat(db, GROUP_ID);
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(999, `start_order:${vendor.id}`);
    await handleStartOrderCallback(ctx, { db, adminTelegramId: ADMIN_ID, miniAppLink: MINI_APP_LINK });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(await getActiveOrderForVendor(db, vendor.id)).toBeNull();
  });

  it('opens the round, edits the picker message, and announces with a link button', async () => {
    const db = createTestDb();
    await allowChat(db, GROUP_ID);
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(555, `start_order:${vendor.id}`);
    const order = await handleStartOrderCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      miniAppLink: MINI_APP_LINK,
    });
    expect(order?.vendorId).toBe(vendor.id);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = ctx.api.sendMessage.mock.calls[0];
    expect(chatId).toBe(GROUP_ID);
    expect(text).toContain('Vasya');
    // A group cannot carry a web_app button — see notify.ts.
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Открыть заказ',
      url: `${MINI_APP_LINK}?startapp=order_${order!.id}`,
    });
  });

  it('cannot open an order through an old button after the chat is stopped', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    await allowChat(db, GROUP_ID);
    await disallowChat(db, GROUP_ID);
    const ctx = fakeCallbackCtx(555, `start_order:${vendor.id}`);
    expect(await handleStartOrderCallback(ctx, { db, adminTelegramId: ADMIN_ID, miniAppLink: MINI_APP_LINK })).toBeUndefined();
    expect(await getActiveOrderForVendor(db, vendor.id)).toBeNull();
  });

  it('keeps the order open when announcing to another allowed chat fails', async () => {
    const db = createTestDb();
    await allowChat(db, GROUP_ID);
    await allowChat(db, '-1002');
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(555, `start_order:${vendor.id}`);
    ctx.api.sendMessage.mockImplementation(async (chatId) => {
      if (chatId === '-1002') throw new Error('chat unavailable');
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order = await handleStartOrderCallback(ctx, { db, adminTelegramId: ADMIN_ID, miniAppLink: MINI_APP_LINK });
    log.mockRestore();
    expect(order?.id).toBe((await getActiveOrderForVendor(db, vendor.id))?.id);
    expect(ctx.api.sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual([GROUP_ID, '-1002']);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
  });

  it('refuses a second order at a vendor that already has one', async () => {
    const db = createTestDb();
    await allowChat(db, GROUP_ID);
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
      miniAppLink: MINI_APP_LINK,
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
    await allowChat(db, GROUP_ID);
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
      miniAppLink: MINI_APP_LINK,
    });

    expect(result?.vendorId).toBe(vendor2.id);
  });
});
