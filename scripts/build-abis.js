#!/usr/bin/env node
/**
 * Build ABI JavaScript wrappers from the JSON sources.
 *
 * For each `abi/*.json` file this script writes a sibling `abi/*.js` file
 * containing `module.exports = <abi-array>;`. This lets bundlers
 * (webpack, Rollup, esbuild, Vite, Next.js, etc.) statically resolve the
 * ABIs via `require()` instead of relying on runtime `fs.readFileSync`,
 * which breaks in bundled and serverless environments.
 *
 * Run manually:
 *   node scripts/build-abis.js
 *
 * Or via npm:
 *   npm run build:abis
 *
 * It is also invoked automatically from `scripts/deployments/extractABI.js`
 * after fresh ABIs are extracted from the Hardhat artifacts.
 */

const fs = require('fs');
const path = require('path');

function buildAbis(abiDir) {
	if (!fs.existsSync(abiDir)) {
		throw new Error(`ABI directory not found: ${abiDir}`);
	}

	const entries = fs.readdirSync(abiDir);
	const generated = [];

	for (const entry of entries) {
		if (!entry.endsWith('.json')) continue;

		const jsonPath = path.join(abiDir, entry);
		const jsName = entry.replace(/\.json$/, '.js');
		const jsPath = path.join(abiDir, jsName);

		const raw = fs.readFileSync(jsonPath, 'utf8');
		// Validate that the JSON parses — surface broken ABIs early.
		const abi = JSON.parse(raw);

		const banner = '// AUTO-GENERATED FILE — do not edit.\n'
			+ `// Source: abi/${entry}\n`
			+ '// Regenerate with: npm run build:abis\n';

		const body = `module.exports = ${JSON.stringify(abi, null, 2)};\n`;
		fs.writeFileSync(jsPath, banner + body);
		generated.push(jsName);
	}

	return generated;
}

if (require.main === module) {
	const abiDir = path.resolve(__dirname, '..', 'abi');
	const generated = buildAbis(abiDir);
	console.log(`Generated ${generated.length} ABI module(s) in ${abiDir}`);
	for (const name of generated) {
		console.log(`  - ${name}`);
	}
}

module.exports = { buildAbis };
