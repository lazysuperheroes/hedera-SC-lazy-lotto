/**
 * Client Factory - Centralized Hedera client initialization
 *
 * Eliminates the 15-line if/else client init chain duplicated across 53+ scripts.
 */

const {
	Client,
	AccountId,
	PrivateKey,
	ContractId,
	Hbar,
} = require('@hashgraph/sdk');
require('dotenv').config();

/**
 * Create a Hedera client for the given environment
 * @param {string} env - Environment name (testnet, mainnet, previewnet, local)
 * @param {AccountId} operatorId - Operator account ID
 * @param {PrivateKey} operatorKey - Operator private key
 * @returns {Client} Configured Hedera client
 */
function createClient(env, operatorId, operatorKey) {
	const envUpper = (env || '').toUpperCase();
	let client;

	if (envUpper === 'MAINNET' || envUpper === 'MAIN') {
		client = Client.forMainnet();
	}
	else if (envUpper === 'TESTNET' || envUpper === 'TEST') {
		client = Client.forTestnet();
	}
	else if (envUpper === 'PREVIEWNET' || envUpper === 'PREVIEW') {
		client = Client.forPreviewnet();
	}
	else if (envUpper === 'LOCAL') {
		client = Client.forLocalNode();
	}
	else {
		throw new Error(`Unknown environment: ${env}. Use TESTNET, MAINNET, PREVIEWNET, or LOCAL`);
	}

	client.setOperator(operatorId, operatorKey);
	// Raise the per-transaction fee CAP (not actual cost — the network charges its
	// real fee, far lower). The SDK default is too low for multi-allowance approvals
	// and high-gas contract calls (e.g. NFT-bundle addPrizePackage), which otherwise
	// fail with INSUFFICIENT_TX_FEE. Capped at 20 ℏ — the SDK's setDefaultMaxTransactionFee
	// rejects values above ~21.47 ℏ (int32 tinybar limit).
	client.setDefaultMaxTransactionFee(new Hbar(20));
	return client;
}

/**
 * Read and validate core env vars. Returns parsed Hedera SDK objects.
 * @returns {{ operatorId: AccountId, operatorKey: PrivateKey, env: string }}
 */
function getEnvConfig() {
	const accountId = process.env.ACCOUNT_ID;
	const privateKey = process.env.PRIVATE_KEY;
	const env = process.env.ENVIRONMENT ?? 'testnet';

	if (!accountId) {
		throw new Error('Missing ACCOUNT_ID in .env');
	}
	if (!privateKey) {
		throw new Error('Missing PRIVATE_KEY in .env');
	}

	return {
		operatorId: AccountId.fromString(accountId),
		operatorKey: PrivateKey.fromStringED25519(privateKey),
		env,
	};
}

/**
 * Read a contract ID from an env var, throw if missing.
 * @param {string} envVar - Name of the environment variable (e.g. 'LAZY_LOTTO_CONTRACT_ID')
 * @returns {ContractId}
 */
function getContractId(envVar) {
	const value = process.env[envVar];
	if (!value) {
		throw new Error(`Missing ${envVar} in .env`);
	}
	return ContractId.fromString(value);
}

module.exports = {
	createClient,
	getEnvConfig,
	getContractId,
};
