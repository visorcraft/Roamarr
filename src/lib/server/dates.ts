export function isExpired(expiresAt: string | null | undefined) {
	if (expiresAt == null || expiresAt.trim() === '') return false;
	const expires = new Date(expiresAt);
	// An unparseable stored deadline fails closed: public token routes must never serve it.
	return Number.isNaN(expires.getTime()) || expires <= new Date();
}
