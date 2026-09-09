import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FEATURES } from '@influenceos/contracts';
import { makeApp } from './helpers.ts';

/**
 * Contract tests — the OpenAPI document IS the API contract for Web and future
 * mobile clients. These machine-verify ONE readiness dimension: that every
 * endpoint the Feature Registry advertises as READY actually exists in the
 * running API's OpenAPI document, and that the typed client exposes a method
 * for the core ones.
 *
 * This does NOT prove Web implementation, mobile readiness, authorization
 * correctness, or semantic completeness — those are verified elsewhere
 * (authz.test.ts for admin enforcement, the integration/DoD suites and the
 * Playwright browser journey for behavior) or by manual review. See
 * docs/FINAL_VERIFICATION.md → "Readiness dimensions" for which is which.
 */

/** Normalize a route to method + path with param names erased ({id} ≡ :id ≡ {x}). */
function normalize(method: string, path: string): string {
  const p = path
    .replace(/\{[^}]+\}/g, '{}')
    .replace(/:[A-Za-z0-9_]+/g, '{}')
    .replace(/\/$/, '');
  return `${method.toUpperCase()} ${p}`;
}

describe('contract — OpenAPI document', () => {
  let app: FastifyInstance;
  let spec: {
    openapi: string;
    info: { version: string };
    paths: Record<string, Record<string, unknown>>;
    components?: { securitySchemes?: Record<string, unknown> };
  };
  let available: Set<string>;

  beforeAll(async () => {
    app = await makeApp();
    await app.ready();
    spec = app.swagger() as typeof spec;
    available = new Set<string>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        available.add(normalize(method, path));
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('is a valid, versioned OpenAPI 3 document with bearer security', () => {
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.version).toBeTruthy();
    expect(spec.components?.securitySchemes).toHaveProperty('bearerAuth');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(40);
  });

  it('exposes every path under the /api/v1 version prefix', () => {
    for (const path of Object.keys(spec.paths)) {
      // health/docs/openapi live outside the versioned surface by design.
      if (/^\/(health|api\/docs|api\/openapi)/.test(path)) continue;
      expect(path.startsWith('/api/v1/')).toBe(true);
    }
  });

  it('backs every READY feature endpoint in the registry with a real route', () => {
    const missing: string[] = [];
    for (const feature of FEATURES) {
      if (feature.apiStatus !== 'READY') continue;
      for (const endpoint of feature.apiEndpoints) {
        const [method, rawPath] = endpoint.split(/\s+/, 2);
        if (!method || !rawPath) continue;
        if (!available.has(normalize(method, rawPath))) {
          missing.push(`${feature.key}: ${endpoint}`);
        }
      }
    }
    expect(missing, `Registry advertises endpoints that don't exist:\n${missing.join('\n')}`).toEqual([]);
  });

  it('documents the two-phase file upload contract', () => {
    expect(available.has(normalize('POST', '/api/v1/files'))).toBe(true);
    expect(available.has(normalize('POST', '/api/v1/files/complete'))).toBe(true);
    expect(available.has(normalize('GET', '/api/v1/files/{}/blob'))).toBe(true);
  });

  it('has a real Web page for each READY web feature that claims a route', async () => {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const webApp = join(process.cwd(), '..', 'web', 'src', 'app', '(app)');
    // Curated feature → expected web page directory (machine-checked existence).
    const WEB_ROUTES: Record<string, string> = {
      auth: '../login',
      brands: 'brands',
      influencers: 'influencers',
      campaigns: 'campaigns',
      content: 'content',
      calendar: 'calendar',
      reports: 'reports',
      files: 'campaigns', // attachments surface inside the campaign workspace
      storage_admin: 'settings/storage',
      audit_admin: 'settings/audit',
    };
    const missing: string[] = [];
    for (const [key, route] of Object.entries(WEB_ROUTES)) {
      const feature = FEATURES.find((f) => f.key === key);
      if (!feature || feature.webStatus !== 'READY') continue;
      if (!existsSync(join(webApp, route, 'page.tsx'))) missing.push(`${key} → ${route}/page.tsx`);
    }
    expect(missing, `READY web features without a page:\n${missing.join('\n')}`).toEqual([]);
  });

  it('exposes the core operations through the typed client (client-method availability)', async () => {
    const { createClient } = await import('@influenceos/api-client');
    const client = createClient({ baseUrl: 'http://localhost:4000' });
    // A representative slice across modules — the Web and mobile clients depend
    // on these existing.
    expect(typeof client.auth.login).toBe('function');
    expect(typeof client.auth.refresh).toBe('function');
    expect(typeof client.auth.changePassword).toBe('function');
    expect(typeof client.files.initiate).toBe('function');
    expect(typeof client.files.complete).toBe('function');
    expect(typeof client.platform.storage).toBe('function');
    expect(typeof client.platform.audit).toBe('function');
  });
});
