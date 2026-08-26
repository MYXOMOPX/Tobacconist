import { getInitData } from './telegram';

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
      'X-Telegram-Init-Data': getInitData(),
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
};

export async function uploadAvailabilityImage(
  vendorId: number,
  brandId: number,
  weightId: number,
  file: File
): Promise<{ entries: { name: string; available: boolean }[] }> {
  const form = new FormData();
  form.append('vendorId', String(vendorId));
  form.append('brandId', String(brandId));
  form.append('weightId', String(weightId));
  form.append('image', file);

  const res = await fetch(`${BASE_URL}/admin/availability/parse`, {
    method: 'POST',
    headers: { 'X-Telegram-Init-Data': getInitData() },
    body: form,
  });
  if (!res.ok) return parseErrorAndThrow(res);
  return res.json();
}
