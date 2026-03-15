require('dotenv').config();
const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
const fs = require('fs');
const readlineSync = require('readline-sync');
const { loadInterface } = require('../../../utils/abiLoader');
const { getEventsFromMirror } = require('../../../utils/hederaMirrorHelpers');
const { getArgFlag } = require('../../../utils/nodeHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify PRIVATE_KEY & ACCOUNT_ID in the .env file');
}

const contractName = 'LazySecureTrade';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify PRIVATE_KEY & ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getLazySecureTradeLogs.js 0.0.LST');
		console.log('       LST is the contract address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Import ABI
	const lstIface = loadInterface(contractName);

	// Call the function to fetch logs
	const logs = await getEventsFromMirror(env, contractId, lstIface);

	const proceed = readlineSync.keyInYNStrict('Do you want to write logs to file?');
	if (!proceed) {
		if (logs) {
			for (const log of logs) {
				console.log(log);
			}
		}
		else { console.log('ERROR: No logs found'); }
		return;
	}

	// Write logs to a text file
	const now = new Date();
	const dateHour = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${now.getHours()}`;
	const outputFile = `./logs/LazySecureTrade-logs-${contractId}-${dateHour}.txt`;
	try {
		fs.writeFileSync(outputFile, logs.join('\n'));
	}
	catch (err) {
		console.error(err);
		console.log('Error writing logs to file - check smart-contracts/logs directory exists');
	}
	console.log(`Logs have been written to ${outputFile}`);
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
