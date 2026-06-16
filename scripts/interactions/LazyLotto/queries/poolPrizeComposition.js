/**
 * LazyLotto — Pool Prize Composition
 *
 * Walks every remaining prize package in a pool (or all pools) via
 * `getPrizePackage` and breaks the inventory down into:
 *
 *   • real HBAR (and any other fungible token) value
 *   • outside-collection NFTs (the actual chase/marquee prizes) — listed per
 *     collection with serials
 *   • free reroll tickets (NFTs whose token is *some* pool's ticket token —
 *     i.e. a free spin seeded as a prize, not a collectible)
 *
 * The pool's `prizes` array only holds prizes that are STILL AVAILABLE — won
 * prizes are removed. So this is the live "what's left to win" snapshot; diff it
 * against your seed recipe to see what has already walked out.
 *
 * Read-only. No gas cost. Reads current contract state via the mirror node.
 *
 * Usage:
 *   node scripts/interactions/LazyLotto/queries/poolPrizeComposition.js [contractId] [options]
 *
 *   contractId        0.0.xxxxx  (defaults to LAZY_LOTTO_CONTRACT_ID in .env)
 *
 * Options:
 *   --env <name>      mainnet|testnet|previewnet|local (defaults to ENVIRONMENT in .env)
 *   --pool <N>        only this pool; also prints per-package detail (serials).
 *   --find <id:serial> highlight a specific NFT prize, e.g. --find 0.0.1992037:75
 *   --json <path>     write the structured dataset to this file
 *
 * Examples:
 *   node ...poolPrizeComposition.js 0.0.10584509 --env mainnet
 *   node ...poolPrizeComposition.js --env mainnet --pool 3 --find 0.0.1992037:75
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { AccountId, ContractId, Hbar, HbarUnit } = require('@hashgraph/sdk');

const { loadInterface } = require('../../../../utils/abiLoader');
const { batchMirrorQuery } = require('../../../../utils/solidityHelpers');
const { getTokenDetails, homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ───────────────────────────── CLI parsing ─────────────────────────────

function parseArgs(argv) {
	const args = { positional: [], flags: {} };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			const next = argv[i + 1];
			if (next === undefined || next.startsWith('--')) args.flags[key] = true;
			else { args.flags[key] = next; i++; }
		}
		else {
			args.positional.push(a);
		}
	}
	return args;
}

function evmToTokenId(evmAddr) {
	// native long-zero token addresses decode straight to 0.0.N
	return AccountId.fromEvmAddress(0, 0, evmAddr).toString();
}

// ───────────────────────────── token resolution ─────────────────────────────

const tokenCache = new Map(); // evm(lower) → { hederaId, symbol, name, decimals }
async function resolveToken(env, evmAddr) {
	const lower = evmAddr.toLowerCase();
	if (tokenCache.has(lower)) return tokenCache.get(lower);
	let hederaId;
	try { hederaId = await homebrewPopulateAccountNum(env, evmAddr, EntityType.TOKEN); }
	catch { try { hederaId = evmToTokenId(evmAddr); } catch { hederaId = evmAddr; } }
	let dets = {};
	try { dets = await getTokenDetails(env, hederaId); } catch { /* ignore */ }
	const rec = { hederaId, symbol: dets.symbol || hederaId, name: dets.name || '', decimals: dets.decimals ?? null };
	tokenCache.set(lower, rec);
	return rec;
}

// ─────────────────────────── pool basic info ───────────────────────────

async function readPoolBasics(env, iface, contractId, operatorId, totalPools) {
	const queries = [];
	for (let i = 0; i < totalPools; i++) {
		queries.push({ contractId, encoded: iface.encodeFunctionData('getPoolBasicInfo', [i]), label: `pool_${i}` });
	}
	const res = queries.length ? await batchMirrorQuery(env, queries, operatorId, { concurrency: 25 }) : [];
	const pools = new Map();
	for (let i = 0; i < totalPools; i++) {
		if (res[i].error) continue;
		const d = iface.decodeFunctionResult('getPoolBasicInfo', res[i].result);
		// [ticketCID, winCID, winRate, entryFee, prizeCount, outstandingEntries, poolTokenId, paused, closed, feeToken]
		pools.set(i, {
			id: i,
			winRate: Number(d[2]),
			entryFee: BigInt(d[3]),
			prizeCount: Number(d[4]),
			outstandingEntries: Number(d[5]),
			poolTokenAddr: String(d[6]).toLowerCase(),
			paused: d[7],
			closed: d[8],
			feeTokenAddr: String(d[9]).toLowerCase(),
		});
	}
	return pools;
}

