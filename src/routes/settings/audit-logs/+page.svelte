<script lang="ts">
	let { data }: { data: { filters: { userId?: number; action?: string; entityType?: string; from?: string; to?: string }; page: number; pageSize: number; total: number; users: { id: number; email: string; displayName: string }[]; logs: { id: number; createdAt: string; action: string; entityType: string; entityId: number; meta: unknown; user: { displayName: string; email: string } }[] } } = $props();

	const totalPages = $derived(Math.ceil(data.total / data.pageSize));
	const hasPrev = $derived(data.page > 1);
	const hasNext = $derived(data.page < totalPages);

	function queryFor(page: number) {
		const params = new URLSearchParams();
		if (data.filters.userId) params.set('userId', String(data.filters.userId));
		if (data.filters.action) params.set('action', data.filters.action);
		if (data.filters.entityType) params.set('entityType', data.filters.entityType);
		if (data.filters.from) params.set('from', data.filters.from);
		if (data.filters.to) params.set('to', data.filters.to);
		params.set('page', String(page));
		return '?' + params.toString();
	}

	function exportQuery() {
		const params = new URLSearchParams();
		if (data.filters.userId) params.set('userId', String(data.filters.userId));
		if (data.filters.action) params.set('action', data.filters.action);
		if (data.filters.entityType) params.set('entityType', data.filters.entityType);
		if (data.filters.from) params.set('from', data.filters.from);
		if (data.filters.to) params.set('to', data.filters.to);
		params.set('export', 'csv');
		return '?' + params.toString();
	}
</script>

<header>
	<h1 class="page-title">Audit log</h1>
	<p class="page-subtitle">Security-relevant events across the instance.</p>
</header>

<section class="card mt-6 p-5 sm:p-6">
	<form method="GET" class="flex flex-wrap items-end gap-3">
		<label class="field min-w-[10rem]">
			<span class="label">User</span>
			<select name="userId" class="input">
				<option value="">All users</option>
				{#each data.users as u}
					<option value={u.id} selected={data.filters.userId === u.id}>{u.displayName} ({u.email})</option>
				{/each}
			</select>
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">Action</span>
			<input type="text" name="action" value={data.filters.action ?? ''} placeholder="e.g. login" class="input" />
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">Entity type</span>
			<input type="text" name="entityType" value={data.filters.entityType ?? ''} placeholder="e.g. trip" class="input" />
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">From</span>
			<input type="date" name="from" value={data.filters.from ?? ''} class="input" />
		</label>
		<label class="field min-w-[8rem]">
			<span class="label">To</span>
			<input type="date" name="to" value={data.filters.to ?? ''} class="input" />
		</label>
		<button type="submit" class="btn btn-primary">Filter</button>
		<a href="/settings/audit-logs" class="btn btn-ghost">Reset</a>
	</form>
</section>

<section class="card mt-6 p-5 sm:p-6">
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
		<p class="text-sm text-muted">{data.total} event{data.total === 1 ? '' : 's'} · page {data.page} of {totalPages || 1}</p>
		<div class="flex gap-2">
			<a href={exportQuery()} class="btn btn-sm btn-ghost">Export CSV</a>
			<a href={queryFor(data.page - 1)} class="btn btn-sm btn-ghost" class:opacity-50={!hasPrev} aria-disabled={!hasPrev}>Previous</a>
			<a href={queryFor(data.page + 1)} class="btn btn-sm btn-ghost" class:opacity-50={!hasNext} aria-disabled={!hasNext}>Next</a>
		</div>
	</div>
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
							<code class="code-chip px-2 py-1">
								{JSON.stringify(log.meta)}
							</code>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="5" class="py-8 text-center text-slate-500">No audit events match.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>
