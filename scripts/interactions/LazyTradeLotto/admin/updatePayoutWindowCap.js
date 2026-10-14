/**
 * LazyTradeLotto - Update Payout Window Cap (Admin)
 *
 * Updates payoutWindowCap: the most $LAZY (regular wins + jackpots) the lotto may pay within one
 * 24h window. A winning roll that would exceed it reverts (PayoutCapReached) until the window resets,
 * bounding total loss from a leaked signer key. Set it well above normal daily payouts.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updatePayoutWindowCap.js 0.0.LTL [amount]
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updatePayoutWindowCap.js 0.0.LTL <amount> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updatePayoutWindowCap.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * If no amount is provided, the current window (cap, paid, remaining) will be displayed.
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
		console.log('Usage: updatePayoutWindowCap.js 0.0.LTL [amount]');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       [amount] is the new 24h payout cap (in $LAZY)');
		console.log('');
		console.log('If no amount is provided, the current window will be displayed');
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

	const windowRes = await queryContract(env, contractId, ltlIface, 'getPayoutWindow', [], operatorId);
	const fmt = (v) => Number(v) / (10 ** lazyTokenDecimals);
	console.log('\n-Current Payout Window Cap:', fmt(windowRes[2]), '$LAZY');
	console.log('-Paid in current window:', fmt(windowRes[1]), '$LAZY');
	console.log('-Remaining in current window:', fmt(windowRes[3]), '$LAZY');

	// If no new cap is provided, exit after showing the current value
	if (args.length < 2) {
		console.log('\nTo update the cap, provide a value as the second argument.');
		return;
	}

	const newCap = Number(args[1]);

	if (isNaN(newCap) || newCap <= 0) {
		console.log('ERROR: Payout window cap must be a positive number');
		return;
	}

	console.log('\n-New Payout Window Cap:', newCap, '$LAZY');

	// Calculate the cap with decimals
	const capWithDecimals = Math.floor(newCap * (10 ** lazyTokenDecimals));

	const proceed = readlineSync.keyInYNStrict('Do you want to update the payout window cap?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update the cap using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updatePayoutWindowCap',
		params: [capWithDecimals],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating payout window cap:', result.error);
		return;
	}

	console.log('\nPayout window cap updated successfully!');
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
