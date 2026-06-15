/**
 * LazyLotto — Play Pattern Analysis
 *
 * Reconstructs how people are actually playing a LazyLotto deployment by
 * replaying every on-chain event (from the mirror node) and cross-referencing
 * it with current on-chain state. Answers questions like:
 *
 *   • Which users are playing which pools, and how heavily?
 *   • Did they PAY for their entries, get them FREE (admin grant), or roll
 *     tickets sourced from NFTs they acquired/won/were gifted?
 *   • Did they benefit from bonuses on their rolls? (decisive-bonus wins +
 *     each player's current live boost)
 *   • Did they out- / under-perform the pool's win odds? (actual vs expected
 *     wins — flagged as low-confidence on small samples)
 *   • Engagement shape: hourly activity, top players, conversion (entries →
 *     rolls → claims), unclaimed prizes, prize depletion per pool.
 *
 * Read-only. No gas cost. Pulls events + state from the public mirror node.
 *
 * Usage:
 *   node scripts/interactions/LazyLotto/queries/analysePlayPatterns.js [contractId] [options]
 *
 *   contractId            0.0.xxxxx  (defaults to LAZY_LOTTO_CONTRACT_ID in .env)
 *
 * Options:
 *   --env <name>          mainnet|testnet|previewnet|local  (defaults to ENVIRONMENT in .env)
 *   --from <ts>           only events at/after this time. ISO date or unix seconds.
 *   --to <ts>             only events at/before this time. ISO date or unix seconds.
 *   --top <n>             how many rows to show in leaderboards (default 25)
 *   --json <path>         also write the full structured dataset to this file
 *   --no-classify         skip the per-transaction fetch that labels paid/free/NFT
 *                         entries (much faster, but loses entry-source detail)
 *
 * Examples:
 *   node ...analysePlayPatterns.js 0.0.10584052 --env mainnet
 *   node ...analysePlayPatterns.js --env mainnet --json reports/lotto-day1.json
 *   node ...analysePlayPatterns.js 0.0.10584052 --env mainnet --from 2026-06-14T00:00:00Z
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { default: axios } = require('axios');
const { AccountId, ContractId, Hbar, HbarUnit } = require('@hashgraph/sdk');

const { loadInterface } = require('../../../../utils/abiLoader');
const { batchMirrorQuery } = require('../../../../utils/solidityHelpers');
const {
	getBaseURL,
	getTokenDetails,
	homebrewPopulateAccountNum,
	EntityType,
} = require('../../../../utils/hederaMirrorHelpers');

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const MAX_WIN_RATE = 100_000_000; // contract constant: 100% = 100,000,000
const LAZY_DECIMALS = parseInt(process.env.LAZY_DECIMALS ?? '1', 10);

// ───────────────────────────── CLI parsing ─────────────────────────────

function parseArgs(argv) {
	const args = { positional: [], flags: {} };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			// boolean flags
			if (key === 'no-classify') {
				args.flags.classify = false;
			}
			else {
				const next = argv[i + 1];
				if (next === undefined || next.startsWith('--')) {
					args.flags[key] = true;
				}
				else {
					args.flags[key] = next;
					i++;
				}
			}
		}
		else {
			args.positional.push(a);
		}
	}
	return args;
}

function resolveTimestamp(value) {
	if (value === undefined) return null;
	// pure unix seconds (allow decimals for nanos precision)
	if (/^\d+(\.\d+)?$/.test(String(value))) return String(value);
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) {
		throw new Error(`Could not parse timestamp: "${value}". Use ISO date or unix seconds.`);
	}
	return (ms / 1000).toFixed(0);
}

// ───────────────────────────── formatting ─────────────────────────────

function fmtPct(thousandthsOfBps) {
	// win rate is stored 0..100,000,000 where 100,000,000 == 100%
	return (Number(thousandthsOfBps) / 1_000_000).toFixed(4) + '%';
}

// Boost is in the same scaled units as the win rate (100% == 100,000,000),
// NOT plain basis points — so percent = value / 1,000,000.
function fmtBoost(scaledBps) {
	if (scaledBps == null) return '—';
	return '+' + (Number(scaledBps) / 1_000_000).toFixed(2) + '%';
}

function fmtAmount(tokenId, rawAmount, tokenCache) {
	const amt = Number(rawAmount);
	if (tokenId === 'HBAR') {
		return new Hbar(amt, HbarUnit.Tinybar).toString();
	}
	const dets = tokenCache.get(tokenId);
	if (!dets || dets.decimals == null) return `${amt} ${tokenId}`;
	return `${(amt / 10 ** dets.decimals).toLocaleString(undefined, { maximumFractionDigits: dets.decimals })} ${dets.symbol || tokenId}`;
}

function bar(value, max, width = 24) {
	if (max <= 0) return '';
	const filled = Math.round((value / max) * width);
	return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

// ───────────────────────── mirror node fetching ─────────────────────────

/**
 * Fetch ALL contract logs (paginated) in ascending consensus order.
 */
