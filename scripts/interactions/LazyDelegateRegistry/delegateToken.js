require('dotenv').config();
const {
	AccountId,
	ContractId,
	TokenId,
} = require('@hashgraph/sdk');
const readlineSync = require('readline-sync');
const { createClient, getEnvConfig } = require('../../../utils/clientFactory');
const { loadInterface } = require('../../../utils/abiLoader');
const { contractExecuteFunction } = require('../../../utils/solidityHelpers');
const { getArgFlag } = require('../../../utils/nodeHelpers');

const contractName = 'LazyDelegateRegistry';

const { operatorId, operatorKey, env } = getEnvConfig();
let client;

const main = async () => {
	// Initialize client
	client = createClient(env, operatorId, operatorKey);

	const args = process.argv.slice(2);
	if (args.length != 4 || getArgFlag('h')) {
		console.log('Usage: delegateToken.js 0.0.LDR 0.0.TOKEN <serials> 0.0.TARGET');
		console.log('Example: delegateToken.js 0.0.1234 0.0.5678 1,2,3 0.0.91011');
		return;
	}

	const contractId = ContractId.fromString(args[0]);
	const token = TokenId.fromString(args[1]);
	const serials = args[2].split(',').map(Number);
	const target = AccountId.fromString(args[3]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());
	console.log('\n-Using Token:', token.toString());
	console.log('\n-Using Serial(s):', serials);
	console.log('\n-Delegate to Target:', target.toString());

	// Import ABI
	const ldrIface = loadInterface(contractName);

	const proceed = readlineSync.keyInYNStrict('Do you delegate the token?');
	if (!proceed) {
		console.log('User Aborted');
		return;
	}

	const result = await contractExecuteFunction(
		contractId,
		ldrIface,
		client,
		500_000,
		'delegateNFT',
		[target.toSolidityAddress(), token.toSolidityAddress(), serials],
	);

	if (result[0]?.status?.toString() != 'SUCCESS') {
		console.log('Error delegating token:', result);
		return;
	}

	console.log('Serial(s) Delegated. Transaction ID:', result[2]?.transactionId?.toString());
};


main()
	.then(() => {
		process.exit(0);
	})
	.catch(error => {
		console.error(error);
		process.exit(1);
	});
