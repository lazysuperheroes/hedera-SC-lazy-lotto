/**
 * Remove contract user(s) from LazyGasStation
 *
 * Deregisters one or more contract addresses as authorized users of the LazyGasStation,
 * revoking their ability to call refill/payout/burn functions — which can pull $LAZY from
 * any user who granted an allowance to the LGS. Use when retiring a contract (e.g. an old
 * LazyLotto / LazyLottoStorage after a v2 redeploy) so it can no longer draw on the shared
 * gas station that the live contracts also depend on.
 *
 * Requires the operator to be an LGS admin or authorizer (removeContractUser is
 * onlyAdminOrAuthorizer). Run it from the LGS admin key, NOT a plain prize-hub account.
 *
 * Usage:
 *   Single:     node scripts/interactions/LazyGasStation/removeContractUser.js 0.0.CONTRACT
 *   Multiple:   node scripts/interactions/LazyGasStation/removeContractUser.js 0.0.OLD_LOTTO 0.0.OLD_STORAGE
 *   Multi-sig:  node scripts/interactions/LazyGasStation/removeContractUser.js 0.0.CONTRACT --multisig
 *   Help:       node scripts/interactions/LazyGasStation/removeContractUser.js --multisig-help
 *
 * Multi-sig options (each address is executed as its own transaction):
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 */

require('dotenv').config();
const { AccountId, ContractId } = require('@hashgraph/sdk');
const { createClient, getEnvConfig, getContractId } = require('../../../utils/clientFactory');
const { loadInterface } = require('../../../utils/abiLoader');
const { prompt } = require('../../../utils/promptHelpers');
const { queryContract } = require('../../../utils/queryHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../utils/scriptHelpers');

const contractName = 'LazyGasStation';

async function main() {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	const { operatorId, operatorKey, env } = getEnvConfig();
	const lazyGasStationId = getContractId('LAZY_GAS_STATION_CONTRACT_ID');

	// Parse contract address arguments (skip --flags); allow one or many
	let targetInputs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));

	if (targetInputs.length === 0) {
		const single = await prompt('Enter the contract ID to remove as a user (e.g. 0.0.123456): ');
		if (single && single.trim().length > 0) {
			targetInputs = [single.trim()];
		}
	}

	if (targetInputs.length === 0) {
		console.error('❌ At least one contract ID is required.');
		process.exit(1);
	}

	const targets = targetInputs.map(t => ContractId.fromString(t.trim()));

	let client;
	try {
		client = createClient(env, operatorId, operatorKey);
		const lgsIface = loadInterface(contractName);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║        Remove Contract User(s) from LazyGasStation         ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 LazyGasStation: ${lazyGasStationId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}`);
		console.log(`🎯 Contract(s) to remove: ${targets.map(t => t.toString()).join(', ')}\n`);

		displayMultiSigBanner();

		// Current contract users (before)
		const contractUsers = await queryContract(env, lazyGasStationId, lgsIface, 'getContractUsers', [], operatorId);
		const existingUsers = contractUsers[0].map(a => AccountId.fromEvmAddress(0, 0, a).toString());
		console.log(`📋 Current contract users (${existingUsers.length}): ${existingUsers.length > 0 ? existingUsers.join(', ') : '(none)'}\n`);

		let removed = 0;
		for (const target of targets) {
			if (!existingUsers.includes(target.toString())) {
				console.log(`⏭️  ${target.toString()} is not a contract user — skipping.`);
				continue;
			}

			const confirm = await prompt(`❓ Remove ${target.toString()} as a contract user? (yes/no): `);
			if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
				console.log(`🛑 Skipped ${target.toString()}.`);
				continue;
			}

			console.log(`🔨 Removing ${target.toString()}...`);
			const result = await executeContractFunction({
				contractId: lazyGasStationId,
				iface: lgsIface,
				client,
				functionName: 'removeContractUser',
				params: [target.toSolidityAddress()],
				gas: 300_000,
				payableAmount: 0,
			});

			if (!result.success) {
				throw new Error(result.error || `removeContractUser failed for ${target.toString()}`);
			}

			const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
			console.log(`✅ Removed ${target.toString()}  (tx ${txId})\n`);
			removed++;
		}

		// Re-query to confirm (best-effort; mirror may lag a few seconds)
		const after = await queryContract(env, lazyGasStationId, lgsIface, 'getContractUsers', [], operatorId);
		const remainingUsers = after[0].map(a => AccountId.fromEvmAddress(0, 0, a).toString());
		console.log(`📋 Contract users now (${remainingUsers.length}): ${remainingUsers.length > 0 ? remainingUsers.join(', ') : '(none)'}`);
		console.log(`\n✅ Done — removed ${removed} contract user(s).`);
	}
	catch (error) {
		console.error('\n❌ Error:', error.message);
		process.exit(1);
	}
	finally {
		if (client) {
			client.close();
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
