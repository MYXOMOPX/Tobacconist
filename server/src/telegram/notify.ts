import { Bot, InputFile } from 'grammy';

export interface DocumentSender {
  sendDocument(chatId: string | number, buffer: Buffer, filename: string): Promise<void>;
}

export function createDocumentSender(bot: Bot): DocumentSender {
  return {
    async sendDocument(chatId, buffer, filename) {
      await bot.api.sendDocument(chatId, new InputFile(buffer, filename));
    },
  };
}

/** The slice of grammY's `bot.api` (or a ctx's `api`) that announcements need. */
export interface MessageSender {
  sendMessage(chatId: string | number, text: string, opts?: unknown): Promise<unknown>;
}

export interface RoundAnnouncer {
  /** Posts the "order is open" message with a Mini App launch button to the group. */
  announceRoundOpened(vendorName: string): Promise<void>;
}

/**
 * Shared by both round-start entry points (spec §5): the `/start_round` bot
 * callback and the Mini App's POST /api/rounds route.
 */
export function createRoundAnnouncer(deps: {
  sender: MessageSender;
  groupChatId: string;
  miniAppUrl: string;
}): RoundAnnouncer {
  return {
    async announceRoundOpened(vendorName) {
      await deps.sender.sendMessage(
        deps.groupChatId,
        `🛍 Заказ открыт (${vendorName})! Жми, чтобы сформировать свой заказ:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🛍 Заказать', web_app: { url: deps.miniAppUrl } }]],
          },
        }
      );
    },
  };
}
