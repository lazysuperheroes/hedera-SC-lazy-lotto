/**
 * LazyLotto Migration Snapshot  ── PHASE A (read-only, run FIRST) ──
 *
 * Dumps EVERY pool's config + EVERY prize package to a durable JSON file. This is the
 * RE-LIST SOURCE OF TRUTH for v2 — once Phase B/C extract prizes, the on-chain prize
 * lists are gone, so this file is the only record of how to rebuild them.
 *
 * Captures RAW EVM values (addresses, raw amounts, serials) — exactly what the v2
 * re-list step consumes — plus best-effort human 0.0.x IDs and reconciliation totals.
 * Read-only: no gas, no state change. Safe to run repeatedly.
 *
 * Usage:
 *   ENVIRONMENT=mainnet LAZY_LOTTO_CONTRACT_ID=0.0.10584509 \
 *     node scripts/interactions/LazyLotto/queries/snapshotForMigration.js [outPath]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { batchMirrorQuery } = require('../../../../utils/solidityHelpers');
const { homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const ZERO = '0x0000000000000000000000000000000000000000';

function tokenLabel(addr) {
	return addr === ZERO ? 'HBAR' : addr;
}

async function main() {
	const client = createClient(env, operatorId, operatorKey);
	const iface = loadInterface('LazyLotto');

	let storageId = 'n/a';
	try {
		storageId = getContractId('LAZY_LOTTO_STORAGE').toString();
	}
	catch {
		storageId = 'n/a';
	}

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   LazyLotto MIGRATION SNAPSHOT  (Phase A — re-list source) ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 Contract:    ${contractId.toString()}\n`);

	try {
		// ---- pool count ----
		const totalRes = await batchMirrorQuery(
			env,
			[{ contractId, encoded: iface.encodeFunctionData('totalPools', []), label: 'totalPools' }],
			operatorId,
			{ concurrency: 5 },
		);
		if (totalRes[0].error) {
			throw new Error(`totalPools failed: ${totalRes[0].error.message}`);
		}
		const poolCount = Number(iface.decodeFunctionResult('totalPools', totalRes[0].result)[0]);
		console.log(`🎰 Pools: ${poolCount}\n`);

		// ---- pool basic info (batch) ----
		const poolQueries = [];
		for (let i = 0; i < poolCount; i++) {
			poolQueries.push({
				contractId,
				encoded: iface.encodeFunctionData('getPoolBasicInfo', [i]),
				label: `pool_${i}`,
			});
		}
		const poolRes = await batchMirrorQuery(env, poolQueries, operatorId, { concurrency: 25 });

		// ---- prize package queries (batch) ----
		const poolBasics = [];
		const prizeQueries = [];
		for (let i = 0; i < poolCount; i++) {
			if (poolRes[i].error) {
				throw new Error(`getPoolBasicInfo(${i}) failed: ${poolRes[i].error.message}`);
			}
			const d = iface.decodeFunctionResult('getPoolBasicInfo', poolRes[i].result);
			const prizeCount = Number(d[4]);
			poolBasics.push({
				id: i,
				ticketCID: d[0],
				winCID: d[1],
				winRateThousandthsOfBps: String(d[2]),
				entryFee: String(d[3]),
				prizeCount,
				outstandingEntries: Number(d[5]),
				poolTokenIdEvm: d[6],
				paused: d[7],
				closed: d[8],
				feeTokenEvm: d[9],
			});
			for (let j = 0; j < prizeCount; j++) {
				prizeQueries.push({
					contractId,
					encoded: iface.encodeFunctionData('getPrizePackage', [i, j]),
					label: `prize_${i}_${j}`,
					poolIndex: i,
					prizeIndex: j,
				});
			}
		}
		console.log(`🎁 Prize packages to fetch: ${prizeQueries.length}\n`);
		const prizeRes = prizeQueries.length
			? await batchMirrorQuery(env, prizeQueries, operatorId, { concurrency: 25 })
			: [];

		// ---- assemble raw prize data + collect unique addresses ----
		const uniqueAddrs = new Set();
		const prizesByPool = new Map();
		for (let q = 0; q < prizeQueries.length; q++) {
			const { poolIndex, prizeIndex } = prizeQueries[q];
			if (prizeRes[q].error) {
				throw new Error(`getPrizePackage(${poolIndex},${prizeIndex}) failed: ${prizeRes[q].error.message}`);
			}
			const pkg = iface.decodeFunctionResult('getPrizePackage', prizeRes[q].result)[0];
			const nftTokens = pkg.nftTokens.map((a) => a);
			const nftSerials = pkg.nftSerials.map((arr) => arr.map((s) => String(s)));
			const prize = {
				index: prizeIndex,
				tokenEvm: pkg.token,
				amount: String(pkg.amount),
				nftTokensEvm: nftTokens,
				nftSerials,
			};
			if (pkg.token !== ZERO) {
				uniqueAddrs.add(pkg.token);
			}
			for (const a of nftTokens) {
				if (a !== ZERO) {
					uniqueAddrs.add(a);
				}
			}
			if (!prizesByPool.has(poolIndex)) {
				prizesByPool.set(poolIndex, []);
			}
			prizesByPool.get(poolIndex).push(prize);
		}
		for (const pb of poolBasics) {
			if (pb.poolTokenIdEvm !== ZERO) {
				uniqueAddrs.add(pb.poolTokenIdEvm);
			}
			if (pb.feeTokenEvm !== ZERO) {
				uniqueAddrs.add(pb.feeTokenEvm);
			}
		}

		// ---- best-effort human 0.0.x resolution (cached, never fatal) ----
		console.log('🔎 Resolving Hedera IDs for', uniqueAddrs.size, 'unique addresses...');
		const idMap = { [ZERO]: 'HBAR' };
		for (const addr of uniqueAddrs) {
			try {
				idMap[addr] = await homebrewPopulateAccountNum(env, addr, EntityType.TOKEN);
			}
			catch {
				idMap[addr] = addr;
			}
		}
		const resolve = (addr) => idMap[addr] || addr;

		// ---- build final snapshot object + reconciliation ----
		const ftTotals = {};
		const nftTotals = {};
		const pools = poolBasics.map((pb) => {
			const prizes = (prizesByPool.get(pb.id) || []).map((p) => {
				if (p.amount !== '0') {
					const key = tokenLabel(p.tokenEvm);
					ftTotals[key] = (BigInt(ftTotals[key] || '0') + BigInt(p.amount)).toString();
				}
				for (let k = 0; k < p.nftTokensEvm.length; k++) {
					const col = p.nftTokensEvm[k];
					if (col === ZERO) {
						continue;
					}
					nftTotals[col] = (nftTotals[col] || 0) + p.nftSerials[k].length;
				}
				return {
					index: p.index,
					token: resolve(p.tokenEvm),
					tokenEvm: p.tokenEvm,
					amount: p.amount,
					nftTokens: p.nftTokensEvm.map(resolve),
					nftTokensEvm: p.nftTokensEvm,
					nftSerials: p.nftSerials,
				};
			});
			return {
				id: pb.id,
				ticketCID: pb.ticketCID,
				winCID: pb.winCID,
				winRateThousandthsOfBps: pb.winRateThousandthsOfBps,
				entryFee: pb.entryFee,
				prizeCount: pb.prizeCount,
				prizesCaptured: prizes.length,
				outstandingEntries: pb.outstandingEntries,
				poolTokenId: resolve(pb.poolTokenIdEvm),
				poolTokenIdEvm: pb.poolTokenIdEvm,
				paused: pb.paused,
				closed: pb.closed,
				feeToken: resolve(pb.feeTokenEvm),
				feeTokenEvm: pb.feeTokenEvm,
				prizes,
			};
		});

		const nftTotalsHuman = {};
		for (const [col, n] of Object.entries(nftTotals)) {
			nftTotalsHuman[resolve(col)] = n;
		}
		const ftTotalsHuman = {};
		for (const [tok, amt] of Object.entries(ftTotals)) {
			ftTotalsHuman[tok === 'HBAR' ? 'HBAR' : resolve(tok)] = amt;
		}

		const snapshot = {
			capturedAt: new Date().toISOString(),
			environment: env,
			contractId: contractId.toString(),
			storageContractId: storageId,
			totalPools: poolCount,
			totalPrizePackages: prizeQueries.length,
			reconciliation: {
				ftTotalsByToken: ftTotalsHuman,
				nftTotalsByCollection: nftTotalsHuman,
			},
			pools,
		};

		// ---- write durable file ----
		const outArg = process.argv[2];
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const outPath = outArg
			? path.resolve(outArg)
			: path.resolve('migration-snapshots', `pools-snapshot-${env}-${stamp}.json`);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

		// ---- reconciliation summary ----
		console.log('\n═══ SNAPSHOT SUMMARY ═══');
		for (const p of pools) {
			const flag = p.prizesCaptured === p.prizeCount ? '✅' : '⚠️';
			console.log(`  ${flag} pool #${p.id}  ${p.prizesCaptured}/${p.prizeCount} prizes  |  ticketToken ${p.poolTokenId}  |  ${p.paused ? 'paused' : 'live'}${p.closed ? ' closed' : ''}`);
		}
		console.log(`\n  Total prize packages captured: ${pools.reduce((a, p) => a + p.prizesCaptured, 0)} / ${prizeQueries.length}`);
		console.log('\n  FT / HBAR obligations (raw base units):');
		for (const [tok, amt] of Object.entries(ftTotalsHuman)) {
			console.log(`    ${tok}: ${amt}`);
		}
		console.log('\n  NFT prizes by collection:');
		for (const [col, n] of Object.entries(nftTotalsHuman)) {
			console.log(`    ${col}: ${n} serials`);
		}
		const anyMissing = pools.some((p) => p.prizesCaptured !== p.prizeCount);
		console.log(`\n${anyMissing ? '⚠️  SOME PRIZES MISSING — do NOT start Phase B until this reads clean.' : '✅ Full inventory captured.'}`);
		console.log(`\n💾 Saved: ${outPath}\n`);
	}
	catch (error) {
		console.error('\n❌ Snapshot failed:', error.message);
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

main();
