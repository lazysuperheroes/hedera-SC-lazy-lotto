/**
 * LazyLotto Self-Drain Pool  ── MIGRATION TOOL (OLD contract only) ──
 *
 * Recovers a pool's prize inventory when the pool CANNOT be closed (outstanding
 * ticket NFTs block closePool). It rigs the OLD contract's PRNG to force wins, then
 * grants free entries to the operator, rolls them, and claims the won prizes — so the
 * full prize set lands in the operator wallet, ready to re-list on v2.
 *
 * Flow (per run, one pool):
 *   1. unpausePool           (adminGrantEntry reverts on a paused pool)
 *   2. setPrng(mock)         (rig randomness)
 *   3. setStaticArray([0])   (every roll wins, picks a prize)
 *   4. loop: adminGrantEntry(self) -> rollBatch(self) -> claimAllPrizes   until prizeCount==0
 *   5. setPrng(real)         (restore)
 *   6. pausePool             (re-lock)
 *
 * Safety:
 *   - Confirms before setup and before the drain loop.
 *   - `--restore-only` jumps straight to step 5+6 (recovery if a prior run died mid-drain).
 *   - Reads + restores the REAL prng that was live before this run.
 *   - TEST THIS ON TESTNET FIRST. It rigs a live PRNG on mainnet.
 *
 * Usage:
 *   ENVIRONMENT=mainnet LAZY_LOTTO_CONTRACT_ID=0.0.10584509 MOCK_PRNG_CONTRACT_ID=0.0.XXXX \
 *     node scripts/interactions/LazyLotto/admin/selfDrainPool.js [--restore-only]
 */

require('dotenv').config();
const { ContractId } = require('@hashgraph/sdk');
const { ethers } = require('ethers');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getSerialsOwned, homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const { executeContractFunction } = require('../../../../utils/scriptHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');
const RESTORE_ONLY = process.argv.includes('--restore-only');
const REAL_PRNG_DEFAULT = process.env.PRNG_CONTRACT_ID || '0.0.10583667';
// safety backstop against a runaway loop
const MAX_LOOP_ITERATIONS = 500;

// Minimal ABI for the mock's control function (avoids needing the mock artifact path).
const mockIface = new ethers.Interface(['function setStaticArray(uint256[] _array) external']);

const toEvm = (idStr) => ContractId.fromString(idStr).toSolidityAddress();

async function readPool(iface) {
	const info = await queryContract(env, contractId, iface, 'getPoolBasicInfo', [POOL_ID], operatorId);
	// [ticketCID, winCID, winRate, entryFee, prizeCount, outstanding, poolTokenId, paused, closed, feeToken]
	return {
		prizeCount: Number(info[4]),
		outstanding: Number(info[5]),
		poolTokenId: info[6],
		paused: info[7],
		closed: info[8],
	};
}

async function exec(iface, target, fn, params, gas) {
	const r = await executeContractFunction({
		contractId: target, iface, client: CLIENT, functionName: fn, params, gas, payableAmount: 0,
	});
	if (!r.success) throw new Error(`${fn} failed: ${r.error || 'unknown'}`);
	return r;
}

async function claimAll(lotto) {
	let g;
	try { g = Math.floor((await estimateGas(env, contractId, lotto, operatorId, 'claimAllPrizes', [], 3_000_000)).gasLimit * 1.5); }
	catch { g = 4_000_000; }
	return exec(lotto, contractId, 'claimAllPrizes', [], Math.max(g, 2_500_000));
}

let POOL_ID; let CLIENT;

