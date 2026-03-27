/**
 * LazyLotto Prize Config Generator
 *
 * Generates batch prize JSON from a recipe file. Takes tier definitions
 * and NFT inventory, assigns serials to tiers, and outputs a file
 * compatible with addPrizesBatch.js.
 *
 * Usage:
 *   node generatePrizeConfig.js -f recipe.json
 *   node generatePrizeConfig.js -f recipe.json -o output.json
 *   node generatePrizeConfig.js -f recipe.json -dry          # validate only
 *   node generatePrizeConfig.js -f recipe.json -shuffle       # randomize serial assignment
 *
 * Recipe format: see recipes/lazyLounge-stage1.json for a complete template.
 *
 * Workflow:
 *   1. Mint free-roll tickets:  buyAndRedeemEntry.js → note serial numbers
 *   2. Copy a recipe template:  cp recipes/lazyLounge-stage1.json my-config.json
 *   3. Fill in token addresses and serial numbers in your config
 *   4. Generate:                node generatePrizeConfig.js -f my-config.json
 *   5. Review output file
 *   6. Dry run:                 node addPrizesBatch.js -f <output>.json -dry
 *   7. Upload:                  node addPrizesBatch.js -f <output>.json
 */

const fs = require('fs');
const path = require('path');
const { getArgFlag, getArg } = require('../../../../utils/nodeHelpers');

