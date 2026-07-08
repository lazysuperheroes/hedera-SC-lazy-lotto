// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

/// @title LazyLottoPoolManager
/// @author stowerling.eth / stowerling.hbar
/// @notice Manages pool ownership, authorization, creation fees, proceeds, and bonus system for LazyLotto
/// @dev Companion contract to LazyLotto - handles all authorization logic and bonus calculations

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {
    ILazyLotto,
    ILazyDelegateRegistry
} from "./interfaces/ILazyLottoPoolManager.sol";

contract LazyLottoPoolManager is ReentrancyGuard {
    // --- DATA STRUCTURES ---

    /// @notice Time-based bonus window
    struct TimeWindow {
        uint256 start; // Start timestamp
        uint256 end; // End timestamp
        uint16 bonusBps; // Bonus in basis points (0-10000)
    }

    /// @notice Pool proceeds tracking
    struct PoolProceeds {
        mapping(address => uint256) totalProceeds; // token => total collected
        mapping(address => uint256) withdrawnProceeds; // token => already withdrawn
    }

    // --- ERRORS ---

    error NotLazyLotto();
    error NotAuthorized();
    error BadParameters();
    error InvalidAddress();
    error InsufficientHbarFee(uint256 required, uint256 provided);
    error NothingToWithdraw();
    error CannotSetManagerForGlobalPools();
    error CannotWithdrawFromGlobalPools();
    error LazyLottoAlreadySet();
    error TooManyTimeBonuses();
    error TooManyNFTBonuses();

    // --- CONSTANTS ---
    uint256 public constant MAX_TIME_BONUSES = 10; // Maximum time-based bonus windows
    uint256 public constant MAX_NFT_BONUS_TOKENS = 25; // Maximum NFT tokens with bonuses

    // --- EVENTS ---

    event PoolCreated(
        uint256 indexed poolId,
        address indexed creator,
        bool isGlobalAdmin
    );
    event PoolOwnershipTransferred(
        uint256 indexed poolId,
        address indexed oldOwner,
        address indexed newOwner
    );
    event PoolPrizeManagerSet(uint256 indexed poolId, address indexed manager);
    event GlobalPrizeManagerAdded(address indexed manager);
    event GlobalPrizeManagerRemoved(address indexed manager);
    event TimeBonusAdded(uint256 start, uint256 end, uint16 bonusBps);
    event TimeBonusRemoved(uint256 index);
    event NFTBonusSet(address indexed token, uint16 bonusBps);
    event NFTBonusRemoved(uint256 index);
    event LazyBalanceBonusSet(uint256 threshold, uint16 bonusBps);
    event ProceedsRecorded(
        uint256 indexed poolId,
        address indexed token,
        uint256 amount
    );
    event WithdrawalRequested(
        uint256 indexed poolId,
        address indexed owner,
        address indexed token,
        uint256 ownerShare,
        uint256 platformCut
    );
    event CreationFeesUpdated(uint256 hbarFee, uint256 lazyFee);
    event PlatformProceedsPercentageUpdated(uint256 percentage);
    event CreationFeesWithdrawn(address indexed recipient, uint256 hbarAmount);
    event GlobalPoolWithdrawal(
        uint256 indexed poolId,
        address indexed token,
        uint256 amount
    );

    // --- STATE ---

    address private immutable deployer;
    address public lazyLotto;
    address public lazyToken;
    address public lazyGasStation;
    address public lazyDelegateRegistry;

    // Pool ownership
    mapping(uint256 => address) public poolOwners; // poolId => owner (address(0) = global pool)
    mapping(uint256 => address) public poolPrizeManagers; // poolId => optional prize helper
    mapping(address => uint256[]) public userOwnedPools; // user => poolIds[]

    // Creation fees
    uint256 public hbarCreationFee;
    uint256 public lazyCreationFee;
    uint256 public totalHbarCollected;
    uint256 public totalLazyCollected;

    // Proceeds tracking
    mapping(uint256 => PoolProceeds) private poolProceeds;
    mapping(uint256 => uint256) public poolPlatformFeePercentage; // poolId => fee% at creation time
    mapping(uint256 => uint256) public poolBurnPercentage; // poolId => burn% at creation time
    mapping(address => uint256) public pendingWithdrawals; // token => full un-withdrawn proceeds (owner share + platform cut) still reserved in Storage
    mapping(address => uint256) public platformProceedsBalance; // token => accumulated platform cut
    uint256 public platformProceedsPercentage = 5; // 5% platform rake (default)

    // Pool enumeration
    uint256[] private globalPools; // Team-created pools
    uint256[] private communityPools; // User-created pools

    // Global prize managers
    mapping(address => bool) public globalPrizeManagers;
    uint256 private _prizeManagerCount;

    // Bonus system (migrated from LazyLotto)
    TimeWindow[] public timeBonuses;
    mapping(address => uint16) public nftBonusBps;
    address[] public nftBonusTokens;
    uint256 public lazyBalanceThreshold;
    uint16 public lazyBalanceBonusBps;

    // --- CONSTRUCTOR ---

    /// @param _lazyToken The address of the LAZY token
    /// @param _lazyGasStation The address of the LazyGasStation contract
    /// @param _lazyDelegateRegistry The address of the LazyDelegateRegistry contract
    constructor(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry
    ) {
        if (
            _lazyToken == address(0) ||
            _lazyGasStation == address(0) ||
            _lazyDelegateRegistry == address(0)
        ) {
            revert BadParameters();
        }

        lazyToken = _lazyToken;
        lazyGasStation = _lazyGasStation;
        lazyDelegateRegistry = _lazyDelegateRegistry;
        deployer = msg.sender;
        // lazyLotto set via setLazyLotto() after deployment
    }

    /// @notice Set LazyLotto contract address (one-time only, called by admin after deployment)
    /// @param _lazyLotto The LazyLotto contract address
    function setLazyLotto(address _lazyLotto) external {
        if (msg.sender != deployer) revert NotAuthorized();
        if (_lazyLotto == address(0)) revert BadParameters();
        if (lazyLotto != address(0)) revert LazyLottoAlreadySet();
        lazyLotto = _lazyLotto;
    }

    // --- AUTHORIZATION ---

    /// @notice Check if user can manage a pool (pause/unpause/close/remove prizes)
    /// @param poolId The pool ID
    /// @param user The user address
    /// @return bool True if user can manage the pool
    function canManagePool(
        uint256 poolId,
        address user
    ) external view returns (bool) {
        // Global admin can manage anything
        if (ILazyLotto(lazyLotto).isAdmin(user)) return true;

        // Pool owner can manage their own pool
        if (poolOwners[poolId] == user) return true;

        return false;
    }

    /// @notice Check if user can add prizes to a pool
    /// @param poolId The pool ID
    /// @param user The user address
    /// @return bool True if user can add prizes
    function canAddPrizes(
        uint256 poolId,
        address user
    ) external view returns (bool) {
        // Global admin can add to anything
        if (ILazyLotto(lazyLotto).isAdmin(user)) return true;

        // Global prize manager can add to anything
        if (globalPrizeManagers[user]) return true;

        // Pool owner can add to their own pool
        if (poolOwners[poolId] == user) return true;

        // Pool prize manager can add to specific pool
        if (poolPrizeManagers[poolId] == user) return true;

        return false;
    }

    // --- POOL REGISTRATION ---

    /// @notice Record pool creation and collect fees (called by LazyLotto)
    /// @param poolId The pool ID
    /// @param creator The creator address
    /// @param isGlobalAdmin Whether creator is global admin
    function recordPoolCreation(
        uint256 poolId,
        address creator,
        bool isGlobalAdmin,
        uint256 lazyFeeCollected,
        uint256 _burnPercentage
    ) external payable nonReentrant {
        if (msg.sender != lazyLotto) revert NotLazyLotto();

        // Freeze burn percentage at pool creation time
        poolBurnPercentage[poolId] = _burnPercentage;

        if (!isGlobalAdmin) {
            // Capture platform fee percentage at creation time
            poolPlatformFeePercentage[poolId] = platformProceedsPercentage;

            // Validate HBAR fee
            if (msg.value < hbarCreationFee) {
                revert InsufficientHbarFee(hbarCreationFee, msg.value);
            }

            totalHbarCollected += msg.value;
            totalLazyCollected += lazyFeeCollected;

            // Register community pool
            poolOwners[poolId] = creator;
            userOwnedPools[creator].push(poolId);
            communityPools.push(poolId);
        } else {
            // Admin creates for free - mark as global pool
            poolPlatformFeePercentage[poolId] = 0;
            poolOwners[poolId] = address(0);
            globalPools.push(poolId);
        }

        emit PoolCreated(poolId, creator, isGlobalAdmin);
    }

    // --- CREATION FEES ---

    /// @notice Get current creation fees
    /// @return hbar HBAR fee in tinybars
    /// @return lazy LAZY fee in base units
    function getCreationFees()
        external
        view
        returns (uint256 hbar, uint256 lazy)
    {
        return (hbarCreationFee, lazyCreationFee);
    }

    /// @notice Admin sets creation fees
    /// @param _hbarFee HBAR fee in tinybars
    /// @param _lazyFee LAZY fee in base units
    function setCreationFees(uint256 _hbarFee, uint256 _lazyFee) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();

        hbarCreationFee = _hbarFee;
        lazyCreationFee = _lazyFee;

        emit CreationFeesUpdated(_hbarFee, _lazyFee);
    }

    /// @notice Admin withdraws collected HBAR creation fees
    /// @param recipient The address to send fees to
    function withdrawCreationFees(address payable recipient) external nonReentrant {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (recipient == address(0)) revert BadParameters();

        uint256 hbarToSend = totalHbarCollected;
        if (hbarToSend == 0) revert NothingToWithdraw();

        totalHbarCollected = 0;

        (bool success, ) = recipient.call{value: hbarToSend}("");
        if (!success) revert BadParameters();

        emit CreationFeesWithdrawn(recipient, hbarToSend);
    }

    // --- PROCEEDS MANAGEMENT ---

    /// @notice Record proceeds from entry purchases (called by LazyLotto)
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    /// @param amount The amount of proceeds
    function recordProceeds(
        uint256 poolId,
        address token,
        uint256 amount
    ) external nonReentrant {
        if (msg.sender != lazyLotto) revert NotLazyLotto();

        poolProceeds[poolId].totalProceeds[token] += amount;

        // Reserve the FULL proceeds (owner share + platform cut) as an outstanding obligation, so
        // the platform's cut is covered by the anti-rug reserve the moment it accrues — not only
        // when the owner later withdraws. Reserving just the owner share left the platform cut
        // unreserved in Storage and drainable by an admin (audit Finding 3).
        pendingWithdrawals[token] += amount;

        emit ProceedsRecorded(poolId, token, amount);
    }

    /// @notice Get pool proceeds (total and withdrawn)
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    /// @return total Total proceeds collected
    /// @return withdrawn Amount already withdrawn
    function getPoolProceeds(
        uint256 poolId,
        address token
    ) external view returns (uint256 total, uint256 withdrawn) {
        return (
            poolProceeds[poolId].totalProceeds[token],
            poolProceeds[poolId].withdrawnProceeds[token]
        );
    }

    /// @notice Request withdrawal of proceeds (called by LazyLotto)
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    /// @param caller The address requesting withdrawal
    /// @return ownerShare The amount to be withdrawn to owner
    function requestWithdrawal(
        uint256 poolId,
        address token,
        address caller
    ) external nonReentrant returns (uint256 ownerShare) {
        if (msg.sender != lazyLotto) revert NotLazyLotto();

        address owner = poolOwners[poolId];

        // Check if global pool first (fail fast)
        if (owner == address(0)) revert CannotWithdrawFromGlobalPools();

        // Authorization: pool owner or global admin
        if (caller != owner && !ILazyLotto(lazyLotto).isAdmin(caller)) {
            revert NotAuthorized();
        }

        PoolProceeds storage proceeds = poolProceeds[poolId];
        uint256 total = proceeds.totalProceeds[token];
        uint256 withdrawn = proceeds.withdrawnProceeds[token];
        uint256 available = total - withdrawn;

        if (available == 0) revert NothingToWithdraw();

        // Calculate split using the fee percentage set when pool was created
        // Platform cut calculated first, owner gets remainder (including rounding dust)
        uint256 poolFeePercentage = poolPlatformFeePercentage[poolId];
        uint256 platformCut = (available * poolFeePercentage) / 100;
        ownerShare = available - platformCut;

        // Update state: the full `available` leaves the pending reserve — the owner share is paid
        // out (below) and the platform cut moves into platformProceedsBalance (still reserved),
        // so the reserve drops by exactly the owner share that actually leaves Storage.
        proceeds.withdrawnProceeds[token] += available;
        pendingWithdrawals[token] -= available;
        platformProceedsBalance[token] += platformCut;

        emit WithdrawalRequested(poolId, owner, token, ownerShare, platformCut);

        return ownerShare;
    }

    /// @notice Get platform fee balance for a token
    /// @param token The token address (address(0) for HBAR)
    /// @return amount Accumulated platform fees
    function getPlatformBalance(
        address token
    ) external view returns (uint256 amount) {
        return platformProceedsBalance[token];
    }

    /// @notice Reset platform fee balance (called by LazyLotto after withdrawal)
    /// @param token The token address (address(0) for HBAR)
    function withdrawPlatformFees(address token) external {
        if (msg.sender != lazyLotto) revert NotLazyLotto();
        platformProceedsBalance[token] = 0;
    }

    /// @notice Request withdrawal of global pool proceeds (called by LazyLotto)
    /// @param poolId The pool ID (must be a global pool)
    /// @param token The token address (address(0) for HBAR)
    /// @return amount The full available amount to withdraw
    function requestGlobalWithdrawal(
        uint256 poolId,
        address token
    ) external nonReentrant returns (uint256 amount) {
        if (msg.sender != lazyLotto) revert NotLazyLotto();

        // Must be a global pool
        if (poolOwners[poolId] != address(0)) revert NotAuthorized();

        PoolProceeds storage proceeds = poolProceeds[poolId];
        uint256 total = proceeds.totalProceeds[token];
        uint256 withdrawn = proceeds.withdrawnProceeds[token];
        amount = total - withdrawn;

        if (amount == 0) revert NothingToWithdraw();

        proceeds.withdrawnProceeds[token] += amount;
        pendingWithdrawals[token] -= amount;

        emit GlobalPoolWithdrawal(poolId, token, amount);

        return amount;
    }

    /// @notice Set platform proceeds percentage
    /// @param _percentage Platform percentage (0-25)
    function setPlatformProceedsPercentage(uint256 _percentage) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (_percentage > 25) revert BadParameters(); // Maximum 25% platform fee

        platformProceedsPercentage = _percentage;

        emit PlatformProceedsPercentageUpdated(_percentage);
    }

    // --- OWNERSHIP MANAGEMENT ---

    /// @notice Get pool owner address
    /// @param poolId The pool ID
    /// @return owner Owner address (address(0) for global pools)
    function getPoolOwner(
        uint256 poolId
    ) external view returns (address owner) {
        return poolOwners[poolId];
    }

    /// @notice Get pool prize manager address
    /// @param poolId The pool ID
    /// @return manager Prize manager address (address(0) if none)
    function getPoolPrizeManager(
        uint256 poolId
    ) external view returns (address manager) {
        return poolPrizeManagers[poolId];
    }

    /// @notice Get all pools owned by a user
    /// @param user The user address
    /// @return poolIds Array of pool IDs
    function getUserPools(
        address user
    ) external view returns (uint256[] memory poolIds) {
        return userOwnedPools[user];
    }

    /// @notice Transfer pool ownership to a new address
    /// @param poolId The pool ID
    /// @param newOwner The new owner address
    function transferPoolOwnership(uint256 poolId, address newOwner) external {
        address currentOwner = poolOwners[poolId];

        // Authorization: ONLY the current owner may transfer. Admins cannot seize a community
        // pool — otherwise a compromised admin could reassign ownership and drain the owner's
        // accrued proceeds (and, if idle, its prizes via close + removePrizes).
        if (msg.sender != currentOwner) {
            revert NotAuthorized();
        }

        if (newOwner == address(0)) revert InvalidAddress();

        // Update ownership
        poolOwners[poolId] = newOwner;

        // Update tracking arrays
        _removeFromOwnedPools(currentOwner, poolId);
        userOwnedPools[newOwner].push(poolId);

        emit PoolOwnershipTransferred(poolId, currentOwner, newOwner);
    }

    /// @notice Remove pool from user's owned pools array
    /// @param owner The owner address
    /// @param poolId The pool ID to remove
    function _removeFromOwnedPools(address owner, uint256 poolId) internal {
        uint256[] storage pools = userOwnedPools[owner];
        for (uint256 i = 0; i < pools.length; i++) {
            if (pools[i] == poolId) {
                pools[i] = pools[pools.length - 1];
                pools.pop();
                break;
            }
        }
    }

    /// @notice Set or remove pool prize manager
    /// @param poolId The pool ID
    /// @param manager The manager address (address(0) to remove)
    function setPoolPrizeManager(uint256 poolId, address manager) external {
        address owner = poolOwners[poolId];

        // Only pool owner or global admin can set
        bool isAdmin = ILazyLotto(lazyLotto).isAdmin(msg.sender);
        if (msg.sender != owner && !isAdmin) {
            revert NotAuthorized();
        }

        if (owner == address(0)) revert CannotSetManagerForGlobalPools();

        poolPrizeManagers[poolId] = manager;

        emit PoolPrizeManagerSet(poolId, manager);
    }

    // --- GLOBAL PRIZE MANAGERS ---

    /// @notice Add global prize manager
    /// @param a The address to add
    function addGlobalPrizeManager(address a) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (a == address(0)) revert BadParameters();

        if (!globalPrizeManagers[a]) {
            globalPrizeManagers[a] = true;
            _prizeManagerCount++;
            emit GlobalPrizeManagerAdded(a);
        }
    }

    /// @notice Remove global prize manager
    /// @param a The address to remove
    function removeGlobalPrizeManager(address a) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (a == address(0)) revert BadParameters();

        if (globalPrizeManagers[a]) {
            globalPrizeManagers[a] = false;
            _prizeManagerCount--;
            emit GlobalPrizeManagerRemoved(a);
        }
    }

    /// @notice Check if address is global prize manager
    /// @param a The address to check
    /// @return bool True if global prize manager
    function isGlobalPrizeManager(address a) external view returns (bool) {
        return globalPrizeManagers[a];
    }

    /// @notice Get total number of global prize managers
    /// @return count Number of global prize managers
    function getGlobalPrizeManagerCount() external view returns (uint256 count) {
        return _prizeManagerCount;
    }

    // --- POOL ENUMERATION HELPERS ---

    /// @notice Check if a pool is a global (team-created) pool
    /// @param poolId The pool ID
    /// @return bool True if global pool (created by admin)
    function isGlobalPool(uint256 poolId) external view returns (bool) {
        return poolOwners[poolId] == address(0);
    }

    /// @notice Get total number of global pools
    /// @return count Number of global pools
    function totalGlobalPools() external view returns (uint256 count) {
        return globalPools.length;
    }

    /// @notice Get total number of community pools
    /// @return count Number of community pools
    function totalCommunityPools() external view returns (uint256 count) {
        return communityPools.length;
    }

    /// @notice Get paginated list of global pool IDs
    /// @param offset Starting index (0-based)
    /// @param limit Maximum number of pools to return
    /// @return poolIds Array of global pool IDs
    function getGlobalPools(
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory poolIds) {
        uint256 total = globalPools.length;
        if (offset >= total) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        poolIds = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            poolIds[i] = globalPools[offset + i];
        }

        return poolIds;
    }

    /// @notice Get paginated list of community pool IDs
    /// @param offset Starting index (0-based)
    /// @param limit Maximum number of pools to return
    /// @return poolIds Array of community pool IDs
    function getCommunityPools(
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory poolIds) {
        uint256 total = communityPools.length;
        if (offset >= total) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 resultLength = end - offset;
        poolIds = new uint256[](resultLength);

        for (uint256 i = 0; i < resultLength; i++) {
            poolIds[i] = communityPools[offset + i];
        }

        return poolIds;
    }

    /// @notice Get platform fee percentage that was set for a specific pool at creation time
    /// @param poolId The pool ID
    /// @return percentage The platform fee percentage (0-100)
    function getPoolPlatformFeePercentage(
        uint256 poolId
    ) external view returns (uint256 percentage) {
        return poolPlatformFeePercentage[poolId];
    }

    /// @notice Get burn percentage that was frozen at pool creation time
    /// @param poolId The pool ID
    /// @return percentage The burn percentage (0-100)
    function getPoolBurnPercentage(
        uint256 poolId
    ) external view returns (uint256 percentage) {
        return poolBurnPercentage[poolId];
    }

    // --- BONUS SYSTEM (MIGRATED FROM LAZYLOTTO) ---

    /// @notice Calculate boost for a user based on holdings and time bonuses
    /// @param _user The user address
    /// @return boost The calculated boost in basis points (scaled by 10,000)
    function calculateBoost(
        address _user
    ) external view returns (uint32 boost) {
        uint256 ts = block.timestamp;
        uint256 boostAccumulator = 0; // Use uint256 for safe accumulation

        // Time bonuses
        for (uint256 i; i < timeBonuses.length; ) {
            if (ts >= timeBonuses[i].start && ts <= timeBonuses[i].end) {
                boostAccumulator += timeBonuses[i].bonusBps;
            }
            unchecked {
                i++;
            }
        }

        // NFT holding bonuses
        for (uint256 i; i < nftBonusTokens.length; ) {
            address tkn = nftBonusTokens[i];
            if (
                IERC721(tkn).balanceOf(_user) > 0 ||
                ILazyDelegateRegistry(lazyDelegateRegistry)
                    .getSerialsDelegatedTo(_user, tkn)
                    .length >
                0
            ) {
                boostAccumulator += nftBonusBps[tkn];
            }
            unchecked {
                i++;
            }
        }

        // LAZY balance bonus
        if (IERC20(lazyToken).balanceOf(_user) >= lazyBalanceThreshold) {
            boostAccumulator += lazyBalanceBonusBps;
        }

        // Scale bps to tens of thousands of bps (safely)
        uint256 scaledBoost = boostAccumulator * 10_000;

        // Cap at uint32 max to prevent overflow
        if (scaledBoost > type(uint32).max) {
            scaledBoost = type(uint32).max;
        }

        return uint32(scaledBoost);
    }

    /// @notice Admin sets time-based bonus window
    /// @param _start Start timestamp
    /// @param _end End timestamp
    /// @param _bonusBps Bonus in basis points (0-10000)
    function setTimeBonus(
        uint256 _start,
        uint256 _end,
        uint16 _bonusBps
    ) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (_start >= _end || _bonusBps > 10000) revert BadParameters();
        if (timeBonuses.length >= MAX_TIME_BONUSES) revert TooManyTimeBonuses();

        timeBonuses.push(
            TimeWindow({start: _start, end: _end, bonusBps: _bonusBps})
        );

        emit TimeBonusAdded(_start, _end, _bonusBps);
    }

    /// @notice Admin removes time-based bonus window
    /// @param index The index to remove
    function removeTimeBonus(uint256 index) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (index >= timeBonuses.length) revert BadParameters();

        timeBonuses[index] = timeBonuses[timeBonuses.length - 1];
        timeBonuses.pop();

        emit TimeBonusRemoved(index);
    }

    /// @notice Admin sets NFT holding bonus
    /// @param _token The NFT token address
    /// @param _bonusBps Bonus in basis points (0-10000)
    function setNFTBonus(address _token, uint16 _bonusBps) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (_token == address(0) || _bonusBps > 10000) revert BadParameters();

        // Check if token already exists (prevent duplicates)
        bool exists = false;
        for (uint256 i = 0; i < nftBonusTokens.length; i++) {
            if (nftBonusTokens[i] == _token) {
                nftBonusBps[_token] = _bonusBps;
                exists = true;
                break;
            }
        }

        if (!exists) {
            if (nftBonusTokens.length >= MAX_NFT_BONUS_TOKENS) revert TooManyNFTBonuses();
            nftBonusTokens.push(_token);
            nftBonusBps[_token] = _bonusBps;
        }

        emit NFTBonusSet(_token, _bonusBps);
    }

    /// @notice Admin removes NFT holding bonus
    /// @param index The index to remove
    function removeNFTBonus(uint256 index) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (index >= nftBonusTokens.length) revert BadParameters();

        address token = nftBonusTokens[index];
        delete nftBonusBps[token];

        nftBonusTokens[index] = nftBonusTokens[nftBonusTokens.length - 1];
        nftBonusTokens.pop();

        emit NFTBonusRemoved(index);
    }

    /// @notice Admin sets LAZY balance bonus
    /// @param _threshold Minimum LAZY balance required
    /// @param _bonusBps Bonus in basis points (0-10000)
    function setLazyBalanceBonus(
        uint256 _threshold,
        uint16 _bonusBps
    ) external {
        if (!ILazyLotto(lazyLotto).isAdmin(msg.sender)) revert NotAuthorized();
        if (_bonusBps > 10000) revert BadParameters();

        lazyBalanceThreshold = _threshold;
        lazyBalanceBonusBps = _bonusBps;

        emit LazyBalanceBonusSet(_threshold, _bonusBps);
    }

    /// @notice Get total number of time bonuses
    /// @return count Number of time bonus windows
    function totalTimeBonuses() external view returns (uint256 count) {
        return timeBonuses.length;
    }

    /// @notice Get total number of NFT bonus tokens
    /// @return count Number of NFT bonus tokens
    function totalNFTBonusTokens() external view returns (uint256 count) {
        return nftBonusTokens.length;
    }

    // --- FALLBACK ---

    receive() external payable {}
    fallback() external payable {}
}
