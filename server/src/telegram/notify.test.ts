import { describe, it, expect, vi } from 'vitest';
import { createRoundAnnouncer, type MessageSender } from './notify';

describe('createRoundAnnouncer', () => {
  it('posts the vendor name and a Mini App launch button to the group chat', async () => {
    const sender: MessageSender = { sendMessage: vi.fn().mockResolvedValue(undefined) };
    const announcer = createRoundAnnouncer({
      sender,
      groupChatId: '-1001',
      miniAppUrl: 'https://example.com/app',
    });

    await announcer.announceRoundOpened('Vasya');

    expect(sender.sendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, opts] = vi.mocked(sender.sendMessage).mock.calls[0] as [
      string,
      string,
      { reply_markup: { inline_keyboard: unknown[][] } }
    ];
    expect(chatId).toBe('-1001');
    expect(text).toContain('Vasya');
    expect(opts.reply_markup.inline_keyboard[0][0]).toEqual({
      text: '🛍 Заказать',
      web_app: { url: 'https://example.com/app' },
    });
  });
});
