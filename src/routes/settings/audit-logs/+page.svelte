<script lang="ts">
	let { data } = $props();
</script>

<header>
	<h1 class="text-3xl font-extrabold text-white">Audit log</h1>
	<p class="mt-1 text-sm text-muted">Recent security-relevant events across the instance.</p>
</header>

<section class="card mt-8 p-5 sm:p-6">
	<div class="overflow-x-auto">
		<table class="table">
			<thead>
				<tr>
					<th>Time</th>
					<th>User</th>
					<th>Action</th>
					<th>Entity</th>
					<th class="w-full">Details</th>
				</tr>
			</thead>
			<tbody>
				{#each data.logs as log (log.id)}
					<tr>
						<td class="whitespace-nowrap text-slate-400">{log.createdAt}</td>
						<td>
							<div class="font-medium text-white">{log.user.displayName}</div>
							<div class="text-xs text-slate-500">{log.user.email}</div>
						</td>
						<td class="whitespace-nowrap">
							<span class="badge badge-slate">{log.action}</span>
						</td>
						<td class="whitespace-nowrap text-slate-400">
							{log.entityType}:{log.entityId}
						</td>
						<td>
							<code class="rounded bg-slate-950/50 px-2 py-1 text-xs text-slate-300">
								{JSON.stringify(log.meta)}
							</code>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="py-8 text-center text-slate-500">No audit events yet.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
