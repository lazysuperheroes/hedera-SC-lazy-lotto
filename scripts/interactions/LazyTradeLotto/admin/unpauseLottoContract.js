/**
 * LazyTradeLotto - Unpause Contract (Admin)
 *
 * Unpauses the LazyTradeLotto contract to allow lotto rolls again.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/unpauseLottoContract.js 0.0.LTL
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/unpauseLottoContract.js 0.0.LTL --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/unpauseLottoContract.js --multisig-help
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
const {
	ContractId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

const contractName = 'LazyTradeLotto';

const { operatorId, operatorKey, env } = getEnvConfig();
let client;

const main = async () => {
	// Check for multi-sig help request
	if (checkMultiSigHelp()) {
		process.exit(0);
	}

	console.log('\n-Using ENVIRONMENT:', env);

	// Initialize client
	client = createClient(env, operatorId, operatorKey);

	const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
	if (args.length !== 1 || getArgFlag('h')) {
		console.log('Usage: unpauseLottoContract.js 0.0.LTL');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
		return;
	}

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	// First check if the contract is already unpaused using mirror node
	try {
		const isPausedResult = await queryContract(env, contractId, ltlIface, 'isPaused', [], operatorId);
		const isPaused = isPausedResult[0];

		if (!isPaused) {
			console.log('\nThe contract is already active (not paused). No action needed.');
			return;
		}
	}
	catch (error) {
		console.log('Warning: Could not check pause status via mirror node:', error.message);
		// Continue with unpause operation anyway
	}

	const proceed = readlineSync.keyInYNStrict('Are you sure you want to unpause the LazyTradeLotto contract?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Additional confirmation for safety
	const confirmProceed = readlineSync.keyInYNStrict('This will allow users to start rolling the lotto again. Are you absolutely sure?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Unpause the contract using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'unpause',
		params: [],
		gas: 400_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error unpausing the contract:', result.error);
		return;
	}

	console.log('\nContract unpaused successfully!');
	const txId = result.receipt?.transactionId?.toString() || result.record?.transactionId?.toString() || 'N/A';
	console.log('Transaction ID:', txId);
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
