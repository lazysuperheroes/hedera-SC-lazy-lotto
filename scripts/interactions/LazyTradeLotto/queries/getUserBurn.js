/**
 * LazyTradeLotto - Check User Burn Percentage
 *
 * Checks if a user holds LSH NFTs (Gen1, Gen2, or Mutant) or has delegated access.
 * LSH NFT holders get 0% burn on lottery winnings.
 * Non-holders receive the contract's configured burn percentage.
 *
 * Usage: node queries/getUserBurn.js <contractId> <userAddress>
 * Example: node queries/getUserBurn.js 0.0.123456 0x1234...abcd
 */

require('dotenv').config();
const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
const { loadInterface } = require('../../../../utils/abiLoader');
const { queryContract } = require('../../../../utils/queryHelpers');
const { getArgFlag } = require('../../../../utils/nodeHelpers');
const { homebrewPopulateAccountNum } = require('../../../../utils/hederaMirrorHelpers');

const contractName = 'LazyTradeLotto';
const env = process.env.ENVIRONMENT ?? null;

let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
	process.exit(1);
}

async function convertToHederaId(evmAddress) {
	if (evmAddress === '0x0000000000000000000000000000000000000000') {
		return 'HBAR (zero address)';
	}
	try {
		const hederaId = await homebrewPopulateAccountNum(env, evmAddress);
		return hederaId ? hederaId.toString() : evmAddress;
	}
	catch {
		return evmAddress;
	}
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length < 2 || getArgFlag('h')) {
		console.log('Usage: getUserBurn.js <contractId> <userAddress>');
		console.log('       contractId: LazyTradeLotto contract address (e.g., 0.0.123456)');
		console.log('       userAddress: User EVM address (e.g., 0x1234...abcd) or Account ID (e.g., 0.0.789)');
		console.log('\nChecks burn percentage for the user (0% if LSH NFT holder, contract burn % otherwise).');
		return;
	}

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('-Using Operator:', operatorId.toString());

	// Import ABI
	const ltlIface = loadInterface(contractName);

	const contractId = ContractId.fromString(args[0]);
	let userAddress = args[1];

	// Convert Account ID to EVM address if needed
	if (userAddress.startsWith('0.0.')) {
		const accountId = AccountId.fromString(userAddress);
		userAddress = accountId.toSolidityAddress();
	}

	console.log('-Using Contract:', contractId.toString());
	console.log('-Checking User:', userAddress);

	// Convert EVM address to Hedera ID for display
	const hederaId = await convertToHederaId(userAddress);
	if (hederaId !== userAddress) {
		console.log('  (Hedera ID:', hederaId + ')');
	}

	console.log('\nFetching burn information...\n');

	// Get user's burn percentage
	const userBurnResult = await queryContract(env, contractId, ltlIface, 'getBurnForUser', [userAddress], operatorId);
	const userBurn = userBurnResult[0];

	// Get contract's default burn percentage
	const contractBurnResult = await queryContract(env, contractId, ltlIface, 'burnPercentage', [], operatorId);
	const contractBurn = contractBurnResult[0];

	// Display Results
	console.log('═══════════════════════════════════════════════════════════');
	console.log('           User Burn Percentage Check');
	console.log('═══════════════════════════════════════════════════════════\n');

	console.log('User Address:', userAddress);
	if (hederaId !== userAddress) {
		console.log('   Hedera ID:', hederaId);
	}

	console.log('\nBurn Percentage:', Number(userBurn) + '%');
	console.log('Contract Default:', Number(contractBurn) + '%');

	if (Number(userBurn) === 0) {
		console.log('\nThis user is an LSH NFT holder or has delegated access!');
		console.log('   They receive ZERO burn on lottery winnings.');
		console.log('\n   LSH NFT Benefits:');
		console.log('   - Full prize payouts (0% burn)');
		console.log('   - Valid for Gen1, Gen2, and Gen1 Mutant collections');
		console.log('   - Includes direct ownership and delegated access');
	}
	else {
		console.log('\nThis user is NOT an LSH NFT holder.');
		console.log(`   They will have ${Number(userBurn)}% burn applied to lottery winnings.`);
		console.log('\n   To get 0% burn, acquire LSH NFTs:');
		console.log('   - LSH Gen1');
		console.log('   - LSH Gen2');
		console.log('   - LSH Gen1 Mutant');
		console.log('   Or get delegated access via LazyDelegateRegistry');
	}

	console.log('\n═══════════════════════════════════════════════════════════\n');
}

main()
	.then(() => process.exit(0))
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
