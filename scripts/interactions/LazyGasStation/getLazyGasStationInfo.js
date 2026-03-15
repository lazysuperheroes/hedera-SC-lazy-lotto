require('dotenv').config();
const {
	AccountId,
	ContractId,
} = require('@hashgraph/sdk');
const { loadInterface } = require('../../../utils/abiLoader');
const { queryContract } = require('../../../utils/queryHelpers');
const { getArgFlag } = require('../../../utils/nodeHelpers');

// Get operator from .env file
let operatorId;
try {
	operatorId = AccountId.fromString(process.env.ACCOUNT_ID);
}
catch {
	console.log('ERROR: Must specify ACCOUNT_ID in the .env file');
}

const contractName = 'LazyGasStation';

const env = process.env.ENVIRONMENT ?? null;

const main = async () => {
	// configure the client object
	if (
		operatorId === undefined ||
		operatorId == null
	) {
		console.log(
			'Environment required, please specify ACCOUNT_ID in the .env file',
		);
		process.exit(1);
	}

	const args = process.argv.slice(2);
	if (args.length != 1 || getArgFlag('h')) {
		console.log('Usage: getLazyGasStationInfo.js 0.0.LGS');
		console.log('       LGS is the LazyGasStation address');
		return;
	}

	const contractId = ContractId.fromString(args[0]);

	console.log('\n-Using ENVIRONMENT:', env);
	console.log('\n-Using Operator:', operatorId.toString());
	console.log('\n-Using Contract:', contractId.toString());

	// Import ABI
	const lgsIface = loadInterface(contractName);

	// query the EVM via mirror node
	// 1) getAdmins
	const admins = await queryContract(env, contractId, lgsIface, 'getAdmins', [], operatorId);
	console.log('Admins:', admins[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	// 2) getAuthorizers
	const authorizers = await queryContract(env, contractId, lgsIface, 'getAuthorizers', [], operatorId);
	console.log('Authorizers:', authorizers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));

	// 3) getContractUsers
	const contractUsers = await queryContract(env, contractId, lgsIface, 'getContractUsers', [], operatorId);
	console.log('Contract Users:', contractUsers[0].map((a) => AccountId.fromEvmAddress(0, 0, a).toString()).join(', '));
};

main()
	.then(() => {
		process.exit(0);
	})
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
