/**
 * LazyLotto Pending-Prize Check  ── MIGRATION safety (read-only) ──
 *
 * Quantifies WON-BUT-UNCLAIMED prizes (pending[user]) that the pool snapshot does NOT
 * capture. Method: the on-chain prize reserve covers pool prizes + pending prizes, but the
 * snapshot only sums pool prizes — so (reserve − poolSum) = the pending obligation.
 *
 *   Fungible:  getFungiblesNeededForPrizes(token)  vs  Σ pool prize amounts (per token)
 *   NFTs:      Storage account NFT holdings         vs  Σ pool prize serials (per collection)
 *
 * A positive delta = value users have WON but not yet CLAIMED. Those assets stay locked in
 * Storage (the anti-rug invariant blocks Phase-D withdrawal of them) and remain claimable on
 * the OLD contract post-cutover — but you want to KNOW the number before retiring anything.
 *
 * Usage:
 *   ENVIRONMENT=mainnet LAZY_LOTTO_CONTRACT_ID=0.0.10584509 LAZY_LOTTO_STORAGE=0.0.10584506 \
 *     node scripts/interactions/LazyLotto/queries/checkPendingPrizes.js [snapshot.json]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getSerialsOwned } = require('../../../../utils/hederaMirrorHelpers');

const { operatorId, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const storageId = getContractId('LAZY_LOTTO_STORAGE');
const ZERO = '0x0000000000000000000000000000000000000000';

function latestSnapshot() {
	const dir = 'migration-snapshots';
	if (!fs.existsSync(dir)) {
		return null;
	}
	const files = fs.readdirSync(dir).filter((f) => f.startsWith('pools-snapshot-') && f.endsWith('.json')).sort();
	return files.length ? path.join(dir, files[files.length - 1]) : null;
}

async function main() {
	const snapPath = process.argv[2] || latestSnapshot();
	if (!snapPath || !fs.existsSync(snapPath)) {
		console.error('❌ No snapshot found. Run snapshotForMigration.js first, or pass a path.');
		process.exit(1);
	}
	const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   LazyLotto PENDING-PRIZE CHECK  (won-but-unclaimed)       ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 Contract:    ${contractId.toString()}`);
	console.log(`🗄️  Storage:     ${storageId.toString()}`);
	console.log(`📦 Snapshot:    ${snapPath}\n`);

	try {
		const lotto = loadInterface('LazyLotto');

		// ---- pool sums from snapshot ----
		const poolFt = {};
		const poolNft = {};
		for (const p of snap.pools) {
			for (const pr of p.prizes) {
				if (pr.amount !== '0') {
					poolFt[pr.tokenEvm] = (BigInt(poolFt[pr.tokenEvm] || '0') + BigInt(pr.amount)).toString();
				}
				for (let k = 0; k < pr.nftTokens.length; k++) {
					const col = pr.nftTokens[k];
					if (col !== 'HBAR' && pr.nftTokensEvm[k] !== ZERO) {
						poolNft[col] = (poolNft[col] || 0) + pr.nftSerials[k].length;
					}
				}
			}
		}

		// ---- fungible reserve vs pool sum ----
		console.log('═══ FUNGIBLE / HBAR (reserve vs pool prizes) ═══');
		let pendingFtFound = false;
		const ftTokens = new Set([ZERO, ...Object.keys(poolFt)]);
		for (const tokEvm of ftTokens) {
			const reserveRes = await queryContract(env, contractId, lotto, 'getFungiblesNeededForPrizes', [tokEvm], operatorId);
			const reserve = BigInt(reserveRes[0]);
			const poolSum = BigInt(poolFt[tokEvm] || '0');
			const pending = reserve - poolSum;
			const label = tokEvm === ZERO ? 'HBAR' : tokEvm;
			const fmt = (v) => (tokEvm === ZERO ? `${ethers.formatUnits(v, 8)} ℏ` : `${v.toString()} raw`);
			const flag = pending > 0n ? '⚠️ PENDING' : (pending < 0n ? '❓ reserve < pool (investigate)' : '✅ none');
			console.log(`  ${label}: reserve ${fmt(reserve)} | pool ${fmt(poolSum)} | unclaimed ${fmt(pending)}  ${flag}`);
			if (pending > 0n) {
				pendingFtFound = true;
			}
		}

		// ---- NFT: Storage holdings vs pool serials ----
		console.log('\n═══ NFT (Storage holdings vs pool prizes) ═══');
		console.log('  (delta>0 for a non-ticket collection = won-unclaimed NFT prizes; ticket tokens also hold undistributed inventory)');
		let pendingNftFound = false;
		for (const [col, poolCount] of Object.entries(poolNft)) {
			const held = (await getSerialsOwned(env, storageId, col)) || [];
			const delta = held.length - poolCount;
			const flag = delta > 0 ? '⚠️ delta' : (delta < 0 ? '❓ Storage < pool (investigate)' : '✅ match');
			console.log(`  ${col}: Storage ${held.length} | pool ${poolCount} | delta ${delta}  ${flag}`);
			if (delta > 0) {
				pendingNftFound = true;
			}
		}

		// ---- verdict ----
		console.log('\n═══ VERDICT ═══');
		if (!pendingFtFound && !pendingNftFound) {
			console.log('✅ No unclaimed prizes detected — reserve matches pool prizes, Storage matches pool NFTs.');
			console.log('   Safe to extract/retire without stranding user winnings.');
		}
		else {
			console.log('⚠️  Unclaimed prizes (or extra Storage inventory) detected — see deltas above.');
			console.log('   These assets stay locked in Storage (Phase-D withdrawal is obligation-blocked) and remain');
			console.log('   claimable on the OLD contract after cutover. Decide: announce+wait for claims, OR keep the');
			console.log('   old contract claimable indefinitely, OR fold the specific holders into the v2 make-good.');
			console.log('   Ticket-token deltas are expected (undistributed ticket inventory) — focus on non-ticket collections.');
		}
		console.log('');
	}
	catch (error) {
		console.error('\n❌ Pending-prize check failed:', error.message);
		process.exit(1);
	}
}

main();
