import { describe, it, expect, vi } from 'vitest';
import { createTestDb } from '../db/client';
import { createVendor } from '../domain/vendors';
import { getActiveRound, openRound } from '../domain/rounds';
import { users } from '../db/schema';
import { handleStartRoundCommand, handleStartRoundCallback } from './bot';

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

describe('handleStartRoundCommand', () => {
  it('does nothing when the sender is not the admin', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(999, GROUP_ID);
    await handleStartRoundCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('does nothing when the message is outside the configured group', async () => {
    const db = createTestDb();
    const ctx = fakeCommandCtx(555, '-999');
    await handleStartRoundCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('replies with an inline keyboard of vendors for the admin in the group', async () => {
    const db = createTestDb();
    await createVendor(db, 'Vasya');
    await createVendor(db, 'Petya');
    const ctx = fakeCommandCtx(555, GROUP_ID);
    await handleStartRoundCommand(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID });
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [, opts] = ctx.reply.mock.calls[0];
    expect(opts.reply_markup.inline_keyboard).toEqual([
      [{ text: 'Vasya', callback_data: 'start_round:1' }],
      [{ text: 'Petya', callback_data: 'start_round:2' }],
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

describe('handleStartRoundCallback', () => {
  it('acknowledges the callback but opens nothing for a non-admin sender', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(999, `start_round:${vendor.id}`);
    await handleStartRoundCallback(ctx, { db, adminTelegramId: ADMIN_ID, groupChatId: GROUP_ID, miniAppUrl: MINI_APP_URL });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    expect(await getActiveRound(db)).toBeNull();
  });

  it('opens the round, edits the picker message, and announces with a web_app button', async () => {
    const db = createTestDb();
    const vendor = await createVendor(db, 'Vasya');
    const ctx = fakeCallbackCtx(555, `start_round:${vendor.id}`);
    const round = await handleStartRoundCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      groupChatId: GROUP_ID,
      miniAppUrl: MINI_APP_URL,
    });
    expect(round?.vendorId).toBe(vendor.id);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, , opts] = ctx.api.sendMessage.mock.calls[0];
    expect(chatId).toBe(GROUP_ID);
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Заказать',
      web_app: { url: MINI_APP_URL },
    });
  });

  it('handles openRound throwing "already open" error gracefully', async () => {
    const db = createTestDb();
    const vendor1 = await createVendor(db, 'Vasya');
    const vendor2 = await createVendor(db, 'Petya');

    // Create an admin user and open a round directly to simulate an existing open round
    const [admin] = await db
      .insert(users)
      .values({ telegramId: ADMIN_ID, displayName: 'Admin', role: 'admin', firstSeenAt: new Date().toISOString() })
      .returning()
      .all();
    await openRound(db, vendor1.id, admin.id);

    // Now try to open another round via the callback
    const ctx = fakeCallbackCtx(555, `start_round:${vendor2.id}`);
    const result = await handleStartRoundCallback(ctx, {
      db,
      adminTelegramId: ADMIN_ID,
      groupChatId: GROUP_ID,
      miniAppUrl: MINI_APP_URL,
    });

    // Should not throw, should return undefined, and should edit message with error
    expect(result).toBeUndefined();
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const errorMessage = ctx.editMessageText.mock.calls[0][0];
    expect(errorMessage).toContain('Ошибка');
    expect(errorMessage).toContain('already open');
  });
});
