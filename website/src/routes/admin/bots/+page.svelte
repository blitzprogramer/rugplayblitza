<script lang="ts">
	import { onMount } from 'svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { HugeiconsIcon } from '@hugeicons/svelte';
	import { Robot02Icon, TradeUpIcon, TradeDownIcon, Loading03Icon } from '@hugeicons/core-free-icons';
	import { toast } from 'svelte-sonner';
	import { formatValue, formatRelativeTime } from '$lib/utils';

	type Bias = 'bull' | 'bear' | 'neutral';
	type TradeType = 'BUY' | 'SELL';

	interface BotStatusRow {
		id: number;
		username: string;
		image: string | null;
		botPersonality: string | null;
		baseCurrencyBalance: number;
		holdingCount: number;
		portfolioValue: number;
	}
	interface BotRecentTrade {
		id: number;
		userId: number;
		username: string;
		coinSymbol: string;
		type: TradeType;
		quantity: number;
		totalValue: number;
		timestamp: string;
	}

	let bots = $state<BotStatusRow[]>([]);
	let recentTrades = $state<BotRecentTrade[]>([]);
	let bias = $state<Bias>('neutral');
	let loading = $state(true);
	let savingBias = $state(false);

	// force-trade form
	let botId = $state<number | null>(null);
	let coinSymbol = $state('');
	let tradeType = $state<TradeType>('BUY');
	let amount = $state<number | null>(null);
	let submitting = $state(false);

	// amount unit swaps with type — load-bearing (BUY spends $, SELL sells tokens)
	let amountLabel = $derived(tradeType === 'BUY' ? '$ to spend' : 'Token quantity to sell');
	let amountPlaceholder = $derived(tradeType === 'BUY' ? '500' : '100');

	async function loadBots() {
		loading = true;
		try {
			const res = await fetch('/api/admin/bots');
			if (res.ok) {
				const data = await res.json();
				bots = data.bots;
				recentTrades = data.recentTrades;
				bias = data.bias;
				if (botId == null && bots.length > 0) botId = bots[0].id;
			} else {
				toast.error('Failed to load bots');
			}
		} catch {
			toast.error('Failed to load bots');
		} finally {
			loading = false;
		}
	}

	async function setBias(next: Bias) {
		if (bias === next) return;
		const prev = bias;
		bias = next; // optimistic
		savingBias = true;
		try {
			const res = await fetch('/api/admin/bots/config', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bias: next })
			});
			if (res.ok) {
				bias = (await res.json()).bias;
				toast.success(`Market bias → ${next}`);
			} else {
				bias = prev;
				toast.error((await res.json()).error || 'Failed to set bias');
			}
		} catch {
			bias = prev;
			toast.error('Failed to set bias');
		} finally {
			savingBias = false;
		}
	}

	async function forceTrade() {
		if (botId == null || !coinSymbol.trim() || amount == null || amount <= 0) {
			toast.error('Fill in bot, symbol, and a positive amount');
			return;
		}
		submitting = true;
		try {
			const res = await fetch('/api/admin/bots/force-trade', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					botId: Number(botId),
					coinSymbol: coinSymbol.trim().toUpperCase(),
					type: tradeType,
					amount
				})
			});
			const data = await res.json();
			if (res.ok) {
				const r = data.result;
				toast.success(`${r.type} *${r.coinSymbol} · impact ${r.priceImpact?.toFixed(2)}%`);
				amount = null;
				await loadBots();
			} else {
				toast.error(data.error || 'Trade failed');
			}
		} catch {
			toast.error('Trade failed');
		} finally {
			submitting = false;
		}
	}

	function personalityBadge(p: string | null): { label: string; class: string } {
		switch (p) {
			case 'momentum':
				return { label: 'Momentum', class: 'text-amber-500' };
			case 'degen':
				return { label: 'Degen', class: 'text-red-500' };
			default:
				return { label: 'Contrarian', class: 'text-blue-500' };
		}
	}

	onMount(() => loadBots());
</script>

<svelte:head>
	<title>Bots - Admin - Rugplay</title>
</svelte:head>