function main() {
	const filePath = getArg('f') || getArg('-file');
	const outputPath = getArg('o') || getArg('-output');
	const dryRun = getArgFlag('dry');
	const shuffle = getArgFlag('shuffle');

	if (!filePath) {
		console.error('❌ Usage: node generatePrizeConfig.js -f <recipe.json> [-o output.json] [-dry] [-shuffle]');
		console.error('\nSee recipes/ directory for template files.');
		process.exit(1);
	}

	console.log('\n🎰 LazyLotto Prize Config Generator');
	console.log('════════════════════════════════════\n');

	// Read recipe
	let recipe;
	try {
		const raw = fs.readFileSync(filePath, 'utf-8');
		recipe = JSON.parse(raw);
	}
	catch (error) {
		console.error(`❌ Error reading recipe: ${error.message}`);
		process.exit(1);
	}

	// Validate structure
	if (recipe.poolId === undefined && recipe.poolId !== 0) {
		console.error('❌ Missing poolId in recipe');
		process.exit(1);
	}
	if (!recipe.inventory || typeof recipe.inventory !== 'object') {
		console.error('❌ Missing inventory section in recipe');
		process.exit(1);
	}
	if (!Array.isArray(recipe.tiers) || recipe.tiers.length === 0) {
		console.error('❌ Missing or empty tiers array in recipe');
		process.exit(1);
	}

	console.log(`📄 Recipe: ${filePath}`);
	if (recipe._description) console.log(`📝 ${recipe._description}`);
	console.log(`🎯 Pool ID: ${recipe.poolId}`);
	console.log(`📦 Tiers: ${recipe.tiers.length}`);

	// Build serial pools from inventory (deep copy so we can pop from them)
	const serialPools = {};
	const ftTokens = {};
	let hasErrors = false;

	console.log('\n── Inventory ──────────────────────────────────────────');
	for (const [label, inv] of Object.entries(recipe.inventory)) {
		if (!inv.token) {
			console.error(`  ❌ ${label}: missing token address`);
			hasErrors = true;
			continue;
		}

		if (inv.serials) {
			// NFT collection
			serialPools[label] = [...inv.serials];
			if (shuffle) {
				// Fisher-Yates shuffle
				for (let i = serialPools[label].length - 1; i > 0; i--) {
					const j = Math.floor(Math.random() * (i + 1));
					[serialPools[label][i], serialPools[label][j]] = [serialPools[label][j], serialPools[label][i]];
				}
			}
			console.log(`  📋 ${label}: ${inv.token} — ${inv.serials.length} serials available`);
		}
		else {
			// Fungible token (no serials needed)
			ftTokens[label] = inv.token;
			console.log(`  🪙 ${label}: ${inv.token} (fungible)`);
		}
	}

	// Calculate serial requirements per label
	const serialsNeeded = {};
	let totalPrizes = 0;

	for (const tier of recipe.tiers) {
		totalPrizes += tier.count;
		if (tier.nfts) {
			for (const nftReq of tier.nfts) {
				const needed = (nftReq.perPrize || 1) * tier.count;
				serialsNeeded[nftReq.label] = (serialsNeeded[nftReq.label] || 0) + needed;
			}
		}
	}

	console.log(`\n  Total prizes: ${totalPrizes}`);

	// Validate inventory sufficiency
	console.log('\n── Inventory Check ────────────────────────────────────');
	for (const [label, needed] of Object.entries(serialsNeeded)) {
		const available = serialPools[label] ? serialPools[label].length : 0;
		const ok = available >= needed;
		const icon = ok ? '✅' : '❌';
		console.log(`  ${icon} ${label}: need ${needed}, have ${available}`);
		if (!ok) hasErrors = true;
	}

	// Validate FT references
	for (const tier of recipe.tiers) {
		if (tier.ft) {
			const label = tier.ft.label;
			if (!ftTokens[label] && !recipe.inventory[label]) {
				console.error(`  ❌ Tier "${tier.name}" references FT label "${label}" not in inventory`);
				hasErrors = true;
			}
		}
	}

	if (hasErrors) {
		console.error('\n❌ Validation failed. Fix the recipe and try again.');
		process.exit(1);
	}

	console.log('\n✅ Inventory sufficient for all tiers');

	// Generate packages
	console.log('\n── Generating Packages ────────────────────────────────');
	const packages = [];
	const summary = {
		totalHbar: 0,
		totalFt: {},
		totalNfts: {},
		byTier: [],
	};

	for (const tier of recipe.tiers) {
		let tierHbar = 0;
		let tierNfts = 0;

		for (let i = 0; i < tier.count; i++) {
			const pkg = {};

			// Handle HBAR
			if (tier.hbar) {
				let amount;
				if (typeof tier.hbar === 'object' && tier.hbar.min !== undefined) {
					// Range: random integer between min and max
					const min = parseFloat(tier.hbar.min);
					const max = parseFloat(tier.hbar.max);
					amount = String(Math.floor(min + Math.random() * (max - min + 1)));
				}
				else {
					amount = String(tier.hbar);
				}
				pkg.hbar = amount;
				tierHbar += parseFloat(amount);
				summary.totalHbar += parseFloat(amount);
			}

			// Handle FT
			if (tier.ft) {
				const label = tier.ft.label;
				const token = ftTokens[label] || recipe.inventory[label].token;
				pkg.ft = {
					token: token,
					amount: String(tier.ft.amount),
				};
				const ftKey = `${label} (${token})`;
				summary.totalFt[ftKey] = (summary.totalFt[ftKey] || 0) + parseFloat(tier.ft.amount);
			}

			// Handle NFTs
			if (tier.nfts && tier.nfts.length > 0) {
				pkg.nfts = [];
				for (const nftReq of tier.nfts) {
					const perPrize = nftReq.perPrize || 1;
					const inv = recipe.inventory[nftReq.label];
					const pool = serialPools[nftReq.label];
					const serials = pool.splice(0, perPrize);
					tierNfts += serials.length;

					// Check if we already have an entry for this token in this package
					const existingEntry = pkg.nfts.find(n => n.token === inv.token);
					if (existingEntry) {
						existingEntry.serials.push(...serials);
					}
					else {
						pkg.nfts.push({
							token: inv.token,
							serials: serials,
						});
					}

					// Track NFT usage
					const nftKey = `${nftReq.label} (${inv.token})`;
					summary.totalNfts[nftKey] = (summary.totalNfts[nftKey] || 0) + serials.length;
				}
			}

			packages.push(pkg);
		}

		const tierDesc = [];
		if (tier.hbar) tierDesc.push(`${tierHbar} HBAR`);
		if (tier.ft) tierDesc.push(`FT: ${tier.ft.label}`);
		if (tierNfts > 0) tierDesc.push(`${tierNfts} NFTs`);

		console.log(`  ${tier.name}: ${tier.count}x — ${tierDesc.join(' + ')}`);

		summary.byTier.push({
			name: tier.name,
			count: tier.count,
			hbar: tierHbar,
			nfts: tierNfts,
		});
	}

	// Summary
	console.log('\n── Summary ────────────────────────────────────────────');
	console.log(`  Total packages: ${packages.length}`);
	console.log(`  Total HBAR:     ${summary.totalHbar}`);

	if (Object.keys(summary.totalFt).length > 0) {
		console.log('  Fungible tokens:');
		for (const [key, amount] of Object.entries(summary.totalFt)) {
			console.log(`    • ${key}: ${amount}`);
		}
	}

	if (Object.keys(summary.totalNfts).length > 0) {
		console.log('  NFTs:');
		for (const [key, count] of Object.entries(summary.totalNfts)) {
			console.log(`    • ${key}: ${count} serials`);
		}
	}

	// Remaining inventory
	const hasRemaining = Object.entries(serialPools).some(([, pool]) => pool.length > 0);
	if (hasRemaining) {
		console.log('\n  Remaining inventory (unused):');
		for (const [label, pool] of Object.entries(serialPools)) {
			if (pool.length > 0) {
				console.log(`    • ${label}: ${pool.length} serials remaining`);
			}
		}
	}

	// Package type breakdown
	const typeA = packages.filter(p => p.hbar && !p.ft && !p.nfts).length;
	const typeB = packages.filter(p => !p.hbar && p.ft && !p.nfts).length;
	const typeC = packages.filter(p => !p.hbar && !p.ft && p.nfts).length;
	const typeD = packages.filter(p => p.hbar && !p.ft && p.nfts).length;
	const typeE = packages.filter(p => !p.hbar && p.ft && p.nfts).length;

	console.log('\n  Package types:');
	if (typeA) console.log(`    Type A (HBAR only):  ${typeA}`);
	if (typeB) console.log(`    Type B (FT only):    ${typeB}`);
	if (typeC) console.log(`    Type C (NFT only):   ${typeC}`);
	if (typeD) console.log(`    Type D (HBAR+NFT):   ${typeD}`);
	if (typeE) console.log(`    Type E (FT+NFT):     ${typeE}`);

	if (dryRun) {
		console.log('\n🧪 Dry run — no file written. Remove -dry to generate output.\n');
		process.exit(0);
	}

	// Build output
	const output = {
		_generated: new Date().toISOString(),
		_recipe: path.basename(filePath),
		_description: recipe._description || '',
		poolId: recipe.poolId,
		packages: packages,
	};

	// Determine output path
	const outFile = outputPath || `prizes-pool${recipe.poolId}-${path.basename(filePath, '.json')}.json`;

	fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
	console.log(`\n✅ Generated: ${outFile}`);
	console.log(`   ${packages.length} packages for Pool #${recipe.poolId}`);
	console.log(`\nNext steps:`);
	console.log(`   1. Review:  cat ${outFile}`);
	console.log(`   2. Dry run: node addPrizesBatch.js -f ${outFile} -dry`);
	console.log(`   3. Upload:  node addPrizesBatch.js -f ${outFile}\n`);
}

main();
