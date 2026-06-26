export function isExpired(expiresAt: string | null | undefined) {
	return expiresAt != null && new Date(expiresAt) <= new Date();
}
