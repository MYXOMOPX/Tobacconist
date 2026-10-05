/**
 * What went wrong with the vision/text model, in words the admin can act on.
 * The raw provider message is kept after the explanation for the logs and for
 * whoever debugs it: "Ой, не удалось распарсить скрин" tells nobody anything.
 */
export type GeminiErrorCode =
  | 'quota'
  | 'auth'
  | 'model'
  | 'overloaded'
  | 'timeout'
  | 'not_configured'
  | 'agy_missing'
  | 'bad_response'
  | 'unknown';

const EXPLANATIONS: Record<GeminiErrorCode, { text: string; status: number }> = {
  quota: {
    text: 'Исчерпан лимит запросов к Gemini. Подожди (лимит обновляется) или переключи GEMINI_BACKEND на agy.',
    status: 429,
  },
  auth: {
    text: 'Gemini отклонил ключ или доступ (проверь GEMINI_API_KEY или вход в agy).',
    status: 502,
  },
  model: {
    text: 'Такой модели нет у Gemini. Проверь GEMINI_MODEL: id мог устареть или быть написан неверно.',
    status: 502,
  },
  overloaded: {
    text: 'Gemini перегружен и не ответил после нескольких попыток. Попробуй чуть позже.',
    status: 503,
  },
  timeout: {
    text: 'Gemini слишком долго не отвечал. Попробуй ещё раз или выбери модель побыстрее.',
    status: 504,
  },
  not_configured: {
    text: 'Распознавание скринов не настроено: нет GEMINI_API_KEY (или выбери GEMINI_BACKEND=agy).',
    status: 503,
  },
  agy_missing: {
    text: 'Не найдена программа agy на сервере. Установи её или задай путь в AGY_PATH.',
    status: 503,
  },
  bad_response: {
    text: 'Модель ответила не в том формате, поэтому скрин не разобрать. Попробуй ещё раз.',
    status: 502,
  },
  unknown: {
    text: 'Распознавание не удалось по неизвестной причине.',
    status: 502,
  },
};

export class GeminiError extends Error {
  readonly code: GeminiErrorCode;
  /** Fastify turns this into the HTTP status of the reply. */
  readonly statusCode: number;

  constructor(code: GeminiErrorCode, detail?: string) {
    const { text, status } = EXPLANATIONS[code];
    super(detail ? `${text} (${detail})` : text);
    this.name = 'GeminiError';
    this.code = code;
    this.statusCode = status;
  }
}

/** Sorts a provider/transport failure into a `GeminiError`; passes ours through. */
export function classifyGeminiError(err: unknown): GeminiError {
  if (err instanceof GeminiError) return err;
  const detail = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 300);
  const text = detail.toLowerCase();

  let code: GeminiErrorCode = 'unknown';
  if (/\b429\b|quota|rate.?limit|resource.?exhausted|too many requests|exceeded/.test(text)) code = 'quota';
  else if (/\b(401|403)\b|api key|permission|unauthenticated|unauthorized|not logged in|login/.test(text)) code = 'auth';
  else if (/\b404\b|not found|not recognized|invalid model|is not supported/.test(text)) code = 'model';
  else if (/\b(500|502|503|504)\b|overloaded|unavailable/.test(text)) code = 'overloaded';
  else if (/timeout|timed out|etimedout|econnreset|killed/.test(text)) code = 'timeout';
  return new GeminiError(code, detail);
}
