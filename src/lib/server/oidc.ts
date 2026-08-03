import {
	createHash,
	createHmac,
	createPublicKey,
	createSign,
	createVerify,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';
import { dev } from '$app/environment';
import { getSettings } from './settings';
import { decrypt } from './crypto';
import { logAudit } from './audit';
import { hashPassword } from './auth';
import { normalizeEmail } from './users';
import * as usersRepo from './repositories/usersRepo';

/**
 * OIDC single sign-on (authorization-code flow with PKCE S256, state, and
 * nonce). One provider is configured instance-wide via admin settings; the
 * client secret is encrypted at rest. Network access happens only here and
 * is fully injectable for tests.
 */

export const OIDC_DISCOVERY_TTL_MS = 10 * 60_000;
export const OIDC_JWKS_TTL_MS = 10 * 60_000;
export const OIDC_FETCH_TIMEOUT_MS = 8_000;
export const OIDC_FLOW_MAX_AGE_S = 10 * 60;
const CLOCK_SKEW_S = 60;

export interface OidcConfig {
	discoveryUrl: string;
	clientId: string;
	clientSecret: string | null;
	displayName: string;
}

export interface OidcDiscovery {
	issuer: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	jwksUri: string;
}

export interface OidcJwk {
	kty?: string;
	kid?: string;
	use?: string;
	alg?: string;
	n?: string;
	e?: string;
	[key: string]: unknown;
}

export interface IdTokenClaims {
	sub: string;
	email?: string;
	email_verified?: boolean;
	name?: string;
	preferred_username?: string;
	[key: string]: unknown;
}

export class OidcError extends Error {}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Full server-side config, or null when SSO is disabled/incomplete. */
export function getOidcConfig(): OidcConfig | null {
	const s = getSettings();
	if (!s.oidcEnabled || !s.oidcDiscoveryUrl || !s.oidcClientId) return null;
	let clientSecret: string | null = null;
	if (s.oidcClientSecret) {
		try {
			clientSecret = decrypt(s.oidcClientSecret);
		} catch {
			// A wrong ROAMARR_SECRET after restore must not break logins entirely;
			// treat the provider as secret-less and let the token exchange fail.
			clientSecret = null;
		}
	}
	return {
		discoveryUrl: s.oidcDiscoveryUrl,
		clientId: s.oidcClientId,
		clientSecret,
		displayName: s.oidcDisplayName || 'SSO'
	};
}

/** Safe subset for the login page: never exposes secrets or URLs. */
export function getOidcPublicInfo(): { enabled: boolean; displayName: string } {
	const s = getSettings();
	return {
		enabled: Boolean(s.oidcEnabled && s.oidcDiscoveryUrl && s.oidcClientId),
		displayName: s.oidcDisplayName || 'SSO'
	};
}

/** Public origin for building the redirect URI: ORIGIN env wins, else the request origin. */
export function resolveOrigin(requestOrigin: string): string {
	return (process.env.ORIGIN || requestOrigin).replace(/\/+$/, '');
}

export function oidcRedirectUri(origin: string): string {
	return `${origin.replace(/\/+$/, '')}/auth/oidc/callback`;
}

// ---------------------------------------------------------------------------
// Discovery + JWKS (in-memory caches with TTL)
// ---------------------------------------------------------------------------

const discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();
const jwksCache = new Map<string, { keys: OidcJwk[]; expiresAt: number }>();

/** Test hook: drop both caches. */
export function clearOidcCaches(): void {
	discoveryCache.clear();
	jwksCache.clear();
}

export function normalizeDiscoveryUrl(raw: string): string {
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (trimmed.endsWith('/.well-known/openid-configuration')) return trimmed;
	return `${trimmed}/.well-known/openid-configuration`;
}

function requireHttpsUrl(value: unknown, field: string): string {
	if (typeof value !== 'string' || !/^https?:\/\//.test(value)) {
		throw new OidcError(`OIDC discovery document has an invalid ${field}`);
	}
	return value;
}

export function parseDiscovery(data: unknown): OidcDiscovery {
	const doc = data as Record<string, unknown> | null;
	if (!doc || typeof doc !== 'object') throw new OidcError('OIDC discovery document is not an object');
	return {
		issuer: requireHttpsUrl(doc.issuer, 'issuer'),
		authorizationEndpoint: requireHttpsUrl(doc.authorization_endpoint, 'authorization_endpoint'),
		tokenEndpoint: requireHttpsUrl(doc.token_endpoint, 'token_endpoint'),
		jwksUri: requireHttpsUrl(doc.jwks_uri, 'jwks_uri')
	};
}

export async function fetchDiscovery(
	discoveryUrl: string,
	fetchImpl: typeof fetch = fetch
): Promise<OidcDiscovery> {
	const url = normalizeDiscoveryUrl(discoveryUrl);
	const hit = discoveryCache.get(url);
	if (hit && hit.expiresAt > Date.now()) return hit.value;
	let res: Response;
	try {
		res = await fetchImpl(url, {
			signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
			headers: { accept: 'application/json' }
		});
	} catch (e) {
		throw new OidcError(`OIDC discovery request failed: ${e instanceof Error ? e.message : e}`);
	}
	if (!res.ok) throw new OidcError(`OIDC discovery failed with HTTP ${res.status}`);
	const value = parseDiscovery(await res.json().catch(() => null));
	discoveryCache.set(url, { value, expiresAt: Date.now() + OIDC_DISCOVERY_TTL_MS });
	return value;
}

export async function fetchJwks(
	jwksUri: string,
	fetchImpl: typeof fetch = fetch
): Promise<OidcJwk[]> {
	const hit = jwksCache.get(jwksUri);
	if (hit && hit.expiresAt > Date.now()) return hit.keys;
	let res: Response;
	try {
		res = await fetchImpl(jwksUri, {
			signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS),
			headers: { accept: 'application/json' }
		});
	} catch (e) {
		throw new OidcError(`OIDC JWKS request failed: ${e instanceof Error ? e.message : e}`);
	}
	if (!res.ok) throw new OidcError(`OIDC JWKS fetch failed with HTTP ${res.status}`);
	const data = (await res.json().catch(() => null)) as { keys?: unknown } | null;
	if (!data || !Array.isArray(data.keys)) throw new OidcError('OIDC JWKS document has no keys');
	const keys = data.keys as OidcJwk[];
	jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + OIDC_JWKS_TTL_MS });
	return keys;
}

