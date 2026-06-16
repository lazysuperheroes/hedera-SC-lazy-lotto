/**
 * LazyLotto — $LAZY Burn Total
 *
 * Reports how much $LAZY the LazyLotto pools have burned since launch.
 *
 * Burns are executed by the LazyGasStation on behalf of the LazyLotto contract:
 * on a LAZY-fee entry the gas station pulls the fee and burns
 * `amount * burnPercentage / 100` (integer math) before forwarding the
 * remainder. Each call emits:
 *
 *   GasStationFunding(callingContract, user, amount, burnPercentage, fromUser)
 *
 * So the real, on-chain burn = sum over every GasStationFunding event where
 * callingContract == LazyLotto of (amount * burnPercentage / 100). This is the
 * actual reduction in $LAZY total supply attributable to the lottery — not an
 * estimate (it reproduces the contract's integer rounding exactly).
 *
 * Only LAZY-fee pools with a non-zero frozen burn % contribute (e.g. the LAZY
 * Lounge @ 50%, the Whale Lounge @ 75%). HBAR pools and pool-creation fee draws
 * (burn % = 0) contribute nothing.
 *
 * Read-only. No gas cost. Pulls events from the public mirror node.
 *
 * Usage:
 *   node scripts/interactions/LazyLotto/queries/lazyBurned.js [contractId] [options]
 *
 *   contractId            0.0.xxxxx  (defaults to LAZY_LOTTO_CONTRACT_ID in .env)
 *
 * Options:
 *   --env <name>          mainnet|testnet|previewnet|local (defaults to ENVIRONMENT in .env)
 *   --gas-station <id>    0.0.xxxxx  (defaults to LAZY_GAS_STATION_CONTRACT_ID in .env)
 *   --from <ts>           only burns at/after this time. ISO date or unix seconds.
 *                         Defaults to the LazyLotto contract's creation time.
 *   --to <ts>             only burns at/before this time. ISO date or unix seconds.
 *   --json <path>         also write the structured per-event dataset to this file
 *
 * Examples:
 *   node ...lazyBurned.js --env mainnet
 *   node ...lazyBurned.js 0.0.10584509 --env mainnet --from 2026-06-14T00:00:00Z
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { default: axios } = require('axios');
const { ContractId } = require('@hashgraph/sdk');

const { loadInterface } = require('../../../../utils/abiLoader');

const LAZY_DECIMALS = parseInt(process.env.LAZY_DECIMALS ?? '1', 10);

// ───────────────────────────── helpers ─────────────────────────────

function parseArgs(argv) {
	const args = { positional: [], flags: {} };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) {
				args.flags[key] = true;
			}
			else {
				args.flags[key] = next;
				i++;
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
	if (/^\d+(\.\d+)?$/.test(String(value))) return String(value);
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) {
		throw new Error(`Could not parse timestamp: "${value}". Use ISO date or unix seconds.`);
	}
	return (ms / 1000).toFixed(0);
}

function getBaseURL(env) {
	const e = env.toLowerCase();
	if (e === 'test' || e === 'testnet') return 'https://testnet.mirrornode.hedera.com';
	if (e === 'main' || e === 'mainnet') return 'https://mainnet-public.mirrornode.hedera.com';
	if (e === 'preview' || e === 'previewnet') return 'https://previewnet.mirrornode.hedera.com';
	if (e === 'local') return 'http://localhost:8000';
	throw new Error('ERROR: Must specify either MAIN, TEST, LOCAL or PREVIEW as environment');
}

function evmOf(contractId) {
	return ('0x' + ContractId.fromString(contractId.toString()).toSolidityAddress()).toLowerCase();
}

// $LAZY base units (BigInt) → human string honouring LAZY_DECIMALS.
function fmtLazy(baseUnits) {
	const negative = baseUnits < 0n;
	const v = negative ? -baseUnits : baseUnits;
	const divisor = 10n ** BigInt(LAZY_DECIMALS);
	const whole = v / divisor;
	const frac = v % divisor;
	const wholeStr = whole.toLocaleString('en-US');
	if (LAZY_DECIMALS === 0 || frac === 0n) return (negative ? '-' : '') + wholeStr;
	const fracStr = frac.toString().padStart(LAZY_DECIMALS, '0').replace(/0+$/, '');
	return (negative ? '-' : '') + `${wholeStr}.${fracStr}`;
}

async function fetchContractCreatedTs(baseUrl, contractId) {
	try {
		const { data } = await axios.get(`${baseUrl}/api/v1/contracts/${contractId.toString()}`);
		return data.created_timestamp || null;
	}
	catch {
		return null;
	}
}

/**
 * Fetch ALL logs for a contract (paginated, ascending) within an optional window.
 */
