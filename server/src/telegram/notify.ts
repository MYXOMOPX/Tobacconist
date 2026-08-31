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

export interface OrderAnnouncer {
  /** Posts the "order is open" message with a Mini App launch button to the group. */
  announceOrderOpened(vendorName: string, orderId: number): Promise<void>;
}

/**
 * Shared by both order-start entry points (spec §5): the `/start_order` bot
 * callback and the Mini App's POST /api/orders route.
 *
 * Several vendors can be collecting at once, so the button carries the order id
 * and the Mini App opens straight on that order rather than on a guess.
 */
export function createOrderAnnouncer(deps: {
  sender: MessageSender;
  groupChatId: string;
  miniAppUrl: string;
}): OrderAnnouncer {
  return {
    async announceOrderOpened(vendorName, orderId) {
      const url = new URL(deps.miniAppUrl);
      url.searchParams.set('order', String(orderId));
      await deps.sender.sendMessage(
        deps.groupChatId,
        `🛍 Заказ открыт (${vendorName})! Жми, чтобы сформировать свой заказ:`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '🛍 Заказать', web_app: { url: url.toString() } }]],
          },
        }
      );
    },
  };
}
