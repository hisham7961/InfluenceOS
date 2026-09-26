import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  createContext,
  createServices,
  systemContext,
  type Actor,
  type Services,
} from '@influenceos/domain';
import { API_ACCESS_COOKIE, type ReportDTO } from '@influenceos/contracts';
import { toCsv } from '@influenceos/shared';
import { csvHeader, type CsvLocale } from './lib/csv-labels';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

/** Extract a bearer token from the Authorization header or an access cookie. */
export function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = (request as { cookies?: Record<string, string> }).cookies?.[API_ACCESS_COOKIE];
  return cookie ?? null;
}

/** Resolve the current actor from the request's bearer token (stateless). */
export async function resolveActor(request: FastifyRequest): Promise<Actor | null> {
  const token = extractToken(request);
  if (!token) return null;
  const services = createServices(systemContext());
  return services.auth.authenticate(token);
}

/** Build the per-request domain services bound to the authenticated actor. */
export function servicesFor(request: FastifyRequest): Services {
  return createServices(
    createContext({ actor: request.actor ?? null, env: process.env, requestId: request.id }),
  );
}

/** preHandler: require any authenticated user. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.actor) {
    const err = new Error('Authentication required.') as Error & { statusCode?: number; code?: string };
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    throw err;
  }
}

/** preHandler: require an ADMIN user. */
export async function requireAdmin(request: FastifyRequest): Promise<void> {
  await requireAuth(request);
  if (request.actor?.role !== 'ADMIN') {
    const err = new Error('Administrator access required.') as Error & { statusCode?: number; code?: string };
    err.statusCode = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }
}

/** RFC-4180 cell escaping: quote when the value contains a comma, quote or newline. */
/** Convert a report DTO into CSV text (mobile/web share the same source). */
export function reportToCsv(report: ReportDTO, locale: CsvLocale = 'en'): string {
  return toCsv(
    report.columns.map((c) => csvHeader(c.label, locale)),
    report.rows.map((row) => report.columns.map((c) => row[c.key] ?? null)),
  );
}

/** Generic CSV writer: ordered {key,label} columns → header row + data rows. */
export function rowsToCsv<T>(
  columns: { key: keyof T & string; label: string }[],
  rows: T[],
  locale: CsvLocale = 'en',
): string {
  return toCsv(
    columns.map((c) => csvHeader(c.label, locale)),
    rows.map((row) => columns.map((c) => row[c.key])),
  );
}

/** CSV header language: an explicit ?locale=, else the user's own language setting. */
export async function csvLocale(req: FastifyRequest, explicit?: string): Promise<CsvLocale> {
  if (explicit === 'ar' || explicit === 'en') return explicit;
  try {
    return (await servicesFor(req).auth.me()).locale === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function sendCsv(reply: FastifyReply, filename: string, csv: string): void {
  reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .send(csv);
}
