import { authHeaders } from './telegram';

const BASE_URL = '/api';

async function parseErrorAndThrow(res: Response): Promise<never> {
  const payload = await res.json().catch(() => ({ error: res.statusText }));
  throw new Error(payload.error ?? `request failed with status ${res.status}`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return parseErrorAndThrow(res);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export type ParsedScreenshot = {
  /** What the screenshot said, verbatim — shown when it did not match the catalogue. */
  detectedBrandName: string | null;
  brandId: number | null;
  detectedGrams: number | null;
  weightId: number | null;
  /** `originalName` is set when the server corrected a misspelling to a known name. */
  entries: { name: string; available: boolean; originalName?: string }[];
};

export async function uploadAvailabilityImage(
  vendorId: number,
  file: File
): Promise<ParsedScreenshot> {
  const form = new FormData();
  form.append('vendorId', String(vendorId));
  form.append('image', file);

  const res = await fetch(`${BASE_URL}/admin/availability/parse`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!res.ok) return parseErrorAndThrow(res);
  return res.json();
}
