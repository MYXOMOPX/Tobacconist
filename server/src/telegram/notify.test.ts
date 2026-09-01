import { describe, it, expect, vi } from 'vitest';
import { createOrderAnnouncer, createLoggingOrderAnnouncer, type MessageSender } from './notify';

const LINK = 'https://t.me/mybot/order';

function announcer(miniAppLink = LINK) {
  const sender: MessageSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
  return {
    sender,
    announcer: createOrderAnnouncer({ sender, groupChatId: '-1001', miniAppLink }),
    lastCall: () =>
      vi.mocked(sender.sendMessage).mock.calls.at(-1) as [
        string,
        string,
        { reply_markup: { inline_keyboard: { text: string; url?: string }[][] } } | undefined,
      ],
  };
}

describe('createOrderAnnouncer', () => {
  /**
   * The regression this guards: a `web_app` button is only valid in a private
   * chat, so posting one to the group came back as 400 BUTTON_TYPE_INVALID.
   */
  it('opens the order with a url button, never a web_app one', async () => {
    const { announcer: a, lastCall } = announcer();

    await a.announceOrderOpened('Vasya', 42);

    const [chatId, text, opts] = lastCall();
    expect(chatId).toBe('-1001');
    expect(text).toContain('Vasya');
    // The link carries the order id: several vendors can be collecting at once.
    expect(opts!.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Открыть заказ',
      url: 'https://t.me/mybot/order?startapp=order_42',
    });
  });

  it('posts without a button when no direct link is configured', async () => {
    const { announcer: a, lastCall } = announcer('');

    await a.announceOrderOpened('Vasya', 42);

    const [, text, opts] = lastCall();
    expect(text).toContain('Vasya');
    expect(opts).toBeUndefined();
  });

  it('tells the group when collection closes, finishes or is cancelled', async () => {
    const { announcer: a, sender, lastCall } = announcer();

    await a.announceStatusChanged('Vasya', 42, 'awaiting_validation');
    expect(lastCall()[1]).toContain('Сбор закрыт');

    await a.announceStatusChanged('Vasya', 42, 'done');
    expect(lastCall()[1]).toContain('завершён');

    await a.announceStatusChanged('Vasya', 42, 'rejected');
    expect(lastCall()[1]).toContain('отменён');

    await a.announceStatusChanged('Vasya', 42, 'ordering');
    expect(lastCall()[1]).toContain('снова открыт');

    expect(sender.sendMessage).toHaveBeenCalledTimes(4);
    // Every notice carries the way back into that same order.
    expect(lastCall()[2]!.reply_markup.inline_keyboard[0][0].url).toContain('startapp=order_42');
  });
});

describe('createLoggingOrderAnnouncer', () => {
  it('logs instead of posting, so dev mode never fails on a missing chat', async () => {
    const log = vi.fn();
    const a = createLoggingOrderAnnouncer(log);

    await a.announceOrderOpened('Vasya', 42);
    await a.announceStatusChanged('Vasya', 42, 'done');

    expect(log).toHaveBeenCalledTimes(2);
  });
});
