/**
 * Forensic check: were any EOA-guarded contracts called from inside a HIP-551 atomic batch?
 *
 * The `tx.origin == msg.sender` guard (LazyLotto._roll, ForeverMinter.mintNFT, MinterContract,
 * Mission.enterMission) assumes an EOA cannot run anything after the random outcome inside the
 * same atomic unit. Until Hedera restricted atomic batches (September 2026: at most one contract
 * call per batch, and it must be the last inner transaction), an EOA could submit e.g.
 *   [ rollBatch(pool, n), claimPrize(offset) ]
 * as one batch: on a loss the second inner transaction fails and the whole batch, roll included,
 * is rolled back (the roll is recorded as REVERTED_SUCCESS), so the ticket is kept for a retry.
 *
 * Two detection channels (both read-only, public mirror node):
 *   1. Every contract result on each target in the window -> is its transaction a batch inner tx?
 *   2. Every caller seen in (1) -> any of their CONTRACTCALL / ETHEREUMTRANSACTION txs to a target
 *      that carry a batch_key. This catches rolled-back attempts even if the mirror node does not
 *      list REVERTED_SUCCESS calls under the contract's results.
 * A batch is flagged as a re-roll pattern when another inner transaction runs AFTER the call to
 * the target (something could inspect the outcome and fail the batch).
 *
 * Usage:
 *   node scripts/interactions/Utilities/checkBatchRerolls.js [contractId ...]
 *        [--from 2026-07-08] [--to 2026-10-14] [--network mainnet|testnet] [--abi path/to/abi.json ...]
 *
 * With no contract IDs it checks the mainnet LazyLotto v2 contract.
 */
const fs = require('fs');
const path = require('path');
const { Interface } = require('ethers');

const MIRROR = {
	mainnet: 'https://mainnet-public.mirrornode.hedera.com',
	testnet: 'https://testnet.mirrornode.hedera.com',
};
const HASHSCAN = {
	mainnet: 'https://hashscan.io/mainnet/transaction/',
	testnet: 'https://hashscan.io/testnet/transaction/',
};
const DEFAULT_CONTRACTS = {
	// LazyLotto v2 (deployed 2026-07-08); PoolManager/Storage are never the roll entry point
	'0.0.10628505': 'LazyLotto v2',
};
const DEFAULT_FROM = '2026-07-08';
const CONCURRENCY = 5;

function parseArgs(argv) {
	const opts = { contracts: [], from: DEFAULT_FROM, to: null, network: 'mainnet', abis: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '-h' || a === '--help') {
			opts.help = true;
		}
		else if (a === '--from') {
			opts.from = argv[++i];
		}
		else if (a === '--to') {
			opts.to = argv[++i];
		}
		else if (a === '--network') {
			opts.network = argv[++i];
		}
		else if (a === '--abi') {
			opts.abis.push(argv[++i]);
		}
		else {
			opts.contracts.push(a);
		}
	}
	return opts;
}

function toSeconds(dateStr) {
	const ms = Date.parse(dateStr.length === 10 ? `${dateStr}T00:00:00Z` : dateStr);
	if (Number.isNaN(ms)) throw new Error(`Bad date: ${dateStr}`);
	return Math.floor(ms / 1000);
}

// consensus timestamps are "seconds.nanos" strings; compare/offset them as BigInt nanoseconds
function tsToNs(ts) {
	const [s, n = '0'] = ts.split('.');
	return BigInt(s) * 1_000_000_000n + BigInt(n.padEnd(9, '0'));
}

