/**
 * ABI Loader - Centralized contract interface loading
 *
 * Tries abi/ first (extracted ABIs), then falls back to artifacts/.
 * Caches results so repeated loads are free.
 */

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// Cache loaded interfaces
const interfaceCache = new Map();

/**
 * Load an ethers.Interface for a contract by name.
 * Tries abi/<name>.json first, then artifacts/contracts/<name>.sol/<name>.json.
 *
 * @param {string} contractName - Contract name (e.g. 'LazyLotto', 'LazyLottoPoolManager')
 * @returns {ethers.Interface} The contract interface
 */
function loadInterface(contractName) {
	if (interfaceCache.has(contractName)) {
		return interfaceCache.get(contractName);
	}

	const projectRoot = findProjectRoot();

	// Try abi/ directory first (extracted ABIs - just the ABI array)
	const abiPath = path.join(projectRoot, 'abi', `${contractName}.json`);
	if (fs.existsSync(abiPath)) {
		const abiJson = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
		// abi/ files may be raw ABI arrays or objects with an .abi property
		const abi = Array.isArray(abiJson) ? abiJson : abiJson.abi || abiJson;
		const iface = new ethers.Interface(abi);
		interfaceCache.set(contractName, iface);
		return iface;
	}

	// Fall back to artifacts/ (Hardhat compilation output)
	const artifactPath = path.join(
		projectRoot,
		'artifacts',
		'contracts',
		`${contractName}.sol`,
		`${contractName}.json`,
	);
	if (fs.existsSync(artifactPath)) {
		const artifactJson = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
		const iface = new ethers.Interface(artifactJson.abi);
		interfaceCache.set(contractName, iface);
		return iface;
	}

	throw new Error(
		`Could not find ABI for ${contractName}. ` +
		`Tried: ${abiPath} and ${artifactPath}. ` +
		'Run `npx hardhat compile` first.',
	);
}

/**
 * Load raw ABI JSON (array) for a contract.
 * Useful when you need the ABI array itself, not an Interface.
 *
 * @param {string} contractName - Contract name
 * @returns {Array} The ABI array
 */
function loadAbi(contractName) {
	const iface = loadInterface(contractName);
	return JSON.parse(iface.formatJson());
}

/**
 * Find the project root by looking for package.json
 * @returns {string} Absolute path to project root
 */
function findProjectRoot() {
	let dir = __dirname;
	// Walk up from utils/ to find project root
	for (let i = 0; i < 5; i++) {
		if (fs.existsSync(path.join(dir, 'package.json'))) {
			return dir;
		}
		dir = path.dirname(dir);
	}
	// Fallback: assume utils/ is one level below root
	return path.dirname(__dirname);
}

module.exports = {
	loadInterface,
	loadAbi,
};
