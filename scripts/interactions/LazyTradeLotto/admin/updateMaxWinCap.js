/**
 * LazyTradeLotto - Update Max Win Cap (Admin)
 *
 * Updates maxWinAmtCap: the largest maxWinAmt the system wallet may sign for a roll. Rolls signed
 * above it revert (BadArguments "Win Cap"), bounding what a leaked or buggy signer can pay out per
 * regular win. Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/updateMaxWinCap.js 0.0.LTL [amount]
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/updateMaxWinCap.js 0.0.LTL <amount> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/updateMaxWinCap.js --multisig-help
 *
 * Multi-sig options:
 *   --multisig                      Enable multi-signature mode
 *   --workflow=interactive|offline  Choose workflow (default: interactive)
 *   --export-only                   Just freeze and export (offline mode)
 *   --signatures=f1.json,f2.json    Execute with collected signatures
 *   --threshold=N                   Require N signatures
 *   --signers=Alice,Bob,Charlie     Label signers for clarity
 *
 * If no amount is provided, the current cap will be displayed.
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
		console.log('Usage: updateMaxWinCap.js 0.0.LTL [amount]');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       [amount] is the new max win cap (in $LAZY)');
		console.log('');
		console.log('If no amount is provided, the current cap will be displayed');
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

	const capRes = await queryContract(env, contractId, ltlIface, 'maxWinAmtCap', [], operatorId);
	const currentCap = Number(capRes[0]) / (10 ** lazyTokenDecimals);
	console.log('\n-Current Max Win Cap:', currentCap, '$LAZY');

	// If no new cap is provided, exit after showing the current value
	if (args.length < 2) {
		console.log('\nTo update the cap, provide a value as the second argument.');
		return;
	}

	const newCap = Number(args[1]);

	if (isNaN(newCap) || newCap <= 0) {
		console.log('ERROR: Max win cap must be a positive number');
		return;
	}

	console.log('\n-New Max Win Cap:', newCap, '$LAZY');

	// Calculate the cap with decimals
	const capWithDecimals = Math.floor(newCap * (10 ** lazyTokenDecimals));

	// The contract requires payoutWindowCap >= maxJackpotPool + maxWinAmtCap (otherwise a full
	// jackpot could never be paid); check here for a clear message instead of a revert.
	const [poolMaxRes, winCapRes, windowCapRes] = await Promise.all([
		queryContract(env, contractId, ltlIface, 'maxJackpotPool', [], operatorId),
		queryContract(env, contractId, ltlIface, 'maxWinAmtCap', [], operatorId),
		queryContract(env, contractId, ltlIface, 'payoutWindowCap', [], operatorId),
	]);
	const caps = { maxJackpotPool: BigInt(poolMaxRes[0]), maxWinAmtCap: BigInt(winCapRes[0]), payoutWindowCap: BigInt(windowCapRes[0]) };
	caps.maxWinAmtCap = BigInt(capWithDecimals);
	if (caps.payoutWindowCap < caps.maxJackpotPool + caps.maxWinAmtCap) {
		const fmt = (v) => Number(v) / (10 ** lazyTokenDecimals);
		console.log(`ERROR: payoutWindowCap (${fmt(caps.payoutWindowCap)}) must be at least maxJackpotPool (${fmt(caps.maxJackpotPool)}) + maxWinAmtCap (${fmt(caps.maxWinAmtCap)}) $LAZY.`);
		console.log('Raise payoutWindowCap first (updatePayoutWindowCap.js).');
		return;
	}

	const proceed = readlineSync.keyInYNStrict('Do you want to update the max win cap?');
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Update the cap using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'updateMaxWinAmtCap',
		params: [capWithDecimals],
		gas: 300_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error updating max win cap:', result.error);
		return;
	}

	console.log('\nMax win cap updated successfully!');
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
