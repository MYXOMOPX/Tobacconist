interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string };
  ready(): void;
  expand(): void;
}

const DEV_USER_KEY = 'tb-dev-user';

function getTelegramWebApp(): TelegramWebApp | null {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

/**
 * Outside Telegram there is nothing to sign with, so the page asks who you are
 * and the server takes it on faith — which it only does when it runs with
 * DEV_NO_TELEGRAM. Remembered, so a reload does not ask again.
 */
function devUserName(): string {
  const stored = window.localStorage.getItem(DEV_USER_KEY);
  if (stored) return stored;

  const name = window.prompt('Имя')?.trim();
  if (!name) throw new Error('Без имени не войти. Обнови страницу и представься.');
  window.localStorage.setItem(DEV_USER_KEY, name);
  return name;
}

/**
 * The order the group's "открыть заказ" button pointed at, if any.
 *
 * A direct link (`t.me/bot/app?startapp=order_5`) delivers it as `start_param`,
 * not as a query string — the app's own url never sees it. The `?order=` form
 * still works for a link opened straight in a browser.
 */
export function orderFromLaunch(): number | null {
  const startParam = getTelegramWebApp()?.initDataUnsafe?.start_param ?? '';
  const fromStart = /^order_(\d+)$/.exec(startParam)?.[1];
  const raw = fromStart ?? new URLSearchParams(window.location.search).get('order');
  const id = Number(raw);
  return raw && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Who the request is from: signed init data inside Telegram, a plain name when
 * the app is opened in a browser for local debugging.
 */
export function authHeaders(): Record<string, string> {
  const webApp = getTelegramWebApp();
  // telegram-web-app.js defines window.Telegram.WebApp in any browser, so the
  // object being there proves nothing — only non-empty initData means Telegram
  // actually launched this page and signed the launch.
  if (!webApp?.initData) return { 'X-Dev-User': devUserName() };

  webApp.ready();
  webApp.expand();
  return { 'X-Telegram-Init-Data': webApp.initData };
}
