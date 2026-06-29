<!-- SPDX-FileCopyrightText: 2026 Visorcraft LLC -->
<!-- SPDX-License-Identifier: GPL-3.0-only -->

# Account security

Roamarr supports passwords, two-factor authentication (TOTP), and passwordless
passkeys (WebAuthn). All three can coexist on a single account.

Visit **Security** in the sidebar (under Profile) to manage these settings.

## Passwords

- Passwords are hashed with argon2id.
- Passwords must be 8–1024 bytes.
- Changing your password invalidates all other sessions.
- An admin can force a password reset, which redirects the user to the
  change-password page on next access.

## Two-factor authentication (TOTP + backup codes)

TOTP is an extra layer that requires a 6-digit code from an authenticator app
(Google Authenticator, Authy, 1Password, etc.) in addition to your password.

### Enabling 2FA

1. Go to **Security → Set up 2FA**.
2. Scan the QR code with your authenticator app, or enter the secret manually.
3. Enter the 6-digit code shown by your app to confirm.
4. **Save your backup codes** — you receive 10 single-use codes. Each is
   formatted as five groups of four hex digits (for example,
   `abcd-ef12-3456-7890-abcd`). Store them securely; they are shown only once.

### Logging in with 2FA

After entering your email and password, you are redirected to a verification
page. Enter either:
- Your current 6-digit TOTP code, or
- A backup code (single-use).

### Regenerating backup codes

At **Security → Regenerate backup codes**, enter your current 6-digit code to
generate a fresh set. All previous backup codes are invalidated.

### Disabling 2FA

At **Security → Disable 2FA**, you must provide:

1. Your account password.
2. A valid 6-digit TOTP code **or** a single-use backup code.

This prevents someone who knows only your password from removing your second
factor.

## Passkeys (WebAuthn)

Passkeys let you sign in without a password using Face ID, Touch ID, or a
hardware security key.

### Requirements

- The `ORIGIN` environment variable must be set (passkeys require a stable
  origin for the Relying Party).
- HTTPS in production (or `localhost` in development).

### Registering a passkey

1. Go to **Security → Manage passkeys → Add passkey**.
2. Give it a name (e.g. "iPhone", "YubiKey").
3. Complete the platform authenticator prompt.

### Signing in with a passkey

On the login page, click **Sign in with a passkey**. Complete the authenticator
prompt — no password required.

### Lockout protection

You cannot delete your last passkey if the account has no password set.

### Relationship to 2FA

A passkey login is a primary credential and **satisfies** authentication — no
additional TOTP step-up is required. 2FA remains an independently enabled
layer that users may combine with a password.