// ---------------------------------------------------------------------------
// PKCE + transient flow cookie (signed, HttpOnly, 10 minutes)
// ---------------------------------------------------------------------------

export interface OidcFlow {
	state: string;
	nonce: string;
	codeVerifier: string;
	next: string | null;
	expires: number;
}

function sign(value: string): string {
	const secret = process.env.ROAMARR_SECRET;
	if (!secret) throw new Error('ROAMARR_SECRET is not set');
	return createHmac('sha256', secret).update(value).digest('hex');
}

export function pkceChallenge(codeVerifier: string): string {
	return createHash('sha256').update(codeVerifier).digest('base64url');
}

export function createOidcFlow(
	next: string | null,
	nowMs: number = Date.now()
): OidcFlow & { cookieValue: string } {
	const flow: OidcFlow = {
		state: randomBytes(16).toString('base64url'),
		nonce: randomBytes(16).toString('base64url'),
		codeVerifier: randomBytes(32).toString('base64url'),
		next,
		expires: nowMs + OIDC_FLOW_MAX_AGE_S * 1000
	};
	const payload = Buffer.from(JSON.stringify(flow), 'utf8').toString('base64url');
	return { ...flow, cookieValue: `${payload}.${sign(payload)}` };
}

export function verifyOidcFlowCookie(
	value: string | undefined,
	nowMs: number = Date.now()
): OidcFlow | null {
	if (!value) return null;
	const dot = value.lastIndexOf('.');
	if (dot <= 0) return null;
	const payload = value.slice(0, dot);
	const sig = value.slice(dot + 1);
	const expected = Buffer.from(sign(payload), 'hex');
	const actual = Buffer.from(sig, 'hex');
	if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
	let flow: OidcFlow;
	try {
		flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OidcFlow;
	} catch {
		return null;
	}
	if (
		typeof flow?.state !== 'string' ||
		typeof flow?.nonce !== 'string' ||
		typeof flow?.codeVerifier !== 'string' ||
		typeof flow?.expires !== 'number'
	) {
		return null;
	}
	if (nowMs > flow.expires) return null;
	return flow;
}

/** Cookie attributes for the transient flow cookie. SameSite=Lax is required: the provider redirects back via a top-level cross-site GET. */
export function oidcFlowCookieOptions() {
	const origin = process.env.ORIGIN;
	const secure = dev ? false : !(origin && origin.startsWith('http://'));
	return {
		path: '/',
		httpOnly: true,
		secure,
		sameSite: 'lax' as const,
		maxAge: OIDC_FLOW_MAX_AGE_S
	};
}

