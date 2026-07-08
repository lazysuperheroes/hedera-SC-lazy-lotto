/**
 * LazyLotto Pending-Prize Winner Identifier  ── MIGRATION (read-only) ──
 *
 * Finds EVERY unclaimed prize and its current holder, so you can pay them directly instead
 * of standing up a legacy claim page. Unclaimed prizes live in TWO places:
 *
 *   A) pending[user]  — in-memory, from a roll win not yet claimed. Found by scanning
 *      Rolled(won=true) → each winner's getPendingPrizesPage.
 *   B) prize NFTs      — a won prize converted via redeemPrizeToNFT into a TRADEABLE NFT
 *      minted from the POOL ticket token (winCID metadata), tracked in pendingNFTs. The
 *      current NFT holder (who may never have rolled) is owed the prize. Found by walking
 *      every live serial of each pool token and calling getPendingPrizesByNFT.
 *
 * Also emits prize-nft-serials.json: the pool-token serials that are PRIZE NFTs (not entry
 * tickets) — the honor/make-good snapshot MUST exclude these (their holders get the prize,
 * not a free v2 entry).
 *
 * Usage:
 *   ENVIRONMENT=mainnet LAZY_LOTTO_CONTRACT_ID=0.0.10584509 \
 *     node scripts/interactions/LazyLotto/queries/identifyPendingWinners.js [snapshot.json]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ethers } = require('ethers');
const { getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { batchMirrorQuery } = require('../../../../utils/solidityHelpers');
const { getBaseURL, homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');

const { operatorId, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const ZERO = '0x0000000000000000000000000000000000000000';
const h = (tinybar) => ethers.formatUnits(tinybar, 8);

function latestSnapshot() {
	const dir = 'migration-snapshots';
	if (!fs.existsSync(dir)) {
		return null;
	}
	const files = fs.readdirSync(dir).filter((f) => f.startsWith('pools-snapshot-') && f.endsWith('.json')).sort();
	return files.length ? path.join(dir, files[files.length - 1]) : null;
}

async function resolveAccount(evm) {
	try {
		const id = await homebrewPopulateAccountNum(env, evm);
		return id ? id.toString() : evm;
	}
	catch {
		return evm;
	}
}

async function allLiveSerials(tokenHuman) {
	let url = `${getBaseURL(env)}/api/v1/tokens/${tokenHuman}/nfts?limit=100`;
	const out = [];
	while (url) {
		const res = await axios.get(url);
		for (const n of (res.data.nfts || [])) {
			if (!n.deleted && n.account_id) {
				out.push({ serial: Number(n.serial_number), owner: n.account_id });
			}
		}
		url = (res.data.links && res.data.links.next) ? `${getBaseURL(env)}${res.data.links.next}` : null;
	}
	return out;
}

function prizeHbar(pp) {
	let hbar = 0n;
	const other = [];
	if (pp.prize.token === ZERO && BigInt(pp.prize.amount) > 0n) {
		hbar = BigInt(pp.prize.amount);
	}
	else if (BigInt(pp.prize.amount) > 0n) {
		other.push(`${pp.prize.amount} raw ${pp.prize.token}`);
	}
	for (let k = 0; k < pp.prize.nftTokens.length; k++) {
		if (pp.prize.nftTokens[k] !== ZERO) {
			other.push(`NFT ${pp.prize.nftTokens[k]} [${pp.prize.nftSerials[k].join(',')}]`);
		}
	}
	return { hbar, other };
}

async function scanInMemory(iface) {
	console.log('🔎 Pass A — scanning Rolled(won=true) for in-memory pending...');
	const rolledTopic0 = ethers.id('Rolled(address,uint256,bool,uint256)').toLowerCase();
	let url = `${getBaseURL(env)}/api/v1/contracts/${contractId.toString()}/results/logs?order=asc&limit=100`;
	const winners = new Set();
	let rolls = 0;
	while (url) {
		const res = await axios.get(url);
		for (const log of (res.data.logs || [])) {
			if (!log.topics || !log.topics.length || log.topics[0].toLowerCase() !== rolledTopic0) {
				continue;
			}
			rolls++;
			const dataHex = (log.data || '0x').replace(/^0x/, '');
			if (dataHex.length >= 64 && BigInt(`0x${dataHex.slice(0, 64)}`) !== 0n) {
				winners.add(`0x${log.topics[1].replace(/^0x/, '').slice(-40)}`.toLowerCase());
			}
		}
		url = (res.data.links && res.data.links.next) ? `${getBaseURL(env)}${res.data.links.next}` : null;
	}
	console.log(`   ${rolls} rolls, ${winners.size} unique winners.`);

	const wl = [...winners];
	const byAccount = {};
	if (!wl.length) {
		return byAccount;
	}
	const countQ = wl.map((w) => ({ contractId, encoded: iface.encodeFunctionData('getPendingPrizesCount', [w]), label: w }));
	const countRes = await batchMirrorQuery(env, countQ, operatorId, { concurrency: 25 });
	const withPending = [];
	for (let i = 0; i < wl.length; i++) {
		if (countRes[i].error) {
			continue;
		}
		const n = Number(iface.decodeFunctionResult('getPendingPrizesCount', countRes[i].result)[0]);
		if (n > 0) {
			withPending.push({ evm: wl[i], count: n });
		}
	}
	const pageQ = withPending.map((w) => ({ contractId, encoded: iface.encodeFunctionData('getPendingPrizesPage', [w.evm, 0, w.count]), label: w.evm }));
	const pageRes = pageQ.length ? await batchMirrorQuery(env, pageQ, operatorId, { concurrency: 25 }) : [];
	for (let i = 0; i < withPending.length; i++) {
		if (pageRes[i].error) {
			continue;
		}
		const arr = iface.decodeFunctionResult('getPendingPrizesPage', pageRes[i].result)[0];
		let hbar = 0n;
		const other = [];
		for (const pp of arr) {
			const r = prizeHbar(pp);
			hbar += r.hbar;
			other.push(...r.other);
		}
		const account = await resolveAccount(withPending[i].evm);
		byAccount[account] = { inMemHbar: hbar, inMemPackages: withPending[i].count, other };
	}
	console.log(`   in-memory pending holders: ${Object.keys(byAccount).length}\n`);
	return byAccount;
}

async function scanPrizeNFTs(iface, pools) {
	console.log('🔎 Pass B — scanning pool-token serials for prize NFTs...');
	const holders = {};
	const prizeSerials = {};
	for (const p of pools) {
		const serials = await allLiveSerials(p.poolTokenId);
		if (!serials.length) {
			continue;
		}
		const q = serials.map((s) => ({
			contractId,
			encoded: iface.encodeFunctionData('getPendingPrizesByNFT', [p.poolTokenIdEvm, s.serial]),
			label: `${p.poolTokenId}:${s.serial}`,
		}));
		const res = await batchMirrorQuery(env, q, operatorId, { concurrency: 25 });
		let found = 0;
		for (let i = 0; i < serials.length; i++) {
			if (res[i].error) {
				continue;
			}
			const pp = iface.decodeFunctionResult('getPendingPrizesByNFT', res[i].result)[0];
			const isPrize = BigInt(pp.prize.amount) > 0n || pp.prize.nftTokens.some((t) => t !== ZERO);
			if (!isPrize) {
				continue;
			}
			found++;
			const { hbar, other } = prizeHbar(pp);
			const owner = serials[i].owner;
			if (!holders[owner]) {
				holders[owner] = { nftHbar: 0n, serials: [], other: [] };
			}
			holders[owner].nftHbar += hbar;
			holders[owner].serials.push({ token: p.poolTokenId, serial: serials[i].serial, poolId: p.id });
			holders[owner].other.push(...other);
			if (!prizeSerials[p.poolTokenId]) {
				prizeSerials[p.poolTokenId] = [];
			}
			prizeSerials[p.poolTokenId].push(serials[i].serial);
		}
		console.log(`   pool #${p.id} (${p.poolTokenId}): ${serials.length} serials scanned, ${found} prize NFT(s).`);
	}
	console.log(`   prize-NFT holders: ${Object.keys(holders).length}\n`);
	return { holders, prizeSerials };
}

async function main() {
	const snapPath = process.argv[2] || latestSnapshot();
	if (!snapPath || !fs.existsSync(snapPath)) {
		console.error('❌ No snapshot found. Run snapshotForMigration.js first, or pass a path.');
		process.exit(1);
	}
	const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   LazyLotto PENDING WINNERS — unclaimed HBAR (both kinds)  ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 Contract:    ${contractId.toString()}`);
	console.log(`📦 Snapshot:    ${snapPath}\n`);

	try {
		const iface = loadInterface('LazyLotto');
		const inMem = await scanInMemory(iface);
		const { holders, prizeSerials } = await scanPrizeNFTs(iface, snap.pools);

		// ---- merge by account ----
		const accounts = new Set([...Object.keys(inMem), ...Object.keys(holders)]);
		const payouts = [];
		let total = 0n;
		for (const acct of accounts) {
			const a = inMem[acct] || { inMemHbar: 0n, inMemPackages: 0, other: [] };
			const b = holders[acct] || { nftHbar: 0n, serials: [], other: [] };
			const hbar = a.inMemHbar + b.nftHbar;
			total += hbar;
			payouts.push({
				account: acct,
				hbar: h(hbar),
				tinybar: hbar.toString(),
				inMemoryHbar: h(a.inMemHbar),
				prizeNftHbar: h(b.nftHbar),
				inMemoryPackages: a.inMemPackages,
				prizeNftSerials: b.serials,
				other: [...a.other, ...b.other],
			});
		}
		payouts.sort((x, y) => Number(y.tinybar) - Number(x.tinybar));

		// ---- report ----
		console.log('═══ ALL PENDING WINNERS (pay these directly) ═══');
		for (const p of payouts) {
			const extra = p.other.length ? `  ⚠️ + ${p.other.join(', ')}` : '';
			console.log(`  ${p.account}  →  ${p.hbar} ℏ  (in-mem ${p.inMemoryHbar} + prizeNFT ${p.prizeNftHbar})${extra}`);
		}
		console.log(`\n  TOTAL unclaimed HBAR: ${h(total)} ℏ  (should equal checkPendingPrizes delta: 12 ℏ)`);

		const out = 'migration-snapshots/pending-payouts.json';
		fs.writeFileSync(out, JSON.stringify({
			capturedAt: new Date().toISOString(),
			environment: env,
			contractId: contractId.toString(),
			totalHbar: h(total),
			payouts,
		}, null, 2));
		const serialsOut = 'migration-snapshots/prize-nft-serials.json';
		fs.writeFileSync(serialsOut, JSON.stringify(prizeSerials, null, 2));

		console.log(`\n💾 Payouts:            ${out}`);
		console.log(`💾 Prize-NFT serials:  ${serialsOut}  (EXCLUDE these from the entry make-good)`);
		if (payouts.some((p) => p.other.length)) {
			console.log('\n⚠️  Some winners have NON-HBAR pending — a plain HBAR send will NOT cover those.');
		}
		const totalPrizeSerials = Object.values(prizeSerials).reduce((a, s) => a + s.length, 0);
		if (totalPrizeSerials) {
			console.log(`\n⚠️  ${totalPrizeSerials} pool-token serial(s) are PRIZE NFTs, not entry tickets — the honor snapshot must subtract them (their holders are paid above).`);
		}
		console.log('');
	}
	catch (error) {
		console.error('\n❌ Failed:', error.message);
		process.exit(1);
	}
}

main();
