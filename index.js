/**
 * @lazysuperheroes/lazy-lotto
 *
 * ABIs and utilities for interacting with the LazyLotto and LazyTradeLotto
 * smart contracts on Hedera.
 *
 * Usage:
 *   const { LazyLottoABI, LazyTradeLottoABI } = require('@lazysuperheroes/lazy-lotto');
 *
 *   // With ethers.js
 *   const contract = new ethers.Contract(address, LazyLottoABI, provider);
 */

// ABIs are loaded via require() so bundlers (webpack, Rollup, esbuild, Vite,
// Next.js, etc.) and serverless runtimes can statically resolve them. The
// `abi/*.js` files are auto-generated from `abi/*.json` by
// `scripts/build-abis.js` (run via `npm run build:abis` or as part of
// `scripts/deployments/extractABI.js`). Do NOT switch this back to
// `fs.readFileSync` — it breaks every bundled and serverless consumer.

// Core LazyLotto ABIs
const LazyLottoABI = require('./abi/LazyLotto.js');
const LazyLottoStorageABI = require('./abi/LazyLottoStorage.js');
const LazyLottoPoolManagerABI = require('./abi/LazyLottoPoolManager.js');

// LazyTradeLotto ABI
const LazyTradeLottoABI = require('./abi/LazyTradeLotto.js');

// Supporting contract ABIs
const LazyGasStationABI = require('./abi/LazyGasStation.js');
const LazyDelegateRegistryABI = require('./abi/LazyDelegateRegistry.js');

// Hedera system ABIs (for reference)
const HederaTokenServiceABI = require('./abi/HederaTokenService.js');
const PrngSystemContractABI = require('./abi/PrngSystemContract.js');

// Contract addresses helper
const ContractAddresses = {
	// Mainnet addresses (to be filled after mainnet deployment)
	mainnet: {
		lazyLotto: null,
		lazyLottoStorage: null,
		lazyLottoPoolManager: null,
		lazyTradeLotto: null,
		lazyGasStation: null,
		lazyDelegateRegistry: null,
		lazyToken: null,
	},
	// Testnet addresses (to be filled after testnet deployment)
	testnet: {
		lazyLotto: null,
		lazyLottoStorage: null,
		lazyLottoPoolManager: null,
		lazyTradeLotto: null,
		lazyGasStation: null,
		lazyDelegateRegistry: null,
		lazyToken: null,
	},
};

/**
 * Get contract addresses for a specific network
 * @param {string} network - 'mainnet' or 'testnet'
 * @returns {Object} Contract addresses for the network
 */
function getAddresses(network) {
	const normalizedNetwork = network.toLowerCase().replace('net', '');
	if (normalizedNetwork === 'main') return ContractAddresses.mainnet;
	if (normalizedNetwork === 'test') return ContractAddresses.testnet;
	throw new Error(`Unknown network: ${network}. Use 'mainnet' or 'testnet'`);
}

// Export everything
module.exports = {
	// LazyLotto system
	LazyLottoABI,
	LazyLottoStorageABI,
	LazyLottoPoolManagerABI,

	// LazyTradeLotto
	LazyTradeLottoABI,

	// Supporting contracts
	LazyGasStationABI,
	LazyDelegateRegistryABI,

	// Hedera system
	HederaTokenServiceABI,
	PrngSystemContractABI,

	// Addresses helper
	ContractAddresses,
	getAddresses,

	// Re-export individual ABIs for destructuring convenience
	abi: {
		LazyLotto: LazyLottoABI,
		LazyLottoStorage: LazyLottoStorageABI,
		LazyLottoPoolManager: LazyLottoPoolManagerABI,
		LazyTradeLotto: LazyTradeLottoABI,
		LazyGasStation: LazyGasStationABI,
		LazyDelegateRegistry: LazyDelegateRegistryABI,
		HederaTokenService: HederaTokenServiceABI,
		PrngSystemContract: PrngSystemContractABI,
	},
};
