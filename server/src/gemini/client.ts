import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiClient {
  generateFromImage(params: { imageBase64: string; mimeType: string; prompt: string }): Promise<string>;
}

export function createGeminiClient(apiKey: string): GeminiClient {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  return {
    async generateFromImage({ imageBase64, mimeType, prompt }) {
      const result = await model.generateContent([
        { inlineData: { data: imageBase64, mimeType } },
        { text: prompt },
      ]);
      return result.response.text();
    },
  };
}
