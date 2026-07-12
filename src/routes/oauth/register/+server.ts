import { json, type RequestHandler } from '@sveltejs/kit';
import { ALL_SCOPES, createClient, getOAuthClientAllowList, type Scope } from '$lib/server/oauth';
import { checkRateLimit } from '$lib/server/rateLimit';
import { getSettings } from '$lib/server/settings';

const failure = (error: string, error_description: string, status = 400) => json({ error, error_description }, { status });

function validHttpsOrLoopbackUri(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2048) return false;
	try {
		const url = new URL(value);
		if (url.hash || url.username || url.password) return false;
		if (url.protocol === 'https:') return true;
		return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	} catch { return false; }
}

// Schemes that must never be accepted as a redirect target regardless of form.
const BLOCKED_REDIRECT_SCHEMES = new Set([
	'http', 'https', 'ws', 'wss', 'javascript', 'data', 'file', 'ftp', 'blob', 'about'
]);

// Public native clients (RFC 8252) redirect through a claimed custom URL scheme
// such as `com.roamarr.mobile:/oauth`. Require reverse-DNS form (at least one
// dot) so generic names like `myapp` cannot be registered, and reject any URI
// carrying credentials or a fragment. PKCE — mandatory for every client —
// limits the blast radius if another app claims the same scheme.
function validCustomSchemeUri(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2048) return false;
	try {
		const url = new URL(value);
		if (url.hash || url.username || url.password) return false;
		const scheme = url.protocol.replace(/:$/, '').toLowerCase();
		if (BLOCKED_REDIRECT_SCHEMES.has(scheme)) return false;
		if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) return false;
		if (!scheme.includes('.')) return false;
		return true;
	} catch { return false; }
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const limit = checkRateLimit(getClientAddress(), 'oauth_register', { maxAttempts: 5, windowMs: 60 * 60_000 });
	if (!limit.allowed) return failure('temporarily_unavailable', 'Too many registration attempts', 429);
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
		return failure('invalid_client_metadata', 'Content-Type must be application/json');

	const raw = await request.text();
	if (raw.length > 16_384) return failure('invalid_client_metadata', 'Registration request is too large');
	let parsed: unknown;
	try { parsed = JSON.parse(raw); } catch { return failure('invalid_client_metadata', 'Invalid JSON'); }
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('invalid_client_metadata', 'Request body must be a JSON object');
	const body = parsed as Record<string, unknown>;

	if ((getOAuthClientAllowList()?.length ?? 0) > 0)
		return failure('invalid_client_metadata', 'Dynamic registration is disabled while the client allow-list is configured');
	if (!getSettings().allowUserMcpClients)
		return failure('invalid_client_metadata', 'User MCP client setup is disabled by the administrator', 403);
	const clientName = typeof body.client_name === 'string' ? body.client_name.trim() : 'Dynamically registered MCP client';
	if (!clientName || clientName.length > 200) return failure('invalid_client_metadata', 'client_name must be 1 to 200 characters');
	const authMethod = body.token_endpoint_auth_method == null ? 'none' : body.token_endpoint_auth_method;
	if (authMethod !== 'none' && authMethod !== 'client_secret_post')
		return failure('invalid_client_metadata', 'token_endpoint_auth_method must be none or client_secret_post');
	// Custom URL schemes (RFC 8252 native clients) are permitted only for public
	// PKCE clients. Confidential clients must use HTTPS or loopback HTTP.
	const allowsCustomScheme = authMethod === 'none';
	const validUri = (uri: unknown) => validHttpsOrLoopbackUri(uri) || (allowsCustomScheme && validCustomSchemeUri(uri));
	if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length < 1 || body.redirect_uris.length > 10 || !body.redirect_uris.every(validUri))
		return failure('invalid_redirect_uri', allowsCustomScheme
			? 'Provide 1 to 10 HTTPS callback URLs; loopback HTTP URLs are also allowed; public PKCE clients may also use a reverse-DNS custom scheme (e.g. com.example.app:/oauth)'
			: 'Provide 1 to 10 HTTPS callback URLs; loopback HTTP URLs are also allowed');

	const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token'];
	if (!Array.isArray(grantTypes) || grantTypes.some((value) => value !== 'authorization_code' && value !== 'refresh_token') || !grantTypes.includes('authorization_code'))
		return failure('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported');
	const responseTypes = body.response_types ?? ['code'];
	if (!Array.isArray(responseTypes) || responseTypes.length !== 1 || responseTypes[0] !== 'code')
		return failure('invalid_client_metadata', 'Only response_type code is supported');

	const requestedScopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [...ALL_SCOPES];
	if (requestedScopes.length === 0 || requestedScopes.some((scope) => !ALL_SCOPES.includes(scope as Scope)))
		return failure('invalid_client_metadata', 'scope contains an unsupported value');

	const result = createClient(null, {
		clientName,
		redirectUris: body.redirect_uris,
		scopes: requestedScopes as Scope[],
		isPublic: authMethod === 'none'
	});
	return json({
		client_id: result.client.clientId,
		...(result.plaintextSecret ? { client_secret: result.plaintextSecret } : {}),
		client_id_issued_at: Math.floor(Date.now() / 1000),
		client_name: clientName,
		redirect_uris: body.redirect_uris,
		grant_types: grantTypes,
		response_types: responseTypes,
		token_endpoint_auth_method: authMethod,
		scope: requestedScopes.join(' ')
	}, { status: 201 });
};