async function fetchAllLogs(env, contractId, fromTs, toTs) {
	const baseUrl = getBaseURL(env);
	const params = ['order=asc', 'limit=100'];
	if (fromTs) params.push(`timestamp=gte:${fromTs}`);
	if (toTs) params.push(`timestamp=lte:${toTs}`);
	let url = `${baseUrl}/api/v1/contracts/${contractId.toString()}/results/logs?${params.join('&')}`;

	const logs = [];
	let page = 0;
	while (url) {
		const { data } = await axios.get(url);
		if (data.logs && data.logs.length) logs.push(...data.logs);
		page++;
		process.stdout.write(`\r   ...fetched ${logs.length} log entries (page ${page})   `);
		if (data.links && data.links.next) {
			url = data.links.next.startsWith('http') ? data.links.next : `${baseUrl}${data.links.next}`;
		}
		else {
			url = null;
		}
	}
	process.stdout.write('\n');
	return logs;
}

/**
 * Generic bounded-concurrency map.
 */
async function mapPool(items, concurrency, fn) {
	const results = new Array(items.length);
	let idx = 0;
	async function worker() {
		while (idx < items.length) {
			const i = idx++;
			try {
				results[i] = await fn(items[i], i);
			}
			catch (err) {
				results[i] = { __error: err.message };
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
	return results;
}

/**
 * For each unique transaction hash, fetch the contract result so we can learn
 * WHICH function was called (paid vs free vs NFT-sourced) and who paid.
 */
async function classifyTransactions(env, iface, txHashes) {
	const baseUrl = getBaseURL(env);
	const map = new Map();
	const results = await mapPool(txHashes, 8, async (hash) => {
		const { data } = await axios.get(`${baseUrl}/api/v1/contracts/results/${hash}`);
		let fnName = 'unknown';
		try {
			const parsed = iface.parseTransaction({ data: data.function_parameters });
			fnName = parsed?.name ?? 'unknown';
		}
		catch { /* fallback/receive or unparseable */ }
		return { hash, fnName, from: data.from, result: data.result };
	});
	for (let i = 0; i < txHashes.length; i++) {
		const r = results[i];
		if (r && !r.__error) map.set(txHashes[i], r);
	}
	return map;
}

// Map function name → how the entry/roll was sourced.
const PAID_FNS = new Set(['buyEntry', 'buyAndRollEntry', 'buyAndRedeemEntry']);
const FREE_FNS = new Set(['adminGrantEntry', 'adminBuyAndRedeemEntry']);
const NFT_ROLL_FNS = new Set(['rollWithNFT']);

// ───────────────────────── address resolution ─────────────────────────

const addrCache = new Map();
async function resolveAccount(env, evmAddr) {
	if (!evmAddr) return 'unknown';
	const lower = evmAddr.toLowerCase();
	if (lower === ZERO_ADDR) return 'HBAR/0x0';
	if (addrCache.has(lower)) return addrCache.get(lower);
	let id;
	try {
		id = await homebrewPopulateAccountNum(env, evmAddr, EntityType.ACCOUNT);
	}
	catch {
		// Fall back to long-zero decode (works for native Hedera accounts)
		try { id = AccountId.fromEvmAddress(0, 0, evmAddr).toString(); }
		catch { id = evmAddr; }
	}
	addrCache.set(lower, id);
	return id;
}

// ───────────────────────── pool state queries ─────────────────────────

async function fetchPoolState(env, iface, contractId, operatorId) {
	// totalPools
	const totalRes = await batchMirrorQuery(env, [
		{ contractId, encoded: iface.encodeFunctionData('totalPools'), label: 'totalPools' },
	], operatorId, { concurrency: 1 });
	if (totalRes[0].error) throw new Error(`Could not read totalPools: ${totalRes[0].error.message}`);
	const totalPools = Number(iface.decodeFunctionResult('totalPools', totalRes[0].result)[0]);

	const queries = [];
	for (let i = 0; i < totalPools; i++) {
		queries.push({ contractId, encoded: iface.encodeFunctionData('getPoolBasicInfo', [i]), label: `pool_${i}` });
	}
	const results = queries.length ? await batchMirrorQuery(env, queries, operatorId, { concurrency: 25 }) : [];

	const pools = new Map();
	for (let i = 0; i < totalPools; i++) {
		if (results[i].error) continue;
		const d = iface.decodeFunctionResult('getPoolBasicInfo', results[i].result);
		const [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken] = d;
		pools.set(i, {
			id: i,
			winRate: Number(winRate),
			winProbability: Number(winRate) / MAX_WIN_RATE,
			entryFee: Number(entryFee),
			prizeCountRemaining: Number(prizeCount),
			outstandingEntries: Number(outstandingEntries),
			feeTokenAddr: feeToken,
			paused, closed,
			ticketCID, winCID,
		});
	}
	return { totalPools, pools };
}

// ─────────────────────────────── main ───────────────────────────────

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));

	const env = (flags.env || process.env.ENVIRONMENT || 'testnet').toString();
	const contractIdStr = positional[0] || process.env.LAZY_LOTTO_CONTRACT_ID;
	if (!contractIdStr) {
		console.error('❌ No contract ID. Pass it as the first argument or set LAZY_LOTTO_CONTRACT_ID in .env.');
		process.exit(1);
	}
	const contractId = ContractId.fromString(contractIdStr);
	const operatorId = process.env.ACCOUNT_ID
		? AccountId.fromString(process.env.ACCOUNT_ID)
		: AccountId.fromString('0.0.2'); // any account works for read-only mirror calls
	const fromTs = resolveTimestamp(flags.from);
	const toTs = resolveTimestamp(flags.to);
	const topN = flags.top ? parseInt(flags.top, 10) : 25;
	const doClassify = flags.classify !== false;

	console.log('\n╔══════════════════════════════════════════════════════════════╗');
	console.log('║            LazyLotto — Play Pattern Analysis                 ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log(`  Environment:  ${env.toUpperCase()}`);
	console.log(`  Contract:     ${contractId.toString()}`);
	if (fromTs) console.log(`  From:         ${new Date(Number(fromTs) * 1000).toISOString()}`);
	if (toTs) console.log(`  To:           ${new Date(Number(toTs) * 1000).toISOString()}`);
	console.log('');

	const iface = loadInterface('LazyLotto');

	// 1. Pool state (current) ------------------------------------------------
	console.log('🔍 Reading current pool state...');
	const { totalPools, pools } = await fetchPoolState(env, iface, contractId, operatorId);
	console.log(`   ${totalPools} pool(s) found.`);

	// 2. Events --------------------------------------------------------------
	console.log('📜 Fetching on-chain events from mirror node...');
	const rawLogs = await fetchAllLogs(env, contractId, fromTs, toTs);
	console.log(`   ${rawLogs.length} raw log entries.`);

	const events = [];
	for (const log of rawLogs) {
		if (!log.data || log.data === '0x') {
			// some events are fully indexed; still parseable with empty data
		}
		let parsed;
		try {
			parsed = iface.parseLog({ topics: log.topics, data: log.data || '0x' });
		}
		catch {
			continue; // not a LazyLotto event we recognise
		}
		if (!parsed) continue;
		events.push({
			name: parsed.name,
			args: parsed.args,
			timestamp: log.timestamp, // consensus seconds.nanos
			ts: Math.floor(Number(log.timestamp)),
			txHash: log.transaction_hash,
			block: log.block_number,
		});
	}
	console.log(`   ${events.length} decoded LazyLotto events.`);

	const byName = {};
	for (const e of events) byName[e.name] = (byName[e.name] || 0) + 1;
	console.log('   ' + Object.entries(byName).map(([k, v]) => `${k}:${v}`).join('  '));

	// 3. Classify transactions (paid / free / nft) ---------------------------
	let txInfo = new Map();
	if (doClassify) {
		const uniqueTx = [...new Set(events.map(e => e.txHash))];
		console.log(`🏷️  Classifying ${uniqueTx.length} transactions (entry source / payer)...`);
		txInfo = await classifyTransactions(env, iface, uniqueTx);
	}
	else {
		console.log('🏷️  Skipping per-transaction classification (--no-classify).');
	}

	// 4. Resolve addresses ---------------------------------------------------
	console.log('🧭 Resolving account addresses...');
	const evmSet = new Set();
	for (const e of events) {
		if (e.name === 'EntryPurchased' || e.name === 'Rolled' || e.name === 'PrizeClaimed') {
			evmSet.add(e.args.user.toLowerCase());
		}
		if (e.name === 'TicketEvent') evmSet.add(e.args.user.toLowerCase());
	}
	for (const addr of evmSet) await resolveAccount(env, addr); // populate cache (cheap, cached)

	// 5. Aggregate -----------------------------------------------------------
	// per-user record
	const users = new Map();
	function user(addr) {
		const id = addrCache.get(addr.toLowerCase()) || addr;
		if (!users.has(id)) {
			users.set(id, {
				account: id,
				evm: addr.toLowerCase(),
				poolsPlayed: new Set(),
				entriesPurchased: 0,
				entriesPaid: 0,
				entriesFree: 0,
				rolls: 0,
				wins: 0,
				decisiveBonusWins: 0, // won despite roll >= base win rate ⇒ bonus was decisive
				nftSourcedRolls: 0,
				prizesClaimed: 0,
				ticketsMinted: 0,
				ticketsRedeemed: 0,
				firstSeen: null,
				lastSeen: null,
				perPool: new Map(), // poolId → {entries, rolls, wins}
				currentBoostBps: null,
			});
		}
		return users.get(id);
	}

	// per-pool record
	const poolStats = new Map();
	function pstat(poolId) {
		if (!poolStats.has(poolId)) {
			poolStats.set(poolId, {
				poolId,
				participants: new Set(),
				entriesPurchased: 0,
				entriesPaid: 0,
				entriesFree: 0,
				rolls: 0,
				wins: 0,
				prizesClaimed: 0,
				prizesAdded: 0,
				prizesRemoved: 0,
			});
		}
		return poolStats.get(poolId);
	}

	const hourly = new Map(); // unix-hour → {rolls, entries}
	function touchHour(ts, field) {
		const h = Math.floor(ts / 3600) * 3600;
		if (!hourly.has(h)) hourly.set(h, { rolls: 0, entries: 0, wins: 0 });
		hourly.get(h)[field]++;
	}

	const claimedPrizes = []; // {account, poolId?, token, amount, nfts, ts}
	const tokenCache = new Map(); // tokenId → details

	for (const e of events) {
		const info = txInfo.get(e.txHash);
		switch (e.name) {
			case 'EntryPurchased': {
				const u = user(e.args.user);
				const poolId = Number(e.args.poolId);
				const count = Number(e.args.count);
				u.poolsPlayed.add(poolId);
				u.entriesPurchased += count;
				const ps = pstat(poolId);
				ps.participants.add(u.account);
				ps.entriesPurchased += count;
				const pp = u.perPool.get(poolId) || { entries: 0, rolls: 0, wins: 0 };
				pp.entries += count;
				u.perPool.set(poolId, pp);

				const fn = info?.fnName;
				if (fn && FREE_FNS.has(fn)) { u.entriesFree += count; ps.entriesFree += count; }
				else if (fn && PAID_FNS.has(fn)) { u.entriesPaid += count; ps.entriesPaid += count; }
				// unknown classification → leave uncounted in paid/free split

				touchHour(e.ts, 'entries');
				stamp(u, e.ts);
				break;
			}
			case 'Rolled': {
				const u = user(e.args.user);
				const poolId = Number(e.args.poolId);
				const won = e.args.won;
				const rollBps = Number(e.args.rollBps);
				u.rolls++;
				const ps = pstat(poolId);
				ps.participants.add(u.account);
				ps.rolls++;
				const pp = u.perPool.get(poolId) || { entries: 0, rolls: 0, wins: 0 };
				pp.rolls++;
				if (won) {
					u.wins++; ps.wins++; pp.wins++;
					touchHour(e.ts, 'wins');
					// decisive-bonus detection: a win where the raw roll was >= the
					// pool's BASE win rate can only happen because a bonus boosted it.
					const pool = pools.get(poolId);
					if (pool && rollBps >= pool.winRate) u.decisiveBonusWins++;
				}
				u.perPool.set(poolId, pp);
				if (info && NFT_ROLL_FNS.has(info.fnName)) u.nftSourcedRolls++;
				u.poolsPlayed.add(poolId);
				touchHour(e.ts, 'rolls');
				stamp(u, e.ts);
				break;
			}
			case 'PrizeClaimed': {
				const u = user(e.args.user);
				u.prizesClaimed++;
				const prize = e.args.prize;
				const tokenAddr = prize.token;
				const tokenId = tokenAddr.toLowerCase() === ZERO_ADDR ? 'HBAR' : null;
				claimedPrizes.push({
					account: u.account,
					tokenAddr,
					tokenId,
					amount: Number(prize.amount),
					nftCount: prize.nftTokens.filter(a => a.toLowerCase() !== ZERO_ADDR).length,
					ts: e.ts,
				});
				stamp(u, e.ts);
				break;
			}
			case 'TicketEvent': {
				const u = user(e.args.user);
				if (e.args.mint) u.ticketsMinted += e.args.serialNumber.length;
				else u.ticketsRedeemed += e.args.serialNumber.length;
				stamp(u, e.ts);
				break;
			}
			case 'PrizeAdded': pstat(Number(e.args.poolId)).prizesAdded++; break;
			case 'PrizeRemoved': pstat(Number(e.args.poolId)).prizesRemoved++; break;
			default: break;
		}
	}

	function stamp(u, ts) {
		if (u.firstSeen === null || ts < u.firstSeen) u.firstSeen = ts;
		if (u.lastSeen === null || ts > u.lastSeen) u.lastSeen = ts;
	}

	// 6. Live boost per active player ---------------------------------------
	// (current state — tells us who is *currently* set up to benefit from bonuses)
	console.log('🎁 Reading live bonus boost for each player...');
	let poolManagerId;
	try {
		const pmRes = await batchMirrorQuery(env, [
			{ contractId, encoded: iface.encodeFunctionData('poolManager'), label: 'poolManager' },
		], operatorId, { concurrency: 1 });
		const pmAddr = iface.decodeFunctionResult('poolManager', pmRes[0].result)[0];
		const pmHedera = await homebrewPopulateAccountNum(env, pmAddr, EntityType.CONTRACT);
		poolManagerId = ContractId.fromString(pmHedera);
	}
	catch (e) {
		console.log(`   ⚠️  Could not resolve PoolManager (skipping live boost): ${e.message}`);
	}

	if (poolManagerId) {
		const pmIface = loadInterface('LazyLottoPoolManager');
		const userList = [...users.values()];
		const boostQueries = userList.map((u, i) => ({
			contractId: poolManagerId,
			encoded: pmIface.encodeFunctionData('calculateBoost', [u.evm]),
			label: `boost_${i}`,
		}));
		const boostRes = boostQueries.length
			? await batchMirrorQuery(env, boostQueries, operatorId, { concurrency: 20 })
			: [];
		for (let i = 0; i < userList.length; i++) {
			if (boostRes[i] && !boostRes[i].error) {
				try {
					userList[i].currentBoostBps = Number(pmIface.decodeFunctionResult('calculateBoost', boostRes[i].result)[0]);
				}
				catch { /* leave null */ }
			}
		}
	}

	// 7. Resolve token details for claimed prizes & pool fee tokens ----------
	const tokensToResolve = new Set();
	for (const p of pools.values()) {
		if (p.feeTokenAddr && p.feeTokenAddr.toLowerCase() !== ZERO_ADDR) tokensToResolve.add(p.feeTokenAddr.toLowerCase());
	}
	for (const c of claimedPrizes) {
		if (c.tokenAddr && c.tokenAddr.toLowerCase() !== ZERO_ADDR) tokensToResolve.add(c.tokenAddr.toLowerCase());
	}
	for (const addr of tokensToResolve) {
		try {
			const id = await homebrewPopulateAccountNum(env, addr, EntityType.TOKEN);
			const dets = await getTokenDetails(env, id);
			tokenCache.set(id, dets);
			tokenCache.set(addr, { ...dets, hederaId: id }); // also key by evm for convenience
		}
		catch { /* ignore */ }
	}
	// resolve pool fee token ids + claimed prize token ids
	for (const p of pools.values()) {
		p.feeToken = p.feeTokenAddr.toLowerCase() === ZERO_ADDR ? 'HBAR' : (tokenCache.get(p.feeTokenAddr.toLowerCase())?.hederaId || p.feeTokenAddr);
	}
	for (const c of claimedPrizes) {
		if (!c.tokenId) c.tokenId = tokenCache.get(c.tokenAddr.toLowerCase())?.hederaId || c.tokenAddr;
	}

	// ─────────────────────────── REPORTING ───────────────────────────
	render({ env, contractId, totalPools, pools, users, poolStats, hourly, claimedPrizes, tokenCache, topN, doClassify });

	// 8. JSON dump -----------------------------------------------------------
	if (flags.json) {
		const out = buildJson({ env, contractId, totalPools, pools, users, poolStats, hourly, claimedPrizes });
		const outPath = path.resolve(String(flags.json));
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
		console.log(`\n💾 Full dataset written to ${outPath}`);
	}

	console.log('\n✅ Analysis complete.\n');
}

// ───────────────────────────── rendering ─────────────────────────────

function render({ pools, users, poolStats, hourly, claimedPrizes, tokenCache, topN, doClassify }) {
	const userArr = [...users.values()];
	const totalRolls = userArr.reduce((s, u) => s + u.rolls, 0);
	const totalWins = userArr.reduce((s, u) => s + u.wins, 0);
	const totalEntries = userArr.reduce((s, u) => s + u.entriesPurchased, 0);

	// ── Global summary ──
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log('  GLOBAL SUMMARY');
	console.log('═══════════════════════════════════════════════════════════════');
	console.log(`  Unique players:        ${userArr.length}`);
	console.log(`  Entries purchased:     ${totalEntries}`);
	if (doClassify) {
		const paid = userArr.reduce((s, u) => s + u.entriesPaid, 0);
		const free = userArr.reduce((s, u) => s + u.entriesFree, 0);
		const unknown = totalEntries - paid - free;
		console.log(`     ├─ paid:            ${paid}`);
		console.log(`     ├─ free (admin):    ${free}`);
		if (unknown > 0) console.log(`     └─ unclassified:    ${unknown}`);
	}
	console.log(`  Total rolls:           ${totalRolls}`);
	console.log(`  Total wins:            ${totalWins}  (${totalRolls ? (100 * totalWins / totalRolls).toFixed(3) : '0'}% observed hit rate)`);
	const nftRolls = userArr.reduce((s, u) => s + u.nftSourcedRolls, 0);
	if (doClassify) console.log(`  Rolls from NFT tickets: ${nftRolls}  (entries the player held as tradeable NFTs, not freshly paid)`);
	const claimed = userArr.reduce((s, u) => s + u.prizesClaimed, 0);
	console.log(`  Prizes won (rolls):    ${totalWins}`);
	console.log(`  Prizes claimed:        ${claimed}  (unclaimed pending: ${totalWins - claimed})`);

	// ── Per-pool ──
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log('  PER-POOL BREAKDOWN');
	console.log('═══════════════════════════════════════════════════════════════');
	const poolIds = [...new Set([...pools.keys(), ...poolStats.keys()])].sort((a, b) => a - b);
	for (const pid of poolIds) {
		const p = pools.get(pid);
		const s = poolStats.get(pid) || pstatEmpty(pid);
		const baseP = p ? p.winProbability : null;
		const expected = baseP != null ? s.rolls * baseP : null;
		const obs = s.rolls ? s.wins / s.rolls : 0;
		console.log(`\n┌─ Pool #${pid} ${p ? (p.closed ? '🔒 CLOSED' : p.paused ? '⏸️  PAUSED' : '🟢 ACTIVE') : ''}`);
		if (p) {
			console.log(`│  Base win rate:        ${fmtPct(p.winRate)}  (p=${baseP.toFixed(6)})`);
			console.log(`│  Entry fee:            ${fmtAmount(p.feeToken, p.entryFee, tokenCache)}`);
			console.log(`│  Prizes remaining:     ${p.prizeCountRemaining}`);
			console.log(`│  Outstanding entries:  ${p.outstandingEntries}  (bought but not yet rolled)`);
		}
		console.log(`│  Players:              ${s.participants.size}`);
		console.log(`│  Entries purchased:    ${s.entriesPurchased}${doClassify ? `  (paid ${s.entriesPaid} / free ${s.entriesFree})` : ''}`);
		console.log(`│  Rolls:                ${s.rolls}`);
		console.log(`│  Wins:                 ${s.wins}  observed=${(100 * obs).toFixed(3)}%${expected != null ? `  expected≈${expected.toFixed(2)} wins` : ''}`);
		if (expected != null && expected > 0) {
			const luck = s.wins / expected;
			console.log(`│  Luck index:           ${luck.toFixed(2)}× ${luck > 1 ? '(running hot)' : luck < 1 ? '(running cold)' : ''}${s.rolls < 50 ? '  ⚠ small sample — inconclusive' : ''}`);
		}
		console.log(`│  Prizes added/removed: +${s.prizesAdded} (admin) / -${s.prizesRemoved} (admin pull)`);
		// A "win" is emitted even if no prize was left to award, so wins can exceed
		// the prizes the pool ever held — a clear over-subscription / exhaustion signal.
		if (s.prizesAdded > 0 && s.wins > (s.prizesAdded - s.prizesRemoved)) {
			const dry = s.wins - (s.prizesAdded - s.prizesRemoved);
			console.log(`│  ⚠ Prize-dry wins:     ${dry}  (winning rolls that got NO prize — pool ran empty)`);
		}
		console.log('└────────────────────────────────────────────────────────');
	}

	// ── Top players ──
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log(`  TOP PLAYERS (by rolls) — showing up to ${topN}`);
	console.log('═══════════════════════════════════════════════════════════════');
	const byRolls = [...userArr].sort((a, b) => b.rolls - a.rolls).slice(0, topN);
	console.log('  Account            Pools  Entries  Rolls  Wins   Hit%   Boost  Source');
	for (const u of byRolls) {
		const hit = u.rolls ? (100 * u.wins / u.rolls).toFixed(2) : '—';
		const boost = fmtBoost(u.currentBoostBps);
		let src = '';
		if (doClassify) {
			const parts = [];
			if (u.entriesPaid) parts.push(`${u.entriesPaid}p`);
			if (u.entriesFree) parts.push(`${u.entriesFree}f`);
			if (u.nftSourcedRolls) parts.push(`${u.nftSourcedRolls}nft`);
			src = parts.join('/');
		}
		console.log(
			`  ${u.account.padEnd(17)}  ${String(u.poolsPlayed.size).padStart(4)}  ${String(u.entriesPurchased).padStart(7)}  ${String(u.rolls).padStart(5)}  ${String(u.wins).padStart(4)}  ${hit.padStart(6)}  ${boost.padStart(6)}  ${src}`,
		);
	}

	// ── Luck leaderboard ──
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log('  ODDS PERFORMANCE (actual vs expected wins)');
	console.log('  ⚠ Early sample — treat as directional, not statistically settled.');
	console.log('═══════════════════════════════════════════════════════════════');
	const withExpected = userArr.map((u) => {
		let expected = 0;
		for (const [pid, pp] of u.perPool) {
			const pool = pools.get(pid);
			if (pool) expected += pp.rolls * pool.winProbability;
		}
		return { u, expected, luck: expected > 0 ? u.wins / expected : null };
	}).filter(x => x.u.rolls >= 5 && x.luck != null);
	withExpected.sort((a, b) => b.luck - a.luck);
	console.log('  Account            Rolls  Wins  Expected  Luck');
	for (const x of withExpected.slice(0, topN)) {
		console.log(`  ${x.u.account.padEnd(17)}  ${String(x.u.rolls).padStart(5)}  ${String(x.u.wins).padStart(4)}  ${x.expected.toFixed(2).padStart(8)}  ${x.luck.toFixed(2)}×`);
	}
	if (!withExpected.length) console.log('  (no players with ≥5 rolls yet)');

	// ── Bonus analysis ──
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log('  BONUS USAGE');
	console.log('═══════════════════════════════════════════════════════════════');
	const withLiveBoost = userArr.filter(u => u.currentBoostBps && u.currentBoostBps > 0);
	const withDecisive = userArr.filter(u => u.decisiveBonusWins > 0);
	console.log(`  Players currently boosted:        ${withLiveBoost.length} / ${userArr.length}`);
	console.log(`  Players with decisive-bonus wins: ${withDecisive.length}  (won a roll that would have LOST at the base rate)`);
	if (withDecisive.length) {
		withDecisive.sort((a, b) => b.decisiveBonusWins - a.decisiveBonusWins);
		for (const u of withDecisive.slice(0, topN)) {
			console.log(`    ${u.account.padEnd(17)}  ${u.decisiveBonusWins} bonus-decisive win(s)  (live boost ${fmtBoost(u.currentBoostBps)})`);
		}
	}

	// ── Hourly activity ──
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log('  HOURLY ACTIVITY (rolls)');
	console.log('═══════════════════════════════════════════════════════════════');
	const hours = [...hourly.keys()].sort((a, b) => a - b);
	const maxRolls = Math.max(1, ...hours.map(h => hourly.get(h).rolls));
	for (const h of hours) {
		const d = hourly.get(h);
		const label = new Date(h * 1000).toISOString().replace('T', ' ').slice(0, 13) + ':00';
		console.log(`  ${label}  ${bar(d.rolls, maxRolls)} ${d.rolls} rolls / ${d.entries} entries / ${d.wins} wins`);
	}

	// ── Claimed prize value ──
	if (claimedPrizes.length) {
		console.log('\n═══════════════════════════════════════════════════════════════');
		console.log('  CLAIMED PRIZE TOTALS (by token)');
		console.log('═══════════════════════════════════════════════════════════════');
		const byToken = new Map();
		let nftTotal = 0;
		for (const c of claimedPrizes) {
			if (c.amount > 0) byToken.set(c.tokenId, (byToken.get(c.tokenId) || 0) + c.amount);
			nftTotal += c.nftCount;
		}
		for (const [tok, amt] of byToken) console.log(`  ${fmtAmount(tok, amt, tokenCache)}`);
		if (nftTotal) console.log(`  ${nftTotal} NFT prize(s)`);
	}
}

function pstatEmpty(poolId) {
	return { poolId, participants: new Set(), entriesPurchased: 0, entriesPaid: 0, entriesFree: 0, rolls: 0, wins: 0, prizesClaimed: 0, prizesAdded: 0, prizesRemoved: 0 };
}

// ───────────────────────────── JSON output ─────────────────────────────

function buildJson({ env, contractId, totalPools, pools, users, poolStats, hourly, claimedPrizes }) {
	return {
		meta: { env, contract: contractId.toString(), generatedAt: new Date().toISOString(), totalPools },
		pools: [...pools.values()].map(p => ({ ...p, feeTokenAddr: undefined })),
		poolStats: [...poolStats.values()].map(s => ({ ...s, participants: [...s.participants] })),
		users: [...users.values()].map(u => ({
			...u,
			poolsPlayed: [...u.poolsPlayed],
			perPool: [...u.perPool.entries()].map(([poolId, v]) => ({ poolId, ...v })),
			firstSeen: u.firstSeen ? new Date(u.firstSeen * 1000).toISOString() : null,
			lastSeen: u.lastSeen ? new Date(u.lastSeen * 1000).toISOString() : null,
		})),
		hourly: [...hourly.entries()].map(([h, v]) => ({ hour: new Date(h * 1000).toISOString(), ...v })),
		claimedPrizes,
	};
}

main().catch((err) => {
	console.error('\n❌ Error:', err.message);
	if (process.env.DEBUG) console.error(err);
	process.exit(1);
});
