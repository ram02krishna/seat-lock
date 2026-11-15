const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').trim().replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  data: any;
  attendee?: any;
  checkedInAt?: any;

  constructor(message: string, status: number, data: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    if (data && typeof data === 'object') {
      Object.assign(this, data);
    }
  }
}

export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers = new Headers(options.headers);
  // Only JSON requests need this header. Sending it on every GET triggers avoidable CORS
  // preflights, and forcing it on FormData would prevent the browser from setting its boundary.
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data.error || data.message || `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}