function nsToTs(ns) {
	return `${ns / 1_000_000_000n}.${(ns % 1_000_000_000n).toString().padStart(9, '0')}`;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

let baseUrl;
async function mirror(pathAndQuery) {
	for (let attempt = 0; attempt < 6; attempt++) {
		const res = await fetch(`${baseUrl}${pathAndQuery}`);
		if (res.status === 404) return null;
		if (res.ok) return res.json();
		if (res.status === 429 || res.status >= 500) {
			await sleep(500 * 2 ** attempt);
			continue;
		}
		throw new Error(`Mirror ${res.status} for ${pathAndQuery}: ${await res.text()}`);
	}
	throw new Error(`Mirror retries exhausted for ${pathAndQuery}`);
}

async function pageAll(firstPath, key) {
	const out = [];
	let next = firstPath;
	while (next) {
		const page = await mirror(next);
		if (!page) break;
		out.push(...page[key]);
		next = page.links?.next ?? null;
	}
	return out;
}

async function mapLimit(items, limit, fn) {
	const results = new Array(items.length);
	let idx = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (idx < items.length) {
			const i = idx++;
			results[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return results;
}

function buildSelectorMap(extraAbiPaths) {
	const map = {};
	const abiDir = path.join(__dirname, '../../../abi');
	const files = fs.existsSync(abiDir)
		? fs.readdirSync(abiDir).filter((f) => f.endsWith('.json')).map((f) => path.join(abiDir, f))
		: [];
	for (const file of [...files, ...extraAbiPaths]) {
		try {
			const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
			const iface = new Interface(Array.isArray(raw) ? raw : raw.abi);
			iface.forEachFunction((fn) => {
				map[fn.selector] = fn.name;
			});
		}
		catch {
			// not an ABI file (e.g. response code tables) - skip
		}
	}
	return map;
}

const txCache = new Map();
async function getTxAt(ts) {
	if (txCache.has(ts)) return txCache.get(ts);
	const page = await mirror(`/api/v1/transactions?timestamp=${ts}`);
	const tx = page?.transactions?.find((t) => t.consensus_timestamp === ts) ?? null;
	txCache.set(ts, tx);
	return tx;
}

const accountCache = new Map();
async function resolveAccount(evmAddress) {
	if (accountCache.has(evmAddress)) return accountCache.get(evmAddress);
	const acct = await mirror(`/api/v1/accounts/${evmAddress}`);
	const id = acct?.account ?? null;
	accountCache.set(evmAddress, id);
	return id;
}

function isBatchInner(tx, parentTx) {
	return Boolean(tx?.batch_key) || parentTx?.name === 'ATOMICBATCH';
}

// inner transactions get consecutive nanos after the batch timestamp (max 50 inners + child records)
async function expandBatch(parentTs) {
	const p = tsToNs(parentTs);
	const upper = nsToTs(p + 1000n);
	const page = await mirror(`/api/v1/transactions?timestamp=gte:${parentTs}&timestamp=lte:${upper}&limit=100&order=asc`);
	const all = page?.transactions ?? [];
	return {
		batch: all.find((t) => t.consensus_timestamp === parentTs) ?? null,
		inners: all.filter((t) => t.parent_consensus_timestamp === parentTs),
	};
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log('Usage: checkBatchRerolls.js [contractId ...] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--network mainnet|testnet] [--abi file ...]');
		console.log('       Defaults: LazyLotto v2 mainnet (0.0.10628505), from 2026-07-08 to now.');
		return;
	}

	baseUrl = MIRROR[opts.network];
	if (!baseUrl) throw new Error(`Unknown network ${opts.network}`);

	const targets = opts.contracts.length > 0
		? Object.fromEntries(opts.contracts.map((c) => [c, c]))
		: DEFAULT_CONTRACTS;
	const fromS = toSeconds(opts.from);
	const toS = opts.to ? toSeconds(opts.to) + 86399 : Math.floor(Date.now() / 1000);
	const window = `timestamp=gte:${fromS}&timestamp=lte:${toS}`;
	const selectors = buildSelectorMap(opts.abis);
	const fnName = (params) => {
		const sel = (params ?? '').slice(0, 10);
		return selectors[sel] ?? (sel || '(none)');
	};

	console.log(`\nNetwork: ${opts.network}`);
	console.log(`Window:  ${new Date(fromS * 1000).toISOString()} -> ${new Date(toS * 1000).toISOString()}`);
	console.log(`Targets: ${Object.entries(targets).map(([id, label]) => (label === id ? id : `${id} (${label})`)).join(', ')}\n`);

	// flagged inner txs keyed by consensus timestamp: { ts, contractId, parent }
	const flagged = new Map();
	const callers = new Set();

	// Channel 1: every contract result -> batch membership
	for (const contractId of Object.keys(targets)) {
		const results = await pageAll(`/api/v1/contracts/${contractId}/results?${window}&limit=100&order=asc`, 'results');
		const fnCounts = {};
		await mapLimit(results, CONCURRENCY, async (r) => {
			fnCounts[fnName(r.function_parameters)] = (fnCounts[fnName(r.function_parameters)] ?? 0) + 1;
			const id = await resolveAccount(r.from);
			if (id) callers.add(id);
			const tx = await getTxAt(r.timestamp);
			const parentTx = tx?.parent_consensus_timestamp ? await getTxAt(tx.parent_consensus_timestamp) : null;
			if (isBatchInner(tx, parentTx)) {
				flagged.set(r.timestamp, { ts: r.timestamp, contractId, parent: tx.parent_consensus_timestamp });
			}
		});
		console.log(`[${contractId}] ${results.length} contract results`);
		for (const [name, count] of Object.entries(fnCounts).sort((a, b) => b[1] - a[1])) {
			console.log(`    ${String(count).padStart(6)}  ${name}`);
		}
	}

	// Channel 2: every caller's own contract calls -> batch_key set and aimed at a target
	console.log(`\n${callers.size} unique callers; scanning their contract-call history for batch inner txs...`);
	const targetSet = new Set(Object.keys(targets));
	let callerTxCount = 0;
	await mapLimit([...callers], CONCURRENCY, async (accountId) => {
		for (const type of ['CONTRACTCALL', 'ETHEREUMTRANSACTION']) {
			const txs = await pageAll(`/api/v1/transactions?account.id=${accountId}&transactiontype=${type}&${window}&limit=100&order=asc`, 'transactions');
			callerTxCount += txs.length;
			for (const tx of txs) {
				if (!tx.batch_key) continue;
				// EthereumTransaction entity_id is not always the callee - keep it for manual review
				if (type === 'CONTRACTCALL' && !targetSet.has(tx.entity_id)) continue;
				if (!flagged.has(tx.consensus_timestamp)) {
					flagged.set(tx.consensus_timestamp, {
						ts: tx.consensus_timestamp,
						contractId: tx.entity_id ?? '(ethereum tx - check callee)',
						parent: tx.parent_consensus_timestamp,
					});
				}
			}
		}
	});
	console.log(`Scanned ${callerTxCount} caller transactions.\n`);

	if (flagged.size === 0) {
		console.log('RESULT: no calls to the target contracts were made from inside an atomic batch.');
		return;
	}

	// Expand each flagged batch and classify
	const byParent = new Map();
	for (const f of flagged.values()) {
		if (!byParent.has(f.parent)) byParent.set(f.parent, []);
		byParent.get(f.parent).push(f);
	}

	let rerollPatterns = 0;
	for (const [parentTs, hits] of byParent) {
		const { batch, inners } = await expandBatch(parentTs);
		const hitTs = new Set(hits.map((h) => h.ts));
		const lastHitIdx = Math.max(...inners.map((t, i) => (hitTs.has(t.consensus_timestamp) ? i : -1)));
		const after = lastHitIdx >= 0 ? inners.slice(lastHitIdx + 1) : [];
		const pattern = after.length > 0;
		if (pattern) rerollPatterns++;

		console.log(`${pattern ? 'RE-ROLL PATTERN' : 'batched (target call is last - harmless)'}`);
		console.log(`  batch ${batch?.transaction_id ?? parentTs}  result=${batch?.result ?? '?'}  ${HASHSCAN[opts.network]}${parentTs}`);
		for (const t of inners) {
			const mark = hitTs.has(t.consensus_timestamp) ? '>>' : '  ';
			let detail = '';
			if (hitTs.has(t.consensus_timestamp)) {
				const cr = await mirror(`/api/v1/contracts/results/${t.consensus_timestamp}`).catch(() => null);
				detail = cr ? ` ${fnName(cr.function_parameters)}()` : '';
			}
			console.log(`  ${mark} ${t.consensus_timestamp}  ${t.name.padEnd(22)} ${t.result.padEnd(26)} ${t.entity_id ?? ''}${detail}`);
		}
		console.log('');
	}

	console.log(`RESULT: ${flagged.size} batched call(s) across ${byParent.size} batch(es); ${rerollPatterns} with an inner tx after the target call.`);
	if (rerollPatterns > 0) {
		console.log('Review the RE-ROLL PATTERN batches above: a failed batch with the target call marked');
		console.log('REVERTED_SUCCESS is a rolled-back attempt; a successful one is a kept outcome.');
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
