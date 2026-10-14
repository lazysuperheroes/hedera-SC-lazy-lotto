# LazyTradeLotto v2 — Ship Checklist

Everything needed to take LazyTradeLotto v2 from branch `feat/lazytradelotto-v2` to live on mainnet, across the three repos. Signer/client details are in [LazyTradeLotto-V2_SIGNER_GUIDE.md](./LazyTradeLotto-V2_SIGNER_GUIDE.md).

## Done

- [x] v1 `0.0.9109659` removed from LazyGasStation `0.0.7221483` contract users (2026-10-14, tx `0.0.6284762@1792011961.147310417`). It stays paused and never rolled.
- [x] v2 contract: deadline, contract + chain binding, `maxWinAmtCap`, 24h `payoutWindowCap`, signed `burnExempt` (no on-chain LSH / delegate-registry reads), `tx.origin` guard + owner switch `setRequireCodelessCaller` for HIP-1340, `boostJackpot` clamp, `getRollMessageHash`, `getPayoutWindow`. Validated on a local EVM (13 checks, including a simulated EIP-7702 delegated EOA).
- [x] Reference burn-exemption resolver `queries/getUserBurn.js`, checked against mainnet accounts (holder, non-holder, staker with a valid delegation).
- [x] Signer/frontend migration guide and test vector.

## 1. hedera-SC-lazy-lotto

- [ ] Run the suite on testnet: `ENVIRONMENT=test npm run test-trade-lotto`.
- [ ] Commit / PR `feat/lazytradelotto-v2`.
- [ ] Choose `LOTTO_MAX_WIN_CAP` (whole $LAZY): at or just above the largest published `maxWin` in the `LazyLottoOdds` table.
- [ ] Choose `LOTTO_PAYOUT_WINDOW_CAP` (whole $LAZY per 24h): well above normal daily payouts (regular wins + the occasional jackpot, up to `maxJackpotPool`, 50,000). It is the circuit breaker for a leaked signer key.
- [ ] Generate a **new mainnet signing key**, not shared with testnet (audit TL-02). Its address becomes `systemWallet`.
- [ ] Testnet: deploy v2 → `LazyGasStation/addContractUser.js` → `testing/rollLottoTest.js` and `testing/simulateTrade.js` end to end (`--burnExempt true|false`).
- [ ] Mainnet: deploy v2 (starts paused) → `addContractUser.js 0.0.<v2>` on LGS `0.0.7221483` → `deployments/verifySigningKey.js` → `queries/getLottoInfo.js` (caps, payout window, jackpot, connections).
- [ ] Unpause only after lazy-trade (section 2) is live.
- [ ] Separately on `main`: regenerate stale ABIs (`node scripts/deployments/extractABI.js`). `abi/LazyLotto.json` still lists the removed `setPrng`, and `abi/LazyLottoPoolManager.json` the removed `CannotTransferGlobalPools`.
- [ ] Separately: commit `scripts/interactions/Utilities/checkBatchRerolls.js`.

## 2. lazy-trade

- [ ] **Fix the ticket `contractId` mismatch (likely why v1 never rolled).** The scanner writes tickets with `contractId = LAZY_TRADE_SC` (`0.0.8051302`, `utils/secureTradeLottoScanner.ts:18`, `:257`, `:281`), but `getLottoTickets` / `getLottoTicket` only read rows with `contractId = LAZY_TRADE_LOTTO` (`services/lazyTradeLotto.ts:88`, `:128`). Check the Directus `TradeLottoFaucet` rows, then make reader and writer agree. Keying tickets by the trade source (`LAZY_TRADE_SC`) means a future lotto redeploy won't strand unrolled tickets: the on-chain `history` is per lotto contract, so a ticket never rolled on v1 can be rolled on v2.
- [ ] **Odds table:** `getWinRates` filters `LazyLottoOdds` by the lotto `contractId` (`services/lazyTradeLotto.ts:493`). Publish odds rows for the v2 contract ID (or re-key them like tickets).
- [ ] **Burn-exemption resolver:** port `resolveBurnExempt` (direct LSH holdings + valid delegations via `getSerialsDelegatedTo` / `checkNFTDelegationIsValidBatch`, alias and long-zero addresses). Guide §2.
- [ ] Signer: new message format with `burnExempt` and `deadline` in `services/lottoSigning.ts` `generateSignedTicketHash`; roll mutation returns both (`server/api/routers/lotto.ts`). Guide §1, §3.
- [ ] Client: `rollLotto` passes `burnExempt`, `deadline` before the signature (`services/lazyTradeLotto.ts`). Guide §4.
- [ ] Replace `lib/abi/LazyTradeLotto.json` with this repo's `abi/LazyTradeLotto.json`.
- [ ] Self-checks: digest parity via `getRollMessageHash`, refuse tickets above `maxWinAmtCap`, refuse rollers with a mirror-node `delegation_address`. Guide §5–6.
- [ ] Monitoring: alert when `getPayoutWindow()` remaining runs low. Guide §5.
- [ ] Map the new reverts in the UI (`SignatureExpired`, `PayoutCapReached`, `OnlyEOA`, `BadArguments("Win Cap")`). Guide §4.
- [ ] Tests: add the guide's test vector to `services/__tests__/lottoSigning.test.ts`; update `server/api/routers/__tests__/lotto.test.ts`.
- [ ] Set `PRIVATE_LAZY_LOTTO_SIGNING_KEY` to the new mainnet key.
- [ ] `config/addresses.ts`: mainnet default `LAZY_TRADE_LOTTO` `0.0.9109659` → v2 (line 60); testnet default `0.0.9339847` → testnet v2 (line 407); set `NEXT_PUBLIC_LAZY_TRADE_LOTTO_CONTRACT_ID` in each deployed environment.

## 3. lazy-dapp-v3

- [ ] `src/config/addresses.ts:59`: mainnet default `LAZY_TRADE_LOTTO` `0.0.9109659` → v2 (and the env var).
- [ ] No event-parser change needed: `LottoRoll` / `JackpotWin` / `JackpotUpdate` signatures are unchanged, and `checkLazyEvents.ts` already shows `JackpotUpdate` as the pool total, which v2's `boostJackpot` now matches.
- [ ] `docs/plans/MAINNET_LAUNCH_PLAN.md`: update the Trade Lotto ID (line 50) and the LGS contract-user list (line 88). v1 was removed 2026-10-14.

## 4. After HIP-1340 reaches testnet

- [ ] On a testnet v2, confirm a delegated account reports code (EXTCODESIZE 23) and is rejected with `setRequireCodelessCaller` on, while plain accounts still roll.
- [ ] Mainnet: `admin/setRequireCodelessCaller.js 0.0.<v2> on`. No redeploy. LazyLotto V3 still needs its own redeploy.

## Still open (accepted for v2)

| Item | Risk | Handling |
|---|---|---|
| TL-01 non-finality | If LGS can't pay, or a win hits the 24h cap, the roll reverts and the ticket re-arms with fresh randomness | Operational: keep LGS well above `maxJackpotPool + maxWinAmtCap` (it holds about 13.5M LAZY) and size the 24h cap so it only trips under abuse |
| Fixed 24h windows | Up to 2× the cap can pay out across a window boundary | Accepted; set the cap with that in mind |
| Signer trusted for `burnExempt` | A leaked key can also sign 0% burn | Bounded by both caps; same trust as odds and amounts |