async function fetchAllLogs(baseUrl, contractId, fromTs, toTs) {
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
		process.stdout.write(`\r   ...fetched ${logs.length} gas-station log entries (page ${page})   `);
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

// ─────────────────────────────── main ───────────────────────────────

async function main() {
	const { positional, flags } = parseArgs(process.argv.slice(2));

	const env = (flags.env || process.env.ENVIRONMENT || 'testnet').toString();
	const baseUrl = getBaseURL(env);

	const lottoIdStr = positional[0] || process.env.LAZY_LOTTO_CONTRACT_ID;
	if (!lottoIdStr) {
		console.error('❌ No LazyLotto contract ID. Pass it as the first argument or set LAZY_LOTTO_CONTRACT_ID in .env.');
		process.exit(1);
	}
	const gasStationIdStr = (flags['gas-station'] && flags['gas-station'] !== true)
		? flags['gas-station']
		: process.env.LAZY_GAS_STATION_CONTRACT_ID;
	if (!gasStationIdStr) {
		console.error('❌ No LazyGasStation contract ID. Pass --gas-station or set LAZY_GAS_STATION_CONTRACT_ID in .env.');
		process.exit(1);
	}

	const lottoId = ContractId.fromString(lottoIdStr);
	const gasStationId = ContractId.fromString(gasStationIdStr);
	const lottoEvm = evmOf(lottoId);

	let fromTs = resolveTimestamp(flags.from);
	const toTs = resolveTimestamp(flags.to);

	console.log('\n╔══════════════════════════════════════════════════════════════╗');
	console.log('║              LazyLotto — $LAZY Burn Total                    ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log(`  Environment:   ${env.toUpperCase()}`);
	console.log(`  LazyLotto:     ${lottoId.toString()}  (${lottoEvm})`);
	console.log(`  Gas Station:   ${gasStationId.toString()}`);

	// Default the window start to the LazyLotto contract's creation time.
	if (!fromTs) {
		const created = await fetchContractCreatedTs(baseUrl, lottoId);
		if (created) {
			fromTs = created;
			console.log(`  From:          ${new Date(Number(fromTs) * 1000).toISOString()}  (LazyLotto creation)`);
		}
	}
	else {
		console.log(`  From:          ${new Date(Number(fromTs) * 1000).toISOString()}`);
	}
	if (toTs) console.log(`  To:            ${new Date(Number(toTs) * 1000).toISOString()}`);
	console.log('');

	const gsIface = loadInterface('LazyGasStation');

	console.log('📜 Fetching LazyGasStation events from mirror node...');
	const rawLogs = await fetchAllLogs(baseUrl, gasStationId, fromTs, toTs);
	console.log(`   ${rawLogs.length} raw log entries.`);

	let fundingEvents = 0;
	let lottoBurnEvents = 0;
	let totalBurned = 0n;       // base units
	let totalDrawn = 0n;        // base units (gross LAZY pulled by lotto)
	const byBurnPct = new Map(); // burnPct → { burned, drawn, events }
	const byUser = new Map();    // user evm → { burned, drawn, events }
	const detail = [];

	for (const log of rawLogs) {
		let parsed;
		try {
			parsed = gsIface.parseLog({ topics: log.topics, data: log.data || '0x' });
		}
		catch {
			continue; // not a recognised LazyGasStation event
		}
		if (!parsed || parsed.name !== 'GasStationFunding') continue;
		fundingEvents++;

		const caller = String(parsed.args._callingContract).toLowerCase();
		if (caller !== lottoEvm) continue; // only burns driven by LazyLotto

		const amount = BigInt(parsed.args._amount);
		const burnPct = BigInt(parsed.args._burnPercentage);
		const burnAmt = (amount * burnPct) / 100n; // integer math — matches LazyGasStation exactly
		if (burnAmt === 0n) continue;              // no burn on this draw (e.g. creation fees)

		lottoBurnEvents++;
		totalBurned += burnAmt;
		totalDrawn += amount;

		const pctKey = burnPct.toString();
		const pb = byBurnPct.get(pctKey) || { burned: 0n, drawn: 0n, events: 0 };
		pb.burned += burnAmt; pb.drawn += amount; pb.events++;
		byBurnPct.set(pctKey, pb);

		const userEvm = String(parsed.args._user).toLowerCase();
		const ub = byUser.get(userEvm) || { burned: 0n, drawn: 0n, events: 0 };
		ub.burned += burnAmt; ub.drawn += amount; ub.events++;
		byUser.set(userEvm, ub);

		detail.push({
			timestamp: log.timestamp,
			iso: new Date(Math.floor(Number(log.timestamp)) * 1000).toISOString(),
			user: userEvm,
			amount: amount.toString(),
			burnPercentage: Number(burnPct),
			burned: burnAmt.toString(),
			txHash: log.transaction_hash,
		});
	}

	// ─────────────────────────── REPORT ───────────────────────────
	console.log('\n═══════════════════════════════════════════════════════════════');
	console.log('  RESULT');
	console.log('═══════════════════════════════════════════════════════════════');
	console.log(`  GasStationFunding events (all callers): ${fundingEvents}`);
	console.log(`  ...attributable to LazyLotto (burn>0):  ${lottoBurnEvents}`);
	console.log('');
	console.log(`  $LAZY pulled into burns (gross):  ${fmtLazy(totalDrawn)} LAZY`);
	console.log(`  $LAZY BURNED (net supply removed): ${fmtLazy(totalBurned)} LAZY`);
	console.log(`     └─ raw base units:             ${totalBurned.toString()}`);

	if (byBurnPct.size) {
		console.log('\n  By burn tier:');
		const tiers = [...byBurnPct.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
		for (const [pct, v] of tiers) {
			console.log(`    ${pct.padStart(3)}% burn  →  ${fmtLazy(v.burned).padStart(16)} LAZY burned   (${v.events} entr${v.events === 1 ? 'y' : 'ies'}, ${fmtLazy(v.drawn)} LAZY drawn)`);
		}
	}

	if (byUser.size) {
		console.log(`\n  By payer (${byUser.size} unique): top 15 by burn`);
		const top = [...byUser.entries()].sort((a, b) => (b[1].burned > a[1].burned ? 1 : -1)).slice(0, 15);
		for (const [u, v] of top) {
			console.log(`    ${u}  ${fmtLazy(v.burned).padStart(14)} LAZY  (${v.events} entr${v.events === 1 ? 'y' : 'ies'})`);
		}
	}

	if (flags.json && flags.json !== true) {
		const out = {
			meta: {
				env,
				lazyLotto: lottoId.toString(),
				gasStation: gasStationId.toString(),
				from: fromTs ? new Date(Number(fromTs) * 1000).toISOString() : null,
				to: toTs ? new Date(Number(toTs) * 1000).toISOString() : null,
				lazyDecimals: LAZY_DECIMALS,
			},
			totals: {
				burnEvents: lottoBurnEvents,
				burnedBaseUnits: totalBurned.toString(),
				burnedLazy: fmtLazy(totalBurned),
				drawnBaseUnits: totalDrawn.toString(),
			},
			byBurnPct: [...byBurnPct.entries()].map(([pct, v]) => ({
				burnPercentage: Number(pct),
				burnedBaseUnits: v.burned.toString(),
				burnedLazy: fmtLazy(v.burned),
				events: v.events,
			})),
			events: detail,
		};
		const outPath = path.resolve(String(flags.json));
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
		console.log(`\n💾 Per-event dataset written to ${outPath}`);
	}

	console.log('\n✅ Done.\n');
}

main().catch((err) => {
	console.error('\n❌ Error:', err.message);
	if (process.env.DEBUG) console.error(err);
	process.exit(1);
});
