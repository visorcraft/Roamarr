declare module 'tar-fs' {
	import type { Readable, Writable } from 'node:stream';

	interface PackOptions {
		entries?: string[];
		ignore?: (name: string) => boolean;
		map?: (header: { name: string }) => { name: string };
	}

	interface ExtractOptions {
		ignore?: (name: string, header?: { type?: string }) => boolean;
		map?: (header: { name: string }) => { name: string };
	}

	export function pack(path: string, opts?: PackOptions): Readable;
	export function extract(path: string, opts?: ExtractOptions): Readable & Writable;

	const tarFs: { pack: typeof pack; extract: typeof extract };
	export default tarFs;
}
