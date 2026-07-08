/**
 * Generate v2 addPrizesBatch configs from the pre-drain snapshot.
 *
 * Reconstructs each pool's prize packages exactly, with ONE substitution: the old pool-ticket
 * tokens used as prizes (Lounge 0.0.10585596, Whale 0.0.10589060) are dead on v2, so they're
 * replaced by the new pool tokens + the freshly-minted serials. External collectibles keep
 * their token + serials (they're in 0.0.697777 from the drain). HBAR amounts kept exactly.
 *
 * Output: prizes-pool{0..4}-v2.json in this folder (addPrizesBatch -f format).
 *
 *   node scripts/interactions/LazyLotto/admin/recipes/generatePrizesV2.js
 */
const fs = require('fs');
const path = require('path');

const SNAP = 'migration-snapshots/pools-snapshot-main-2026-07-06T20-45-30-483Z.json';

// old ticket token -> { token: new token, serials: queue of fresh serials to assign }
const TICKET_SUB = {
	'0.0.10585596': { token: '0.0.10628804', queue: Array.from({ length: 19 }, (_, i) => i + 1) }, // Lounge #2: 1..19
	'0.0.10589060': { token: '0.0.10628870', queue: Array.from({ length: 8 }, (_, i) => i + 1) },  // Whale #3: 1..8
};

const hbarStr = (tinybar) => String(Number(tinybar) / 1e8);

function main() {
	const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
	const outDir = 'scripts/interactions/LazyLotto/admin/recipes';
	const summary = [];

	for (const pool of snap.pools) {
		const packages = [];
		for (const pr of pool.prizes) {
			const pkg = {};
			if (pr.token === 'HBAR' && pr.amount !== '0') pkg.hbar = hbarStr(pr.amount);
			else if (pr.token !== 'HBAR' && pr.amount !== '0') pkg.ft = { token: pr.token, amount: String(pr.amount) }; // no FT prizes expected, but preserve

			const nfts = [];
			for (let k = 0; k < pr.nftTokens.length; k++) {
				const oldTok = pr.nftTokens[k];
				const serials = pr.nftSerials[k].map(Number);
				const sub = TICKET_SUB[oldTok];
				if (sub) {
					const fresh = sub.queue.splice(0, serials.length); // consume N fresh serials
					if (fresh.length !== serials.length) throw new Error(`ran out of fresh serials for ${oldTok} in pool #${pool.id}`);
					nfts.push({ token: sub.token, serials: fresh });
				} else {
					nfts.push({ token: oldTok, serials });
				}
			}
			if (nfts.length) pkg.nfts = nfts;
			packages.push(pkg);
		}

		const file = path.join(outDir, `prizes-pool${pool.id}-v2.json`);
		fs.writeFileSync(file, JSON.stringify({ poolId: pool.id, packages }, null, 2));

		const hbarTotal = packages.reduce((s, p) => s + (p.hbar ? Number(p.hbar) : 0), 0);
		const nftCount = packages.reduce((s, p) => s + (p.nfts ? p.nfts.reduce((a, n) => a + n.serials.length, 0) : 0), 0);
		summary.push({ pool: pool.id, file, packages: packages.length, hbarTotal, nftCount });
	}

	// verify every fresh ticket serial got consumed
	for (const [oldTok, sub] of Object.entries(TICKET_SUB)) {
		if (sub.queue.length !== 0) throw new Error(`LEFTOVER fresh serials for ${oldTok} → ${sub.token}: [${sub.queue.join(',')}] (expected all consumed)`);
	}

	console.log('\n=== v2 PRIZE CONFIGS GENERATED ===');
	for (const s of summary) console.log(`  pool #${s.pool}: ${s.packages} packages, ${s.hbarTotal} HBAR, ${s.nftCount} NFTs  →  ${s.file}`);
	console.log(`  ✅ all Lounge (19) + Whale (8) fresh ticket serials consumed exactly.\n`);
}

main();
