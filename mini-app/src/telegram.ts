interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
}

function getTelegramWebApp(): TelegramWebApp {
  const webApp = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  if (!webApp) {
    throw new Error('Telegram WebApp SDK not available — open this page inside Telegram');
  }
  webApp.ready();
  webApp.expand();
  return webApp;
}

export function getInitData(): string {
  return getTelegramWebApp().initData;
}
