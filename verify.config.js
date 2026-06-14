/**
 * hedera-verify registry — Sourcify source verification for the LazyLotto suite.
 *
 * Maps each production contract to the .env var(s) holding its deployed Hedera
 * ID. Consumed by:
 *   npx hedera-verify harness          # verify every contract whose id is in .env
 *   npx hedera-verify list             # show registry + which ids are set
 *   npx hedera-verify <Name> <id>      # verify one ad-hoc target
 *
 * Verification is read-only (mirror node + public Sourcify, sourcify.dev) — no
 * private key, no gas. ENVIRONMENT selects the chain: main -> 295, test -> 296.
 * Source paths default to contracts/<contractName>.sol; only set `sourceName`
 * when the path differs (e.g. the legacy LAZY minter). Run
 * `npx hedera-verify list-artifacts` to see compiled names + their sourceName.
 */
module.exports = {
	registry: [
		{ contractName: 'LazyGasStation', envVars: ['LAZY_GAS_STATION_CONTRACT_ID'] },
		{ contractName: 'LazyDelegateRegistry', envVars: ['LAZY_DELEGATE_REGISTRY_CONTRACT_ID'] },
		{ contractName: 'PrngSystemContract', envVars: ['PRNG_CONTRACT_ID'] },
		{ contractName: 'LazyLottoStorage', envVars: ['LAZY_LOTTO_STORAGE'] },
		{ contractName: 'LazyLotto', envVars: ['LAZY_LOTTO_CONTRACT_ID'] },
		{ contractName: 'LazyLottoPoolManager', envVars: ['LAZY_LOTTO_POOL_MANAGER_ID'] },
		{ contractName: 'LazyTradeLotto', envVars: ['LAZY_TRADE_LOTTO_CONTRACT_ID'] },
		// $LAZY minter (legacy path). Usually reused on mainnet — verify only if
		// freshly deployed in this environment.
		{
			contractName: 'LAZYTokenCreator',
			envVars: ['LAZY_SCT_CONTRACT_ID'],
			sourceName: 'contracts/legacy/LAZYTokenCreator.sol',
		},
	],
};
