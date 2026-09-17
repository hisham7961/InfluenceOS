# InfluenceOS — Settings Reality Matrix

**Audit HEAD:** `85b6c852` · Reviewer: settings-reality specialist, every verdict proven by grepping for the *consumer* of the stored value; lead-adjudicated where a live test contradicted a static claim.

**Legend:** REAL = changing it actually alters runtime behaviour · DECORATIVE = renders/saves but nothing consumes it · SERVER-ONLY-OK = correctly not exposed (secret/internal) · MISSING = backend capability an admin should control but has no UI/API.

**Counts:** REAL 12 · DECORATIVE 9 · SERVER-ONLY-OK 4 · MISSING admin controls 11.

**Headline:** the entire `PATCH /platform/client-config` surface has **no web UI and no runtime consumer**, and **feature flags — the one fully wired admin toggle — gate nothing**. No recommendation moves any secret to the browser.

---

## Matrix

| Setting | UI | API | Persistence | AuthZ | Actual consumer | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Feature flag toggles | Platform→Flags | `PATCH /platform/flags/:key` | `PlatformFlag` | ADMIN | **none** — only echoed in client-config `enabledFeatures` (`platform.service.ts:336`), which the web never reads | **DECORATIVE** |
| `maintenanceMode` | — | `PATCH /platform/client-config` | `ClientConfig` | ADMIN | **none** — no middleware/gate anywhere | **DECORATIVE** |
| `maintenanceMessage` | — | client-config | `ClientConfig` | ADMIN | echoed only | **DECORATIVE** |
| `defaultLanguage` / `supportedLanguages` | — | client-config | `ClientConfig` | ADMIN | i18n uses the **cookie** only (`i18n/request.ts:14`) | **DECORATIVE** |
| `maxUploadMb` | — | client-config | `ClientConfig` | ADMIN | real limit is **env `MAX_UPLOAD_MB`** via `maxUploadBytes()` (`attachment.service.ts:37`); DB value only echoed | **DECORATIVE** |
| `supportInfo` | — | client-config | `ClientConfig` | ADMIN | echoed only | **DECORATIVE** |
| `IntegrationSetting.config` (provider creds) | Integrations | `PATCH /integrations/:p` | `IntegrationSetting` | ADMIN | **never read** — adapters use `credentialsFromEnv()` (`context.ts:33-48`) | **DECORATIVE** (+ SEC-11: stored plaintext) |
| Integration **enable** toggle | Integrations | `PATCH /integrations/:p` | `IntegrationSetting.isEnabled` | ADMIN | gates worker monitoring (`processors.ts:40`) | **REAL** |
| Integration **test** | Integrations | `POST /integrations/:p/test` | — | ADMIN | live provider probe | **REAL** |
| **Theme** (account) | Settings→General + topbar | `PATCH /auth/me/preferences` | `User.theme` | self | applied at login → `theme` cookie → layout (`login/route.ts:33`, `layout.tsx:26`). **Live-adjudicated REAL** (cross-device on next login; not live-reactive). *(Corrects the static "decorative" claim.)* | **REAL** |
| **Locale** (account) | Settings→General + topbar | `PATCH /auth/me/preferences` | `User.locale` | self | same bridge; `i18n/request.ts:14` reads the cookie | **REAL** |
| Create / list users | Settings→Users | `POST/GET /users` | `User` | ADMIN | real | **REAL** |
| Change password (+revoke sessions) | Settings→Security | `POST /auth/change-password` | `User`, sessions | self | real (but access token lingers ≤15m — SEC-03) | **REAL** |
| Session list / revoke | Settings→Security | `GET/DELETE /auth/sessions` | `DeviceSession` | self | real | **REAL** |
| Admin audit log | Settings→Audit | `GET /platform/audit` | `ActivityLog`/`AuditLog` | ADMIN | real read | **REAL** |
| Storage / platform status screens | Settings→Storage/Platform | `GET /platform/*` | — | ADMIN | real read-only | **REAL** |
| S3 keys / `AUTH_SECRET` / provider tokens | — | — | env | — | server-side only (`context.ts:37-47`) | **SERVER-ONLY-OK** |
| AppVersion rules | — | `PATCH /platform/app-versions/:p` | `AppVersion` | ADMIN | mobile-readiness API (no UI; no mobile app yet) | SERVER-ONLY-OK (no UI needed yet) |

## Decorative settings (ship a control that does nothing)
1. Feature flags (gate nothing) · 2. `maintenanceMode` (no enforcement) · 3. `maintenanceMessage` · 4. `defaultLanguage`/`supportedLanguages` · 5. `maxUploadMb` (real value is env) · 6. `supportInfo` · 7. `IntegrationSetting.config` credentials (never read; adapters use env). **The whole `client-config` write surface is unreachable from the web (`updateClientConfig` never called) and unread by the web.**

**Recommendation:** either wire each of these to a real consumer or remove the control. Highest value: (a) implement a real `maintenanceMode` gate in `middleware.ts` + a banner from `maintenanceMessage`; (b) make feature flags actually gate features (a `useFlag()`/server guard); (c) delete the decorative `client-config` fields or make integration credentials entered/read from the DB (encrypted) instead of env.

## Top missing admin controls (should be operable by an ADMIN, currently code/env-only or absent)
1. **User lifecycle** — deactivate / change-role / remove / reset-password. `User.isActive` is *enforced* at login but there is **no API/UI to set it**; the users route only creates + lists. **P2.**
2. **Maintenance-mode enforcement** — the toggle persists but nothing blocks traffic. Wire it or stop shipping it. **P2.**
3. **Login-lockout tuning** — `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` are env-only and **not in the `env.ts` schema** (undocumented/unvalidated) yet security-critical. **P2.**
4. **Upload size limit** — consolidate on the real enforcer (`MAX_UPLOAD_MB`) and expose it; kill the decorative DB field. **P2.**
5. **Backup / retention** — **no backup capability exists in the app** (only ops scripts). A real operational gap, not just missing UI. **P2.**
6. **Rate limits** — global `RATE_LIMIT_*` (env) + hardcoded per-route login `max:20` / change-pw `max:10`. **P3.**
7. Session/refresh TTL (env) · 8. Worker concurrency `3/2/1` hardcoded + `MONITOR_BATCH_SIZE`/cron (env) · 9. Integration credential entry (no UI field, and unused — see decorative) · 10. Provider capability matrix (read-only today) · 11. Retention/rotation policy for audit + metric snapshots.

All secrets (S3 keys, `AUTH_SECRET`, provider tokens) are correctly kept server-side; **no recommendation moves a secret to the browser.**
