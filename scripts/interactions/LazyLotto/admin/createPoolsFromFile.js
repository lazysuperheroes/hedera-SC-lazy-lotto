/**
 * LazyLotto Batch Pool Creation (from JSON)  ── non-interactive createPool ──
 *
 * Creates multiple pools deterministically from a JSON config, eliminating hand-typed
 * copy/paste errors on immutable fields (CIDs, memos, fees). Reuses createPool.js's exact
 * unit conversions (winRate %→thousandthsOfBps, entryFee whole→base units), and per pool:
 *   - sets global burnPercentage to the pool's value ONLY if it differs (burn is frozen at
 *     creation; a no-op for HBAR pools, matters for LAZY pools)
 *   - createPool (payable 40 HBAR for token creation)
 *   - asserts the returned poolId === expectedPoolId (ABORTS on mismatch — never mis-orders)
 *   - pausePool if pauseAfterCreate
 * Resumable: pools whose expectedPoolId already exists on-chain are skipped. The --dry-run
 * queries the live pool count and prints the SAME skip/create/burn plan that execute follows.
 *
 * Usage:
 *   Dry-run (probe + plan, no tx):  node scripts/interactions/LazyLotto/admin/createPoolsFromFile.js <config.json> --dry-run
 *   Execute:                        node scripts/interactions/LazyLotto/admin/createPoolsFromFile.js <config.json>
 *
 * Config shape: { "pools": [ { expectedPoolId, name, symbol, memo, winRatePercent,
 *   feeToken ("HBAR"|"0.0.x"), entryFee (whole units), ticketCID, winCID, royalties[], burnPercentage, pauseAfterCreate } ] }
 */

