import { execSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.ROAMARR_E2E_URL || 'http://127.0.0.1:3002';
const SECRET =
	process.env.ROAMARR_SECRET ||
	'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';

function run(cmd, opts = {}) {
	console.log(`> ${cmd}`);
	return execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...opts.env } });
}

async function waitForHealth(timeoutMs = 120_000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${BASE_URL}/health`);
			if (res.ok) {
				const body = await res.json();
				if (body.ok && body.db && body.scheduler) {
					console.log('Roamarr is healthy.');
					return;
				}
			}
		} catch {
			// not ready yet
		}
		await sleep(1000);
	}
	throw new Error(`Roamarr did not become healthy within ${timeoutMs}ms`);
}

async function main() {
	// Check whether the dev container is already running.
	let running = false;
	try {
		execSync('podman ps --filter name=roamarr_app_1 --format "{{.Names}}"', { stdio: 'pipe' });
		running = true;
	} catch {
		running = false;
	}

	if (running) {
		console.log('Stopping existing dev container and resetting data...');
		run('podman compose -f compose.local.yml down -v', { env: { ROAMARR_SECRET: SECRET } });
	}

	console.log('Starting dev container...');
	run('podman compose -f compose.local.yml up -d', { env: { ROAMARR_SECRET: SECRET } });

	// The first boot installs node_modules; give it a little time before polling.
	await sleep(3000);
	await waitForHealth();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
