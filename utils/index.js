/**
 * Barrel re-export of all shared utilities
 *
 * Usage:
 *   const { createClient, getEnvConfig, queryContract, loadInterface } = require('../../utils');
 */

const clientFactory = require('./clientFactory');
const addressHelpers = require('./addressHelpers');
const promptHelpers = require('./promptHelpers');
const abiLoader = require('./abiLoader');
const queryHelpers = require('./queryHelpers');
const tokenHelpers = require('./tokenHelpers');

module.exports = {
	// clientFactory
	createClient: clientFactory.createClient,
	getEnvConfig: clientFactory.getEnvConfig,
	getContractId: clientFactory.getContractId,

	// addressHelpers
	convertToHederaId: addressHelpers.convertToHederaId,
	formatHbar: addressHelpers.formatHbar,
	hbarToTinybarsBigInt: addressHelpers.hbarToTinybarsBigInt,
	hbarToTinybarsNumber: addressHelpers.hbarToTinybarsNumber,
	tokenToBaseUnits: addressHelpers.tokenToBaseUnits,
	baseUnitsToDisplay: addressHelpers.baseUnitsToDisplay,
	EntityType: addressHelpers.EntityType,

	// promptHelpers
	prompt: promptHelpers.prompt,
	confirm: promptHelpers.confirm,

	// abiLoader
	loadInterface: abiLoader.loadInterface,
	loadAbi: abiLoader.loadAbi,

	// queryHelpers
	queryContract: queryHelpers.queryContract,
	batchQueryContract: queryHelpers.batchQueryContract,

	// tokenHelpers
	getTokenDecimals: tokenHelpers.getTokenDecimals,
	formatTokenAmount: tokenHelpers.formatTokenAmount,
	getLazyDecimals: tokenHelpers.getLazyDecimals,
};
