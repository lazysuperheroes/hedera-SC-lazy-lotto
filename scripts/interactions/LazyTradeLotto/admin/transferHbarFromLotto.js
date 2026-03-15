/**
 * LazyTradeLotto - Transfer HBAR from Contract (Admin)
 *
 * Withdraws HBAR from the LazyTradeLotto contract to a specified receiver.
 * Only the contract owner can perform this operation.
 *
 * Usage:
 *   Single-sig: node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js 0.0.LTL <receiver> <amount>
 *   Multi-sig:  node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js 0.0.LTL <receiver> <amount> --multisig
 *   Help:       node scripts/interactions/LazyTradeLotto/admin/transferHbarFromLotto.js --multisig-help
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
	AccountId,
	ContractId,
	Hbar,
	HbarUnit,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../../utils/clientFactory');
const { loadInterface } = require('../../../../utils/abiLoader');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { checkMirrorHbarBalance } = require('../../../../utils/hederaMirrorHelpers');
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
	if (args.length !== 3 || getArgFlag('h')) {
		console.log('Usage: transferHbarFromLotto.js 0.0.LTL <receiver> <amount>');
		console.log('       LTL is the LazyTradeLotto contract address');
		console.log('       <receiver> is the Hedera account ID to receive the HBAR');
		console.log('       <amount> is the amount of HBAR to transfer');
		console.log('\nMulti-sig: Add --multisig flag for multi-signature mode');
		console.log('           Use --multisig-help for multi-sig options');
		return;
	}

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	const receiverAccount = AccountId.fromString(args[1]);
	let amount;

	try {
		amount = Number(args[2]);
		if (isNaN(amount) || amount <= 0) {
			throw new Error('Invalid amount');
		}
	}
	catch {
		console.log('ERROR: Amount must be a positive number');
		return;
	}

	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Display multi-sig status if enabled
	displayMultiSigBanner();

	console.log('\n-Receiver:', receiverAccount.toString());
	console.log('\n-Amount to transfer:', amount, 'HBAR');

	// Get contract balance
	const contractBalance = await checkMirrorHbarBalance(env, contractId);

	if (!contractBalance) {
		console.log('ERROR: Could not retrieve contract balance. Exiting.');
		return;
	}

	const contractBalanceInHbar = contractBalance / 100_000_000;
	console.log('\n-Current Contract HBAR Balance:', contractBalanceInHbar, 'HBAR');

	if (contractBalanceInHbar < amount) {
		console.log(`ERROR: Contract only has ${contractBalanceInHbar} HBAR, cannot transfer ${amount} HBAR`);
		return;
	}

	const proceed = readlineSync.keyInYNStrict(`Are you sure you want to transfer ${amount} HBAR from the contract to ${receiverAccount.toString()}?`);
	if (!proceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Additional confirmation for safety
	const confirmProceed = readlineSync.keyInYNStrict('This operation will transfer funds from the contract. Are you absolutely sure?');
	if (!confirmProceed) {
		console.log('Operation canceled by user.');
		return;
	}

	// Convert amount to tinybars
	const amountInTinybars = new Hbar(amount, HbarUnit.Hbar).toTinybars().toNumber();

	// Transfer HBAR using multi-sig aware function
	const result = await executeContractFunction({
		contractId,
		iface: ltlIface,
		client,
		functionName: 'transferHbar',
		params: [receiverAccount.toSolidityAddress(), amountInTinybars],
		gas: 400_000,
		payableAmount: 0,
	});

	if (!result.success) {
		console.log('Error transferring HBAR:', result.error);
		return;
	}

	console.log('\nHBAR transferred successfully!');
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
