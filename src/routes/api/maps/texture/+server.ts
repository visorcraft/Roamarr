import { error, type RequestHandler } from '@sveltejs/kit';
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { requireUser } from '$lib/server/auth';
import { hasMapTexture, textureFilePath } from '$lib/server/mapsAssets';

export const GET: RequestHandler = ({ locals }) => {
	requireUser(locals);
	if (!hasMapTexture()) throw error(404, 'Map texture not downloaded');
	const p = textureFilePath();
	const size = statSync(p).size;
	const body = Readable.toWeb(createReadStream(p)) as unknown as ReadableStream;
	return new Response(body, {
		headers: {
			'content-type': 'image/jpeg',
			'content-length': String(size),
			'cache-control': 'private, max-age=86400'
		}
	});
};
