import type { AuditLogEntry } from './repositories/auditRepo';

function tripUrl(meta: Record<string, unknown>): string | null {
	const tripId = (meta as { tripId?: number }).tripId;
	return tripId != null ? `/trips/${tripId}` : null;
}

export function auditEntityUrl(entry: AuditLogEntry): string | null {
	const { entityType, entityId, meta } = entry;
	switch (entityType) {
		case 'trip':
		case 'mcp_trip_create':
		case 'mcp_trip_update':
			return `/trips/${entityId}`;
		case 'segment':
		case 'trip_segment':
			// Segment audit logs should include tripId; without it the entityId is a
			// segment id and would 404 if treated as a trip id.
			return tripUrl(meta);
		case 'user':
			return `/users/${entityId}/edit`;
		case 'group':
			return `/groups/${entityId}/edit`;
		case 'settings':
			return '/general';
		case 'card':
			return `/cards/${entityId}/edit`;
		case 'insurance':
			return `/insurance/${entityId}/edit`;
		case 'fare_provider':
			return `/fare-providers/${entityId}/edit`;
		case 'travel_document':
		case 'document':
			return `/profile/documents/${entityId}/edit`;
		case 'trip_document_link':
		case 'journal_entry':
		case 'trip_journal_entry':
		case 'trip_poll':
		case 'trip_companion':
		case 'trip_home_task':
		case 'trip_checklist':
		case 'trip_checklist_item':
		case 'trip_important_item':
		case 'trip_medication':
		case 'trip_budget_category':
		case 'trip_expense':
		case 'trip_expense_attachment':
		case 'trip_entry_requirement':
		case 'segment_attendee':
			return tripUrl(meta);
		case 'trip_template':
			// Reusable templates are not trips and have no detail route.
			return null;
		case 'attachment':
		case 'packing_template':
		case 'emergency_contact':
		case 'visited_country':
		case 'visited_state':
		case 'oauth_client':
		default:
			return null;
	}
}