async function main() {
	CLIENT = createClient(env, operatorId, operatorKey);
	const lotto = loadInterface('LazyLotto');

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   LazyLotto SELF-DRAIN  (migration — OLD contract only)    ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 Contract:    ${contractId.toString()}`);
	console.log(`👤 Operator:    ${operatorId.toString()}  (prizes land here)\n`);

	try {
		const poolStr = await prompt('Pool ID to drain: ');
		POOL_ID = parseInt(poolStr, 10);
		if (isNaN(POOL_ID) || POOL_ID < 0) throw new Error('invalid pool id');

		const realPrng = (await prompt(`Real PRNG to restore afterwards [${REAL_PRNG_DEFAULT}]: `)).trim() || REAL_PRNG_DEFAULT;

		// ---- RESTORE-ONLY recovery path ----
		if (RESTORE_ONLY) {
			console.log('\n🛟 RESTORE-ONLY: setPrng(real) + pausePool.\n');
			await exec(lotto, contractId, 'setPrng', [toEvm(realPrng)], 120_000);
			console.log('   ✅ PRNG restored to', realPrng);
			await exec(lotto, contractId, 'pausePool', [POOL_ID], 120_000);
			console.log('   ✅ Pool re-paused.');
			return;
		}

		const mockId = (process.env.MOCK_PRNG_CONTRACT_ID
			|| await prompt('Mock PRNG contract ID (from deployMockPrng.js): ')).trim();
		if (!mockId) throw new Error('mock PRNG id required');
		const chunk = parseInt((await prompt('Rolls per chunk [3]: ')).trim() || '3', 10);
		if (isNaN(chunk) || chunk < 1) throw new Error('invalid chunk');

		const before = await readPool(lotto);
		console.log('\n═══ POOL #' + POOL_ID + ' STATE ═══');
		console.log(`  prizes: ${before.prizeCount}  |  outstanding entries: ${before.outstanding}  |  paused: ${before.paused}  |  closed: ${before.closed}`);
		if (before.closed) throw new Error('pool is closed — nothing to drain');
		if (before.prizeCount === 0) {
			console.log('  Nothing to drain (0 prizes).');
			return;
		}

		console.log('\n⚠️  This will: unpause the pool, point the OLD contract PRNG at the mock,');
		console.log(`    force-win all ${before.prizeCount} prizes to ${operatorId.toString()}, restore PRNG ${realPrng}, and re-pause.`);
		const go = await prompt('\nType DRAIN to proceed: ');
		if (go.trim() !== 'DRAIN') {
			console.log('❌ Cancelled.');
			return;
		}

		// ---- SETUP ----
		if (before.paused) {
			console.log('\n1/6 unpausePool...');
			await exec(lotto, contractId, 'unpausePool', [POOL_ID], 120_000);
		}
		console.log('2/6 setPrng(mock)...');
		await exec(lotto, contractId, 'setPrng', [toEvm(mockId)], 120_000);
		console.log('3/6 setStaticArray([0]) on mock (always-win)...');
		await exec(mockIface, ContractId.fromString(mockId), 'setStaticArray', [[0]], 200_000);

		// ---- DRAIN LOOP ----
		console.log('\n4/6 draining (grant → rollBatch → claimAllPrizes)...');
		let remaining = before.prizeCount;
		let iter = 0;
		// (3b) Burn any operator-held ticket NFTs of THIS pool first. rollWithNFT wipes
		// each ticket AND wins a prize on the rigged PRNG (one motion, no graveyard/dust).
		const poolTokenHedera = await homebrewPopulateAccountNum(env, before.poolTokenId, EntityType.TOKEN);
		const heldSerials = (await getSerialsOwned(env, operatorId, poolTokenHedera)) || [];
		if (heldSerials.length) {
			console.log(`   first burning ${heldSerials.length} held ticket NFT(s) of ${poolTokenHedera} (rollWithNFT wipes + wins)...`);
			for (let i = 0; i < heldSerials.length && remaining > 0; i += chunk) {
				const batch = heldSerials.slice(i, i + Math.min(chunk, remaining));
				let rgas;
				try { rgas = Math.floor((await estimateGas(env, contractId, lotto, operatorId, 'rollWithNFT', [POOL_ID, batch], 3_000_000)).gasLimit * 1.5); }
				catch { rgas = 4_000_000; }
				await exec(lotto, contractId, 'rollWithNFT', [POOL_ID, batch], Math.max(rgas, 2_500_000));
				await claimAll(lotto);
				remaining = (await readPool(lotto)).prizeCount;
				console.log(`   held-ticket burns: ${before.prizeCount - remaining}/${before.prizeCount} prizes extracted; ${remaining} remaining`);
			}
			if (heldSerials.length > before.prizeCount) {
				console.log('   ⚠️  more held tickets than prizes — un-rolled tickets are worthless duds (bin them).');
			}
		}

		while (remaining > 0) {
			if (++iter > MAX_LOOP_ITERATIONS) throw new Error('hit MAX_LOOP_ITERATIONS — stopping; re-run to continue');
			const n = Math.min(chunk, remaining);
			await exec(lotto, contractId, 'adminGrantEntry', [POOL_ID, n, operatorId.toSolidityAddress()], 300_000 + n * 60_000);
			// roll ops use a generous multiplier (PRNG + prize handling); estimate then buffer + floor.
			let rollGas;
			try { rollGas = Math.floor((await estimateGas(env, contractId, lotto, operatorId, 'rollBatch', [POOL_ID, n], 3_000_000)).gasLimit * 1.5); }
			catch { rollGas = 4_000_000; }
			await exec(lotto, contractId, 'rollBatch', [POOL_ID, n], Math.max(rollGas, 2_500_000));
			let claimGas;
			try { claimGas = Math.floor((await estimateGas(env, contractId, lotto, operatorId, 'claimAllPrizes', [], 3_000_000)).gasLimit * 1.5); }
			catch { claimGas = 4_000_000; }
			await exec(lotto, contractId, 'claimAllPrizes', [], Math.max(claimGas, 2_500_000));
			remaining = (await readPool(lotto)).prizeCount;
			console.log(`   … ${before.prizeCount - remaining}/${before.prizeCount} prizes drained (iter ${iter})`);
		}

		// ---- RESTORE ----
		console.log('\n5/6 setPrng(real)...');
		await exec(lotto, contractId, 'setPrng', [toEvm(realPrng)], 120_000);
		console.log('6/6 pausePool...');
		await exec(lotto, contractId, 'pausePool', [POOL_ID], 120_000);

		// ---- VERIFY ----
		// The mirror node lags the last two txs (setPrng(real), pausePool) by a few seconds, so a
		// read taken immediately reports stale paused/prng. Re-read until it reflects (or times out),
		// so a genuine failure is real and not just read-after-write lag.
		const expectPrng = toEvm(realPrng).toLowerCase();
		let after; let prngNow; let ok = false;
		for (let t = 0; t < 6; t++) {
			after = await readPool(lotto);
			prngNow = (await queryContract(env, contractId, lotto, 'prng', [], operatorId))[0];
			ok = after.prizeCount === 0 && after.paused && prngNow.slice(2).toLowerCase() === expectPrng;
			if (ok) break;
			await new Promise((r) => setTimeout(r, 3000));
		}
		console.log('\n═══ VERIFY ═══');
		console.log(`  prizes: ${after.prizeCount} (expect 0)  |  paused: ${after.paused} (expect true)`);
		console.log(`  prng now: ${prngNow}  (expect ${toEvm(realPrng)})`);
		console.log(ok ? '\n✅ Pool drained, PRNG restored, pool re-paused.' : '\n⚠️  Verify FAILED — inspect state; you may need --restore-only.');
	}
	catch (error) {
		console.error('\n❌ Error:', error.message);
		console.error('   If PRNG is still the mock / pool still unpaused, re-run with --restore-only.');
		process.exit(1);
	}
	finally {
		if (CLIENT) CLIENT.close();
	}
}

main();
