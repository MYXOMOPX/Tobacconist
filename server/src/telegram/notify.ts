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
