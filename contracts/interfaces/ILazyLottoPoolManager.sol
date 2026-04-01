// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/// @title ILazyLottoPoolManager
/// @notice Interface for the LazyLotto Pool Manager contract
/// @dev Handles pool ownership, authorization, fees, proceeds, and bonus system
interface ILazyLottoPoolManager {
    // --- AUTHORIZATION ---

    /// @notice Check if user can manage a pool (pause/unpause/close/remove prizes)
    /// @param poolId The pool ID
    /// @param user The user address
    /// @return bool True if user can manage the pool
    function canManagePool(
        uint256 poolId,
        address user
    ) external view returns (bool);

    /// @notice Check if user can add prizes to a pool
    /// @param poolId The pool ID
    /// @param user The user address
    /// @return bool True if user can add prizes
    function canAddPrizes(
        uint256 poolId,
        address user
    ) external view returns (bool);

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
    ) external payable;

    // --- PROCEEDS ---

    /// @notice Record proceeds from entry purchases (called by LazyLotto)
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    /// @param amount The amount of proceeds
    function recordProceeds(
        uint256 poolId,
        address token,
        uint256 amount
    ) external;

    /// @notice Request withdrawal of proceeds (called by LazyLotto)
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    /// @param caller The address requesting withdrawal
    /// @return amount The amount to be withdrawn to owner
    function requestWithdrawal(
        uint256 poolId,
        address token,
        address caller
    ) external returns (uint256 amount);

    /// @notice Get pool proceeds (total and withdrawn)
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    /// @return total Total proceeds collected
    /// @return withdrawn Amount already withdrawn
    function getPoolProceeds(
        uint256 poolId,
        address token
    ) external view returns (uint256 total, uint256 withdrawn);

    /// @notice Get total pending withdrawals across all pools for a token
    /// @param token The token address (address(0) for HBAR)
    /// @return amount Total owed to all pool owners
    function pendingWithdrawals(
        address token
    ) external view returns (uint256 amount);

    /// @notice Get platform fee balance for a token
    /// @param token The token address (address(0) for HBAR)
    /// @return amount Accumulated platform fees
    function getPlatformBalance(
        address token
    ) external view returns (uint256 amount);

    /// @notice Reset platform fee balance (called by LazyLotto after withdrawal)
    /// @param token The token address (address(0) for HBAR)
    function withdrawPlatformFees(address token) external;

    /// @notice Request withdrawal of global pool proceeds (called by LazyLotto)
    /// @param poolId The pool ID (must be a global pool)
    /// @param token The token address (address(0) for HBAR)
    /// @return amount The full available amount to withdraw
    function requestGlobalWithdrawal(
        uint256 poolId,
        address token
    ) external returns (uint256 amount);

    // --- CREATION FEES ---

    /// @notice Get current creation fees
    /// @return hbar HBAR fee in tinybars
    /// @return lazy LAZY fee in base units
    function getCreationFees()
        external
        view
        returns (uint256 hbar, uint256 lazy);

    /// @notice Admin sets creation fees
    /// @param hbarFee HBAR fee in tinybars
    /// @param lazyFee LAZY fee in base units
    function setCreationFees(uint256 hbarFee, uint256 lazyFee) external;

    /// @notice Admin withdraws collected HBAR creation fees
    /// @param recipient The address to send fees to
    function withdrawCreationFees(address payable recipient) external;

    // --- CONFIGURATION ---

    /// @notice Get burn percentage frozen at pool creation time
    /// @param poolId The pool ID
    /// @return percentage The burn percentage (0-100)
    function getPoolBurnPercentage(uint256 poolId) external view returns (uint256 percentage);

    // --- OWNERSHIP ---

    /// @notice Get pool owner address
    /// @param poolId The pool ID
    /// @return owner Owner address (address(0) for global pools)
    function getPoolOwner(uint256 poolId) external view returns (address owner);

    /// @notice Get pool prize manager address
    /// @param poolId The pool ID
    /// @return manager Prize manager address (address(0) if none)
    function getPoolPrizeManager(
        uint256 poolId
    ) external view returns (address manager);

    /// @notice Get all pools owned by a user
    /// @param user The user address
    /// @return poolIds Array of pool IDs
    function getUserPools(
        address user
    ) external view returns (uint256[] memory poolIds);

    /// @notice Transfer pool ownership to a new address
    /// @param poolId The pool ID
    /// @param newOwner The new owner address
    function transferPoolOwnership(uint256 poolId, address newOwner) external;

    /// @notice Set or remove pool prize manager
    /// @param poolId The pool ID
    /// @param manager The manager address (address(0) to remove)
    function setPoolPrizeManager(uint256 poolId, address manager) external;

    // --- PRIZE MANAGERS ---

    /// @notice Add global prize manager
    /// @param a The address to add
    function addGlobalPrizeManager(address a) external;

    /// @notice Remove global prize manager
    /// @param a The address to remove
    function removeGlobalPrizeManager(address a) external;

    /// @notice Check if address is global prize manager
    /// @param a The address to check
    /// @return bool True if global prize manager
    function isGlobalPrizeManager(address a) external view returns (bool);

    // --- BONUS SYSTEM ---

    /// @notice Calculate boost for a user based on holdings and time bonuses
    /// @param user The user address
    /// @return boost The calculated boost in basis points (scaled by 10,000)
    function calculateBoost(address user) external view returns (uint32 boost);

    /// @notice Admin sets time-based bonus window
    /// @param start Start timestamp
    /// @param end End timestamp
    /// @param bonusBps Bonus in basis points (0-10000)
    function setTimeBonus(uint256 start, uint256 end, uint16 bonusBps) external;

    /// @notice Admin removes time-based bonus window
    /// @param index The index to remove
    function removeTimeBonus(uint256 index) external;

    /// @notice Admin sets NFT holding bonus
    /// @param token The NFT token address
    /// @param bonusBps Bonus in basis points (0-10000)
    function setNFTBonus(address token, uint16 bonusBps) external;

    /// @notice Admin removes NFT holding bonus
    /// @param index The index to remove
    function removeNFTBonus(uint256 index) external;

    /// @notice Admin sets LAZY balance bonus
    /// @param threshold Minimum LAZY balance required
    /// @param bonusBps Bonus in basis points (0-10000)
    function setLazyBalanceBonus(uint256 threshold, uint16 bonusBps) external;

    /// @notice Get total number of time bonuses
    /// @return count Number of time bonus windows
    function totalTimeBonuses() external view returns (uint256 count);

    /// @notice Get total number of NFT bonus tokens
    /// @return count Number of NFT bonus tokens
    function totalNFTBonusTokens() external view returns (uint256 count);

    // --- CONFIGURATION ---

    /// @notice Set platform proceeds percentage
    /// @param percentage Platform percentage (0-100)
    function setPlatformProceedsPercentage(uint256 percentage) external;
}

/// @title ILazyLotto
/// @notice Minimal interface for LazyLotto contract (used by PoolManager)
interface ILazyLotto {
    /// @notice Check if address is global admin
    /// @param a The address to check
    /// @return bool True if global admin
    function isAdmin(address a) external view returns (bool);
}

/// @title ILazyDelegateRegistry
/// @notice Minimal interface for LazyDelegateRegistry contract
interface ILazyDelegateRegistry {
    /// @notice Get serials delegated to a user for a token
    /// @param _user The user address
    /// @param _token The token address
    /// @return serials Array of delegated serial numbers
    function getSerialsDelegatedTo(
        address _user,
        address _token
    ) external view returns (uint256[] memory serials);
}
