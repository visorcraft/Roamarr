export function formatCents(cents: number, currency = 'USD'): string {
	return `${currency} ${(cents / 100).toFixed(2)}`;
}
