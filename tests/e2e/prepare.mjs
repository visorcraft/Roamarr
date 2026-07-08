import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE_URL = process.env.ROAMARR_E2E_URL || 'http://127.0.0.1:3002';
const SECRET =
	process.env.ROAMARR_SECRET ||
	'ACpm0VlkwltJpcNWtxlilgjX+ZbW2nTV7QqYbZK0Fig=';
const NO_RESET = process.argv.includes('--no-reset');

const DEV_PROJECT = 'roamarr';
const E2E_PROJECT = 'roamarr-e2e';
const COMPOSE_FILE = 'compose.local.yml';

function composeCmd(project, args) {
	return `podman compose -p ${project} -f ${COMPOSE_FILE} ${args}`;
}

function run(cmd, opts = {}) {
	console.log(`> ${cmd}`);
	return execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...opts.env } });
}

function isRunning(containerName) {
	try {
		const out = execSync(`podman ps --filter name=${containerName} --format "{{.Names}}"`, {
			stdio: 'pipe'
		})
			.toString()
			.trim();
		return out.includes(containerName);
	} catch {
		return false;
	}
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
	// The dev container and the e2e container both bind port 3002. Stop the dev
	// container first, but NEVER remove its volume.
	if (isRunning('roamarr_app_1')) {
		console.log('Stopping dev container to free port (its data volume is preserved)...');
		run(composeCmd(DEV_PROJECT, 'down'), { env: { ROAMARR_SECRET: SECRET } });
	}

	const e2eRunning = isRunning('roamarr-e2e_app_1');

	if (e2eRunning && NO_RESET) {
		try {
			await waitForHealth(5000);
			console.log('Reusing existing e2e container.');
			return;
		} catch {
			console.log('E2E container is running but not healthy; restarting...');
			run(composeCmd(E2E_PROJECT, 'down -v'), { env: { ROAMARR_SECRET: SECRET } });
		}
	} else {
		// Default: reset the e2e volume so tests start from a known empty state.
		const reason = e2eRunning ? 'Restarting e2e container with a fresh volume...' : 'Starting e2e container...';
		console.log(reason);
		try {
			run(composeCmd(E2E_PROJECT, 'down -v'), { env: { ROAMARR_SECRET: SECRET } });
		} catch {
			// The e2e project may not exist yet; ignore a failed teardown.
		}
	}

	run(composeCmd(E2E_PROJECT, 'up -d'), { env: { ROAMARR_SECRET: SECRET } });

	// The first boot installs node_modules; give it a little time before polling.
	await sleep(3000);
	await waitForHealth();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
