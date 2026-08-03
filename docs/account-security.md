<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Account security

Open **Security** under **Me** to manage password, TOTP, backup codes, and
passkeys. Open **Profile → Sessions** for browser sessions and
**Profile → MCP Clients** for OAuth grants when enabled.

## Passwords

- Password length is 8 through 1024 bytes.
- Password hashes use argon2id.
- Changing a password requires the current password.
- A successful change invalidates every other browser session.
- An administrator can require a new password before normal access continues.

Password change does not automatically revoke OAuth/MCP grants. Review and
revoke those separately after suspected compromise.

## Forgot-password flow

The public forgot-password form gives a generic response so it does not reveal
whether an email exists. If the active account exists and SMTP is usable,
Roamarr sends a random one-time reset URL.

Reset tokens:

- are stored only as SHA-256 hashes;
- expire after 60 minutes;
- are single-use;
- are all removed after a successful reset.

A reset invalidates all browser sessions. Without configured SMTP, users need
administrator help.

## TOTP

Enable TOTP from the Security page:

1. scan the QR code or enter the secret in an authenticator;
2. enter the current six-digit code;
3. save the 10 generated backup codes;
4. acknowledge that the codes were saved.

The TOTP secret is encrypted at rest. Backup codes are shown once and stored as
hashes. Each code is single-use.

Regenerating backup codes requires a current TOTP code and invalidates every
old backup code. Disabling TOTP requires the account password plus a valid TOTP
or backup code.

Password login with TOTP enabled requires the second factor. Time drift on the
server or authenticator can cause failures.

## Passkeys

Passkeys use WebAuthn. Requirements:

- stable `ORIGIN`;
- HTTPS outside loopback development;
- a browser/platform that supports WebAuthn.

Choose **Security → Passkeys → Add passkey**, enter an optional device name,
and complete the browser prompt. Roamarr stores the public credential and
counter, never a private passkey.

A passkey is a primary sign-in credential and satisfies login without a
separate TOTP step. TOTP remains active for password login.

Passkeys can be renamed and deleted. Roamarr prevents deletion of the last
usable sign-in method when that would lock out the account.

## Single sign-on (OIDC)

When the administrator enables an external OpenID Connect provider, the login
page shows a "Sign in with …" button. SSO sign-in creates the same session
cookie as password login, still requires the TOTP challenge for accounts with
two-factor enabled, and is rejected for disabled accounts. SSO-provisioned
accounts have no usable password until one is set through the normal
reset/change flows. See [OIDC single sign-on](./oidc.md).

## Sessions

Session cookies contain a random 32-byte token. The database stores its
SHA-256 hash. Sessions normally last 30 days and record best-effort IP and
user-agent metadata.

Cookies are HTTP-only, secure in production HTTPS deployments, and use the
administrator-selected `SameSite` policy. Revoke unknown sessions from
**Profile → Sessions**.

## OAuth/MCP grants

Access and refresh tokens are long-lived and stored only as hashes. Disable or
delete a client/grant when no longer needed. A disabled account cannot use its
tokens, but password change alone does not revoke them.

See [OAuth 2.1](./oauth.md).

## Administrator actions

An administrator can create, disable, re-enable, force-reset, change, or delete
users. The last administrator cannot be deleted. Security-sensitive actions
are audit-logged.

Disabling blocks login and token use while preserving data. Deleting is
destructive and can cascade owned records.

## Recovery checklist

- Keep TOTP backup codes offline.
- Register more than one passkey on separate devices where practical.
- Keep SMTP working for password reset.
- Review Sessions and MCP Clients periodically.
- Use a unique password.
- Protect `ORIGIN`, TLS, the server clock, database, backups, and
  `ROAMARR_SECRET`.
