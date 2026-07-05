# Roamarr Security Scan Report

**Scope:** Repository-wide review covering OWASP Top 10 categories, XSS/SSTI, SQL injection, linkjacking/open redirects, authentication/session management, file uploads, SSRF, authorization/IDOR, secrets leakage, and rate-limiting coverage.

**Methodology:** Static code review of `src/` and `tests/`, `npm audit`, and targeted greps for dangerous patterns (`{@html}`, `eval`, `innerHTML`, raw SQL, user-controlled `fetch` targets, hardcoded credentials).

**Overall verdict:** One **High-severity authenticated IDOR** was discovered in fare-provider management and has been fixed. The codebase otherwise follows solid security practices (Argon2id, hashed session tokens, AES-256-GCM encryption, PKCE OAuth, strict sharing checks). The remaining items are low-severity hardening opportunities and defense-in-depth recommendations.

---

## Findings

### 1. HIGH — Authenticated IDOR in fare-provider update/delete
- **Severity:** High
- **Status:** Fixed
- **Evidence:**
  - `src/routes/settings/fare-providers/+page.server.ts:41-55`
  - `src/lib/server/repositories/travelDataRepo.ts:251-270`
  - `src/routes/settings/fare-providers/fare-providers.test.ts:91-128`
- **Details:** The `update` and `delete` actions called `requireUser(locals)` but discarded the returned user ID. They passed the form-supplied `id` directly to `updateFareProvider` and `deleteFareProvider`, which performed the operation by `id` alone without checking `user_id`. Any authenticated user could update or delete another user's fare-provider account, including overwriting the victim's API key.
- **Test flaw:** The existing unit tests at `fare-providers.test.ts:106` and `:122` asserted `rejects.toThrow()`, which passed even for a successful attacker request because the action redirects on success. The tests gave false assurance.
- **Fix:** The route now uses the ownership-checking wrappers `updateProvider` and `deleteProvider` from `src/lib/server/fareproviders/index.ts`, which call `requireOwnedProvider(userId, providerId)`. The tests were updated to assert that the provider row is unchanged after an attacker attempt.

### 2. Reset-password endpoint has no rate limiting
- **Severity:** Low
- **Evidence:** `src/routes/reset-password/[token]/+page.server.ts:10-21`
- **Details:** The password-reset form submission does not call `checkRateLimit`. Reset tokens are high-entropy, single-use, and expire in 60 minutes, so brute-force is impractical, but the endpoint should still be covered for consistency.
- **Recommendation:** Add `checkRateLimit(getClientAddress(), 'reset-password')` to the action.

### 2. CSP allows `'unsafe-inline'` for scripts
- **Severity:** Low (defense-in-depth)
- **Evidence:** `src/hooks.server.ts:25`
- **Details:** The Content-Security-Policy permits `'unsafe-inline'` in `script-src`. This reduces the effectiveness of CSP as an XSS mitigation.
- **Recommendation:** Move to a nonce- or hash-based CSP if feasible, or document the deliberate trade-off.

### 3. Error messages from exceptions are returned to users
- **Severity:** Low
- **Status:** Partially fixed
- **Evidence:**
  - `src/routes/settings/backup/+page.server.ts:69`
  - `src/routes/settings/+page.server.ts:185,203,214,230`
  - `src/routes/profile/+page.server.ts:175,209,223,248,267,280`
- **Details:** Several actions return `e instanceof Error ? e.message : ...` directly in `fail(400, ...)`. Error messages may contain internal paths, database details, or library internals. Backup restore and settings external-service actions (map imports, test email/notification) now log the original error and return a generic user-facing message.
- **Recommendation:** Apply the same pattern to remaining actions that surface unexpected system errors to users.

### 4. Rate limiter is in-process only
- **Severity:** Low (operational)
- **Evidence:** `src/lib/server/rateLimit.ts:1-32`
- **Details:** Rate limits are stored in a `Map` keyed by IP+route. Limits reset on process restart and do not scale beyond a single container. IP addresses come from `getClientAddress()`, which can be influenced by proxy configuration.
- **Recommendation:** Document that Roamarr should run behind a trusted reverse proxy. For multi-instance deployments, move rate-limit state to Redis or a similar shared store.

### 5. Webhook URL is not validated before `fetch`
- **Severity:** Low
- **Evidence:** `src/lib/server/notify.ts:55-72`
- **Details:** The admin-configured `webhookUrl` is fetched without scheme validation or an allow-list. If an admin account is compromised, this could be used for SSRF to internal services.
- **Recommendation:** Restrict `webhookUrl` to `http://`/`https://` and optionally block private IP ranges/localhost.

### 6. Attachment filename reflected in `Content-Disposition`
- **Severity:** Low
- **Evidence:** `src/routes/trips/[id]/expenses/[expenseId]/attachments/[attachmentId]/+server.ts:23`
- **Details:** The uploaded file's `filename` is inserted into a `Content-Disposition` header without sanitization. Modern Node/Browser stacks mitigate classic CRLF header injection, but it remains a fragile boundary.
- **Recommendation:** Sanitize the filename (strip control chars, quotes, backslashes) or encode it as a fallback filename parameter.

