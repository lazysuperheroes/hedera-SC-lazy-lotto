/**
 * LazyLotto Pending-Prize Airdrop  ── MIGRATION make-good (HBAR) ──
 *
 * Pays the won-but-unclaimed HBAR prizes directly to their holders, so they don't have to
 * claim on the retired old contract. Reads migration-snapshots/pending-payouts.json
 * (from identifyPendingWinners.js) and sends each payout in ONE atomic TransferTransaction
 * (all recipients paid, or none). HBAR needs no association — plain sends.
 *
 * Sender = the .env operator (funds the airdrop). Does NOT need the pools unpaused.
 *
 * Usage:
 *   Preview:  node scripts/interactions/LazyLotto/admin/airdropPendingPrizes.js --dry
 *   Send:     node scripts/interactions/LazyLotto/admin/airdropPendingPrizes.js
 *   Custom:   node scripts/interactions/LazyLotto/admin/airdropPendingPrizes.js path/to/payouts.json
 */

require('dotenv').config();
const fs = require('fs');
const { TransferTransaction, Hbar, HbarUnit, AccountId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig } = require('../../../../utils/clientFactory');
const { prompt } = require('../../../../utils/promptHelpers');

const { operatorId, operatorKey, env } = getEnvConfig();
const DRY = process.argv.includes('--dry');

async function main() {
	const pathArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
	const file = pathArg || 'migration-snapshots/pending-payouts.json';
	if (!fs.existsSync(file)) { console.error(`❌ payouts file not found: ${file}`); process.exit(1); }
	const data = JSON.parse(fs.readFileSync(file, 'utf8'));

	// normalise to [{account, tinybar}], dropping zero/invalid
	const rows = (data.payouts || [])
		.map((p) => ({ account: p.account, tinybar: BigInt(p.tinybar || '0') }))
		.filter((p) => p.tinybar > 0n);
	if (!rows.length) { console.error('❌ no non-zero payouts in file'); process.exit(1); }

	// validate account id format up front (bad id => whole atomic tx would fail anyway)
	for (const r of rows) {
		try { AccountId.fromString(r.account); } catch { console.error(`❌ invalid account id: ${r.account}`); process.exit(1); }
	}

	const total = rows.reduce((s, r) => s + r.tinybar, 0n);

	console.log('\n=== PENDING-PRIZE AIRDROP ===');
	console.log(`env ${env}  |  sender (funds it) ${operatorId}  |  ${DRY ? 'DRY' : 'SEND'}  |  file ${file}\n`);
	for (const r of rows) console.log(`  ${r.account}  →  ${new Hbar(r.tinybar.toString(), HbarUnit.Tinybar).toString()}`);
	console.log(`  ────\n  TOTAL: ${new Hbar(total.toString(), HbarUnit.Tinybar).toString()}  to ${rows.length} recipient(s)\n`);

	if (DRY) { console.log('✅ DRY — no transfer sent.\n'); return; }

	const go = await prompt(`Type SEND to airdrop ${new Hbar(total.toString(), HbarUnit.Tinybar).toString()} from ${operatorId}: `);
	if (go.trim() !== 'SEND') { console.log('❌ Cancelled.'); return; }

	const client = createClient(env, operatorId, operatorKey);
	try {
		const tx = new TransferTransaction();
		tx.addHbarTransfer(operatorId, Hbar.fromTinybars(-total));
		for (const r of rows) tx.addHbarTransfer(AccountId.fromString(r.account), Hbar.fromTinybars(r.tinybar.toString()));
		const resp = await tx.execute(client);
		const rec = await resp.getReceipt(client);
		console.log(`\n✅ Airdrop ${rec.status.toString()}  |  tx ${resp.transactionId.toString()}\n`);
	}
	finally { client.close(); }
}

main().catch((e) => { console.error('\n❌ Error:', e.message); process.exit(1); });
