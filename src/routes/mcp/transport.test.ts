import { test, expect, beforeEach } from 'vitest';
import {
	registerTransport,
	getTransport,
	getMcpTransportCount,
	resetMcpTransports,
	MCP_SESSION_TTL_MS
} from './+server';
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';

const stub = {} as WebStandardStreamableHTTPServerTransport;

beforeEach(() => resetMcpTransports());

test('getTransport prunes sessions idle past the TTL (not only on init)', () => {
	const staleAt = Date.now() - MCP_SESSION_TTL_MS - 1_000;
	registerTransport('stale', stub, staleAt);
	expect(getMcpTransportCount()).toBe(1);

	// A request for the stale session triggers pruning and misses — so quiet
	// periods cannot keep idle transports resident until restart.
	expect(getTransport('stale')).toBeUndefined();
	expect(getMcpTransportCount()).toBe(0);
});

test('getTransport keeps and refreshes a live session', () => {
	registerTransport('live', stub);
	expect(getTransport('live')).toBe(stub);
	expect(getMcpTransportCount()).toBe(1);
});

test('registerTransport caps at MAX_MCP_SESSIONS by evicting the oldest', () => {
	for (let i = 0; i < 1001; i++) registerTransport(`s${i}`, stub);
	expect(getMcpTransportCount()).toBe(1000);
	// s0 was the oldest-inserted and was evicted when the 1001st arrived.
	expect(getTransport('s0')).toBeUndefined();
	expect(getTransport('s1000')).toBe(stub);
});
