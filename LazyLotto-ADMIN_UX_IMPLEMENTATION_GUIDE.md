# LazyLotto - Admin UX Implementation Guide

**Version:** 1.0
**Last Updated:** January 2026
**Contract Versions:** LazyLotto 23.816 KB | LazyLottoPoolManager 9.396 KB | LazyLottoStorage 11.137 KB
**Target Audience:** Frontend Developers building Admin Dashboards, Operations Teams

---

## Overview

This guide provides comprehensive instructions for building admin-facing applications that interact with the LazyLotto and LazyTradeLotto smart contracts. It covers all admin operations, role management, pool lifecycle, prize management, and multi-signature workflows.

**Related Documentation:**
- [User UX Implementation Guide](./LazyLotto-UX_IMPLEMENTATION_GUIDE.md) - Player-facing flows
- [Security Analysis](./LazyLotto-SECURITY_ANALYSIS.md) - Admin powers and constraints
- [Multi-Sig User Guide](./docs/MULTISIG_USER_GUIDE.md) - Multi-signature operations
- [Business Logic](./LazyLotto-BUSINESS_LOGIC.md) - Game mechanics

---

## Table of Contents

1. [Admin Role System](#admin-role-system)
2. [Contract Architecture](#contract-architecture)
3. [Pool Lifecycle Management](#pool-lifecycle-management)
4. [Prize Management](#prize-management)
5. [Bonus System Configuration](#bonus-system-configuration)
6. [Platform Configuration](#platform-configuration)
7. [Financial Operations](#financial-operations)
8. [LazyTradeLotto Administration](#lazytradelotto-administration)
9. [Multi-Signature Operations](#multi-signature-operations)
10. [Error Handling](#error-handling)
11. [Dashboard Components](#dashboard-components)
12. [Script Reference](#script-reference)

---

## Admin Role System

### Role Hierarchy Overview

LazyLotto implements a **dual-tier administration model** that separates platform-level control from community pool management:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLATFORM LEVEL                                │
│                 (Lazy Superheroes Team)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────┐         ┌─────────────────┐               │
│   │  Global Admin   │         │  Prize Manager  │               │
│   │  (Full Control) │         │ (Partnerships)  │               │
│   └────────┬────────┘         └────────┬────────┘               │
│            │                           │                         │
│   • Contract pause/unpause     • Add prizes to ANY pool          │
│   • Create global pools        • Cannot modify config            │
│   • Set platform fees          • Cannot manage roles             │
│   • Configure bonuses                                            │
│   • Manage all roles                                             │
│   • Withdraw platform proceeds                                   │
│   • Emergency operations                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   COMMUNITY LEVEL                                │
│               (Any User Can Participate)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────────────────────────────────────────────┐       │
│   │              Community Pool Owner                    │       │
│   │         (Per-Pool, Self-Managed)                     │       │
│   └─────────────────────────────────────────────────────┘       │
│                                                                  │
│   • Create community pools (pays creation fee)                   │
│   • Add prizes to THEIR OWN pool only                            │
│   • Pause/unpause their pool                                     │
│   • Close their pool (when empty)                                │
│   • Withdraw pool proceeds (after platform fee)                  │
│   • Transfer pool ownership                                      │
│   • CANNOT modify platform config                                │
│   • CANNOT access other pools                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Role Types

| Role | Scope | Who | Primary Purpose |
|------|-------|-----|-----------------|
| **Global Admin** | Entire Contract | Lazy Superheroes Team | Full platform control, configuration, emergency operations |
| **Prize Manager** | Any Pool | Partnership accounts | Add prizes to pools (for sponsored prizes, partnerships) |
| **Community Pool Owner** | Single Pool | Any user | Create and manage their own lottery pool |

### Key Differences: Global Pools vs Community Pools

| Aspect | Global Pools | Community Pools |
|--------|--------------|-----------------|
| **Created by** | Global Admins | Any user |
| **Creation fee** | None | HBAR + $LAZY fee |
| **Management** | Global Admin team | Pool owner |
| **Prize addition** | Admins + Prize Managers | Owner + Global Prize Managers |
| **Proceeds** | 100% to platform | Owner share (minus platform %) |
| **Platform fee** | N/A | Locked at creation (max 25%) |
| **Listing** | `getGlobalPools()` | `getCommunityPools()` |

### Checking Roles

```javascript
// Check if address is Global Admin (Lazy Superheroes team)
async function isGlobalAdmin(address) {
  return await lazyLottoContract.isAdmin(address);
}

// Check if address is Prize Manager (can add prizes to any pool)
async function isPrizeManager(address) {
  return await lazyLottoContract.isPrizeManager(address);
}

// Check if address owns a specific community pool
async function isPoolOwner(poolId, address) {
  const poolInfo = await poolManager.getPoolInfo(poolId);
  return poolInfo.owner === address;
}

// Get pool type (global vs community)
async function isGlobalPool(poolId) {
  const poolInfo = await poolManager.getPoolInfo(poolId);
  return poolInfo.isGlobalPool;
}

// Get all pools owned by an address
async function getPoolsOwnedBy(ownerAddress) {
  const totalPools = await lazyLottoContract.totalPools();
  const ownedPools = [];

  for (let i = 0; i < totalPools; i++) {
    const poolInfo = await poolManager.getPoolInfo(i);
    if (poolInfo.owner === ownerAddress) {
      ownedPools.push(i);
    }
  }
  return ownedPools;
}
```

### Permission Matrix

| Action | Global Admin | Prize Manager | Pool Owner (own pool) | Pool Owner (other pool) |
|--------|:------------:|:-------------:|:---------------------:|:-----------------------:|
| Create global pool | ✅ | ❌ | ❌ | ❌ |
| Create community pool | ✅ (no fee) | ✅ (pays fee) | ✅ (pays fee) | ✅ (pays fee) |
| Add prizes (any pool) | ✅ | ✅ | ❌ | ❌ |
| Add prizes (own pool) | ✅ | ✅ | ✅ | ❌ |
| Pause pool | ✅ | ❌ | ✅ (own only) | ❌ |
| Close pool | ✅ | ❌ | ✅ (own only) | ❌ |
| Withdraw proceeds | ✅ | ❌ | ✅ (own only) | ❌ |
| Set platform fee | ✅ | ❌ | ❌ | ❌ |
| Configure bonuses | ✅ | ❌ | ❌ | ❌ |
| Manage roles | ✅ | ❌ | ❌ | ❌ |
| Pause contract | ✅ | ❌ | ❌ | ❌ |
| Emergency withdraw | ✅ | ❌ | ❌ | ❌ |

### Admin Methods (Global Admins Only)

```solidity
// Role Management
addAdmin(address) external                    // Add new admin
removeAdmin(address) external                 // Remove admin (protected: can't remove last admin)
addPrizeManager(address) external             // Add prize manager
removePrizeManager(address) external          // Remove prize manager
addGlobalPrizeManager(address) external       // Add to global prize managers list

// Query Methods
isAdmin(address) → bool
isPrizeManager(address) → bool
```

### Role Management UI

```jsx
function RoleManagement({ contractAddress }) {
  const [admins, setAdmins] = useState([]);
  const [prizeManagers, setPrizeManagers] = useState([]);

  return (
    <AdminPanel>
      <Section title="Administrators">
        <RoleList
          roles={admins}
          onAdd={addAdmin}
          onRemove={removeAdmin}
          canRemove={admins.length > 1} // Prevent removing last admin
        />
        <WarningBanner>
          Cannot remove the last administrator.
          At least one admin must remain.
        </WarningBanner>
      </Section>

      <Section title="Prize Managers">
        <RoleList
          roles={prizeManagers}
          onAdd={addPrizeManager}
          onRemove={removePrizeManager}
        />
        <InfoBox>
          Prize managers can add prizes to any pool but cannot
          modify configuration or manage other roles.
        </InfoBox>
      </Section>
    </AdminPanel>
  );
}
```

---

## Contract Architecture

### Three-Contract System

```
┌─────────────────────┐
│     LazyLotto       │ ← Admin dashboard primary interface
│   (Execution)       │   All admin functions exposed here
└──────────┬──────────┘
           │
           ├─────────► ┌───────────────────────┐
           │           │ LazyLottoPoolManager  │ ← Pool creation fees, ownership
           │           │   (Authorization)      │   Community pool management
           │           └───────────────────────┘
           │
           └─────────► ┌───────────────────────┐
                       │ LazyLottoStorage      │ ← Token custody (internal only)
                       │   (Treasury)           │   Never call directly
                       └───────────────────────┘
```

### Key Addresses for Admin Dashboard

```javascript
async function getContractAddresses() {
  const storageAddress = await lazyLottoContract.storageContract();
  const poolManagerAddress = await lazyLottoContract.poolManager();
  const gasStationAddress = await lazyLottoContract.lazyGasStation();
  const prngAddress = await lazyLottoContract.prngAddress();

  return {
    lazyLotto: LAZY_LOTTO_CONTRACT_ID,
    storage: storageAddress,
    poolManager: poolManagerAddress,
    gasStation: gasStationAddress,
    prng: prngAddress
  };
}
```

---

## Pool Lifecycle Management

### Pool States

```
┌─────────────┐
│   ACTIVE    │ ← Normal operation (purchases, rolls enabled)
└──────┬──────┘
       │ pausePool()
       ▼
┌─────────────┐
│   PAUSED    │ ← Purchases disabled, rolls/claims still work
└──────┬──────┘
       │ unpausePool()     │ closePool()
       ▼                   ▼
┌─────────────┐     ┌─────────────┐
│   ACTIVE    │     │   CLOSED    │ ← Permanent, cannot reopen
└─────────────┘     └─────────────┘
                           │ removePrizes()
                           ▼
                    ┌─────────────┐
                    │ PRIZES      │ ← Admin recovers unclaimed prizes
                    │ WITHDRAWN   │
                    └─────────────┘
```

### Creating a Pool

```javascript
async function createPool(params) {
  const {
    ticketCID,           // IPFS CID for ticket image
    winCID,              // IPFS CID for win animation
    winRateThousandthsOfBps, // Win rate (100_000_000 = 100%)
    entryFee,            // Entry cost in smallest unit
    feeToken,            // address(0) for HBAR, token address for HTS
    prizes,              // Initial prize packages
    poolTokenName,       // NFT collection name
    poolTokenSymbol,     // NFT collection symbol
    poolTokenMemo        // NFT collection memo
  } = params;

  // Calculate HBAR needed for pool creation
  const [hbarFee, lazyFee] = await poolManager.getCreationFees();
  const isGlobalAdmin = await contract.isAdmin(walletAddress);

  // Global admins bypass creation fees
  const requiredHbar = isGlobalAdmin ? 0 : hbarFee;

  const tx = await contract.createPool(
    ticketCID,
    winCID,
    winRateThousandthsOfBps,
    entryFee,
    feeToken,
    prizes,
    poolTokenName,
    poolTokenSymbol,
    poolTokenMemo,
    { value: requiredHbar }
  );

  const receipt = await tx.wait();
  const poolCreatedEvent = receipt.events.find(e => e.event === 'PoolCreated');
  const newPoolId = poolCreatedEvent.args.poolId;

  return newPoolId;
}
```

### Pool Creation UI Flow

```jsx
function CreatePoolWizard() {
  const [step, setStep] = useState(1);
  const [poolConfig, setPoolConfig] = useState({});

  const steps = [
    { title: 'Basic Info', component: <PoolBasicInfo /> },
    { title: 'Win Rate', component: <WinRateConfig /> },
    { title: 'Entry Fee', component: <EntryFeeConfig /> },
    { title: 'Initial Prizes', component: <PrizeConfig /> },
    { title: 'Review', component: <PoolReview /> },
  ];

  return (
    <Wizard steps={steps} currentStep={step}>
      {/* Step 1: Basic Info */}
      <PoolBasicInfo
        onSubmit={(data) => {
          setPoolConfig(prev => ({ ...prev, ...data }));
          setStep(2);
        }}
      />

      {/* Step 2: Win Rate */}
      <WinRateConfig
        onSubmit={(winRate) => {
          setPoolConfig(prev => ({ ...prev, winRateThousandthsOfBps: winRate }));
          setStep(3);
        }}
      >
        <WinRateSlider
          min={0}
          max={100_000_000}
          format={formatWinRate}
        />
        <WinRatePresets>
          <PresetButton value={1_000_000}>1%</PresetButton>
          <PresetButton value={5_000_000}>5%</PresetButton>
          <PresetButton value={10_000_000}>10%</PresetButton>
        </WinRatePresets>
      </WinRateConfig>

      {/* Step 3: Entry Fee */}
      <EntryFeeConfig>
        <TokenSelector
          options={['HBAR', 'Custom Token']}
          onSelect={setFeeToken}
        />
        <AmountInput
          label="Entry Fee"
          token={feeToken}
        />
      </EntryFeeConfig>

      {/* Step 4: Initial Prizes */}
      <PrizeConfig>
        <PrizeBuilder
          onAddPrize={addPrize}
          prizes={poolConfig.prizes || []}
        />
      </PrizeConfig>

      {/* Step 5: Review & Create */}
      <PoolReview config={poolConfig}>
        <CostSummary>
          <FeeRow label="Creation Fee (HBAR)">{formatHbar(hbarFee)}</FeeRow>
          <FeeRow label="Creation Fee ($LAZY)">{formatLazy(lazyFee)}</FeeRow>
          <FeeRow label="Estimated Gas">{estimatedGas}</FeeRow>
        </CostSummary>
        <CreateButton onClick={createPool}>
          Create Pool
        </CreateButton>
      </PoolReview>
    </Wizard>
  );
}
```

### Pausing/Unpausing Pools

```javascript
// Pause a single pool (prevents new entries, rolls/claims still work)
async function pausePool(poolId) {
  const tx = await contract.pausePool(poolId);
  await tx.wait();
}

// Unpause a single pool
async function unpausePool(poolId) {
  const tx = await contract.unpausePool(poolId);
  await tx.wait();
}

// Pause entire contract (emergency only)
async function pauseContract() {
  const tx = await contract.pause();
  await tx.wait();
}

// Unpause entire contract
async function unpauseContract() {
  const tx = await contract.unpause();
  await tx.wait();
}
```

### Closing Pools

```javascript
async function closePool(poolId) {
  // Pre-flight checks
  const poolInfo = await contract.getPoolBasicInfo(poolId);

  if (poolInfo.outstandingEntries > 0) {
    throw new Error(`Cannot close: ${poolInfo.outstandingEntries} outstanding entries`);
  }

  // Check for pending prizes (would need to be claimed first)
  // Note: closePool will fail if prizes are still claimable

  const tx = await contract.closePool(poolId);
  await tx.wait();
}
```

### Pool Management UI

```jsx
function PoolManagementDashboard({ poolId }) {
  const [poolInfo, setPoolInfo] = useState(null);

  return (
    <Dashboard>
      <PoolStatusCard>
        <StatusIndicator status={poolInfo?.paused ? 'paused' : 'active'} />
        <PoolStats>
          <Stat label="Outstanding Entries">{poolInfo?.outstandingEntries}</Stat>
          <Stat label="Prize Count">{poolInfo?.prizeCount}</Stat>
          <Stat label="Entry Fee">{formatFee(poolInfo)}</Stat>
        </PoolStats>
      </PoolStatusCard>

      <ActionPanel>
        {!poolInfo?.paused && !poolInfo?.closed && (
          <DangerButton onClick={() => pausePool(poolId)}>
            Pause Pool
          </DangerButton>
        )}

        {poolInfo?.paused && !poolInfo?.closed && (
          <SuccessButton onClick={() => unpausePool(poolId)}>
            Unpause Pool
          </SuccessButton>
        )}

        {poolInfo?.outstandingEntries === 0 && !poolInfo?.closed && (
          <DestructiveButton
            onClick={() => closePool(poolId)}
            requireConfirmation
            confirmMessage="This action is PERMANENT. The pool cannot be reopened."
          >
            Close Pool Permanently
          </DestructiveButton>
        )}

        {poolInfo?.closed && poolInfo?.prizeCount > 0 && (
          <WarningButton onClick={() => removePrizes(poolId)}>
            Remove Remaining Prizes
          </WarningButton>
        )}
      </ActionPanel>
    </Dashboard>
  );
}
```

---

## Prize Management

### Prize Package Structure

```solidity
struct PrizePackage {
    address token;           // Fungible token (address(0) = HBAR)
    uint256 amount;          // Amount of fungible tokens
    address[] nftTokens;     // NFT collection addresses
    int64[][] nftSerials;    // Serial numbers per collection
}
```

### Adding Prizes

```javascript
// Add single prize package
async function addPrizePackage(poolId, prizePackage) {
  // Validate NFT ownership if applicable
  for (let i = 0; i < prizePackage.nftTokens.length; i++) {
    const nftToken = prizePackage.nftTokens[i];
    const serials = prizePackage.nftSerials[i];

    for (const serial of serials) {
      const owner = await getNFTOwner(nftToken, serial);
      if (owner !== walletAddress) {
        throw new Error(`NFT ${nftToken}#${serial} not owned by caller`);
      }
    }
  }

  // IMPORTANT: Approve storage contract for transfers
  const storageAddress = await contract.storageContract();

  // Approve fungible tokens to storage
  if (prizePackage.token !== ZERO_ADDRESS && prizePackage.amount > 0) {
    await approveToken(prizePackage.token, storageAddress, prizePackage.amount);
  }

  // Approve NFTs to storage
  for (const nftToken of prizePackage.nftTokens) {
    await setNFTApprovalForAll(nftToken, storageAddress, true);
  }

  const tx = await contract.addPrizePackage(
    poolId,
    prizePackage.token,
    prizePackage.amount,
    prizePackage.nftTokens,
    prizePackage.nftSerials,
    { value: prizePackage.token === ZERO_ADDRESS ? prizePackage.amount : 0 }
  );

  await tx.wait();
}

// Add multiple fungible prizes in batch
async function addMultipleFungiblePrizes(poolId, token, amounts) {
  const totalAmount = amounts.reduce((sum, a) => sum + a, 0n);

  const storageAddress = await contract.storageContract();

  if (token !== ZERO_ADDRESS) {
    await approveToken(token, storageAddress, totalAmount);
  }

  const tx = await contract.addMultipleFungiblePrizes(
    poolId,
    token,
    amounts,
    { value: token === ZERO_ADDRESS ? totalAmount : 0 }
  );

  await tx.wait();
}
```

### Prize Builder UI

```jsx
function PrizeBuilder({ poolId, onPrizeAdded }) {
  const [prizeType, setPrizeType] = useState('hbar');
  const [amount, setAmount] = useState('');
  const [selectedNFTs, setSelectedNFTs] = useState([]);

  return (
    <PrizeBuilderPanel>
      <PrizeTypeSelector>
        <TypeOption
          value="hbar"
          selected={prizeType === 'hbar'}
          onClick={() => setPrizeType('hbar')}
        >
          <HbarIcon /> HBAR
        </TypeOption>
        <TypeOption
          value="token"
          selected={prizeType === 'token'}
          onClick={() => setPrizeType('token')}
        >
          <TokenIcon /> HTS Token
        </TypeOption>
        <TypeOption
          value="nft"
          selected={prizeType === 'nft'}
          onClick={() => setPrizeType('nft')}
        >
          <NFTIcon /> NFT
        </TypeOption>
        <TypeOption
          value="combo"
          selected={prizeType === 'combo'}
          onClick={() => setPrizeType('combo')}
        >
          <ComboIcon /> Combo Package
        </TypeOption>
      </PrizeTypeSelector>

      {prizeType === 'hbar' && (
        <HbarPrizeForm>
          <AmountInput
            label="HBAR Amount"
            value={amount}
            onChange={setAmount}
            suffix="HBAR"
          />
        </HbarPrizeForm>
      )}

      {prizeType === 'token' && (
        <TokenPrizeForm>
          <TokenSelector
            label="Select Token"
            onSelect={setSelectedToken}
          />
          <AmountInput
            label="Token Amount"
            value={amount}
            onChange={setAmount}
            decimals={tokenDecimals}
          />
        </TokenPrizeForm>
      )}

      {prizeType === 'nft' && (
        <NFTPrizeForm>
          <NFTCollectionSelector onSelect={setSelectedCollection} />
          <NFTSerialPicker
            collection={selectedCollection}
            selected={selectedNFTs}
            onSelect={setSelectedNFTs}
            filterOwned={true}
          />
        </NFTPrizeForm>
      )}

      {prizeType === 'combo' && (
        <ComboPrizeForm>
          <Section title="Fungible Component">
            <TokenSelector onSelect={setSelectedToken} />
            <AmountInput value={amount} onChange={setAmount} />
          </Section>
          <Section title="NFT Components">
            <NFTMultiSelector
              selected={selectedNFTs}
              onSelect={setSelectedNFTs}
            />
          </Section>
        </ComboPrizeForm>
      )}

      <ApprovalStatus>
        {needsApproval && (
          <ApprovalButton onClick={handleApproval}>
            Approve Tokens for Transfer
          </ApprovalButton>
        )}
      </ApprovalStatus>

      <AddPrizeButton
        onClick={handleAddPrize}
        disabled={!isValid || needsApproval}
      >
        Add Prize Package
      </AddPrizeButton>
    </PrizeBuilderPanel>
  );
}
```

### Batch Prize Upload

```jsx
function BatchPrizeUpload({ poolId }) {
  const [jsonFile, setJsonFile] = useState(null);
  const [prizes, setPrizes] = useState([]);
  const [validationErrors, setValidationErrors] = useState([]);

  const handleFileUpload = async (file) => {
    const content = await file.text();
    const parsed = JSON.parse(content);

    // Validate prize structure
    const errors = validatePrizeArray(parsed);
    setValidationErrors(errors);

    if (errors.length === 0) {
      setPrizes(parsed);
    }
  };

  return (
    <BatchUploadPanel>
      <FileDropzone
        accept=".json"
        onDrop={handleFileUpload}
      >
        <DropzoneContent>
          <UploadIcon />
          <p>Drop prize JSON file here</p>
          <p className="hint">See examples/README.md for format</p>
        </DropzoneContent>
      </FileDropzone>

      {validationErrors.length > 0 && (
        <ValidationErrors>
          {validationErrors.map((err, i) => (
            <ErrorItem key={i}>{err}</ErrorItem>
          ))}
        </ValidationErrors>
      )}

      {prizes.length > 0 && (
        <PrizePreviewTable>
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Amount/Count</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {prizes.map((prize, i) => (
              <PrizePreviewRow key={i} prize={prize} />
            ))}
          </tbody>
        </PrizePreviewTable>
      )}

      <UploadActions>
        <TotalSummary>
          <div>Total HBAR: {calculateTotalHbar(prizes)}</div>
          <div>Total Tokens: {calculateTotalTokens(prizes)}</div>
          <div>Total NFTs: {calculateTotalNFTs(prizes)}</div>
        </TotalSummary>
        <UploadButton
          onClick={() => uploadPrizes(poolId, prizes)}
          disabled={prizes.length === 0 || validationErrors.length > 0}
        >
          Upload {prizes.length} Prizes
        </UploadButton>
      </UploadActions>
    </BatchUploadPanel>
  );
}
```

### Removing Prizes from Closed Pools

```javascript
async function removePrizes(poolId) {
  // Pool must be closed
  const poolInfo = await contract.getPoolBasicInfo(poolId);
  if (!poolInfo.closed) {
    throw new Error('Pool must be closed before removing prizes');
  }

  // Get prize count for gas estimation
  const prizeCount = poolInfo.prizeCount;
  const gasEstimate = 200_000 + (prizeCount * 50_000);

  const tx = await contract.removePrizes(poolId, {
    gasLimit: Math.ceil(gasEstimate * 1.2)
  });

  await tx.wait();
}
```

---

## Bonus System Configuration

### Bonus Types

1. **Time Bonuses** - Active during specific time windows
2. **NFT Holder Bonuses** - Rewards for holding specific NFT collections
3. **$LAZY Balance Bonus** - Rewards for holding minimum $LAZY balance

### Setting Time Bonuses

```javascript
async function setTimeBonus(bonusIndex, startTime, endTime, bonusBps) {
  // bonusBps is in 1/10000ths (e.g., 1_000_000 = 1% boost)
  const tx = await contract.setTimeBonus(
    bonusIndex,
    startTime,   // Unix timestamp
    endTime,     // Unix timestamp
    bonusBps     // Bonus in thousandths of bps
  );
  await tx.wait();
}
```

### Setting NFT Holder Bonuses

```javascript
async function setNFTBonus(nftTokenAddress, bonusBps) {
  const tx = await contract.setNFTBonus(nftTokenAddress, bonusBps);
  await tx.wait();
}
```

### Setting $LAZY Balance Bonus

```javascript
async function setLazyBalanceBonus(threshold, bonusBps) {
  // threshold: minimum $LAZY balance required (in smallest units)
  // bonusBps: bonus amount in thousandths of bps
  const tx = await contract.setLazyBalanceBonus(threshold, bonusBps);
  await tx.wait();
}
```

### Bonus Configuration UI

```jsx
function BonusConfigurationPanel() {
  return (
    <BonusPanel>
      <Section title="Time Bonuses">
        <TimeBonusList>
          {timeBonuses.map((bonus, i) => (
            <TimeBonusEditor
              key={i}
              index={i}
              bonus={bonus}
              onSave={(updated) => setTimeBonus(i, updated)}
              onDelete={() => removeTimeBonus(i)}
            />
          ))}
          <AddTimeBonusButton onClick={addTimeBonus}>
            + Add Time Bonus
          </AddTimeBonusButton>
        </TimeBonusList>
      </Section>

      <Section title="NFT Holder Bonuses">
        <NFTBonusList>
          {nftBonuses.map((bonus, i) => (
            <NFTBonusEditor
              key={i}
              nftToken={bonus.token}
              bonusBps={bonus.bps}
              onUpdate={(bps) => setNFTBonus(bonus.token, bps)}
            />
          ))}
          <AddNFTBonusForm>
            <NFTCollectionInput
              label="NFT Collection Address"
              value={newNFTToken}
              onChange={setNewNFTToken}
            />
            <BpsInput
              label="Bonus (basis points)"
              value={newNFTBps}
              onChange={setNewNFTBps}
            />
            <AddButton onClick={() => setNFTBonus(newNFTToken, newNFTBps)}>
              Add NFT Bonus
            </AddButton>
          </AddNFTBonusForm>
        </NFTBonusList>
      </Section>

      <Section title="$LAZY Balance Bonus">
        <LazyBonusForm>
          <AmountInput
            label="Minimum Balance"
            value={lazyThreshold}
            onChange={setLazyThreshold}
            suffix="$LAZY"
          />
          <BpsInput
            label="Bonus (basis points)"
            value={lazyBps}
            onChange={setLazyBps}
          />
          <SaveButton onClick={() => setLazyBalanceBonus(lazyThreshold, lazyBps)}>
            Save $LAZY Bonus
          </SaveButton>
        </LazyBonusForm>
      </Section>

      <BonusPreview>
        <h4>Bonus Calculation Preview</h4>
        <PreviewCalculator
          timeBonuses={timeBonuses}
          nftBonuses={nftBonuses}
          lazyBonus={{ threshold: lazyThreshold, bps: lazyBps }}
        />
      </BonusPreview>
    </BonusPanel>
  );
}
```

---

## Platform Configuration

### Platform Fee Management

```javascript
// Set platform proceeds percentage (max 25%)
async function setPlatformFee(percentage) {
  if (percentage > 25) {
    throw new Error('Platform fee cannot exceed 25%');
  }

  const tx = await poolManager.setPlatformProceedsPercentage(percentage);
  await tx.wait();
}

// Get current platform fee
async function getPlatformFee() {
  return await poolManager.platformProceedsPercentage();
}
```

### Pool Creation Fees

```javascript
// Set fees for community pool creation
async function setCreationFees(hbarFee, lazyFee) {
  const tx = await poolManager.setCreationFees(hbarFee, lazyFee);
  await tx.wait();
}

// Get current creation fees
async function getCreationFees() {
  const [hbarFee, lazyFee] = await poolManager.getCreationFees();
  return { hbarFee, lazyFee };
}
```

### Burn Percentage

```javascript
// Set burn percentage for $LAZY token operations
async function setBurnPercentage(percentage) {
  const tx = await contract.setBurnPercentage(percentage);
  await tx.wait();
}
```

### PRNG Configuration

The PRNG contract is **immutable** — set once in the LazyLotto constructor and unchangeable after deployment (there is no `setPrng`). Pointing at a different PRNG requires redeploying LazyLotto; there is no admin action or UI for it.

### Platform Config Dashboard

```jsx
function PlatformConfigDashboard() {
  const [config, setConfig] = useState({});

  return (
    <ConfigDashboard>
      <ConfigSection title="Platform Fees">
        <ConfigItem>
          <Label>Platform Proceeds %</Label>
          <PercentageSlider
            value={config.platformFee}
            max={25}
            onChange={setPlatformFee}
          />
          <CurrentValue>{config.platformFee}%</CurrentValue>
          <Hint>
            Maximum 25%. Applies only to NEW pools.
            Existing pools retain their locked fee percentage.
          </Hint>
        </ConfigItem>
      </ConfigSection>

      <ConfigSection title="Pool Creation Fees">
        <ConfigItem>
          <Label>HBAR Fee</Label>
          <HbarInput
            value={config.hbarCreationFee}
            onChange={(val) => setConfig(prev => ({ ...prev, hbarCreationFee: val }))}
          />
        </ConfigItem>
        <ConfigItem>
          <Label>$LAZY Fee</Label>
          <LazyInput
            value={config.lazyCreationFee}
            onChange={(val) => setConfig(prev => ({ ...prev, lazyCreationFee: val }))}
          />
        </ConfigItem>
        <SaveButton onClick={() => setCreationFees(config.hbarCreationFee, config.lazyCreationFee)}>
          Update Creation Fees
        </SaveButton>
      </ConfigSection>

      <ConfigSection title="Token Operations">
        <ConfigItem>
          <Label>$LAZY Burn %</Label>
          <PercentageSlider
            value={config.burnPercentage}
            max={100}
            onChange={setBurnPercentage}
          />
        </ConfigItem>
      </ConfigSection>

      <ConfigSection title="System Contracts">
        <ContractAddressDisplay
          label="PRNG Contract"
          address={config.prngAddress}
          editable={false}
        />
        <ContractAddressDisplay
          label="Storage Contract"
          address={config.storageAddress}
          editable={false}
        />
        <ContractAddressDisplay
          label="Pool Manager"
          address={config.poolManagerAddress}
          editable={false}
        />
      </ConfigSection>
    </ConfigDashboard>
  );
}
```

---

## Community Pool Owner Operations

This section covers operations available to **any user** who creates a community pool. Community pool owners have self-service management capabilities for their own pools only.

### Creating a Community Pool

Community pools allow any user to become a lottery operator. The creator pays creation fees and receives proceeds minus the platform fee.

```javascript
async function createCommunityPool(params) {
  const {
    ticketCID,
    winCID,
    winRateThousandthsOfBps,
    entryFee,
    feeToken,
    prizes,
    poolTokenName,
    poolTokenSymbol,
    poolTokenMemo
  } = params;

  // Get creation fees (community pools pay fees, global admins don't)
  const [hbarFee, lazyFee] = await poolManager.getCreationFees();

  // Ensure user has sufficient $LAZY balance for fee
  if (lazyFee > 0) {
    const lazyBalance = await getLazyBalance(walletAddress);
    if (lazyBalance < lazyFee) {
      throw new Error(`Insufficient $LAZY. Need ${formatLazy(lazyFee)}, have ${formatLazy(lazyBalance)}`);
    }
  }

  const tx = await contract.createPool(
    ticketCID,
    winCID,
    winRateThousandthsOfBps,
    entryFee,
    feeToken,
    prizes,
    poolTokenName,
    poolTokenSymbol,
    poolTokenMemo,
    { value: hbarFee }
  );

  const receipt = await tx.wait();
  const poolId = parsePoolCreatedEvent(receipt);

  return {
    poolId,
    owner: walletAddress,
    isGlobalPool: false,
    platformFeePercentage: await poolManager.platformProceedsPercentage()
  };
}
```

### Community Pool Dashboard

```jsx
function CommunityPoolOwnerDashboard({ ownerAddress }) {
  const [ownedPools, setOwnedPools] = useState([]);

  useEffect(() => {
    loadOwnedPools(ownerAddress).then(setOwnedPools);
  }, [ownerAddress]);

  return (
    <Dashboard>
      <Header>
        <Title>My Community Pools</Title>
        <CreatePoolButton href="/create-pool">
          + Create New Pool
        </CreatePoolButton>
      </Header>

      {ownedPools.length === 0 ? (
        <EmptyState>
          <p>You haven't created any community pools yet.</p>
          <p>Create a pool to start earning from lottery ticket sales!</p>
        </EmptyState>
      ) : (
        <PoolGrid>
          {ownedPools.map(pool => (
            <CommunityPoolCard key={pool.id}>
              <PoolHeader>
                <PoolName>Pool #{pool.id}</PoolName>
                <PoolStatus status={pool.status} />
              </PoolHeader>

              <PoolStats>
                <Stat label="Total Collected">{formatHbar(pool.totalCollected)}</Stat>
                <Stat label="Already Withdrawn">{formatHbar(pool.totalWithdrawn)}</Stat>
                <Stat label="Available to Withdraw">
                  {formatHbar(pool.totalCollected - pool.totalWithdrawn)}
                </Stat>
                <Stat label="Platform Fee">{pool.platformFeePercentage}%</Stat>
              </PoolStats>

              <PoolActions>
                <ActionButton onClick={() => withdrawProceeds(pool.id)}>
                  Withdraw Proceeds
                </ActionButton>
                <ActionButton variant="secondary" onClick={() => managePrizes(pool.id)}>
                  Manage Prizes
                </ActionButton>
                {!pool.paused && (
                  <ActionButton variant="warning" onClick={() => pausePool(pool.id)}>
                    Pause Pool
                  </ActionButton>
                )}
                {pool.paused && (
                  <ActionButton variant="success" onClick={() => unpausePool(pool.id)}>
                    Unpause Pool
                  </ActionButton>
                )}
              </PoolActions>
            </CommunityPoolCard>
          ))}
        </PoolGrid>
      )}

      <RevenueOverview>
        <h3>Revenue Summary</h3>
        <TotalEarnings>
          Total Earnings: {formatHbar(calculateTotalEarnings(ownedPools))}
        </TotalEarnings>
        <PendingWithdrawals>
          Pending Withdrawals: {formatHbar(calculatePendingWithdrawals(ownedPools))}
        </PendingWithdrawals>
      </RevenueOverview>
    </Dashboard>
  );
}
```

### Community Pool Proceeds Withdrawal

```javascript
async function withdrawCommunityPoolProceeds(poolId) {
  // Verify ownership
  const poolInfo = await poolManager.getPoolInfo(poolId);

  if (poolInfo.owner !== walletAddress) {
    throw new Error('You are not the owner of this pool');
  }

  if (poolInfo.isGlobalPool) {
    throw new Error('This is a global pool. Use platform withdrawal instead.');
  }

  // Calculate available
  const available = poolInfo.totalCollected - poolInfo.totalWithdrawn;
  if (available === 0) {
    throw new Error('No proceeds available to withdraw');
  }

  // Platform takes its cut automatically
  const platformCut = (available * poolInfo.platformFeePercentage) / 100;
  const ownerReceives = available - platformCut;

  // Display confirmation
  console.log(`Withdrawing from Pool #${poolId}`);
  console.log(`  Total available: ${formatHbar(available)}`);
  console.log(`  Platform fee (${poolInfo.platformFeePercentage}%): ${formatHbar(platformCut)}`);
  console.log(`  You will receive: ${formatHbar(ownerReceives)}`);

  const tx = await poolManager.requestWithdrawal(poolId);
  await tx.wait();

  return { platformCut, ownerReceives };
}
```

### Transferring Pool Ownership

```javascript
async function transferPoolOwnership(poolId, newOwnerAddress) {
  // Verify current ownership
  const poolInfo = await poolManager.getPoolInfo(poolId);

  if (poolInfo.owner !== walletAddress) {
    throw new Error('You are not the owner of this pool');
  }

  if (newOwnerAddress === ZERO_ADDRESS) {
    throw new Error('Cannot transfer to zero address');
  }

  const tx = await poolManager.transferPoolOwnership(poolId, newOwnerAddress);
  await tx.wait();

  return { previousOwner: walletAddress, newOwner: newOwnerAddress };
}
```

### Community Pool Owner Limitations

Community pool owners should understand these constraints:

```jsx
function CommunityPoolLimitations() {
  return (
    <InfoPanel>
      <h3>What You CAN Do</h3>
      <CanDoList>
        <li>Create community pools (pay creation fee)</li>
        <li>Add prizes to YOUR pool</li>
        <li>Pause/unpause YOUR pool</li>
        <li>Close YOUR pool (when empty)</li>
        <li>Withdraw YOUR pool proceeds</li>
        <li>Transfer pool ownership</li>
      </CanDoList>

      <h3>What You CANNOT Do</h3>
      <CannotDoList>
        <li>Access or modify other users' pools</li>
        <li>Change platform fee (locked at pool creation)</li>
        <li>Configure global bonuses</li>
        <li>Manage platform roles</li>
        <li>Pause the entire contract</li>
        <li>Withdraw from global pools</li>
      </CannotDoList>

      <h3>Important Notes</h3>
      <NotesList>
        <li>
          <strong>Platform fee is locked</strong>: The platform fee percentage
          at pool creation time applies forever. Future fee changes don't affect
          existing pools.
        </li>
        <li>
          <strong>Cannot close with entries</strong>: You must wait for all
          tickets to be rolled before closing a pool.
        </li>
        <li>
          <strong>Prize obligations</strong>: Prizes added to your pool are
          committed and cannot be withdrawn until the pool is closed.
        </li>
      </NotesList>
    </InfoPanel>
  );
}
```

---

## Financial Operations

### Withdrawing Platform Proceeds (Global Admins Only)

```javascript
async function withdrawTokens(tokenAddress, amount, recipient) {
  // Safety check: cannot withdraw below prize obligations
  const storageAddress = await contract.storageContract();
  const storageBalance = await getTokenBalance(storageAddress, tokenAddress);
  const prizeObligations = await contract.ftTokensForPrizes(tokenAddress);

  const availableForWithdrawal = storageBalance - prizeObligations;

  if (amount > availableForWithdrawal) {
    throw new Error(`Cannot withdraw ${amount}. Only ${availableForWithdrawal} available after prize obligations.`);
  }

  if (tokenAddress === ZERO_ADDRESS) {
    // Withdraw HBAR
    const tx = await contract.transferHbarFromStorage(recipient, amount);
    await tx.wait();
  } else {
    // Withdraw HTS token
    const tx = await contract.transferFungible(tokenAddress, recipient, amount);
    await tx.wait();
  }
}
```

### Pool Owner Withdrawals (Community Pools)

```javascript
async function withdrawPoolProceeds(poolId) {
  // Only pool owner can withdraw
  const poolInfo = await poolManager.getPoolInfo(poolId);

  if (poolInfo.owner !== walletAddress) {
    throw new Error('Not pool owner');
  }

  // Calculate available proceeds
  const available = poolInfo.totalCollected - poolInfo.totalWithdrawn;

  // Platform takes its cut automatically
  const platformFee = (available * poolInfo.platformFeePercentage) / 100;
  const ownerReceives = available - platformFee;

  const tx = await poolManager.requestWithdrawal(poolId);
  const receipt = await tx.wait();

  return { platformFee, ownerReceives };
}
```

### Financial Dashboard

```jsx
function FinancialDashboard() {
  const [balances, setBalances] = useState({});
  const [obligations, setObligations] = useState({});

  return (
    <FinanceDashboard>
      <BalanceOverview>
        <BalanceCard token="HBAR">
          <TotalBalance>{formatHbar(balances.hbar)}</TotalBalance>
          <PrizeObligation>{formatHbar(obligations.hbar)}</PrizeObligation>
          <AvailableWithdraw>
            {formatHbar(balances.hbar - obligations.hbar)}
          </AvailableWithdraw>
        </BalanceCard>

        {Object.entries(balances.tokens || {}).map(([token, balance]) => (
          <BalanceCard key={token} token={token}>
            <TotalBalance>{formatToken(balance, token)}</TotalBalance>
            <PrizeObligation>{formatToken(obligations[token], token)}</PrizeObligation>
            <AvailableWithdraw>
              {formatToken(balance - (obligations[token] || 0), token)}
            </AvailableWithdraw>
          </BalanceCard>
        ))}
      </BalanceOverview>

      <WithdrawForm>
        <TokenSelector
          value={selectedToken}
          onChange={setSelectedToken}
          options={Object.keys(balances)}
        />
        <AmountInput
          value={withdrawAmount}
          onChange={setWithdrawAmount}
          max={availableForWithdrawal}
        />
        <RecipientInput
          value={recipient}
          onChange={setRecipient}
          defaultValue={walletAddress}
        />
        <WithdrawButton
          onClick={() => withdrawTokens(selectedToken, withdrawAmount, recipient)}
          disabled={withdrawAmount > availableForWithdrawal}
        >
          Withdraw {formatToken(withdrawAmount, selectedToken)}
        </WithdrawButton>
      </WithdrawForm>

      <TransactionHistory>
        <WithdrawalHistoryTable poolId={null} />
      </TransactionHistory>
    </FinanceDashboard>
  );
}
```

---

## LazyTradeLotto Administration

### Overview

LazyTradeLotto is a separate lottery system triggered by NFT trades, with its own admin functions.

### Admin Functions

```javascript
// Boost jackpot with additional $LAZY
async function boostJackpot(amount) {
  const tx = await tradeLottoContract.boostJackpot(amount);
  await tx.wait();
}

// Update system wallet (for signature validation)
async function updateSystemWallet(newWallet) {
  const tx = await tradeLottoContract.updateSystemWallet(newWallet);
  await tx.wait();
}

// Update jackpot increment (amount added on each loss)
async function updateJackpotIncrement(increment) {
  const tx = await tradeLottoContract.updateJackpotIncrement(increment);
  await tx.wait();
}

// Update max jackpot threshold
async function updateMaxJackpotThreshold(threshold) {
  const tx = await tradeLottoContract.updateMaxJackpotThreshold(threshold);
  await tx.wait();
}

// Update burn percentage
async function updateBurnPercentage(percentage) {
  const tx = await tradeLottoContract.updateBurnPercentage(percentage);
  await tx.wait();
}

// Pause/unpause
async function pauseTradeLotto() {
  const tx = await tradeLottoContract.pause();
  await tx.wait();
}

async function unpauseTradeLotto() {
  const tx = await tradeLottoContract.unpause();
  await tx.wait();
}

// Withdraw HBAR from contract
async function transferHbarFromTradeLotto(recipient, amount) {
  const tx = await tradeLottoContract.transferHbar(recipient, amount);
  await tx.wait();
}
```

### LazyTradeLotto Dashboard

```jsx
function TradeLottoDashboard() {
  const [config, setConfig] = useState({});

  return (
    <Dashboard>
      <JackpotCard>
        <CurrentJackpot>
          {formatLazy(config.currentJackpot)} $LAZY
        </CurrentJackpot>
        <JackpotActions>
          <BoostInput
            value={boostAmount}
            onChange={setBoostAmount}
          />
          <BoostButton onClick={() => boostJackpot(boostAmount)}>
            Boost Jackpot
          </BoostButton>
        </JackpotActions>
      </JackpotCard>

      <ConfigPanel>
        <ConfigRow>
          <Label>Jackpot Increment</Label>
          <LazyInput
            value={config.jackpotIncrement}
            onSave={updateJackpotIncrement}
          />
        </ConfigRow>
        <ConfigRow>
          <Label>Max Jackpot Threshold</Label>
          <LazyInput
            value={config.maxJackpotThreshold}
            onSave={updateMaxJackpotThreshold}
          />
        </ConfigRow>
        <ConfigRow>
          <Label>Burn Percentage</Label>
          <PercentageInput
            value={config.burnPercentage}
            onSave={updateBurnPercentage}
          />
        </ConfigRow>
        <ConfigRow>
          <Label>System Wallet</Label>
          <AddressInput
            value={config.systemWallet}
            onSave={updateSystemWallet}
          />
        </ConfigRow>
      </ConfigPanel>

      <ContractStatus>
        <PausedIndicator paused={config.paused} />
        {config.paused ? (
          <UnpauseButton onClick={unpauseTradeLotto}>Unpause</UnpauseButton>
        ) : (
          <PauseButton onClick={pauseTradeLotto}>Pause</PauseButton>
        )}
      </ContractStatus>
    </Dashboard>
  );
}
```

---

## Multi-Signature Operations

All admin scripts support multi-signature execution via the `--multisig` flag.

### Multi-Sig Integration

```javascript
const { executeContractFunction, checkMultiSigHelp, displayMultiSigBanner } = require('../utils/scriptHelpers');

// Example: setPlatformFee with multi-sig support
async function setPlatformFeeWithMultiSig(percentage) {
  const result = await executeContractFunction({
    contractId: POOL_MANAGER_CONTRACT_ID,
    iface: poolManagerInterface,
    client: hederaClient,
    functionName: 'setPlatformProceedsPercentage',
    params: [percentage],
    gas: 100000,
    payableAmount: 0
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  return result;
}
```

### Multi-Sig Workflows

**Interactive Mode** (all signers online, < 110 seconds):
```bash
node scripts/interactions/LazyLotto/admin/setPlatformFee.js 10 --multisig --threshold=2
```

**Offline Mode** (asynchronous signing):
```bash
# Phase 1: Freeze and export
node scripts/interactions/LazyLotto/admin/closePool.js 5 --multisig --export-only

# Phase 2: Each signer signs offline
node lib/multiSig/cli/sign.js multisig-transactions/tx-file.tx

# Phase 3: Execute with collected signatures
node scripts/interactions/LazyLotto/admin/closePool.js 5 --multisig --offline --signatures=sig1.json,sig2.json
```

### Multi-Sig UI Components

```jsx
function MultiSigOperationPanel({ operation, onExecute }) {
  const [workflow, setWorkflow] = useState('interactive');
  const [threshold, setThreshold] = useState(2);
  const [signers, setSigners] = useState([]);

  return (
    <MultiSigPanel>
      <WorkflowSelector>
        <Option
          value="interactive"
          selected={workflow === 'interactive'}
          onClick={() => setWorkflow('interactive')}
        >
          <RealtimeIcon />
          Interactive (Real-time)
          <Hint>All signers online, &lt;110s</Hint>
        </Option>
        <Option
          value="offline"
          selected={workflow === 'offline'}
          onClick={() => setWorkflow('offline')}
        >
          <OfflineIcon />
          Offline (Air-gapped)
          <Hint>Async signing, no timeout</Hint>
        </Option>
      </WorkflowSelector>

      <ThresholdConfig>
        <Label>Required Signatures</Label>
        <ThresholdSelector
          value={threshold}
          max={signers.length}
          onChange={setThreshold}
        />
        <ThresholdDisplay>
          {threshold} of {signers.length} required
        </ThresholdDisplay>
      </ThresholdConfig>

      <SignersList>
        {signers.map((signer, i) => (
          <SignerRow key={i}>
            <SignerLabel>{signer.label}</SignerLabel>
            <SignerAddress>{signer.accountId}</SignerAddress>
            <SignerStatus status={signer.status} />
          </SignerRow>
        ))}
        <AddSignerButton onClick={addSigner}>
          + Add Signer
        </AddSignerButton>
      </SignersList>

      <ExecuteMultiSig
        operation={operation}
        workflow={workflow}
        threshold={threshold}
        signers={signers}
        onExecute={onExecute}
      />
    </MultiSigPanel>
  );
}
```

---

## Error Handling

### Common Admin Errors

```javascript
function handleAdminError(error) {
  const errorMap = {
    'NotAuthorized': {
      title: 'Not Authorized',
      message: 'You do not have admin privileges for this operation.',
      action: 'Contact an existing admin to grant you access.'
    },
    'CannotRemoveLastAdmin': {
      title: 'Cannot Remove Last Admin',
      message: 'The contract must have at least one administrator.',
      action: 'Add another admin before removing this one.'
    },
    'PoolNotFound': {
      title: 'Pool Not Found',
      message: 'The specified pool ID does not exist.',
      action: 'Verify the pool ID and try again.'
    },
    'PoolNotClosed': {
      title: 'Pool Not Closed',
      message: 'This operation requires the pool to be closed first.',
      action: 'Close the pool before attempting this operation.'
    },
    'OutstandingEntries': {
      title: 'Outstanding Entries',
      message: 'Cannot close pool with outstanding entries.',
      action: 'Wait for all entries to be rolled or refund users.'
    },
    'InsufficientBalance': {
      title: 'Insufficient Balance',
      message: 'Not enough funds for this operation.',
      action: 'Check balance and try a smaller amount.'
    },
    'PrizeObligationsExceeded': {
      title: 'Prize Obligations',
      message: 'Cannot withdraw below prize obligations.',
      action: 'Wait for prizes to be claimed or reduce withdrawal amount.'
    },
    'BadParameters': {
      title: 'Invalid Parameters',
      message: 'One or more parameters are invalid.',
      action: 'Review input values and try again.'
    }
  };

  for (const [key, info] of Object.entries(errorMap)) {
    if (error.message.includes(key)) {
      return info;
    }
  }

  return {
    title: 'Operation Failed',
    message: error.message,
    action: 'Check the console for details.'
  };
}
```

---

## Dashboard Components

### Admin Navigation

```jsx
function AdminNavigation() {
  return (
    <SideNav>
      <NavSection title="Overview">
        <NavItem to="/admin" icon={<DashboardIcon />}>Dashboard</NavItem>
        <NavItem to="/admin/analytics" icon={<ChartIcon />}>Analytics</NavItem>
      </NavSection>

      <NavSection title="Pool Management">
        <NavItem to="/admin/pools" icon={<PoolIcon />}>All Pools</NavItem>
        <NavItem to="/admin/pools/create" icon={<PlusIcon />}>Create Pool</NavItem>
      </NavSection>

      <NavSection title="Prizes">
        <NavItem to="/admin/prizes" icon={<PrizeIcon />}>Prize Manager</NavItem>
        <NavItem to="/admin/prizes/upload" icon={<UploadIcon />}>Batch Upload</NavItem>
      </NavSection>

      <NavSection title="Configuration">
        <NavItem to="/admin/bonuses" icon={<BonusIcon />}>Bonus System</NavItem>
        <NavItem to="/admin/platform" icon={<SettingsIcon />}>Platform Config</NavItem>
        <NavItem to="/admin/roles" icon={<UsersIcon />}>Role Management</NavItem>
      </NavSection>

      <NavSection title="Finance">
        <NavItem to="/admin/treasury" icon={<TreasuryIcon />}>Treasury</NavItem>
        <NavItem to="/admin/withdrawals" icon={<WithdrawIcon />}>Withdrawals</NavItem>
      </NavSection>

      <NavSection title="LazyTradeLotto">
        <NavItem to="/admin/trade-lotto" icon={<TradeIcon />}>Trade Lotto</NavItem>
      </NavSection>
    </SideNav>
  );
}
```

### Admin Overview Dashboard

```jsx
function AdminOverviewDashboard() {
  return (
    <DashboardGrid>
      <StatCard title="Total Pools" value={stats.totalPools} />
      <StatCard title="Active Pools" value={stats.activePools} />
      <StatCard title="Total Entries" value={stats.totalEntries} />
      <StatCard title="Total Prize Value" value={formatHbar(stats.totalPrizeValue)} />

      <ChartCard title="Entry Volume (7 days)">
        <EntryVolumeChart data={volumeData} />
      </ChartCard>

      <ChartCard title="Win Rate Distribution">
        <WinRateDistributionChart data={winRateData} />
      </ChartCard>

      <RecentActivity>
        <ActivityItem type="pool_created" pool={5} />
        <ActivityItem type="prize_claimed" user="0.0.123" pool={2} />
        <ActivityItem type="admin_added" admin="0.0.456" />
      </RecentActivity>

      <AlertsPanel>
        {alerts.map(alert => (
          <Alert key={alert.id} severity={alert.severity}>
            {alert.message}
          </Alert>
        ))}
      </AlertsPanel>
    </DashboardGrid>
  );
}
```

---

## Script Reference

### LazyLotto Admin Scripts

| Script | Purpose | Multi-Sig |
|--------|---------|-----------|
| `createPool.js` | Create new lottery pool | Yes |
| `addPrizePackage.js` | Add prize to pool | Yes |
| `addPrizesBatch.js` | Batch add fungible prizes | Yes |
| `pausePool.js` | Pause single pool | Yes |
| `unpausePool.js` | Unpause single pool | Yes |
| `pauseContract.js` | Pause entire contract | Yes |
| `closePool.js` | Permanently close pool | Yes |
| `removePrizes.js` | Remove prizes from closed pool | Yes |
| `manageRoles.js` | Add/remove admins and prize managers | Yes |
| `manageGlobalPrizeManagers.js` | Manage global prize manager list | Yes |
| `setBonuses.js` | Configure bonus system | Yes |
| `migrateBonuses.js` | Migrate bonuses between configs | Yes |
| `setBurnPercentage.js` | Set $LAZY burn percentage | Yes |
| `setPlatformFee.js` | Set platform proceeds % | Yes |
| `setCreationFees.js` | Set pool creation fees | Yes |
| `withdrawTokens.js` | Withdraw platform proceeds | Yes |
| `transferPoolOwnership.js` | Transfer community pool ownership | Yes |
| `grantEntry.js` | Grant free entries to users | Yes |

### LazyTradeLotto Admin Scripts

| Script | Purpose | Multi-Sig |
|--------|---------|-----------|
| `boostJackpot.js` | Add funds to jackpot | Yes |
| `updateLottoSystemWallet.js` | Update signature validation wallet | Yes |
| `updateLottoJackpotIncrement.js` | Update loss increment amount | Yes |
| `updateMaxJackpotThreshold.js` | Update max jackpot cap | Yes |
| `updateLottoBurnPercentage.js` | Update burn percentage | Yes |
| `pauseLottoContract.js` | Pause trade lotto | Yes |
| `unpauseLottoContract.js` | Unpause trade lotto | Yes |
| `transferHbarFromLotto.js` | Withdraw HBAR | Yes |

### Deployment Scripts

| Script | Purpose | Multi-Sig |
|--------|---------|-----------|
| `configureLTL-LGS.js` | Link TradeLotto to GasStation | Yes |
| `linkPoolManager.js` | Link PoolManager to LazyLotto | Yes |

---

## Appendix: Contract Method Quick Reference

### LazyLotto Admin Methods

```solidity
// Role Management
addAdmin(address) external
removeAdmin(address) external
addPrizeManager(address) external
removePrizeManager(address) external

// Pool Lifecycle
createPool(...) external payable returns (uint256)
pausePool(uint256 poolId) external
unpausePool(uint256 poolId) external
closePool(uint256 poolId) external

// Prize Management
addPrizePackage(uint256 poolId, ...) external payable
addMultipleFungiblePrizes(uint256 poolId, address token, uint256[] amounts) external payable
removePrizes(uint256 poolId) external

// Configuration
setTimeBonus(uint256 index, uint256 start, uint256 end, uint32 bps) external
setNFTBonus(address token, uint32 bps) external
setLazyBalanceBonus(uint256 threshold, uint32 bps) external
setBurnPercentage(uint256 percentage) external

// Financial
transferHbarFromStorage(address recipient, uint256 amount) external
transferFungible(address token, address recipient, uint256 amount) external

// Emergency
pause() external
unpause() external
```

### PoolManager Admin Methods

```solidity
// Configuration
setCreationFees(uint256 hbarFee, uint256 lazyFee) external
setPlatformProceedsPercentage(uint256 percentage) external

// Pool Management (via LazyLotto)
recordPoolCreation(...) external payable
recordProceeds(...) external
requestWithdrawal(uint256 poolId) external returns (uint256)
transferPoolOwnership(uint256 poolId, address newOwner) external
```

---

## Support

For implementation questions:
1. Refer to script source code in `scripts/interactions/`
2. Check test cases in `test/` for usage examples
3. Review business logic documentation
4. Consult security analysis for admin power constraints

---

*This guide is designed for frontend developers building admin dashboards for LazyLotto and LazyTradeLotto contracts.*