require('dotenv').config();
const fs = require('fs');
const { Hbar, HbarUnit } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const { executeContractFunction } = require('../../../../utils/scriptHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const DRY_RUN = process.argv.includes('--dry-run');
const ZERO = '0x0000000000000000000000000000000000000000';

const toEvm = (id) => (id.startsWith('0x') ? id : '0x' + BigInt(id.split('.').pop()).toString(16).padStart(40, '0'));

async function resolvePool(p) {
	// mirror createPool.js conversions exactly
	if (!p.name || !p.symbol || !p.memo || !p.ticketCID || !p.winCID) throw new Error(`pool #${p.expectedPoolId}: missing required field`);
	if (Buffer.byteLength(p.memo, 'utf8') > 100) throw new Error(`pool #${p.expectedPoolId}: memo > 100 bytes`);
	if (!(p.winRatePercent > 0 && p.winRatePercent <= 100)) throw new Error(`pool #${p.expectedPoolId}: winRatePercent out of range`);
	if (!(Number(p.entryFee) > 0)) throw new Error(`pool #${p.expectedPoolId}: entryFee must be > 0`);

	const winRate = Math.floor(p.winRatePercent * 1_000_000);
	const feeToken = p.feeToken.toUpperCase() === 'HBAR' ? ZERO : toEvm(p.feeToken);
	let entryFee, feeLabel;
	if (feeToken === ZERO) {
		entryFee = Number(new Hbar(Number(p.entryFee), HbarUnit.Hbar).toTinybars());
		feeLabel = `${p.entryFee} HBAR (${entryFee} tinybar)`;
	} else {
		const td = await getTokenDetails(env, p.feeToken);
		entryFee = Math.floor(Number(p.entryFee) * (10 ** Number(td.decimals)));
		feeLabel = `${p.entryFee} ${td.symbol} (${entryFee} base, ${td.decimals}dp)`;
	}
	return { winRate, feeToken, entryFee, feeLabel, royalties: p.royalties || [] };
}

async function poolCount(iface) {
	let n = 0;
	while (n < 100) {
		try { await queryContract(env, contractId, iface, 'getPoolBasicInfo', [n], operatorId); n++; }
		catch { return n; }
	}
	return n;
}

async function main() {
	const cfgPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
	if (!cfgPath || !fs.existsSync(cfgPath)) { console.error('❌ config file not found. Pass a JSON path.'); process.exit(1); }
	const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
	if (!Array.isArray(cfg.pools) || !cfg.pools.length) { console.error('❌ config has no pools[]'); process.exit(1); }

	const client = createClient(env, operatorId, operatorKey);
	const iface = loadInterface('LazyLotto');
	try {
		console.log(`\n=== BATCH CREATE POOLS  (${env})  contract ${contractId} ===`);
		console.log(`operator ${operatorId}  |  ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}  |  config ${cfgPath}\n`);

		const isAdmin = (await queryContract(env, contractId, iface, 'isAdmin', ['0x' + operatorId.toSolidityAddress()], operatorId))[0];
		if (!isAdmin) { console.error('❌ operator is not an admin'); process.exit(1); }

		// resolve + validate all first (fail fast before any tx)
		const resolved = [];
		for (const p of cfg.pools) resolved.push({ p, r: await resolvePool(p) });

		// probe live on-chain state — done in BOTH dry-run and execute
		const count = await poolCount(iface);
		const startBurn = Number((await queryContract(env, contractId, iface, 'burnPercentage', [], operatorId))[0]);
		console.log(`on-chain now: ${count} pool(s) exist, global burnPercentage ${startBurn}\n`);

		// build + print the exact plan execute will follow (skip / create / burn changes)
		console.log('PLAN:');
		let simBurn = startBurn, simCount = count, toCreate = 0;
		const plan = [];
		for (const { p, r } of resolved) {
			if (p.expectedPoolId < simCount) {
				plan.push({ p, r, action: 'skip' });
				console.log(`  #${p.expectedPoolId} ${p.name} [${p.symbol}]  ──►  SKIP (already on-chain)`);
				continue;
			}
			if (p.expectedPoolId !== simCount) throw new Error(`ordering gap: next on-chain poolId is ${simCount} but config expects ${p.expectedPoolId}`);
			const burnNote = simBurn !== p.burnPercentage ? `  [setBurn ${simBurn}→${p.burnPercentage}]` : '';
			simBurn = p.burnPercentage; simCount++; toCreate++;
			plan.push({ p, r, action: 'create' });
			console.log(`  #${p.expectedPoolId} ${p.name} [${p.symbol}]  ──►  CREATE   win ${p.winRatePercent}%  entry ${r.feeLabel}${burnNote}`);
			console.log(`       ticketCID ${p.ticketCID}`);
			console.log(`       winCID    ${p.winCID}`);
		}
		console.log(`\nSummary: ${toCreate} to CREATE, ${plan.length - toCreate} to SKIP.  Cost ~${toCreate * 40} HBAR.  Final global burn will be ${simBurn}.`);

		if (DRY_RUN) { console.log('\n✅ DRY-RUN only — the plan above is exactly what execute would do. No transactions sent.\n'); return; }
		if (toCreate === 0) { console.log('\nNothing to create — all configured pools already exist.\n'); return; }

		const go = await prompt(`\nType CREATE to create ${toCreate} pool(s) on ${env.toUpperCase()}: `);
		if (go.trim() !== 'CREATE') { console.log('❌ Cancelled.'); return; }

		let curBurn = startBurn, cnt = count;
		const created = [];
		for (const { p, r, action } of plan) {
			if (action === 'skip') { console.log(`⏭️  #${p.expectedPoolId} ${p.name} — skipped (exists)`); continue; }
			if (p.expectedPoolId !== cnt) throw new Error(`ordering gap at exec: on-chain ${cnt} vs expected ${p.expectedPoolId}`);

			if (curBurn !== p.burnPercentage) {
				console.log(`   setBurnPercentage ${curBurn} -> ${p.burnPercentage}`);
				const br = await executeContractFunction({ contractId, iface, client, functionName: 'setBurnPercentage', params: [p.burnPercentage], gas: 150_000, payableAmount: 0 });
				if (!br.success) throw new Error(`setBurnPercentage failed: ${br.error}`);
				curBurn = p.burnPercentage;
			}

			console.log(`🔨 creating #${p.expectedPoolId} ${p.name}...`);
			const args = [p.name, p.symbol, p.memo, r.royalties, p.ticketCID, p.winCID, r.winRate, r.entryFee, r.feeToken];
			let gas;
			try { gas = Math.floor((await estimateGas(env, contractId, iface, operatorId, 'createPool', args, 800_000, Number(new Hbar(40).toTinybars()))).gasLimit * 1.2); }
			catch { gas = 1_500_000; }
			const res = await executeContractFunction({ contractId, iface, client, functionName: 'createPool', params: args, gas: Math.max(gas, 900_000), payableAmount: 40 });
			if (!res.success) throw new Error(`createPool failed: ${res.error}`);

			const newId = Number(res.results?.[0]);
			if (newId !== p.expectedPoolId) throw new Error(`ABORT: created poolId ${newId} != expected ${p.expectedPoolId} — stop and inspect before continuing`);
			cnt = newId + 1;
			console.log(`   ✅ poolId #${newId}`);

			if (p.pauseAfterCreate) {
				const pr = await executeContractFunction({ contractId, iface, client, functionName: 'pausePool', params: [newId], gas: 150_000, payableAmount: 0 });
				if (!pr.success) throw new Error(`pausePool #${newId} failed: ${pr.error}`);
				console.log(`   ⏸️  paused`);
			}
			created.push(newId);
		}

		console.log(`\n✅ Done. Created pools: [${created.join(', ')}]  |  global burn now ${curBurn}`);
		console.log('   Next: mint the 27 ticket prizes (grantEntry -> redeemEntriesToNFT as 0.0.697777), then seed prizes.\n');
	}
	catch (e) { console.error('\n❌ Error:', e.message); process.exit(1); }
	finally { if (client) client.close(); }
}

main();
