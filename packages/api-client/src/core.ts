import type { ApiErrorBody, ApiErrorCode, FieldError } from '@influenceos/contracts';

/** Error thrown by the client for any non-2xx response (typed, mobile-safe). */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly fieldErrors?: FieldError[];
  readonly requestId?: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.fieldErrors = body.fieldErrors;
    this.requestId = body.requestId;
    this.details = body.details;
  }

  get isAuth(): boolean {
    return this.code === 'UNAUTHORIZED';
  }
}

export type TokenProvider = string | null | undefined | (() => string | null | undefined | Promise<string | null | undefined>);

export interface ClientConfig {
  /** Base API origin, e.g. http://localhost:4000 (no trailing slash needed). */
  baseUrl: string;
  /** Access token or a (possibly async) getter. Sent as Authorization: Bearer. */
  token?: TokenProvider;
  /** Custom fetch (defaults to global fetch). Useful for SSR / tests. */
  fetch?: typeof fetch;
  /** Extra headers applied to every request. */
  headers?: Record<string, string>;
  /** Send cookies (web). Defaults to 'include' so the web cookie transport works. */
  credentials?: RequestCredentials;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  /** Return the raw Response instead of parsed JSON (e.g. CSV downloads). */
  raw?: boolean;
  headers?: Record<string, string>;
}

async function resolveToken(token: TokenProvider): Promise<string | null | undefined> {
  return typeof token === 'function' ? token() : token;
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class HttpCore {
  constructor(private readonly config: ClientConfig) {}

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const fetchFn = this.config.fetch ?? fetch;
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}${buildQuery(opts.query)}`;
    const token = await resolveToken(this.config.token);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.config.headers,
      ...opts.headers,
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetchFn(url, {
      method,
      headers,
      credentials: this.config.credentials ?? 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (opts.raw) {
      if (!res.ok) await this.throwError(res);
      return res as unknown as T;
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    const data = text ? safeJson(text) : undefined;

    if (!res.ok) {
      const body = (data as ApiErrorBody | undefined)?.error ?? {
        code: 'INTERNAL' as ApiErrorCode,
        message: `Request failed with status ${res.status}`,
      };
      throw new ApiError(res.status, body);
    }
    return data as T;
  }

  private async throwError(res: Response): Promise<never> {
    let body: ApiErrorBody['error'] = { code: 'INTERNAL', message: `Request failed (${res.status})` };
    try {
      const json = (await res.json()) as ApiErrorBody;
      if (json?.error) body = json.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, body);
  }

  get<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('GET', path, opts);
  }
  post<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('POST', path, { ...opts, body });
  }
  patch<T>(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  del<T>(path: string, opts?: RequestOptions) {
    return this.request<T>('DELETE', path, opts);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
