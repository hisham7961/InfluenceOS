import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FEATURES } from '@influenceos/contracts';
import { makeApp } from './helpers.ts';

/**
 * Contract tests — the OpenAPI document IS the product contract for Web and
 * future mobile clients. These assert (a) the spec is well-formed and versioned
 * and (b) every endpoint the Feature Registry advertises as READY actually
 * exists in the running API. That makes the registry honest by construction:
 * you cannot mark a feature READY and ship a doc that lies about its routes.
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
});
