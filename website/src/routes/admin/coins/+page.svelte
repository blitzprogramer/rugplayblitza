<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Badge } from '$lib/components/ui/badge';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Coins02Icon, StarIcon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import CoinIcon from '$lib/components/self/CoinIcon.svelte';
	import { formatValue } from '$lib/utils';

	interface AdminCoin {
		id: number;
		name: string;
		symbol: string;
		icon: string | null;
		isFeatured: boolean;
		isListed: boolean;
		marketCap: number;
		createdAt: string;
	}

	let coins = $state<AdminCoin[]>([]);
	let loading = $state(true);
	let search = $state('');
	let togglingId = $state<number | null>(null);

	let featuredCount = $derived(coins.filter((c) => c.isFeatured).length);

	async function loadCoins() {
		loading = true;
		try {
			const res = await fetch(`/api/admin/coins${search ? `?search=${encodeURIComponent(search)}` : ''}`);
			if (res.ok) coins = await res.json();
		} catch {
			toast.error('Failed to load coins');
		} finally {
			loading = false;
		}
	}

	let debounceTimer: ReturnType<typeof setTimeout>;
	// Re-fetch on search change (debounced).
	$effect(() => {
		const q = search;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => loadCoins(), 300);
	});

	async function toggleFeatured(c: AdminCoin) {
		togglingId = c.id;
		const next = !c.isFeatured;
		try {
			const res = await fetch(`/api/admin/coins/${c.id}/feature`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ featured: next })
			});
			if (res.ok) {
				coins = coins.map((x) => (x.id === c.id ? { ...x, isFeatured: next } : x));
				toast.success(`${next ? 'Featured' : 'Unfeatured'} *${c.symbol}`);
			} else {
				const err = await res.json();
				toast.error(err.error || 'Failed to update');
			}
		} catch {
			toast.error('Failed to update');
		} finally {
			togglingId = null;
		}
	}

	onMount(() => {
		loadCoins();
	});
</script>

<svelte:head>
	<title>Featured Coins - Admin | Rugplay</title>
</svelte:head>

<div class="container mx-auto max-w-4xl space-y-4 py-6">
	<Card>
		<CardHeader class="flex flex-row items-center justify-between">
			<CardTitle class="flex items-center gap-2">
				<HugeiconsIcon icon={Coins02Icon} class="h-5 w-5" />
				Featured Coins
				<Badge variant="secondary" class="text-xs">{featuredCount} featured</Badge>
			</CardTitle>
		</CardHeader>
		<CardContent>
			<p class="text-muted-foreground mb-3 text-sm">
				Featured coins are pinned to the top of the market and home lists with a ★ badge.
			</p>
			<Input
				type="text"
				placeholder="Search by name or symbol…"
				bind:value={search}
				class="mb-4"
			/>

			{#if loading}
				<div class="space-y-2">
					{#each Array(6) as _}
						<div class="flex items-center justify-between p-3 border rounded">
							<div class="flex items-center gap-3 flex-1">
								<Skeleton class="h-8 w-8 rounded-full" />
								<div class="space-y-2 flex-1">
									<Skeleton class="h-4 w-32" />
									<Skeleton class="h-3 w-20" />
								</div>
							</div>
							<Skeleton class="h-8 w-24" />
						</div>
					{/each}
				</div>
			{:else if coins.length === 0}
				<div class="text-center py-8">
					<p class="text-muted-foreground">No coins found.</p>
				</div>
			{:else}
				<div class="max-h-[32rem] space-y-2 overflow-y-auto">
					{#each coins as c (c.id)}
						<div class="flex items-center justify-between gap-3 p-3 border rounded">
							<a href={`/coin/${c.symbol}`} class="flex min-w-0 flex-1 items-center gap-3">
								<CoinIcon icon={c.icon} symbol={c.symbol} name={c.name} size={8} />
								<div class="min-w-0">
									<div class="flex items-center gap-2">
										<span class="truncate font-medium">{c.name}</span>
										<span class="text-muted-foreground text-sm">*{c.symbol}</span>
										{#if !c.isListed}
											<span class="text-muted-foreground text-[10px] uppercase">Unlisted</span>
										{/if}
									</div>
									<div class="text-muted-foreground text-xs font-mono">
										MCap ${formatValue(c.marketCap)}
									</div>
								</div>
							</a>
							<Button
								size="sm"
								variant={c.isFeatured ? 'default' : 'outline'}
								onclick={() => toggleFeatured(c)}
								disabled={togglingId === c.id}
							>
								{#if togglingId === c.id}
									<HugeiconsIcon icon={Loading03Icon} class="h-4 w-4 animate-spin" />
								{:else if c.isFeatured}
									<HugeiconsIcon icon={StarIcon} class="h-4 w-4" />
									Unfeature
								{:else}
									<HugeiconsIcon icon={StarIcon} class="h-4 w-4" />
									Feature
								{/if}
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
