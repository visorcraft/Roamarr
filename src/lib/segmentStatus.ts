export const SEGMENT_STATUS_META: Record<string, { label: string; class: string }> = {
	planned: { label: 'Planned', class: 'badge-slate' },
	checked_in: { label: 'Checked in', class: 'badge-brand' },
	boarded: { label: 'Boarded', class: 'badge-amber' },
	arrived: { label: 'Arrived', class: 'badge-green' },
	completed: { label: 'Completed', class: 'badge-green' }
};

export function segmentStatusLabel(status: string) {
	return SEGMENT_STATUS_META[status]?.label ?? status.replace(/_/g, ' ');
}

export function segmentStatusClass(status: string) {
	return SEGMENT_STATUS_META[status]?.class ?? 'badge-slate';
}