<div class="container mx-auto max-w-5xl space-y-4 py-6">
	<!-- Market bias -->
	<Card>
		<CardHeader>
			<CardTitle class="flex flex-wrap items-center gap-2">
				<HugeiconsIcon icon={Robot02Icon} class="h-5 w-5" />
				Market Bias
				<Badge variant="secondary" class="text-xs">Live · resets on restart</Badge>
			</CardTitle>
		</CardHeader>
		<CardContent class="space-y-2">
			<p class="text-muted-foreground text-sm">
				Soft global tilt on every bot decision. Bull nudges toward buying, bear toward selling.
			</p>
			<div class="flex flex-wrap gap-2">
				<Button
					variant={bias === 'bull' ? 'default' : 'outline'}
					onclick={() => setBias('bull')}
					disabled={savingBias}
				>
					<HugeiconsIcon icon={TradeUpIcon} class="h-4 w-4 text-green-500" /> Bull
				</Button>
				<Button
					variant={bias === 'neutral' ? 'default' : 'outline'}
					onclick={() => setBias('neutral')}
					disabled={savingBias}
				>
					Neutral
				</Button>
				<Button
					variant={bias === 'bear' ? 'default' : 'outline'}
					onclick={() => setBias('bear')}
					disabled={savingBias}
				>
					<HugeiconsIcon icon={TradeDownIcon} class="h-4 w-4 text-red-500" /> Bear
				</Button>
			</div>
		</CardContent>
	</Card>

	<!-- Force trade -->
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<HugeiconsIcon icon={TradeUpIcon} class="h-5 w-5" />
				Force Trade
			</CardTitle>
		</CardHeader>
		<CardContent class="space-y-4">
			<p class="text-muted-foreground text-sm">
				Make a bot buy/sell a coin now. Bypasses the 3% impact cap — you decide the size.
			</p>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="botId">Bot</Label>
					<select
						id="botId"
						bind:value={botId}
						class="border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm"
					>
						{#each bots as bot (bot.id)}
							<option value={bot.id}>@{bot.username}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-2">
					<Label for="coinSymbol">Coin symbol</Label>
					<Input id="coinSymbol" bind:value={coinSymbol} placeholder="e.g. AAPL" />
				</div>
				<div class="space-y-2">
					<Label>Type</Label>
					<div class="flex gap-2">
						<Button
							variant={tradeType === 'BUY' ? 'default' : 'outline'}
							onclick={() => (tradeType = 'BUY')}
							class="flex-1">Buy</Button
						>
						<Button
							variant={tradeType === 'SELL' ? 'default' : 'outline'}
							onclick={() => (tradeType = 'SELL')}
							class="flex-1">Sell</Button
						>
					</div>
				</div>
				<div class="space-y-2">
					<Label for="amount">{amountLabel}</Label>
					<Input
						id="amount"
						type="number"
						bind:value={amount}
						placeholder={amountPlaceholder}
					/>
				</div>
			</div>
			<Button onclick={forceTrade} disabled={submitting}>
				{#if submitting}
					<HugeiconsIcon icon={Loading03Icon} class="mr-2 h-4 w-4 animate-spin" />
				{/if}
				Execute {tradeType}
			</Button>
		</CardContent>
	</Card>

	<!-- Dashboard -->
	<Card>
		<CardHeader class="flex flex-row items-center justify-between space-y-0">
			<CardTitle class="flex items-center gap-2">
				Bots
				<Badge variant="secondary" class="text-xs">{bots.length}</Badge>
			</CardTitle>
			<Button variant="outline" size="sm" onclick={loadBots} disabled={loading}>
				{#if loading}
					<HugeiconsIcon icon={Loading03Icon} class="mr-1 h-4 w-4 animate-spin" />
				{/if}
				Refresh
			</Button>
		</CardHeader>
		<CardContent>
			{#if loading && bots.length === 0}
				<div class="space-y-2">
					{#each Array(5) as _}
						<Skeleton class="h-10 w-full" />
					{/each}
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-muted-foreground border-b text-left">
								<th class="pb-2 pr-2 font-medium">Bot</th>
								<th class="pb-2 pr-2 font-medium">Personality</th>
								<th class="pb-2 pr-2 text-right font-medium">Balance</th>
								<th class="pb-2 pr-2 text-right font-medium">Holdings</th>
								<th class="pb-2 text-right font-medium">Portfolio</th>
							</tr>
						</thead>
						<tbody>
							{#each bots as bot (bot.id)}
								{@const pb = personalityBadge(bot.botPersonality)}
								<tr class="border-b last:border-0">
									<td class="py-2 pr-2 font-medium">@{bot.username}</td>
									<td class="py-2 pr-2">
										<Badge variant="secondary" class={pb.class}>{pb.label}</Badge>
									</td>
									<td class="py-2 pr-2 text-right font-mono"
										>{formatValue(bot.baseCurrencyBalance)}</td
									>
									<td class="py-2 pr-2 text-right font-mono">{bot.holdingCount}</td>
									<td class="py-2 text-right font-mono">{formatValue(bot.portfolioValue)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- Recent bot trades -->
	<Card>
		<CardHeader>
			<CardTitle>Recent Bot Trades</CardTitle>
		</CardHeader>
		<CardContent>
			{#if recentTrades.length === 0}
				<p class="text-muted-foreground py-6 text-center text-sm">No bot trades yet.</p>
			{:else}
				<div class="space-y-2">
					{#each recentTrades as t (t.id)}
						<div
							class="flex items-center justify-between gap-2 border-b py-2 text-sm last:border-0"
						>
							<div class="flex items-center gap-2">
								{#if t.type === 'BUY'}
									<HugeiconsIcon icon={TradeUpIcon} class="h-4 w-4 text-green-500" />
								{:else}
									<HugeiconsIcon icon={TradeDownIcon} class="h-4 w-4 text-red-500" />
								{/if}
								<span class="font-medium">{t.type}</span>
								<span class="text-muted-foreground">·</span>
								<span class="font-mono">*{t.coinSymbol}</span>
								<span class="text-muted-foreground">by @{t.username}</span>
							</div>
							<div class="flex items-center gap-3 font-mono text-xs">
								<span>{formatValue(t.totalValue)}</span>
								<span class="text-muted-foreground"
									>{formatRelativeTime(new Date(t.timestamp))}</span
								>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