// ─────────────────────────── walk one pool ───────────────────────────

async function walkPoolPrizes(env, iface, contractId, operatorId, poolId, prizeCount) {
	if (prizeCount === 0) return [];
	const queries = [];
	for (let i = 0; i < prizeCount; i++) {
		queries.push({ contractId, encoded: iface.encodeFunctionData('getPrizePackage', [poolId, i]), label: `p${poolId}_${i}` });
	}
	const res = await batchMirrorQuery(env, queries, operatorId, { concurrency: 25 });
	const pkgs = [];
	for (let i = 0; i < prizeCount; i++) {
		if (res[i].error) { pkgs.push({ index: i, error: res[i].error.message }); continue; }
		const pkg = iface.decodeFunctionResult('getPrizePackage', res[i].result)[0];
		const nfts = [];
		for (let j = 0; j < pkg.nftTokens.length; j++) {
			const tok = String(pkg.nftTokens[j]).toLowerCase();
			if (tok === ZERO_ADDR) continue;
			const serials = (pkg.nftSerials[j] || []).map((s) => Number(s));
			nfts.push({ tokenAddr: tok, serials });
		}
		pkgs.push({
			index: i,
			tokenAddr: String(pkg.token).toLowerCase(),
			amount: BigInt(pkg.amount),
			nfts,
		});
	}
	return pkgs;
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
	const operatorId = process.env.ACCOUNT_ID ? AccountId.fromString(process.env.ACCOUNT_ID) : AccountId.fromString('0.0.2');
	const onlyPool = (flags.pool !== undefined && flags.pool !== true) ? parseInt(flags.pool, 10) : null;

	let findTarget = null;
	if (flags.find && flags.find !== true) {
		const [tid, ser] = String(flags.find).split(':');
		findTarget = { tokenId: tid, serial: parseInt(ser, 10) };
	}

	console.log('\n╔══════════════════════════════════════════════════════════════╗');
	console.log('║            LazyLotto — Pool Prize Composition               ║');
	console.log('╚══════════════════════════════════════════════════════════════╝');
	console.log(`  Environment:  ${env.toUpperCase()}`);
	console.log(`  Contract:     ${contractId.toString()}`);
	if (onlyPool !== null) console.log(`  Pool filter:  #${onlyPool}`);
	if (findTarget) console.log(`  Looking for:  ${findTarget.tokenId} serial #${findTarget.serial}`);
	console.log('');

	const iface = loadInterface('LazyLotto');

	// totalPools
	const totalRes = await batchMirrorQuery(env, [
		{ contractId, encoded: iface.encodeFunctionData('totalPools'), label: 'totalPools' },
	], operatorId, { concurrency: 1 });
	if (totalRes[0].error) throw new Error(`Could not read totalPools: ${totalRes[0].error.message}`);
	const totalPools = Number(iface.decodeFunctionResult('totalPools', totalRes[0].result)[0]);
	console.log(`🔍 ${totalPools} pool(s) total.`);

	const basics = await readPoolBasics(env, iface, contractId, operatorId, totalPools);

	// build the set of all pools' ticket tokens (reroll-ticket classification)
	const ticketTokens = new Set();
	for (const p of basics.values()) {
		if (p.poolTokenAddr && p.poolTokenAddr !== ZERO_ADDR) ticketTokens.add(p.poolTokenAddr);
	}

	const targetPools = onlyPool !== null ? [onlyPool] : [...basics.keys()];
	const report = [];
	let findHit = null;

	for (const pid of targetPools) {
		const p = basics.get(pid);
		if (!p) { console.log(`\n⚠️  Pool #${pid} not found.`); continue; }
		console.log(`\n📦 Walking pool #${pid} — ${p.prizeCount} prize package(s)...`);
		const pkgs = await walkPoolPrizes(env, iface, contractId, operatorId, pid, p.prizeCount);

		// aggregate
		let hbarTinybar = 0n;
		const ftByToken = new Map();      // evm → amount(BigInt)
		const nftByCollection = new Map(); // evm → serials[]
		let rerollTickets = 0;
		const rerollByToken = new Map();   // evm → count
		let bareHbarCount = 0; // prizes that are pure HBAR (no NFT)

		for (const pkg of pkgs) {
			if (pkg.error) continue;
			if (pkg.tokenAddr === ZERO_ADDR) {
				if (pkg.amount > 0n) hbarTinybar += pkg.amount;
			}
			else if (pkg.amount > 0n) {
				ftByToken.set(pkg.tokenAddr, (ftByToken.get(pkg.tokenAddr) || 0n) + pkg.amount);
			}
			if (pkg.nfts.length === 0 && pkg.tokenAddr === ZERO_ADDR) bareHbarCount++;
			for (const n of pkg.nfts) {
				if (ticketTokens.has(n.tokenAddr)) {
					rerollTickets += n.serials.length;
					rerollByToken.set(n.tokenAddr, (rerollByToken.get(n.tokenAddr) || 0) + n.serials.length);
				}
				else {
					const arr = nftByCollection.get(n.tokenAddr) || [];
					arr.push(...n.serials);
					nftByCollection.set(n.tokenAddr, arr);
				}
				// find-target check
				if (findTarget) {
					let nTokenHedera;
					try { nTokenHedera = evmToTokenId(n.tokenAddr); } catch { nTokenHedera = n.tokenAddr; }
					if (nTokenHedera === findTarget.tokenId && n.serials.includes(findTarget.serial)) {
						findHit = { poolId: pid, packageIndex: pkg.index, pkg };
					}
				}
			}
		}

		report.push({ pid, p, pkgs, hbarTinybar, ftByToken, nftByCollection, rerollTickets, rerollByToken, bareHbarCount });
	}

	// resolve token symbols for everything we saw
	const toResolve = new Set();
	for (const r of report) {
		for (const t of r.ftByToken.keys()) toResolve.add(t);
		for (const t of r.nftByCollection.keys()) toResolve.add(t);
		for (const t of r.rerollByToken.keys()) toResolve.add(t);
		if (r.p.feeTokenAddr !== ZERO_ADDR) toResolve.add(r.p.feeTokenAddr);
	}
	for (const t of toResolve) await resolveToken(env, t);

	// ─────────────────────────── REPORT ───────────────────────────
	for (const r of report) {
		const { pid, p } = r;
		const state = p.closed ? '🔒 CLOSED' : p.paused ? '⏸️  PAUSED' : '🟢 ACTIVE';
		console.log('\n═══════════════════════════════════════════════════════════════');
		console.log(`  POOL #${pid}  ${state}   (${p.prizeCount} prizes remaining)`);
		console.log('═══════════════════════════════════════════════════════════════');
		console.log(`  Real HBAR in pool:     ${new Hbar(r.hbarTinybar, HbarUnit.Tinybar).toString()}`);
		if (r.ftByToken.size) {
			for (const [t, amt] of r.ftByToken) {
				const tk = tokenCache.get(t);
				const dec = tk?.decimals ?? 0;
				const human = dec ? Number(amt) / 10 ** dec : Number(amt);
				console.log(`  Fungible token prize:  ${human.toLocaleString()} ${tk?.symbol || t}`);
			}
		}
		const totalOutsideNfts = [...r.nftByCollection.values()].reduce((s, a) => s + a.length, 0);
		console.log(`  Collectible NFTs:      ${totalOutsideNfts}  (the real chase/marquee prizes)`);
		console.log(`  Free reroll tickets:   ${r.rerollTickets}`);
		console.log(`  Bare HBAR-only prizes: ${r.bareHbarCount}`);

		if (r.nftByCollection.size) {
			console.log('\n  Collectible NFT prizes still in the pool:');
			for (const [t, serials] of r.nftByCollection) {
				const tk = tokenCache.get(t);
				const sorted = [...serials].sort((a, b) => a - b);
				console.log(`    • ${tk?.symbol || t} (${tk?.hederaId || t}): ${sorted.length} → serials [${sorted.join(', ')}]`);
			}
		}
		if (r.rerollByToken.size) {
			console.log('\n  Free reroll tickets seeded here:');
			for (const [t, count] of r.rerollByToken) {
				const tk = tokenCache.get(t);
				console.log(`    • ${tk?.symbol || t} (${tk?.hederaId || t}): ${count}`);
			}
		}

		// per-package detail when a single pool is requested
		if (onlyPool !== null) {
			console.log('\n  Per-package detail:');
			for (const pkg of r.pkgs) {
				if (pkg.error) { console.log(`    #${pkg.index}: ⚠️ ${pkg.error}`); continue; }
				const parts = [];
				if (pkg.tokenAddr === ZERO_ADDR && pkg.amount > 0n) parts.push(new Hbar(pkg.amount, HbarUnit.Tinybar).toString());
				else if (pkg.amount > 0n) {
					const tk = tokenCache.get(pkg.tokenAddr);
					const dec = tk?.decimals ?? 0;
					parts.push(`${dec ? Number(pkg.amount) / 10 ** dec : Number(pkg.amount)} ${tk?.symbol || pkg.tokenAddr}`);
				}
				for (const n of pkg.nfts) {
					const tk = tokenCache.get(n.tokenAddr);
					const tag = ticketTokens.has(n.tokenAddr) ? ' [reroll ticket]' : '';
					parts.push(`${tk?.symbol || tk?.hederaId || n.tokenAddr} #${n.serials.join(',')}${tag}`);
				}
				console.log(`    #${String(pkg.index).padStart(3)}: ${parts.join('  +  ') || '(empty)'}`);
			}
		}
	}

	// find-target result
	if (findTarget) {
		console.log('\n═══════════════════════════════════════════════════════════════');
		console.log(`  TARGET CHECK — ${findTarget.tokenId} #${findTarget.serial}`);
		console.log('═══════════════════════════════════════════════════════════════');
		if (findHit) {
			const tk = tokenCache.get(findHit.pkg.tokenAddr);
			const hbarPart = findHit.pkg.tokenAddr === ZERO_ADDR && findHit.pkg.amount > 0n
				? new Hbar(findHit.pkg.amount, HbarUnit.Tinybar).toString() : '';
			console.log(`  ✅ STILL IN THE POOL — pool #${findHit.poolId}, package index #${findHit.packageIndex}.`);
			if (hbarPart) console.log(`     Bundled with: ${hbarPart}`);
			console.log('     (available to win; not yet rolled out.)');
		}
		else {
			console.log('  ❌ NOT FOUND among remaining prize packages in the scanned pool(s).');
			console.log('     → It has either been WON (now pending/claimed) or was never seeded here.');
			console.log('     Verify by checking the NFT\'s current owner on the mirror node:');
			console.log(`     storage contract should hold it if still a prize; a player wallet means it was claimed.`);
		}
	}

	if (flags.json && flags.json !== true) {
		const out = report.map((r) => ({
			poolId: r.pid,
			prizeCount: r.p.prizeCount,
			paused: r.p.paused,
			closed: r.p.closed,
			realHbar: new Hbar(r.hbarTinybar, HbarUnit.Tinybar).toString(),
			collectibleNfts: [...r.nftByCollection.entries()].map(([t, serials]) => ({
				token: tokenCache.get(t)?.hederaId || t,
				symbol: tokenCache.get(t)?.symbol,
				serials: [...serials].sort((a, b) => a - b),
			})),
			rerollTickets: r.rerollTickets,
			bareHbarPrizes: r.bareHbarCount,
		}));
		const outPath = path.resolve(String(flags.json));
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
		console.log(`\n💾 Dataset written to ${outPath}`);
	}

	console.log('\n✅ Done.\n');
}

main().catch((err) => {
	console.error('\n❌ Error:', err.message);
	if (process.env.DEBUG) console.error(err);
	process.exit(1);
});
