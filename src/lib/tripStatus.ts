export const TRIP_STATUSES = ['planning', 'booked', 'active', 'completed'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

const TRIP_STATUS_BADGE: Record<TripStatus, { label: string; class: string }> = {
	planning: { label: 'Planning', class: 'badge-slate' },
	booked: { label: 'Booked', class: 'badge-brand' },
	active: { label: 'Active', class: 'badge-green' },
	completed: { label: 'Completed', class: 'badge-amber' }
};

export function tripStatusBadge(status: string): { label: string; class: string } {
	return TRIP_STATUS_BADGE[status as TripStatus] ?? { label: status, class: 'badge-slate' };
}
