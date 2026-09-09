# Observability

How to tell whether InfluenceOS is healthy, what it exposes, what to alert on,
and how to run the monitoring stack. This is the on-call reference for the three
observability pillars in this system: **health/readiness endpoints**, **metrics**,
and **logs**.

## 1. Pillars at a glance

| Pillar | Surface | Consumed by |
|---|---|---|
| Health / readiness | `GET /health`, `GET /ready` (API); `:4100/health` (worker) | Load balancer, orchestrator, on-call |
| Metrics | `GET /metrics` (API, Prometheus text) | Prometheus → alerts + Grafana |
| Logs | Structured JSON (pino) on stdout | Log aggregator; correlate by `x-request-id` |

## 2. Health and readiness endpoints

| Endpoint | Meaning | Codes |
|---|---|---|
| `GET /health` (API) | **Liveness.** Always `200` when the process is serving. Includes release identity + `uptimeSec`. | `200` |
| `GET /ready` (API) | **Readiness.** `200` when the DB is reachable, else `503`. | `200` / `503` |
| `:4100/health` (worker) | Worker health as **JSON** (not Prometheus text). Reports `mode`, counters, and `lastMaintenanceAt`. | `200` |

- **Liveness vs readiness.** `/health` answers "is the process up?" — it stays
  `200` even if the DB is down. `/ready` answers "can it serve requests?" — it
  returns `503` when the DB is unreachable. Wire the orchestrator's readiness
  probe to `/ready`, not `/health`, so an instance with a dead DB is taken out of
  rotation.
- The worker's health is JSON, not Prometheus text — see
  [REDIS_AND_QUEUES.md](./REDIS_AND_QUEUES.md) §6 for its fields.

```bash
curl -s http://api:4000/health   # liveness  (release identity + uptimeSec)
curl -s http://api:4000/ready    # readiness (200 if DB reachable, else 503)
```

## 3. Metrics

The API exposes Prometheus metrics at `GET /metrics` (Prometheus text
exposition).

### 3.1 Internal only — and why

`/metrics` is **INTERNAL ONLY**. The reverse proxy does **not** expose it
publicly; Prometheus must scrape it **over the private network**.

> **Why.** `/metrics` is operational telemetry meant for Prometheus, not the
> public. It is not authenticated the way the app API is, so it must never be
> reachable from the internet. Prometheus runs inside the private network (same
> docker network / VPC) and scrapes the API there. **No secrets are ever
> emitted** in the metrics output.

### 3.2 Metric reference

| Metric | Type / labels | Meaning | Alert on |
|---|---|---|---|
| `influenceos_build_info{version,git_sha,environment}` | constant `1` | Release identity (version, git SHA, environment). Not secret. | — (informational) |
| `influenceos_up` | `1` | Process is up. | `up == 0` (target unscrapable) → **API down** |
| `influenceos_db_up` | `1` / `0` | From the readiness DB check. `0` = DB unreachable. | `== 0` → **DB down** |
| `process_uptime_seconds` | gauge | Process uptime. | Sudden reset ⇒ restart/crash-loop |
| `process_resident_memory_bytes` | gauge | Resident set size (RSS). | `> 1.5GB` for 10m → **high memory** |
| `process_heap_used_bytes` | gauge | V8 heap in use. | Growth trend ⇒ leak investigation |
| `influenceos_http_requests_total{method,route,status}` | counter | Request count. `route` is the matched **route template** (e.g. `/api/v1/brands/:id`); `status` is a **class** (`2xx`/`3xx`/`4xx`/`5xx`). | `5xx` ratio `> 5%` → **elevated errors** |

> **Cardinality.** `route` is always the matched **template** (`/api/v1/brands/:id`),
> never a raw URL, and `status` is a **class** (`2xx`…`5xx`), never a specific
> code. This keeps the metric low-cardinality — do not expect per-ID or
> per-status-code series.

## 4. Alerting rules (exact thresholds)

The rules live in `deploy/observability/alerts.yml`. These are the exact
thresholds:

| Alert | Expression (summary) | For | Severity |
|---|---|---|---|
| `InfluenceOSAPIDown` | `up{job="influenceos-api"} == 0` | **2m** | **critical** |
| `InfluenceOSDatabaseDown` | `influenceos_db_up == 0` | **1m** | **critical** |
| `InfluenceOSHigh5xxRate` | 5xx ratio `> 0.05` (>5%) | **5m** | **warning** |
| `InfluenceOSHighMemory` | `process_resident_memory_bytes > 1.5e9` (>1.5GB RSS) | **10m** | **warning** |

Verbatim from `alerts.yml`:

