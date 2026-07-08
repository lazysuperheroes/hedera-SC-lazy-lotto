/**
 * LazyLotto Mint Ticket Prizes  ── MIGRATION helper ──
 *
 * Mints pool-ticket NFTs to the OPERATOR (self) to use as prize inventory — the free-roll
 * tickets that are prizes in other pools. Per pool it does, as one guarded unit:
 *   associate token (if needed) -> unpausePool -> adminGrantEntry(self) -> redeemEntriesToNFT -> pausePool
 * The pause is in a finally block, so the pool is ALWAYS re-locked even if grant/redeem throws.
 * Reports the exact serials minted (diff of owned serials before/after).
 *
 * Run AS the recipient (must be admin + able to receive the token), e.g. 0.0.697777.
 *
 * Usage:
 *   node scripts/interactions/LazyLotto/admin/mintTicketPrizes.js 2:19 3:8
 *   (pairs are poolId:count; the v2 migration set is 2:19 (Lounge) 3:8 (Whale))
 */

require('dotenv').config();
const { TokenId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getSerialsOwned, checkMirrorBalance, homebrewPopulateAccountNum, EntityType } = require('../../../../utils/hederaMirrorHelpers');
const { associateTokensToAccount } = require('../../../../utils/hederaHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const { executeContractFunction } = require('../../../../utils/scriptHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

function parseMints() {
	const out = [];
	for (const a of process.argv.slice(2)) {
		if (a.startsWith('--')) continue;
		const [pid, cnt] = a.split(':').map((x) => parseInt(x, 10));
		if (isNaN(pid) || isNaN(cnt) || pid < 0 || cnt <= 0) throw new Error(`bad mint arg "${a}" — expected poolId:count`);
		out.push({ poolId: pid, count: cnt });
	}
	return out;
}

async function exec(iface, fn, params, gas) {
	const r = await executeContractFunction({ contractId, iface, client: CLIENT, functionName: fn, params, gas, payableAmount: 0 });
	if (!r.success) throw new Error(`${fn} failed: ${r.error || 'unknown'}`);
	return r;
}

// estimate gas (×1.3) with a generous floor for the variable-cost mint ops
async function execEst(iface, fn, params, base, floor) {
	let gas;
	try { gas = Math.floor((await estimateGas(env, contractId, iface, operatorId, fn, params, base)).gasLimit * 1.3); }
	catch { gas = floor; }
	return exec(iface, fn, params, Math.max(gas, floor));
}

let CLIENT;
async function main() {
	const mints = parseMints();
	if (!mints.length) { console.error('❌ no mints. e.g. node ...mintTicketPrizes.js 2:19 3:8'); process.exit(1); }

	CLIENT = createClient(env, operatorId, operatorKey);
	const iface = loadInterface('LazyLotto');
	const selfAddr = '0x' + operatorId.toSolidityAddress();

	console.log('\n=== MINT TICKET PRIZES ===');
	console.log(`contract ${contractId}  |  recipient (self) ${operatorId}  |  env ${env}`);
	const isAdmin = (await queryContract(env, contractId, iface, 'isAdmin', [selfAddr], operatorId))[0];
	if (!isAdmin) { console.error('❌ operator is not an admin'); process.exit(1); }

	// resolve tokens + show plan
	for (const m of mints) {
		const info = await queryContract(env, contractId, iface, 'getPoolBasicInfo', [m.poolId], operatorId);
		m.token = await homebrewPopulateAccountNum(env, info[6], EntityType.TOKEN);
		m.paused = info[7];
		console.log(`  pool #${m.poolId}: mint ${m.count} of ${m.token}  (currently paused ${m.paused})`);
	}
	const go = await prompt('\nType MINT to unpause→grant→redeem→re-pause each pool: ');
	if (go.trim() !== 'MINT') { console.log('❌ Cancelled.'); CLIENT.close(); return; }

	const results = [];
	for (const m of mints) {
		console.log(`\n── pool #${m.poolId} → ${m.count} × ${m.token} ──`);

		// associate token to self if needed
		if ((await checkMirrorBalance(env, operatorId, m.token)) === null) {
			console.log('   associating token...');
			const a = await associateTokensToAccount(CLIENT, operatorId, operatorKey, [TokenId.fromString(m.token)]);
			if (a !== 'SUCCESS') throw new Error(`associate ${m.token} failed: ${a}`);
			await new Promise((r) => setTimeout(r, 5000));
		}

		const before = new Set((await getSerialsOwned(env, operatorId, m.token)) || []);

		console.log('   unpausePool...');
		await exec(iface, 'unpausePool', [m.poolId], 150_000);
		try {
			console.log('   adminGrantEntry(self)...');
			await execEst(iface, 'adminGrantEntry', [m.poolId, m.count, selfAddr], 1_000_000, Math.max(400_000, 300_000 + m.count * 80_000));
			console.log('   redeemEntriesToNFT...');
			await execEst(iface, 'redeemEntriesToNFT', [m.poolId, m.count], 3_000_000, Math.max(1_500_000, 800_000 + m.count * 300_000));
		}
		finally {
			console.log('   pausePool (guaranteed re-lock)...');
			await exec(iface, 'pausePool', [m.poolId], 150_000);
		}

		await new Promise((r) => setTimeout(r, 6000)); // mirror sync
		const after = (await getSerialsOwned(env, operatorId, m.token)) || [];
		const minted = after.filter((s) => !before.has(s)).sort((x, y) => x - y);
		console.log(`   ✅ minted serials: [${minted.join(', ')}]  (${minted.length}/${m.count})`);
		results.push({ poolId: m.poolId, token: m.token, serials: minted });
	}

	console.log('\n=== MINTED (hand these to the prize-JSON step) ===');
	for (const r of results) console.log(`  pool #${r.poolId}  ${r.token}  serials [${r.serials.join(', ')}]`);
	console.log('');
	CLIENT.close();
}

main().catch((e) => { console.error('\n❌ Error:', e.message); console.error('   If a pool was left unpaused, run: node .../admin/pausePool.js <poolId>'); if (CLIENT) CLIENT.close(); process.exit(1); });
