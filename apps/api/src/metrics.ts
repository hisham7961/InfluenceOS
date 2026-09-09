/**
 * Minimal, dependency-free Prometheus metrics.
 *
 * Deliberately hand-rolled (no prom-client) to keep the production supply chain
 * small. Exposes exactly what an operator needs to build dashboards and alerts:
 * a build-info label set, process gauges, and an HTTP request counter split by
 * method / status class / route template. Cardinality is kept low on purpose —
 * we bucket status into 2xx/3xx/4xx/5xx and use the matched route template
 * (e.g. /api/v1/brands/:id), never the raw URL, so metrics never explode or
 * leak identifiers.
 */
import { releaseInfo } from './release';

type Labels = Record<string, string>;

const httpTotals = new Map<string, { labels: Labels; value: number }>();

function key(labels: Labels): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

function statusClass(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return 'other';
}

/** Record one completed request. `route` should be the route template. */
export function recordHttp(method: string, route: string, status: number): void {
  const labels: Labels = { method: method.toUpperCase(), route, status: statusClass(status) };
  const k = key(labels);
  const existing = httpTotals.get(k);
  if (existing) existing.value += 1;
  else httpTotals.set(k, { labels, value: 1 });
}

function esc(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function line(name: string, labels: Labels, value: number): string {
  const inner = Object.entries(labels)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(',');
  return inner ? `${name}{${inner}} ${value}` : `${name} ${value}`;
}

/** Render the current metrics in Prometheus text exposition format. */
export function renderMetrics(dbUp: boolean): string {
  const rel = releaseInfo();
  const mem = process.memoryUsage();
  const out: string[] = [];

  out.push('# HELP influenceos_build_info Build identity of the running API (constant 1).');
  out.push('# TYPE influenceos_build_info gauge');
  out.push(
    line('influenceos_build_info', { version: rel.version, git_sha: rel.gitSha, environment: rel.environment }, 1),
  );

  out.push('# HELP influenceos_up Whether the API process is serving (always 1 when scraped).');
  out.push('# TYPE influenceos_up gauge');
  out.push(line('influenceos_up', {}, 1));

  out.push('# HELP influenceos_db_up Whether the database was reachable at the last readiness check.');
  out.push('# TYPE influenceos_db_up gauge');
  out.push(line('influenceos_db_up', {}, dbUp ? 1 : 0));

  out.push('# HELP process_uptime_seconds Process uptime in seconds.');
  out.push('# TYPE process_uptime_seconds gauge');
  out.push(line('process_uptime_seconds', {}, Math.round(process.uptime())));

  out.push('# HELP process_resident_memory_bytes Resident set size in bytes.');
  out.push('# TYPE process_resident_memory_bytes gauge');
  out.push(line('process_resident_memory_bytes', {}, mem.rss));

  out.push('# HELP process_heap_used_bytes V8 heap used in bytes.');
  out.push('# TYPE process_heap_used_bytes gauge');
  out.push(line('process_heap_used_bytes', {}, mem.heapUsed));

  out.push('# HELP influenceos_http_requests_total Total HTTP requests by method, route and status class.');
  out.push('# TYPE influenceos_http_requests_total counter');
  for (const { labels, value } of httpTotals.values()) {
    out.push(line('influenceos_http_requests_total', labels, value));
  }

  return out.join('\n') + '\n';
}

/** Test helper — clear accumulated counters. */
export function resetMetrics(): void {
  httpTotals.clear();
}
