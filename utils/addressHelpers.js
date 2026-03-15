/**
 * Address & Conversion Helpers
 *
 * Centralized HBAR/token conversion and address resolution.
 * Eliminates 5 different HBAR conversion patterns across the codebase.
 */

const { Hbar } = require('@hashgraph/sdk');
const { homebrewPopulateAccountNum, EntityType } = require('./hederaMirrorHelpers');

/**
 * Convert an EVM address to a Hedera ID (0.0.xxxxx) via mirror node
 * @param {string} env - Environment
 * @param {string} evmAddress - EVM address (0x...)
 * @param {string} [entityType] - EntityType.ACCOUNT, TOKEN, or CONTRACT
 * @returns {Promise<string>} Hedera ID string
 */
async function convertToHederaId(env, evmAddress, entityType) {
	if (!evmAddress || !evmAddress.startsWith('0x')) return evmAddress;
	if (evmAddress === '0x0000000000000000000000000000000000000000') return 'NONE';
	return homebrewPopulateAccountNum(env, evmAddress, entityType || null);
}

/**
 * Format tinybars as a human-readable HBAR string
 * @param {number|bigint|string} tinybars
 * @returns {string} e.g. "1.5 HBAR"
 */
function formatHbar(tinybars) {
	const hbar = Hbar.fromTinybars(tinybars);
	return `${hbar.toString()} HBAR`;
}

/**
 * Convert whole HBAR to tinybars as BigInt (for contract calls expecting uint256)
 * @param {number|string} hbarAmount - Amount in whole HBAR
 * @returns {bigint}
 */
function hbarToTinybarsBigInt(hbarAmount) {
	return BigInt(new Hbar(hbarAmount).toTinybars().toString());
}

/**
 * Convert whole HBAR to tinybars as Number (for SDK methods expecting Number)
 * @param {number|string} hbarAmount - Amount in whole HBAR
 * @returns {number}
 */
function hbarToTinybarsNumber(hbarAmount) {
	return Math.floor(Number(new Hbar(hbarAmount).toTinybars().toString()));
}

/**
 * Convert whole token units to base units (e.g. 100 LAZY with 1 decimal -> 1000)
 * @param {number|string} amount - Amount in whole units
 * @param {number} decimals - Token decimal places
 * @returns {bigint}
 */
function tokenToBaseUnits(amount, decimals) {
	return BigInt(Math.floor(Number(amount) * (10 ** decimals)));
}

/**
 * Convert base units to display string (e.g. 1000 with 1 decimal -> "100.0 LAZY")
 * @param {bigint|number|string} baseUnits - Amount in base units
 * @param {number} decimals - Token decimal places
 * @param {string} [symbol] - Optional token symbol to append
 * @returns {string}
 */
function baseUnitsToDisplay(baseUnits, decimals, symbol) {
	const divisor = 10 ** decimals;
	const value = Number(baseUnits) / divisor;
	const formatted = decimals > 0 ? value.toFixed(decimals) : value.toString();
	return symbol ? `${formatted} ${symbol}` : formatted;
}

module.exports = {
	convertToHederaId,
	formatHbar,
	hbarToTinybarsBigInt,
	hbarToTinybarsNumber,
	tokenToBaseUnits,
	baseUnitsToDisplay,
	// Re-export EntityType for convenience
	EntityType,
};