```yaml
groups:
  - name: influenceos-availability
    rules:
      - alert: InfluenceOSAPIDown
        expr: up{job="influenceos-api"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: 'InfluenceOS API is down'
          description: 'Prometheus cannot scrape the API (/metrics) for 2 minutes. Check the api container and the reverse proxy.'

      - alert: InfluenceOSDatabaseDown
        expr: influenceos_db_up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: 'InfluenceOS database unreachable'
          description: 'The API reports the database is not reachable. /ready is returning 503 and requests will fail.'

  - name: influenceos-errors
    rules:
      - alert: InfluenceOSHigh5xxRate
        expr: |
          sum(rate(influenceos_http_requests_total{status="5xx"}[5m]))
            /
          clamp_min(sum(rate(influenceos_http_requests_total[5m])), 0.001)
            > 0.05
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'Elevated 5xx error rate (>5%)'
          description: 'More than 5% of requests are returning 5xx over the last 5 minutes. Check API logs (correlate by reqId).'

  - name: influenceos-resources
    rules:
      - alert: InfluenceOSHighMemory
        expr: process_resident_memory_bytes{job="influenceos-api"} > 1.5e9
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: 'API memory usage high (>1.5GB RSS)'
          description: 'Resident memory has exceeded 1.5GB for 10 minutes. Investigate for leaks or under-provisioning.'
```

## 5. Running the monitoring stack

The configuration lives in `deploy/observability/`:

| File | Purpose |
|---|---|
| `prometheus.yml` | Scrape config. Scrapes job `influenceos-api` at `api:4000/metrics`; documents where a worker `/metrics` or `node_exporter` would slot in. |
| `alerts.yml` | Alerting rules (§4). |
| `grafana-dashboard.json` | Overview dashboard: API up, DB reachable, build SHA, uptime, request rate by status, 5xx ratio, memory, top routes. |

### 5.1 Point Prometheus at the scrape config

```bash
prometheus --config.file=deploy/observability/prometheus.yml
```

Verbatim `prometheus.yml` scrape config (note the private-network-only scrape and
the commented worker / node_exporter targets):

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    app: influenceos

rule_files:
  - alerts.yml

scrape_configs:
  - job_name: influenceos-api
    metrics_path: /metrics
    static_configs:
      - targets: ['api:4000']
        labels:
          service: api

  # The worker exposes JSON health at :4100/health (not Prometheus text). Use a
  # blackbox/JSON exporter for it, or rely on the healthcheck + logs. Left here
  # as a documented target for when a worker /metrics is added.
  # - job_name: influenceos-worker
  #   metrics_path: /metrics
  #   static_configs:
  #     - targets: ['worker:4100']

  # Host/node metrics (optional): run node_exporter and uncomment.
  # - job_name: node
  #   static_configs:
  #     - targets: ['node-exporter:9100']
```

Prometheus must run **inside the private network** (same docker network / VPC) so
it can reach `api:4000/metrics` — never over the public proxy.

### 5.2 Import the Grafana dashboard

Import `deploy/observability/grafana-dashboard.json` into Grafana (Dashboards →
Import → upload JSON). It gives the overview: API up, DB reachable, build SHA,
uptime, request rate by status, 5xx ratio, memory, and top routes.

### 5.3 Wire Alertmanager (production)

Alertmanager (Slack / email / PagerDuty) is the **recommended notification
path**. It is **commented out** in `prometheus.yml` — wire it up in production:

```yaml
# Alerting via Alertmanager (optional but recommended for production).
# alerting:
#   alertmanagers:
#     - static_configs:
#         - targets: ['alertmanager:9093']
```

Until Alertmanager is wired up, rules in `alerts.yml` evaluate but do not
notify anyone.

## 6. Logs

Logging is **structured JSON (pino)** on stdout. The API emits **one access line
per request** with these fields:

| Field | Meaning |
|---|---|
| `reqId` | Request correlation id |
| `method` | HTTP method |
| `url` | Request URL |
| `route` | Matched route template |
| `statusCode` | HTTP status |
| `responseTimeMs` | Request latency in ms |
| `actorId` | Authenticated actor |

- **Secret redaction.** Secret headers — `authorization`, `cookie`, `set-cookie`,
  `x-api-key` — are **redacted** in logs.
- **Request-id correlation.** Every response and error body carries a correlated
  **`x-request-id`**. It honours an inbound `x-request-id` if present, otherwise
  generates `req_<uuid>`. The same id appears as `reqId` in the access log, so a
  user-reported failure (they can read `x-request-id` off the response/error) maps
  directly to its log line.

```bash
# Correlate a reported failure by its x-request-id:
grep '"reqId":"req_1234-abcd"' /var/log/influenceos/api.log
```

## 7. What to watch (SLO-style)

The four signals to watch, and where each comes from in this system:

| Signal | Where to read it | Threshold / alert |
|---|---|---|
| **Availability** | `influenceos_up` / `up` (API up) and `/ready` + `influenceos_db_up` (DB reachable) | `InfluenceOSAPIDown` (`up==0`, 2m, critical); `InfluenceOSDatabaseDown` (`influenceos_db_up==0`, 1m, critical) |
| **Error rate** | `5xx` ratio from `influenceos_http_requests_total` | `InfluenceOSHigh5xxRate` (>5% over 5m, warning) |
| **Latency** | `responseTimeMs` in the access logs | No metric alert — inspect logs; correlate slow requests by `reqId` |
| **Saturation** | `process_resident_memory_bytes` (RSS); `process_heap_used_bytes` | `InfluenceOSHighMemory` (>1.5GB RSS for 10m, warning) |

On-call flow: an alert fires (§4) → confirm on the Grafana overview (§5.2) →
drill into logs correlated by `reqId` / `x-request-id` (§6).