// ---------------------------------------------------------------------------
// Authorization request + token exchange
// ---------------------------------------------------------------------------

export function buildAuthorizationUrl(
	discovery: OidcDiscovery,
	config: OidcConfig,
	flow: OidcFlow,
	redirectUri: string
): string {
	const url = new URL(discovery.authorizationEndpoint);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', config.clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('scope', 'openid profile email');
	url.searchParams.set('state', flow.state);
	url.searchParams.set('nonce', flow.nonce);
	url.searchParams.set('code_challenge', pkceChallenge(flow.codeVerifier));
	url.searchParams.set('code_challenge_method', 'S256');
	return url.toString();
}

/**
 * Exchange the authorization code for tokens. Uses HTTP Basic
 * (`client_secret_basic`, the OIDC-mandated default) when a client secret is
 * configured; secret-less (public client) configs send `client_id` in the
 * form body instead.
 */
export async function exchangeCode(
	discovery: OidcDiscovery,
	config: OidcConfig,
	code: string,
	redirectUri: string,
	codeVerifier: string,
	fetchImpl: typeof fetch = fetch
): Promise<string> {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		code_verifier: codeVerifier
	});
	const headers: Record<string, string> = {
		'content-type': 'application/x-www-form-urlencoded',
		accept: 'application/json'
	};
	if (config.clientSecret) {
		headers.authorization = `Basic ${Buffer.from(
			`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`
		).toString('base64')}`;
	} else {
		body.set('client_id', config.clientId);
	}
	let res: Response;
	try {
		res = await fetchImpl(discovery.tokenEndpoint, {
			method: 'POST',
			headers,
			body,
			signal: AbortSignal.timeout(OIDC_FETCH_TIMEOUT_MS)
		});
	} catch (e) {
		throw new OidcError(`OIDC token request failed: ${e instanceof Error ? e.message : e}`);
	}
	if (!res.ok) throw new OidcError(`OIDC token exchange failed with HTTP ${res.status}`);
	const data = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
	if (!data || typeof data.id_token !== 'string' || !data.id_token) {
		throw new OidcError('OIDC token response did not contain an id_token');
	}
	return data.id_token;
}

// ---------------------------------------------------------------------------
// ID token validation (RS256 via node:crypto, JWKS kid lookup)
// ---------------------------------------------------------------------------

function decodeJwtPart(part: string): Record<string, unknown> {
	try {
		return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
	} catch {
		throw new OidcError('OIDC id_token is not valid JSON');
	}
}

export function verifyIdToken(
	token: string,
	opts: {
		issuer: string;
		clientId: string;
		nonce: string;
		jwks: OidcJwk[];
		nowSeconds?: number;
	}
): IdTokenClaims {
	const parts = token.split('.');
	if (parts.length !== 3) throw new OidcError('OIDC id_token is malformed');

	const header = decodeJwtPart(parts[0]!);
	// Only RS256 is accepted. This rejects alg=none and HS* confusion attacks.
	if (header.alg !== 'RS256') throw new OidcError('OIDC id_token uses an unexpected algorithm');

	const kid = typeof header.kid === 'string' ? header.kid : null;
	const candidates = opts.jwks.filter((k) => k.kty === 'RSA' && (!kid || k.kid === kid));
	if (candidates.length === 0) throw new OidcError('OIDC id_token signed by an unknown key');

	const signingInput = `${parts[0]}.${parts[1]}`;
	let verified = false;
	for (const jwk of candidates) {
		try {
			const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
			const verifier = createVerify('RSA-SHA256');
			verifier.update(signingInput);
			if (verifier.verify(key, parts[2]!, 'base64url')) {
				verified = true;
				break;
			}
		} catch {
			// try the next candidate key
		}
	}
	if (!verified) throw new OidcError('OIDC id_token signature is invalid');

	const claims = decodeJwtPart(parts[1]!);
	const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);

	if (claims.iss !== opts.issuer) throw new OidcError('OIDC id_token issuer mismatch');
	const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
	if (!aud.includes(opts.clientId)) throw new OidcError('OIDC id_token audience mismatch');
	if (typeof claims.exp !== 'number' || claims.exp < now - CLOCK_SKEW_S) {
		throw new OidcError('OIDC id_token is expired');
	}
	if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW_S) {
		throw new OidcError('OIDC id_token was issued in the future');
	}
	if (claims.nonce !== opts.nonce) throw new OidcError('OIDC id_token nonce mismatch');
	if (typeof claims.sub !== 'string' || !claims.sub) {
		throw new OidcError('OIDC id_token has no subject');
	}
	return claims as IdTokenClaims;
}

