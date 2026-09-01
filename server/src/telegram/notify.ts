import type { OrderStatus } from '../domain/orders.js';

/** The slice of grammY's `bot.api` (or a ctx's `api`) that announcements need. */
export interface MessageSender {
  sendMessage(chatId: string | number, text: string, opts?: unknown): Promise<unknown>;
}

export interface OrderAnnouncer {
  /** Posts the "order is open" message with a Mini App launch button to the group. */
  announceOrderOpened(vendorName: string, orderId: number): Promise<void>;
  /** Tells the group the order moved on — collection closed, finished, cancelled. */
  announceStatusChanged(vendorName: string, orderId: number, status: OrderStatus): Promise<void>;
}

/**
 * Stand-in for when the server runs without Telegram (config `devNoTelegram`):
 * there is no chat to announce into, and a missing announcement must not fail
 * the request that moved the order.
 */
export function createLoggingOrderAnnouncer(
  log: (message: string) => void = console.log
): OrderAnnouncer {
  return {
    async announceOrderOpened(vendorName, orderId) {
      log(`[dev] order ${orderId} opened at ${vendorName} — announcement skipped, no Telegram`);
    },
    async announceStatusChanged(vendorName, orderId, status) {
      log(`[dev] order ${orderId} (${vendorName}) is now ${status} — announcement skipped`);
    },
  };
}

/**
 * What the group is told when an order changes hands. `null` means the move is
 * not worth a message of its own.
 */
function statusNotice(vendorName: string, status: OrderStatus): string | null {
  switch (status) {
    case 'ordering':
      return `↩️ Заказ (${vendorName}) снова открыт — можно поправить свои позиции.`;
    case 'awaiting_validation':
      return `📦 Сбор закрыт (${vendorName}). Идёт сверка поставки, заказы больше не меняются.`;
    case 'done':
      return `✅ Заказ (${vendorName}) завершён. Загляни, что тебе досталось и сколько платить.`;
    case 'rejected':
      return `❌ Заказ (${vendorName}) отменён.`;
    default:
      return null;
  }
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
  /** BotFather's direct link to the Mini App; empty means "post without a button". */
  miniAppLink: string;
}): OrderAnnouncer {
  /**
   * A `web_app` button is only valid in a private chat with the bot — used in a
   * group it is what Telegram rejects as BUTTON_TYPE_INVALID. From a group the
   * one-tap way in is a plain url button holding the Mini App's direct link,
   * whose `startapp` parameter reaches the app as `start_param`.
   */
  function launchButton(orderId: number) {
    if (!deps.miniAppLink) return undefined;
    return {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛍 Открыть заказ', url: `${deps.miniAppLink}?startapp=order_${orderId}` }],
        ],
      },
    };
  }

  async function post(text: string, orderId: number) {
    await deps.sender.sendMessage(deps.groupChatId, text, launchButton(orderId));
  }

  return {
    async announceOrderOpened(vendorName, orderId) {
      await post(`🛍 Заказ открыт (${vendorName})! Жми, чтобы сформировать свой заказ:`, orderId);
    },

    async announceStatusChanged(vendorName, orderId, status) {
      const text = statusNotice(vendorName, status);
      if (text) await post(text, orderId);
    },
  };
}
