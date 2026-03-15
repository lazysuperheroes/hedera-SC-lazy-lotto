/**
 * LazyTradeLotto - Update Burn Percentage (Admin)
 *
 * Updates the burn percentage applied to non-NFT holders' winnings.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js 0.0.LTL <percentage>
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js 0.0.LTL <percentage> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updateLottoBurnPercentage.js --multisig-help
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
	if (args.length !== 2 || getArgFlag('h')) {
		console.log('Usage: updateLottoBurnPercentage.js 0.0.LTL <percentage>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <percentage> is the new burn percentage (integer from 0-100)');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
		return;
	}

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	const newBurnPercentage = Number(args[1]);

	// Validate percentage
	if (isNaN(newBurnPercentage) || newBurnPercentage < 0 || newBurnPercentage > 100) {
		console.log('ERROR: Burn percentage must be an integer between 0 and 100');
		return;
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	console.log('\n-New Burn Percentage:', newBurnPercentage, '%');

	// Get current burn percentage using mirror node
	const burnPercentageResult = await queryContract(env, contractId, ltlIface, 'burnPercentage', [], operatorId);
	const currentBurnPercentage = Number(burnPercentageResult[0]);

	console.log('\n-Current Burn Percentage:', currentBurnPercentage, '%');

	const proceed = readlineSync.keyInYNStrict('Do you want to update the burn percentage?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update burn percentage using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updateBurnPercentage',
		params: [newBurnPercentage],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating burn percentage:', result.error);
		return;
	}

	console.log('\nBurn percentage updated successfully!');
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
