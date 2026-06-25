<script lang="ts">
	let { errors = {} }: { errors?: Record<string, string> } = $props();
</script>

<div class="field flex flex-row items-center gap-2 sm:col-span-2">
	<input id="detail_booked" name="detail_booked" type="checkbox" class="checkbox" />
	<label class="label mb-0" for="detail_booked">Has this plan been booked?</label>
</div>
