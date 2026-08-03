<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# OIDC single sign-on

Roamarr can delegate browser sign-in to one external OpenID Connect provider
(Authentik, Keycloak, Google, or any OIDC-compliant IdP). SSO is configured
instance-wide by an administrator under **Configuration → MCP Clients →
Single Sign-On (OIDC)**.

## How it works

- Authorization-code flow with PKCE (S256), `state`, and `nonce`.
- Provider metadata is discovered from
  `{discovery URL}/.well-known/openid-configuration` and cached in memory for
  10 minutes. A full well-known URL is also accepted.
- The transient flow state (state, nonce, PKCE verifier) lives in a signed,
  HttpOnly, 10-minute cookie — nothing is stored server-side.
- The ID token is validated locally: RS256 signature against the provider
  JWKS (`kid` lookup, cached 10 minutes), issuer, audience, expiry (60 s
  clock skew), and nonce. `alg=none` and unexpected algorithms are rejected.
- When a client secret is configured it is sent with HTTP Basic
  authentication (`client_secret_basic`); without a secret, `client_id` is
  sent in the token-request form body (public client).
- Both `/auth/oidc/start` and `/auth/oidc/callback` are rate-limited per IP.

## Settings

| Setting | Purpose |
| --- | --- |
| Enable SSO sign-in | Shows the "Sign in with …" button on the login page. |
| Button label | Text after "Sign in with" (default: SSO). |
| Discovery URL | Issuer base URL or full well-known configuration URL. |
| Client ID | Client identifier issued by the provider. |
| Client secret | Optional; encrypted at rest like SMTP passwords. Leave the masked value to keep the stored secret. |

## Redirect URI

Register exactly one redirect (callback) URI with the provider:

```
{ORIGIN}/auth/oidc/callback
```

`ORIGIN` is the public origin environment variable when set, otherwise the
request origin. Example for a local trial: `http://localhost:3000/auth/oidc/callback`.

## Provider setup notes

- **Authentik**: create an *OAuth2/OpenID Provider* (authorization-code flow)
  and an application. Set the redirect URI above. The discovery URL is
  `https://<authentik-host>/application/o/<slug>`.
- **Keycloak**: create a *confidential* (or public) client in your realm with
  standard flow enabled and the redirect URI above. The discovery URL is
  `https://<keycloak-host>/realms/<realm>`.
- **Google**: create OAuth 2.0 credentials (web application) in Google Cloud
  Console with the redirect URI above. The discovery URL is
  `https://accounts.google.com`.

In all cases the requested scopes are `openid profile email`.

## Account linking and provisioning

- Roamarr links SSO identities by **verified email**: the provider must
  return an `email` claim with `email_verified: true`. If a user with that
  email exists, the SSO login signs them in (audit: `oidc_login_linked`) and
  the provider `sub` is recorded on the account.
- If the provider later stops returning a verified email, the stored `sub`
  is used as the fallback identity for previously linked accounts. Accounts
  are never created from `sub` alone — Roamarr requires a real email.
- If no account exists, a new user is auto-provisioned **only when public
  self-registration is enabled** (the same gate as `/register`: setup
  complete and `allowRegistration` on). Instances that closed registration
  never gain accounts via SSO; the admin must create the user first.
- Provisioned users get a random, unknown password hash, so password sign-in
  is effectively disabled for them. They can set a password later through
  the normal forgot-password/change flows. `must_reset_password` is not set,
  so SSO users are never forced onto a password screen.
- Disabled accounts are rejected, exactly as with password sign-in.

## Two-factor authentication

TOTP is honored, not bypassed. If the resolved user has two-factor
authentication enabled, the callback routes them through the existing
`/login/verify` challenge before a session is created.

## Failure behavior

- If discovery or JWKS fetch fails (provider down, misconfigured URL), the
  login page shows an error flash and password/passkey sign-in keeps working.
- State or cookie mismatches on the callback return HTTP 400.
- Successful logins are audited (`oidc_login`, `oidc_login_linked`). Failed
  attempts are rate-limited; like password login, failures are not written
  to the audit log because no user row is implicated.