### 7. Session cookies use `SameSite=Lax`
- **Severity:** Informational
- **Evidence:** `src/lib/server/auth.ts:142`
- **Details:** `SameSite=Lax` is acceptable, but `SameSite=Strict` would provide stronger CSRF protection for a self-hosted app where cross-site POST navigations are unlikely.
- **Recommendation:** Consider upgrading to `SameSite=Strict` and verifying that legitimate cross-site links (e.g., OAuth, passkey flows) still work.

### 8. Password reset does not invalidate existing sessions
- **Severity:** Medium
- **Evidence:** `src/lib/server/passwordReset.ts:31-42`
- **Details:** When a password-reset token is consumed, the user's password is changed but existing sessions remain valid. An attacker with a stolen session could continue using it after the legitimate user resets their password. The impact warrants Medium rather than Low because this undermines a standard containment action.
- **Recommendation:** Call `invalidateAllSessions(userId)` after a successful password reset.

### 9. Backup restore relies on tar-fs path traversal behavior
- **Severity:** Low
- **Evidence:** `src/routes/settings/backup/+page.server.ts:45`
- **Details:** The restore action extracts an uploaded tar.gz using `tar-fs` without explicitly configuring `strip` or path validation. The extracted directory is later validated as a MongrelDB database, which reduces risk, but the extraction step itself assumes `tar-fs` rejects `..` entries.
- **Recommendation:** Pin a current `tar-fs` version and/or add a post-extraction path check ensuring all files remain under the extraction root.

### 10. MCP session transport map can grow unbounded
- **Severity:** Low
- **Evidence:** `src/routes/mcp/+server.ts:10`
- **Details:** `transports` is a `Map` keyed by session ID. If clients initialize sessions and never close/DELETE them, memory grows until the process restarts.
- **Recommendation:** Add a maximum size, TTL sweep, or per-session timeout to prune stale transports.

### 11. Reset-password endpoint has no rate limiting
- **Severity:** Informational
- **Evidence:** `src/routes/reset-password/[token]/+page.server.ts:10-21`
- **Details:** The password-reset form submission does not call `checkRateLimit`. Because reset tokens are 32 bytes of randomness, single-use, and expire in 60 minutes, online brute-force is infeasible. Rate limiting here is defense-in-depth rather than a meaningful vulnerability.
- **Recommendation:** Add `checkRateLimit(getClientAddress(), 'reset-password')` for consistency.

---

## Positive Findings

- **`npm audit`:** 0 vulnerabilities.
- **Password storage:** Argon2id with OWASP-recommended parameters (`memoryCost: 19456`, `timeCost: 2`, `parallelism: 1`).
- **Session tokens:** 32-byte random tokens, stored as SHA-256 hashes, 30-day expiry.
- **Encryption at rest:** AES-256-GCM with random 12-byte nonces for travel documents, fare-provider keys, SMTP/map credentials, and 2FA secrets.
- **Password-change invalidation:** `invalidateOtherSessions`/`invalidateAllSessions` are called on user password changes and admin-forced password changes.
- **Disabled-user enforcement:** Consistently checked in login, OAuth token verification, and passkey authentication.
- **OAuth:** Authorization codes are single-use, 5-minute expiry, bound to `redirect_uri`, and PKCE (`S256`) is enforced.
- **Open redirects:** `safeNext()` only permits same-origin relative paths; OAuth `redirect_uri` is matched against registered values.
- **XSS:** No `eval`, `innerHTML`, or `dangerouslySetInnerHTML`. The custom markdown renderer escapes HTML and allows only `http://`/`https://` links. `{@html}` usages are limited to trusted local SVG/Icon data and sanitized markdown.
- **SQL/NoSQL injection:** No user input reaches raw SQL. MongrelDB Kit query builders are used throughout.
- **Authorization:** `canView`/`canEdit`, `requireOwnedTrip`, `requireEditableTrip`, and `assertOwnedRefs` gate trips, cards, providers, and segments.
- **File uploads:** Expense attachments are stored under random UUID keys with type/size whitelisting; filenames are not used in the storage path.
- **Audit logging:** Security-relevant mutations call `logAudit()`.

---

## Recommendations Summary

| Priority | Action |
|----------|--------|
| High | Audit all route actions that call bare repository `update*`/`delete*` helpers to ensure ownership checks are always enforced. |
| Medium | Invalidate all sessions on password-reset consumption. |
| Low | Sanitize/validate attachment filenames in `Content-Disposition`. |
| Low | Validate `webhookUrl` scheme and optionally block private ranges. |
| Low | Continue returning generic error messages for unexpected failures; log details server-side. |
| Low | Harden CSP by moving away from `'unsafe-inline'` if feasible. |
| Low | Add TTL/max-size guard to MCP transport map. |
| Low | Verify tar-fs path-traversal protections for backup restore. |
| Optional | Add rate limiting to the reset-password action for consistency. |
| Optional | Evaluate `SameSite=Strict` for session cookies. |
| Optional | Document proxy trust requirements for IP-based rate limiting. |
