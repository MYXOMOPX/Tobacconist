interface TelegramWebApp {
  initData: string;
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
 * Who the request is from: signed init data inside Telegram, a plain name when
 * the app is opened in a browser for local debugging.
 */
export function authHeaders(): Record<string, string> {
  const webApp = getTelegramWebApp();
  if (!webApp) return { 'X-Dev-User': devUserName() };

  webApp.ready();
  webApp.expand();
  return { 'X-Telegram-Init-Data': webApp.initData };
}
