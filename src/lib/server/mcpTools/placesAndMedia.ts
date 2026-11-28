import type { McpToolModule } from './context';
import { error } from '@sveltejs/kit';
import * as segmentsRepo from '../repositories/segmentsRepo';
import { requireViewableTrip } from '../ownership';
import { canViewDetails } from '../sharing';
import { logAudit } from '../audit';
import { paginateList } from '../mcpHelpers';
import { fileFromAttachmentBase64 } from '../mcpHelpers';
import { parseAttachmentByteRange } from '../mcpHelpers';
import { streamToBase64 } from '../mcpHelpers';
import { parsePlaceLinkArgs } from '../mcpArgParsers';
import { attachmentFilename } from '../mcpArgParsers';
import { textResult, canReadPrivateDetails, attachmentMimeType, boundedOptional, resolveAttachmentTarget, projectTripDocument, loadTripDocumentForView } from './context';

export const placesAndMediaTools: McpToolModule = {
	'roamarr_saved_places_list': {
		scope: 'saved-places:read',
		handler: async ({ userId, args }) => {
			const { listPlaces, projectPlace } = await import('../places');
			const places = listPlaces(userId, {
				categoryId: args.categoryId != null ? Number(args.categoryId) : undefined,
				status: args.status as 'planned' | 'visited' | undefined,
				favorite: args.favorite === true || undefined,
				search: (args.q as string) ?? undefined
			});
			const page = paginateList(places, args, (p) => p.id);
			return textResult({ items: page.items.map(projectPlace), nextCursor: page.nextCursor });
		}
	},
	'roamarr_saved_places_get': {
		scope: 'saved-places:read',
		handler: async ({ userId, args }) => {
			const { getPlaceById, projectPlace } = await import('../places');
			const place = getPlaceById(Number(args.placeId), userId);
			if (!place) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			return textResult(projectPlace(place));
		}
	},
	'roamarr_saved_places_create': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { createPlace, projectPlace } = await import('../places');
			const place = createPlace(userId, {
				name: String(args.name ?? ''),
				categoryId: args.categoryId != null ? Number(args.categoryId) : null,
				address: (args.address as string) ?? null,
				cityId: args.cityId != null ? Number(args.cityId) : null,
				lat: args.lat != null ? Number(args.lat) : null,
				lng: args.lng != null ? Number(args.lng) : null,
				durationMin: args.durationMin != null ? Number(args.durationMin) : null,
				priceCents: args.priceCents != null ? Number(args.priceCents) : null,
				description: (args.description as string) ?? null,
				status: args.status as 'planned' | 'visited' | undefined,
				favorite: args.favorite === true
			});
			logAudit(userId, 'mcp_place_create', 'place', place.id, {});
			return textResult(projectPlace(place));
		}
	},
	'roamarr_saved_places_update': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { getPlaceById, updatePlace, projectPlace } = await import('../places');
			const id = Number(args.placeId);
			if (!getPlaceById(id, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			// Partial patch: absent keys are omitted entirely so they are never
			// written as NULL (Kit treats explicit undefined as NULL).
			const patch: Parameters<typeof updatePlace>[2] = {};
			if (args.name !== undefined) patch.name = String(args.name);
			if (args.categoryId !== undefined) patch.categoryId = args.categoryId === null ? null : Number(args.categoryId);
			if (args.address !== undefined) patch.address = args.address as string | null;
			if (args.cityId !== undefined) patch.cityId = args.cityId === null ? null : Number(args.cityId);
			if (args.lat !== undefined) patch.lat = args.lat === null ? null : Number(args.lat);
			if (args.lng !== undefined) patch.lng = args.lng === null ? null : Number(args.lng);
			if (args.durationMin !== undefined) patch.durationMin = args.durationMin === null ? null : Number(args.durationMin);
			if (args.priceCents !== undefined) patch.priceCents = args.priceCents === null ? null : Number(args.priceCents);
			if (args.description !== undefined) patch.description = args.description as string | null;
			if (args.status !== undefined) patch.status = args.status as 'planned' | 'visited';
			if (args.favorite !== undefined) patch.favorite = args.favorite === true;
			const place = updatePlace(id, userId, patch);
			logAudit(userId, 'mcp_place_update', 'place', id, {});
			return textResult(place ? projectPlace(place) : { ok: false });
		}
	},
	'roamarr_saved_places_delete': {
		scope: 'saved-places:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getPlaceById, deletePlace } = await import('../places');
			const id = Number(args.placeId);
			if (!getPlaceById(id, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			await deletePlace(id, userId);
			logAudit(userId, 'mcp_place_delete', 'place', id, {});
			return textResult({ ok: true, placeId: id });
		}
	},
	'roamarr_saved_places_mark_visited': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { setPlaceVisited, projectPlace } = await import('../places');
			const id = Number(args.placeId);
			const place = setPlaceVisited(id, userId, true);
			logAudit(userId, 'mcp_place_mark_visited', 'place', id, {});
			return textResult(projectPlace(place));
		}
	},
	'roamarr_saved_places_unmark_visited': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { setPlaceVisited, projectPlace } = await import('../places');
			const id = Number(args.placeId);
			const place = setPlaceVisited(id, userId, false);
			logAudit(userId, 'mcp_place_unmark_visited', 'place', id, {});
			return textResult(projectPlace(place));
		}
	},
	'roamarr_place_category_list': {
		scope: 'saved-places:read',
		handler: async ({ userId }) => {
			const { listPlaceCategories, projectPlaceCategory } = await import('../places');
			return textResult({ items: listPlaceCategories(userId).map(projectPlaceCategory) });
		}
	},
	'roamarr_place_category_create': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { createPlaceCategory, projectPlaceCategory } = await import('../places');
			if (typeof args.name !== 'string') throw error(400, 'name must be a string');
			if (args.color != null && typeof args.color !== 'string') throw error(400, 'color must be a string');
			const category = createPlaceCategory(userId, {
				name: args.name,
				color: args.color == null ? null : args.color
			});
			logAudit(userId, 'mcp_place_category_create', 'place_category', category.id, {});
			return textResult(projectPlaceCategory(category));
		}
	},
	'roamarr_place_category_update': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { getPlaceCategoryById, updatePlaceCategory, projectPlaceCategory } = await import('../places');
			const id = Number(args.categoryId);
			if (!Number.isSafeInteger(id) || id < 1) throw error(400, 'categoryId must be a positive integer');
			const existing = getPlaceCategoryById(id, userId);
			if (!existing) return { content: [{ type: 'text' as const, text: 'Category not found' }], isError: true };
			if (args.name !== undefined && typeof args.name !== 'string') throw error(400, 'name must be a string');
			if (args.color != null && typeof args.color !== 'string') throw error(400, 'color must be a string');
			const name = args.name === undefined ? existing.name : args.name;
			const color = typeof args.color === 'string' && args.color.trim() ? args.color : existing.color;
			const category = updatePlaceCategory(id, userId, { name, color });
			logAudit(userId, 'mcp_place_category_update', 'place_category', id, {});
			return textResult(category ? projectPlaceCategory(category) : { ok: false });
		}
	},
	'roamarr_place_category_delete': {
		scope: 'saved-places:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getPlaceCategoryById, deletePlaceCategory } = await import('../places');
			const id = Number(args.categoryId);
			if (!getPlaceCategoryById(id, userId)) return { content: [{ type: 'text' as const, text: 'Category not found' }], isError: true };
			deletePlaceCategory(id, userId);
			logAudit(userId, 'mcp_place_category_delete', 'place_category', id, {});
			return textResult({ ok: true, categoryId: id });
		}
	},
	'roamarr_saved_places_search': {
		scope: 'saved-places:read',
		handler: async ({ args }) => {
			const { searchPlaceCatalog } = await import('../placeSearch');
			const outcome = await searchPlaceCatalog(String(args.query ?? ''), {
				limit: args.limit != null ? Number(args.limit) : undefined
			});
			if (!outcome.ok) return { content: [{ type: 'text' as const, text: outcome.error }], isError: true };
			return textResult({ results: outcome.results });
		}
	},
	'roamarr_saved_places_import': {
		scope: 'saved-places:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { executeGeoImport, GEO_IMPORT_MAX_ROWS } = await import('../geoImport');
			if (!Array.isArray(args.rows)) {
				return { content: [{ type: 'text' as const, text: 'rows must be an array of { name, lat, lng, address, description, categoryId }' }], isError: true };
			}
			if (args.rows.length === 0 || args.rows.length > GEO_IMPORT_MAX_ROWS) {
				return { content: [{ type: 'text' as const, text: `rows must contain 1-${GEO_IMPORT_MAX_ROWS} entries` }], isError: true };
			}
			const rows = args.rows.map((r) => {
				const row = (r ?? {}) as Record<string, unknown>;
				return {
					name: typeof row.name === 'string' ? row.name : '',
					lat: row.lat != null && Number.isFinite(Number(row.lat)) ? Number(row.lat) : null,
					lng: row.lng != null && Number.isFinite(Number(row.lng)) ? Number(row.lng) : null,
					address: typeof row.address === 'string' ? row.address : null,
					description: typeof row.description === 'string' ? row.description : null,
					sourceUrl: null,
					categoryGuess: typeof row.category === 'string' ? row.category : null
				};
			});
			if (rows.some((r) => !r.name.trim())) {
				return { content: [{ type: 'text' as const, text: 'Every row needs a non-empty name' }], isError: true };
			}
			const result = executeGeoImport(userId, rows, {
				categoryId: args.categoryId != null ? Number(args.categoryId) : null,
				skipDuplicates: args.skipDuplicates !== false
			});
			logAudit(userId, 'mcp_places_import', 'place', 0, { created: result.created });
			return textResult(result);
		}
	},
	'roamarr_place_links_list': {
		scope: 'saved-places:read',
		handler: async ({ userId, args }) => {
			const { getPlaceById } = await import('../places');
			const { listPlaceLinks } = await import('../placeLinks');
			const placeId = Number(args.placeId);
			if (!getPlaceById(placeId, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			const links = listPlaceLinks(placeId);
			const page = paginateList(links, args, (l) => l.id);
			return textResult({ placeId, items: page.items, nextCursor: page.nextCursor });
		}
	},
	'roamarr_place_links_create': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const { getPlaceById } = await import('../places');
			const { createPlaceLink } = await import('../placeLinks');
			const placeId = Number(args.placeId);
			if (!getPlaceById(placeId, userId)) return { content: [{ type: 'text' as const, text: 'Place not found' }], isError: true };
			// Helper enforces URL validation + audit log.
			const link = createPlaceLink(userId, placeId, {
				label: String(args.label ?? ''),
				url: String(args.url ?? ''),
				notes: (args.notes as string) ?? null
			});
			logAudit(userId, 'mcp_place_link_create', 'place_link', link.id, { placeId });
			return textResult({ id: link.id, placeId });
		}
	},
	'roamarr_place_links_update': {
		scope: 'saved-places:write',
		handler: async ({ userId, args }) => {
			const parsed = parsePlaceLinkArgs(args);
			if (!parsed.ok) {
				return { content: [{ type: 'text' as const, text: parsed.error }], isError: true };
			}
			if (parsed.empty) {
				return textResult({ ok: true, linkId: parsed.linkId, updated: false });
			}
			const { getPlaceById } = await import('../places');
			const { getPlaceLinkById, updatePlaceLink } = await import('../placeLinks');
			const existing = getPlaceLinkById(parsed.linkId);
			if (!existing || !getPlaceById(existing.placeId, userId)) {
				return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
			}
			// Partial patch: absent keys are omitted entirely so they are never
			// written as NULL (Kit treats explicit undefined as NULL).
			updatePlaceLink(userId, existing.placeId, parsed.linkId, parsed.patch);
			logAudit(userId, 'mcp_place_link_update', 'place_link', parsed.linkId, {});
			return textResult({ ok: true, linkId: parsed.linkId, updated: true });
		}
	},
	'roamarr_place_links_delete': {
		scope: 'saved-places:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { getPlaceById } = await import('../places');
			const { getPlaceLinkById, deletePlaceLink } = await import('../placeLinks');
			const id = Number(args.linkId);
			const existing = getPlaceLinkById(id);
			if (!existing || !getPlaceById(existing.placeId, userId)) {
				return { content: [{ type: 'text' as const, text: 'Link not found' }], isError: true };
			}
			deletePlaceLink(userId, existing.placeId, id);
			logAudit(userId, 'mcp_place_link_delete', 'place_link', id, {});
			return textResult({ ok: true, linkId: id });
		}
	},
	'roamarr_search': {
		scope: 'search:read',
		handler: async ({ userId, args }) => {
			const q = String(args.query ?? '').trim();
			const { globalSearch } = await import('../embeddings/search');
			const result = q
				? await globalSearch(userId, q)
				: { trips: [], hits: [], semantic: false, q: '' };
			// Place hits are owner-filtered upstream; hydrate a useful projection here.
			let hits: unknown[] = result.hits;
			if (result.hits.some((h) => h.entityType === 'place')) {
				const { getPlaceById, getPlaceCategoryById } = await import('../places');
				hits = result.hits.map((h) => {
					if (h.entityType !== 'place') return h;
					const place = getPlaceById(h.entityId, userId);
					if (!place) return h;
					const category =
						place.categoryId != null ? getPlaceCategoryById(place.categoryId, userId) : null;
					return {
						...h,
						snippet: h.body,
						place: {
							id: place.id,
							name: place.name,
							category: category?.name ?? null,
							lat: place.lat,
							lng: place.lng,
							status: place.status
						}
					};
				});
			}
			return textResult({
				query: result.q,
				semantic: result.semantic,
				hits,
				trips: result.trips.map((t) => ({
					id: t.id,
					name: t.name,
					destination: 'destination' in t ? (t as { destination?: string | null }).destination : null,
					destinationCityName: t.destinationCityName,
					isShared: t.isShared
				}))
			});
		}
	},
	'roamarr_gallery_list': {
		scope: 'gallery:read',
		handler: async ({ userId, args }) => {
			const ownerType = String(args.ownerType ?? '');
			if (ownerType !== 'place' && ownerType !== 'trip') {
				return { content: [{ type: 'text' as const, text: 'ownerType must be place or trip' }], isError: true };
			}
			const { listGallery, projectGalleryImage } = await import('../gallery');
			const ownerId = Number(args.ownerId);
			return textResult({ ownerType, ownerId, items: listGallery(userId, ownerType, ownerId).map(projectGalleryImage) });
		}
	},
	'roamarr_gallery_remove': {
		scope: 'gallery:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const { removeGalleryImage } = await import('../gallery');
			const imageId = Number(args.imageId);
			await removeGalleryImage(userId, imageId);
			return textResult({ ok: true, imageId });
		}
	},
	'roamarr_gallery_reorder': {
		scope: 'gallery:write',
		handler: async ({ userId, args }) => {
			const ownerType = String(args.ownerType ?? '');
			if (ownerType !== 'place' && ownerType !== 'trip') {
				return { content: [{ type: 'text' as const, text: 'ownerType must be place or trip' }], isError: true };
			}
			if (!Array.isArray(args.imageIds)) {
				return { content: [{ type: 'text' as const, text: 'imageIds must be an array of image ids' }], isError: true };
			}
			const { reorderGallery, projectGalleryImage } = await import('../gallery');
			const items = reorderGallery(
				userId,
				ownerType,
				Number(args.ownerId),
				args.imageIds.map((id) => Number(id))
			);
			return textResult({ items: items.map(projectGalleryImage) });
		}
	},
	'roamarr_gallery_set_caption': {
		scope: 'gallery:write',
		handler: async ({ userId, args }) => {
			const { setGalleryCaption, projectGalleryImage } = await import('../gallery');
			const image = setGalleryCaption(userId, Number(args.imageId), String(args.caption ?? ''));
			return textResult(projectGalleryImage(image));
		}
	},
	'roamarr_attachment_upload': {
		scope: 'trips:write',
		handler: async ({ userId, args }) => {
			const target = resolveAttachmentTarget(args as Record<string, unknown>);
			const filename = attachmentFilename(args.filename);
			const mimeType = attachmentMimeType(args.mimeType);
			if (typeof args.contentBase64 !== 'string') throw error(400, 'contentBase64 is required');
			const file = fileFromAttachmentBase64({
				filename,
				mimeType,
				contentBase64: args.contentBase64
			});
			const { addTripDocument } = await import('../tripDocuments');
			const { link, attachment } = await addTripDocument(userId, target.tripId, {
				file,
				segmentId: target.segmentId,
				label: boundedOptional(args.label, 'label', 200),
				notes: boundedOptional(args.notes, 'notes', 2000)
			});
			logAudit(userId, 'mcp_attachment_upload', 'trip_document', link.id, {
				tripId: target.tripId,
				segmentId: target.segmentId,
				filename
			});
			// The caller just supplied these notes; addTripDocument already enforced edit access.
			return textResult(
				projectTripDocument(
					{
						id: link.id,
						tripId: link.tripId,
						segmentId: link.segmentId,
						label: link.label,
						notes: link.notes,
						filename: attachment.filename,
						contentType: attachment.contentType,
						sizeBytes: attachment.sizeBytes,
						createdAt: link.createdAt
					},
					true
				)
			);
		}
	},
	'roamarr_attachment_list': {
		scope: 'trips:read',
		handler: async ({ userId, scopes, args }) => {
			const target = resolveAttachmentTarget(args as Record<string, unknown>);
			const trip = requireViewableTrip(userId, target.tripId);
			if (target.segmentId != null) {
				const seg = segmentsRepo.getSegmentById(target.segmentId);
				if (!seg || seg.tripId !== target.tripId) throw error(400, 'Segment not found on this trip');
			}
			const { listTripDocuments, listSegmentDocuments } = await import('../tripDocuments');
			const rows =
				target.segmentId != null
					? listSegmentDocuments(target.segmentId)
					: listTripDocuments(target.tripId);
			const page = paginateList(rows, args as { limit?: unknown; cursor?: unknown }, (row) => row.id);
			const includeNotes = canReadPrivateDetails(scopes) && canViewDetails(userId, trip);
			return textResult({
				tripId: target.tripId,
				segmentId: target.segmentId,
				items: page.items.map((row) => projectTripDocument(row, includeNotes)),
				nextCursor: page.nextCursor
			});
		}
	},
	'roamarr_attachment_get': {
		scope: 'trips:read',
		handler: async ({ userId, scopes, args }) => {
			const loaded = await loadTripDocumentForView(userId, args as Record<string, unknown>);
			const includeNotes = canReadPrivateDetails(scopes) && canViewDetails(userId, loaded.trip);
			const document = projectTripDocument(loaded.row, includeNotes);
			if (args.includeContent !== true) return textResult({ document });
			const { readTripDocument } = await import('../tripDocuments');
			const range = parseAttachmentByteRange(args as Record<string, unknown>);
			const { stream, record } = await readTripDocument(userId, loaded.row.id);
			const totalBytes = record.sizeBytes;
			if (range.offset > totalBytes) {
				await stream.cancel();
				throw error(400, `offset ${range.offset} is past the end of the file (${totalBytes} bytes)`);
			}
			const { contentBase64, bytes } = await streamToBase64(stream, range);
			const nextByte = range.offset + bytes;
			const complete = nextByte >= totalBytes;
			return textResult({
				document,
				contentIncluded: true,
				contentBase64,
				totalBytes,
				contentOffset: range.offset,
				contentBytes: bytes,
				complete,
				nextOffset: complete ? null : nextByte
			});
		}
	},
	'roamarr_attachment_delete': {
		scope: 'trips:write',
		confirm: true,
		handler: async ({ userId, args }) => {
			const loaded = await loadTripDocumentForView(userId, args as Record<string, unknown>);
			const { deleteTripDocument } = await import('../tripDocuments');
			await deleteTripDocument(userId, loaded.row.id);
			logAudit(userId, 'mcp_attachment_delete', 'trip_document', loaded.row.id, {
				tripId: loaded.row.tripId,
				segmentId: loaded.row.segmentId,
				filename: loaded.row.filename
			});
			return textResult({ ok: true, documentId: loaded.row.id });
		}
	},
};
