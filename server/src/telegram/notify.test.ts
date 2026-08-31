import { describe, it, expect, vi } from 'vitest';
import { createOrderAnnouncer, type MessageSender } from './notify';

describe('createOrderAnnouncer', () => {
  it('posts the vendor name and a Mini App launch button to the group chat', async () => {
    const sender: MessageSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const announcer = createOrderAnnouncer({
      sender,
      groupChatId: '-1001',
      miniAppUrl: 'https://example.com/app',
    });

    await announcer.announceOrderOpened('Vasya', 42);

    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = vi.mocked(sender.sendMessage).mock.calls[0] as [
      string,
      string,
      { reply_markup: { inline_keyboard: unknown[][] } }
    ];
    expect(chatId).toBe('-1001');
    expect(text).toContain('Vasya');
    // The button carries the order id: several vendors can be collecting at once.
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Заказать',
      web_app: { url: 'https://example.com/app?order=42' },
    });
  });
});
