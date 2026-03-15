/**
 * Token Helpers - Dynamic token decimal lookup and formatting
 *
 * Eliminates hardcoded LAZY_DECIMALS=8 bugs by looking up decimals from mirror node.
 */

const { getTokenDetails } = require('./hederaMirrorHelpers');

// Cache token decimals to avoid repeated mirror node calls
const decimalsCache = new Map();

/**
 * Get the decimal places for a token via mirror node (cached).
 * @param {string} env - Environment
 * @param {string} tokenId - Token ID (e.g. '0.0.123456')
 * @returns {Promise<number>} Number of decimal places
 */
async function getTokenDecimals(env, tokenId) {
	const cacheKey = `${env}:${tokenId}`;

	if (decimalsCache.has(cacheKey)) {
		return decimalsCache.get(cacheKey);
	}

	const details = await getTokenDetails(env, tokenId);
	if (!details) {
		throw new Error(`Could not fetch token details for ${tokenId}`);
	}

	const decimals = Number(details.decimals);
	decimalsCache.set(cacheKey, decimals);
	return decimals;
}

/**
 * Format a token amount from base units to display string.
 * @param {bigint|number|string} baseUnits - Amount in smallest units
 * @param {number} decimals - Token decimal places
 * @param {string} [symbol] - Optional token symbol
 * @returns {string} Formatted display string
 */
function formatTokenAmount(baseUnits, decimals, symbol) {
	const divisor = 10 ** decimals;
	const value = Number(baseUnits) / divisor;
	const formatted = decimals > 0 ? value.toFixed(decimals) : value.toString();
	return symbol ? `${formatted} ${symbol}` : formatted;
}

/**
 * Get LAZY token decimals from env or mirror node (cached).
 * Prefers LAZY_DECIMALS env var if set, otherwise queries mirror node.
 * @param {string} env - Environment
 * @returns {Promise<number>} LAZY decimal places
 */
async function getLazyDecimals(env) {
	// If env var is set, use it (but default to 1, not 8)
	if (process.env.LAZY_DECIMALS) {
		return parseInt(process.env.LAZY_DECIMALS);
	}

	// Try to look up from mirror node
	if (process.env.LAZY_TOKEN_ID) {
		return getTokenDecimals(env, process.env.LAZY_TOKEN_ID);
	}

	// Fallback: $LAZY uses 1 decimal
	return 1;
}

module.exports = {
	getTokenDecimals,
	formatTokenAmount,
	getLazyDecimals,
};