// ---------------------------------------------------------------------------
// User resolution: link by verified email, fall back to stored sub,
// auto-provision only when public registration is allowed.
// ---------------------------------------------------------------------------

export type OidcUserResolution =
	| { ok: true; userId: number; outcome: 'linked' | 'linked_by_sub' | 'provisioned' }
	| { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export async function resolveOidcUser(claims: IdTokenClaims): Promise<OidcUserResolution> {
	const email =
		typeof claims.email === 'string' && EMAIL_RE.test(claims.email)
			? normalizeEmail(claims.email)
			: null;

	if (email && claims.email_verified === true) {
		const existing = usersRepo.getUserByEmail(email);
		if (existing) {
			if (existing.disabled) return { ok: false, error: 'This account is disabled.' };
			if (!existing.oidc_sub) {
				usersRepo.updateUser(Number(existing.id), { oidc_sub: claims.sub });
			}
			logAudit(Number(existing.id), 'oidc_login_linked', 'user', Number(existing.id), {});
			return { ok: true, userId: Number(existing.id), outcome: 'linked' };
		}
		return provisionOidcUser(claims, email);
	}

	// No verified email: fall back to the provider subject recorded on an
	// earlier email-linked login. Provisioning without a verified email is
	// never allowed — Roamarr accounts require a real email address.
	const bySub = usersRepo.getUserByOidcSub(claims.sub);
	if (bySub) {
		if (bySub.disabled) return { ok: false, error: 'This account is disabled.' };
		logAudit(Number(bySub.id), 'oidc_login', 'user', Number(bySub.id), { via: 'sub' });
		return { ok: true, userId: Number(bySub.id), outcome: 'linked_by_sub' };
	}
	if (email) {
		return { ok: false, error: 'The identity provider did not verify this email address.' };
	}
	return { ok: false, error: 'The identity provider did not return an email address.' };
}

/**
 * Auto-provisioning mirrors the /register gate: only when setup is complete
 * AND `allowRegistration` is on. Instances that closed registration never get
 * new accounts via SSO. Provisioned users receive a random, unknown password
 * (SSO-only sign-in); they can set a password later through the normal
 * reset/change flows. `must_reset_password` stays false so SSO users are not
 * forced onto a password screen.
 */
async function provisionOidcUser(claims: IdTokenClaims, email: string): Promise<OidcUserResolution> {
	const s = getSettings();
	if (!s.setupComplete || !s.allowRegistration) {
		return {
			ok: false,
			error: 'No account exists for this email and self-registration is disabled.'
		};
	}
	const displayName = (
		(typeof claims.name === 'string' && claims.name.trim()) ||
		(typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
		email.split('@')[0]!
	).slice(0, 200);
	// Random 32-byte password: the hash is valid argon2id but the password is
	// unknowable, so password login is effectively disabled for this account.
	const passwordHash = await hashPassword(randomBytes(32).toString('base64url'));
	const user = usersRepo.createUser({
		email,
		password_hash: passwordHash,
		display_name: displayName,
		role: 'user',
		disabled: false,
		must_reset_password: false,
		timezone: s.defaultTimezone,
		flight_checkin_lead_hours: BigInt(s.defaultFlightCheckinLeadHours),
		document_expiry_lead_days: BigInt(s.defaultDocumentExpiryLeadDays),
		email_notifications: true,
		webhook_notifications: true,
		theme_id: 'system',
		default_currency: s.defaultCurrency,
		calendar_token: null,
		calendar_token_expires_at: null,
		oidc_sub: claims.sub
	} as usersRepo.CreateUserInput);
	logAudit(Number(user.id), 'oidc_login', 'user', Number(user.id), { provisioned: true });
	return { ok: true, userId: Number(user.id), outcome: 'provisioned' };
}

// Exported for tests only: build a signed RS256 JWT without pulling in a JWT
// library. Not used by the production flow.
export function _testSignRs256(
	header: Record<string, unknown>,
	payload: Record<string, unknown>,
	privateKey: import('node:crypto').KeyLike
): string {
	const h = Buffer.from(JSON.stringify(header)).toString('base64url');
	const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signer = createSign('RSA-SHA256');
	signer.update(`${h}.${p}`);
	return `${h}.${p}.${signer.sign(privateKey, 'base64url')}`;
}
