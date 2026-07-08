/**
 * LazyLotto Honor-Grant Runner  ── MIGRATION make-good ──
 *
 * Grants equivalent IN-MEMORY entries on the NEW (v2) contract to the holders of the
 * OLD pools' outstanding ticket NFTs / in-memory entries — one v2 entry per old ticket.
 *
 * Reads a REVIEWED make-good JSON (built from the POST-DRAIN holder snapshot):
 *   [
 *     { "poolId": 2, "recipients": [ { "account": "0.0.4000044", "count": 90 } ] },
 *     { "poolId": 3, "recipients": [ { "account": "0.0.8316", "count": 2 }, ... ] },
 *     { "poolId": 4, "recipients": [ ... ] }
 *   ]
 * `poolId` is the V2 pool id (v2 recreates pools in the same order as old). Team wallets
 * are simply omitted from the JSON. Each recipient is validated on the mirror node.
 *
 * IMPORTANT:
 *   - Point LAZY_LOTTO_CONTRACT_ID at the V2 contract before running this.
 *   - Grants are NOT idempotent — running twice double-grants. Review the JSON first.
 *   - Build the JSON from the definitive POST-DRAIN snapshot (tickets are then frozen).
 *
 * Usage:
 *   node scripts/interactions/LazyLotto/admin/honorGrant.js <makegood.json>
 */

require('dotenv').config();
const fs = require('fs');
const { createClient, getEnvConfig, getContractId } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { prompt } = require('../../../../utils/promptHelpers');
const { estimateGas } = require('../../../../utils/gasHelpers');
const { executeContractFunction } = require('../../../../utils/scriptHelpers');
// reuse mirror validation (typo / contract / dead-account guard)
const { validateRecipient } = require('./grantEntry');

const { operatorId, operatorKey, env } = getEnvConfig();
const contractId = getContractId('LAZY_LOTTO_CONTRACT_ID');

async function main() {
	const file = process.argv[2];
	if (!file || !fs.existsSync(file)) {
		console.error('Usage: node scripts/interactions/LazyLotto/admin/honorGrant.js <makegood.json>');
		process.exit(1);
	}
	const plan = JSON.parse(fs.readFileSync(file, 'utf8'));

	const client = createClient(env, operatorId, operatorKey);
	const lotto = loadInterface('LazyLotto');

	console.log('\n╔════════════════════════════════════════════════════════════╗');
	console.log('║   LazyLotto Honor-Grant  (v2 make-good, in-memory)        ║');
	console.log('╚════════════════════════════════════════════════════════════╝\n');
	console.log(`📍 Environment: ${env.toUpperCase()}`);
	console.log(`📄 v2 Contract: ${contractId.toString()}`);
	console.log(`👤 Operator (admin): ${operatorId.toString()}\n`);

	try {
		// Validate every recipient on the mirror before we grant anything.
		console.log('🔎 Validating recipients...');
		const grants = [];
		for (const pool of plan) {
			for (const r of (pool.recipients || [])) {
				const v = await validateRecipient(env, r.account);
				if (!v.ok) {
					console.log(`   ❌ pool ${pool.poolId}  ${r.account}: ${v.reason}`);
					continue;
				}
				grants.push({ poolId: pool.poolId, account: v.accountId, address: v.address, count: r.count });
				console.log(`   ✅ pool ${pool.poolId}  ${v.accountId}  → ${r.count} entries`);
			}
		}
		if (!grants.length) {
			console.error('\n❌ No valid grants. Aborting.');
			process.exit(1);
		}

		const total = grants.reduce((a, g) => a + g.count, 0);
		const pools = new Set(grants.map(g => g.poolId)).size;
		console.log(`\n═══ SUMMARY ═══\n  ${grants.length} grants · ${total} total in-memory entries · ${pools} pool(s)`);
		console.log('  ⚠️  NOT idempotent — do NOT run this twice against the same v2 pools.');
		if ((await prompt('\nType GRANT to execute: ')).trim() !== 'GRANT') {
			console.log('❌ Cancelled.');
			return;
		}

		console.log('\n🔄 Granting...\n');
		let ok = 0;
		for (const g of grants) {
			try {
				let gas;
				try { gas = Math.floor((await estimateGas(env, contractId, lotto, operatorId, 'adminGrantEntry', [g.poolId, g.count, g.address], 300_000)).gasLimit * 1.3); }
				catch { gas = 400_000; }
				const r = await executeContractFunction({
					contractId, iface: lotto, client, functionName: 'adminGrantEntry',
					params: [g.poolId, g.count, g.address], gas, payableAmount: 0,
				});
				if (r.success) {
					console.log(`   ✅ pool ${g.poolId}  ${g.account}  +${g.count}`);
					ok++;
				}
				else {console.error(`   ❌ pool ${g.poolId}  ${g.account}: ${r.error || 'failed'}`);}
			}
			catch (e) { console.error(`   ❌ pool ${g.poolId}  ${g.account}: ${e.message}`); }
		}
		console.log(`\n═══ RESULT ═══\n  ${ok}/${grants.length} grants succeeded.`);
		if (ok !== grants.length) console.log('  ⚠️  Some failed — DO NOT blindly re-run (double-grant risk). Re-grant only the failed ones with a trimmed JSON.');
	}
	catch (error) {
		console.error('\n❌ Error:', error.message);
		process.exit(1);
	}
	finally {
		if (client) client.close();
	}
}

main();
