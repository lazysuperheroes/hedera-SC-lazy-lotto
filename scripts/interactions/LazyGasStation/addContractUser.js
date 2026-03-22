/**
 * Add a contract user to LazyGasStation
 *
 * Registers a contract address as an authorized user of the LazyGasStation,
 * allowing it to call refill/payout functions (refillLazy, refillHbar, payoutLazy, etc.).
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyGasStation/addContractUser.js 0.0.CONTRACT
 *   Multi-sig:  node scripts/interactions/LazyGasStation/addContractUser.js 0.0.CONTRACT --multisig
 *   Help:       node scripts/interactions/LazyGasStation/addContractUser.js --multisig-help
 *
 * Multi-sig options:
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

	// Parse contract address argument (skip --flags)
	let contractUserInput = process.argv.slice(2).find(arg => !arg.startsWith('--'));

	if (!contractUserInput) {
		contractUserInput = await prompt('Enter the contract ID to add as a user (e.g. 0.0.123456): ');
	}

	if (!contractUserInput || contractUserInput.trim().length === 0) {
		console.error('❌ Contract ID is required.');
		process.exit(1);
	}

	const contractUserId = ContractId.fromString(contractUserInput.trim());

	let client;
	try {
		client = createClient(env, operatorId, operatorKey);
		const lgsIface = loadInterface(contractName);

		console.log('\n╔════════════════════════════════════════════════════════════╗');
		console.log('║          Add Contract User to LazyGasStation               ║');
		console.log('╚════════════════════════════════════════════════════════════╝\n');
		console.log(`📍 Environment: ${env.toUpperCase()}`);
		console.log(`📄 LazyGasStation: ${lazyGasStationId.toString()}`);
		console.log(`👤 Admin: ${operatorId.toString()}`);
		console.log(`🎯 Contract to add: ${contractUserId.toString()}\n`);

		displayMultiSigBanner();

		// Check if already a contract user
		const contractUsers = await queryContract(env, lazyGasStationId, lgsIface, 'getContractUsers', [], operatorId);
		const existingUsers = contractUsers[0].map(a => AccountId.fromEvmAddress(0, 0, a).toString());

		console.log(`📋 Current contract users: ${existingUsers.length > 0 ? existingUsers.join(', ') : '(none)'}`);

		if (existingUsers.includes(contractUserId.toString())) {
			console.log(`\n✅ ${contractUserId.toString()} is already a contract user. No action needed.`);
			return;
		}

		console.log('');
		const confirm = await prompt(`❓ Add ${contractUserId.toString()} as a contract user? (yes/no): `);
		if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
			console.log('🛑 Cancelled.');
			return;
		}

		console.log('\n🔨 Adding contract user...');

		const result = await executeContractFunction({
			contractId: lazyGasStationId,
			iface: lgsIface,
			client,
			functionName: 'addContractUser',
			params: [contractUserId.toSolidityAddress()],
			gas: 300_000,
			payableAmount: 0,
		});

		if (!result.success) {
			throw new Error(result.error || 'Transaction execution failed');
		}

		const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
		console.log(`\n✅ ${contractUserId.toString()} added as a contract user to LazyGasStation!`);
		console.log(`📝 Transaction ID: ${txId}`);
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
