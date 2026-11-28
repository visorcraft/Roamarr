import type { McpToolModule } from './context';
import { error } from '@sveltejs/kit';
import * as tripsRepo from '../repositories/tripsRepo';
import * as segmentsRepo from '../repositories/segmentsRepo';
import { requireOwnedTrip } from '../ownership';
import { requireEditableTrip } from '../ownership';
import { listVisited } from '../visitedPlaces';
import { markVisited } from '../visitedPlaces';
import { unmarkVisited } from '../visitedPlaces';
import { canViewDetails } from '../sharing';
import { logAudit } from '../audit';
import { findCity } from '../cities';
import { paginateList } from '../mcpHelpers';
import { effectiveTripStatus } from '../tripLifecycle';
import { todayForUser } from '../tripLifecycle';
import { validateToolInput } from '../mcpArgParsers';
import { parseSegmentUpdateArgs } from '../mcpArgParsers';
import { parseTripFieldsArgs } from '../mcpArgParsers';
import { textResult, safeTripProjection, destinationCityPatch } from './context';

export const tripsAndSegmentsTools: McpToolModule = {
	'roamarr_trip_list': {
		scope: 'trips:read',
		handler: async ({ userId, scopes, args }) => {
			// Include shared trips, matching what the user sees in the web
			// UI. The previous impl used listTripsForUser (owner-only),
			// which silently hid trips shared with the calling user.
			const tripIds = tripsRepo.listViewableTripIdsForUser(userId);
			const page = paginateList(tripIds, args, (id) => id);
			return textResult({
				items: page.items.map((id) => {
					const t = safeTripProjection(id, userId, scopes);
					return {
						id: t.id, name: t.name, destination: 'destination' in t ? t.destination : null,
						destinationCountryCode: t.destinationCountryCode,
						destinationAdmin1Code: 'destinationAdmin1Code' in t ? t.destinationAdmin1Code : null,
						destinationCityName: t.destinationCityName,
						startDate: t.startDate, endDate: t.endDate, status: t.status
					};
				}),
				nextCursor: page.nextCursor,
			});
		}
	},
	'roamarr_trip_get': {
		scope: 'trips:read',
		handler: async ({ userId, scopes, args }) => {
			const tripId = Number(args.tripId);
			const projected = safeTripProjection(tripId, userId, scopes);
			return textResult({ trip: projected });
		}
	},
	'roamarr_trip_create': {
		scope: 'trips:write',
		handler: async ({ userId, args }) => {
			const validation = validateToolInput(args as Record<string, unknown>);
			if (!validation.ok) return textResult({ error: validation.error });
			const parsed = parseTripFieldsArgs(args as Record<string, unknown>, null);
			if (!parsed.ok) return textResult({ error: parsed.error });
			const { name, ...fields } = parsed.fields;
			if (name === undefined) return textResult({ error: 'name is required' }); // unreachable after the parser; keeps the type honest without `!`
			const destination = destinationCityPatch(args);
			const trip = tripsRepo.createTrip(userId, {
				destination: args.destination as string | undefined,
				...destination,
				tags: Array.isArray(args.tags) ? JSON.stringify(args.tags) : undefined,
				...fields,
				name
			});
			logAudit(userId, 'mcp_trip_create', 'trip', trip.id, { name: trip.name });
			return textResult({ id: trip.id, name: trip.name });
		}
	},
	'roamarr_trip_update': {
		scope: 'trips:write',
		handler: async ({ userId, args }) => {
			const validation = validateToolInput(args as Record<string, unknown>);
			if (!validation.ok) return textResult({ error: validation.error });
			const tripId = Number(args.tripId);
			// Editors of shared trips can update trip metadata, matching
			// the web UI /trips/[id]/edit save action (requireEditableTrip).
			const existing = requireEditableTrip(userId, tripId);
			// Same guard as the web edit action: an editor whose share lacks
			// showDetails must not overwrite the owner's private notes.
			if (args.notes !== undefined && !canViewDetails(userId, existing)) {
				return textResult({
					error: 'notes cannot be changed without permission to view private trip details; omit notes and retry'
				});
			}
			const parsed = parseTripFieldsArgs(args as Record<string, unknown>, existing);
			if (!parsed.ok) return textResult({ error: parsed.error });
			const destination = destinationCityPatch(args, existing);
			const updated = tripsRepo.updateTrip(tripId, {
				destination: args.destination as string | undefined,
				...destination,
				tags: Array.isArray(args.tags) ? JSON.stringify(args.tags) : undefined,
				...parsed.fields
			});
			if (!updated) return textResult({ error: 'Trip not found' });
			logAudit(userId, 'mcp_trip_update', 'trip', tripId, {});
			return textResult({
				id: updated.id,
				name: updated.name,
				status: effectiveTripStatus(updated, todayForUser(userId))
			});
		}
	},
	'roamarr_day_plan': {
		scope: 'segments:write',
		handler: async ({ userId, args }) => {
			// Segment creation needs segments:write. Goes through addSegment
			// helper which enforces trip ownership, validates the type,
			// converts local time, creates flight reminders, etc.
			const validation = validateToolInput(args as Record<string, unknown>);
			if (!validation.ok) return { content: [{ type: 'text' as const, text: validation.error }], isError: true };
			const { addSegment } = await import('../segments');
			const countryCode = (args.countryCode as string) || undefined;
			const cityNameArg = (args.cityName as string) || undefined;
			const admin1Code = (args.admin1Code as string) || undefined;
			const latArg = args.cityLat as number | undefined;
			const lngArg = args.cityLng as number | undefined;
			const hasCoords = latArg != null && lngArg != null;
			const city =
				countryCode && cityNameArg
					? findCity(countryCode, cityNameArg, admin1Code)
					: null;
			const seg = addSegment(userId, Number(args.tripId), {
				type: String(args.type ?? 'event') as Parameters<typeof addSegment>[2]['type'],
				title: String(args.title ?? ''),
				localStart: String(args.startAt ?? ''),
				startTz: String(args.startTz ?? 'UTC'),
				endAt: (args.endAt as string) || undefined,
				endTz: (args.endTz as string) || undefined,
				cityName: city?.name ?? cityNameArg,
				countryCode,
				admin1Code: admin1Code ?? city?.admin1Code ?? undefined,
				cityLat: hasCoords ? latArg : (city?.lat ?? undefined),
				cityLng: hasCoords ? lngArg : (city?.lng ?? undefined),
				location: (args.location as string) || undefined,
				venue:
					(args.venue as string) ||
					(String(args.type) === 'hotel' ? (args.location as string) : undefined),
				confirmationNumber: (args.confirmationNumber as string) || undefined,
				details: {
					...((args.details as Record<string, unknown> | undefined) ?? {}),
					...(args.notes ? { notes: args.notes } : {})
				},
				paymentStatus: args.paymentStatus as string | undefined
			});
			logAudit(userId, 'mcp_day_plan', 'segment', seg.id, { tripId: seg.tripId });
			return textResult({ id: seg.id, tripId: seg.tripId, type: args.type, title: args.title });
		}
	},
	'roamarr_upcoming_summary': {
		scope: 'trips:read',
		handler: async ({ userId }) => {
			// Include shared trips (matches roamarr_trip_list semantics).
			const all = tripsRepo
				.listViewableTripIdsForUser(userId)
				.map((id) => tripsRepo.getTripById(id))
				.filter((t): t is NonNullable<typeof t> => t !== null);
			const today = new Date().toISOString().slice(0, 10);
			const upcoming = all
				.filter((t) => t.startDate && t.startDate >= today && !t.archived)
				.slice(0, 5);
			return textResult(upcoming.map((t) => ({
				id: t.id, name: t.name, destination: t.destination, startDate: t.startDate
			})));
		}
	},
	'roamarr_weather_overview': {
		scope: 'trips:read',
		handler: async ({ userId, args }) => {
			const { tripWeatherOverview } = await import('../weather');
			return textResult(await tripWeatherOverview(Number(args.tripId), userId));
		}
	},
	'roamarr_places_list': {
		scope: 'places:read',
		handler: async ({ userId, args }) => {
			// Ponytail: paginate a flat (kind, code, createdAt) view across
			// both collections so the cursor covers them as one stream.
			const visited = listVisited(userId);
			const flat = [
				...visited.countries.map((p) => ({ kind: 'country' as const, ...p })),
				...visited.usStates.map((p) => ({ kind: 'state' as const, ...p }))
			].sort((a, b) => {
				if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
				return a.code.localeCompare(b.code);
			});
			const page = paginateList(
				flat,
				args,
				(p) => `${p.kind}:${p.code}`
			);
			const items = page.items.map((p) => ({
				kind: p.kind,
				code: p.code,
				visitedOn: p.visitedOn,
				firstVisitedOn: p.firstVisitedOn,
				lastVisitedOn: p.lastVisitedOn,
				source: p.source
			}));
			return textResult({ items, nextCursor: page.nextCursor, });
		}
	},
	'roamarr_places_mark': {
		scope: 'places:write',
		handler: async ({ userId, args }) => {
			const kind = args.kind === 'state' ? 'state' : 'country';
			const result = markVisited(userId, kind as any, String(args.code ?? ''), {
				source: 'ai'
			});
			logAudit(userId, 'mcp_places_mark', 'visited_' + kind, userId, {
				code: args.code, created: result.created
			});
			return textResult(result);
		}
	},
	'roamarr_places_unmark': {
		scope: 'places:write',
		handler: async ({ userId, args }) => {
			const kind = args.kind === 'state' ? 'state' : 'country';
			const result = unmarkVisited(userId, kind as any, String(args.code ?? ''));
			logAudit(userId, 'mcp_places_unmark', 'visited_' + kind, userId, { code: args.code });
			return textResult(result);
		}
	},
	'roamarr_segment_update': {
		scope: 'segments:write',
		handler: async ({ userId, args }) => {
			const raw = args.segmentId;
			const segId = Number(raw);
			if (typeof raw !== 'number' || !Number.isSafeInteger(segId) || segId <= 0) {
				return { content: [{ type: 'text' as const, text: 'segmentId must be a positive integer' }], isError: true };
			}
			const parsed = parseSegmentUpdateArgs(args as Record<string, unknown>);
			if (!parsed.ok) return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
			const validation = validateToolInput(args as Record<string, unknown>);
			if (!validation.ok) return { content: [{ type: 'text' as const, text: validation.error }], isError: true };
			const patch = parsed.patch;
			const { patchSegment } = await import('../segments');
			const existing = segmentsRepo.getSegmentById(segId);
			patchSegment(userId, segId, {
				type: patch.type as import('$lib/segmentLabels').SegmentType | undefined,
				title: patch.title as string | undefined,
				startAt: patch.startAt as string | undefined,
				startTz: patch.startTz as string | undefined,
				endAt: patch.endAt as string | null | undefined,
				endTz: patch.endTz as string | undefined,
				cityName: patch.cityName as string | null | undefined,
				countryCode: patch.countryCode as string | null | undefined,
				admin1Code: patch.admin1Code as string | null | undefined,
				cityLat: patch.cityLat as number | null | undefined,
				cityLng: patch.cityLng as number | null | undefined,
				location: patch.location as string | null | undefined,
				venue:
					patch.venue !== undefined
						? (patch.venue as string | null)
						: existing?.type === 'hotel'
							? (patch.location as string | undefined)
							: undefined,
				confirmationNumber: patch.confirmationNumber as string | null | undefined,
				notes: patch.notes as string | undefined,
				details: patch.details as Record<string, unknown> | undefined,
				paymentStatus: patch.paymentStatus as string | undefined
			});
			logAudit(userId, 'mcp_segment_update', 'segment', segId, {});
			return textResult({ ok: true, segmentId: segId });
		}
	},
	'roamarr_segment_delete': {
		scope: 'segments:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { deleteSegment } = await import('../segments');
			const segId = Number(args.segmentId);
			const segRow = segmentsRepo.getSegmentById(segId);
			if (!segRow) return { content: [{ type: 'text' as const, text: 'Segment not found' }], isError: true };
			deleteSegment(userId, segRow.tripId, segId);
			logAudit(userId, 'mcp_segment_delete', 'segment', segId, { tripId: segRow.tripId });
			return textResult({ ok: true, segmentId: segId });
		}
	},
	'roamarr_segment_move': {
		scope: 'segments:write',
		handler: async ({ userId, args }) => {
			const { moveSegmentToDate } = await import('../segments');
			const segId = Number(args.segmentId);
			const segRow = segmentsRepo.getSegmentById(segId);
			if (!segRow) return { content: [{ type: 'text' as const, text: 'Segment not found' }], isError: true };
			// Schema is targetDate (YYYY-MM-DD). The helper preserves time-of-day
			// and shifts only the calendar date. To change time, use
			// roamarr_segment_update.
			const targetDate = String(args.targetDate);
			moveSegmentToDate(userId, segRow.tripId, segId, targetDate);
			logAudit(userId, 'mcp_segment_move', 'segment', segId, { tripId: segRow.tripId, targetDate });
			return textResult({ ok: true, segmentId: segId, targetDate });
		}
	},
	'roamarr_segment_status': {
		scope: 'segments:write',
		handler: async ({ userId, args }) => {
			const { setSegmentStatus } = await import('../segments');
			const segId = Number(args.segmentId);
			const segRow = segmentsRepo.getSegmentById(segId);
			if (!segRow) return { content: [{ type: 'text' as const, text: 'Segment not found' }], isError: true };
			setSegmentStatus(userId, segRow.tripId, segId, String(args.status) as 'planned' | 'checked_in' | 'boarded' | 'arrived' | 'completed');
			logAudit(userId, 'mcp_segment_status', 'segment', segId, { tripId: segRow.tripId, status: args.status });
			return textResult({ ok: true, segmentId: segId, status: args.status });
		}
	},
	'roamarr_trip_day_optimize': {
		scope: 'segments:write',
		handler: async ({ userId, args }) => {
			const { optimizeTripDay, planTripDay } = await import('../tripDayOptimize');
			const tripId = Number(args.tripId);
			const date = String(args.date);
			if (args.confirm === true) {
				const applied = optimizeTripDay(userId, tripId, date);
				logAudit(userId, 'mcp_trip_day_optimize', 'trip', tripId, { date, applied: applied.applied });
				return textResult({ ok: true, ...applied });
			}
			// Preview: proposed order only, nothing persisted.
			const preview = planTripDay(userId, tripId, date);
			return textResult({ ok: true, preview: true, ...preview });
		}
	},
	'roamarr_trip_day_directions_url': {
		scope: 'segments:read',
		handler: async ({ userId, args }) => {
			const { tripDayDirectionsPoints } = await import('../tripDayOptimize');
			const { buildGoogleMapsDirectionsUrl } = await import('$lib/googleMaps');
			const tripId = Number(args.tripId);
			const date = String(args.date);
			const points = tripDayDirectionsPoints(userId, tripId, date);
			return textResult({ ok: true, tripId, date, url: buildGoogleMapsDirectionsUrl(points) });
		}
	},
	'roamarr_trip_delete': {
		scope: 'trips:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const raw = args.tripId;
			const tripId = Number(raw);
			if (typeof raw !== 'number' || !Number.isSafeInteger(tripId) || tripId <= 0) {
				return { content: [{ type: 'text' as const, text: 'tripId must be a positive integer' }], isError: true };
			}
			// Use the same helper as the web UI: cancels trip + segment
			// reminders, then deletes, then logs trip_delete. MCP logs
			// its own mcp_trip_delete on top for traceability.
			const { _deleteTrip } = await import('../../../routes/trips/[id]/edit/+page.server');
			await _deleteTrip(userId, tripId);
			logAudit(userId, 'mcp_trip_delete', 'trip', tripId, {});
			return textResult({ ok: true, tripId, deleted: true });
		}
	},
	'roamarr_trip_archive': {
		scope: 'trips:write',
		handler: async ({ userId, args }) => {
			const tripId = Number(args.tripId);
			const t = requireOwnedTrip(userId, tripId);
			tripsRepo.updateTrip(tripId, { archived: !t.archived });
			logAudit(userId, 'mcp_trip_archive', 'trip', tripId, { archived: !t.archived });
			return textResult({ ok: true, tripId, archived: !t.archived });
		}
	},
	'roamarr_trip_duplicate': {
		scope: 'trips:write',
		handler: async ({ userId, args }) => {
			const { duplicateTrip } = await import('../../../routes/trips/shared');
			const tripId = Number(args.tripId);
			requireOwnedTrip(userId, tripId);
			const copy = duplicateTrip(userId, tripId);
			logAudit(userId, 'mcp_trip_duplicate', 'trip', copy.id, { sourceTripId: tripId });
			return textResult({ ok: true, sourceTripId: tripId, newTripId: copy.id });
		}
	},
};
