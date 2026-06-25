export const TRIP_STATUSES = ['planning', 'booked', 'active', 'completed'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

const TRIP_STATUS_BADGE: Record<string, { label: string; class: string }> = {
	upcoming: { label: 'Upcoming', class: 'badge-brand' },
	active: { label: 'In progress', class: 'badge-green' },
	past: { label: 'Completed', class: 'badge-slate' },
	unknown: { label: 'Planned', class: 'badge-slate' }
};

export function tripStatusBadge(status: string) {
	return TRIP_STATUS_BADGE[status] ?? TRIP_STATUS_BADGE.unknown;
}
