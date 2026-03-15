/**
 * LazyTradeLotto - Update Maximum Jackpot Threshold (Admin)
 *
 * Updates the maximum threshold for the jackpot pool.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updateMaxJackpotThreshold.js 0.0.LTL [amount]
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updateMaxJackpotThreshold.js 0.0.LTL <amount> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updateMaxJackpotThreshold.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * If no amount is provided, the current maximum threshold will be displayed.
 */

require('dotenv').config();
const {
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { getTokenDetails } = require('../../../../utils/hederaMirrorHelpers');
const {
	executeContractFunction,
	checkMultiSigHelp,
	displayMultiSigBanner,
} = require('../../../../utils/scriptHelpers');

const contractName = 'LazyTradeLotto';
const LAZY_TOKEN_ID = process.env.LAZY_TOKEN_ID;
const LAZY_DECIMAL = parseInt(process.env.LAZY_DECIMALS ?? '1');

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
	if (args.length < 1 || getArgFlag('h')) {
		console.log('Usage: updateMaxJackpotThreshold.js 0.0.LTL [amount]');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       [amount] is the new maximum jackpot threshold (in $LAZY)');
		console.log('');
		console.log('If no amount is provided, the current maximum threshold will be displayed');
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

	// Get the lazy token decimal from mirror node
	let lazyTokenDecimals = LAZY_DECIMAL;
	if (LAZY_TOKEN_ID) {
		const lazyToken = TokenId.fromString(LAZY_TOKEN_ID);
		const lazyTokenDetails = await getTokenDetails(env, lazyToken);
		if (lazyTokenDetails && lazyTokenDetails.decimals !== undefined) {
			lazyTokenDecimals = lazyTokenDetails.decimals;
		}
	}

	// Get current jackpot stats using mirror node
	const lottoStats = await queryContract(env, contractId, ltlIface, 'getLottoStats', [], operatorId);
	const currentJackpot = Number(lottoStats[0]) / (10 ** lazyTokenDecimals);
	const currentMaxThreshold = Number(lottoStats[7]) / (10 ** lazyTokenDecimals);

	console.log('\n-Current Jackpot Pool:', currentJackpot, '$LAZY');
	console.log('-Current Maximum Jackpot Threshold:', currentMaxThreshold, '$LAZY');

	// If no new threshold is provided, exit after showing the current values
	if (args.length < 2) {
		console.log('\nTo update the maximum threshold, provide a value as the second argument.');
		return;
	}

	const newThreshold = Number(args[1]);

	if (isNaN(newThreshold) || newThreshold <= 0) {
		console.log('ERROR: Maximum jackpot threshold must be a positive number');
		return;
	}

	console.log('\n-New Maximum Jackpot Threshold:', newThreshold, '$LAZY');

	// Calculate the threshold with decimals
	const thresholdWithDecimals = Math.floor(newThreshold * (10 ** lazyTokenDecimals));

	const proceed = readlineSync.keyInYNStrict('Do you want to update the maximum jackpot threshold?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update maximum jackpot threshold using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updateMaxJackpotPool',
		params: [thresholdWithDecimals],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating maximum jackpot threshold:', result.error);
		return;
	}

	console.log('\nMaximum jackpot threshold updated successfully!');
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
