// SPDX-License-Identifier: MIT
pragma solidity >=0.8.12 <0.9.0;

/*
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 * ⚡                                                             ⚡
 * ⚡                        LAZY SUPERHEROES                     ⚡
 * ⚡                      The OG Hedera Project                  ⚡
 * ⚡                                                             ⚡
 * ⚡                        %%%%#####%%@@@@                      ⚡
 * ⚡                   @%%%@%###%%%%###%%%%%@@                   ⚡
 * ⚡                %%%%%%@@@@@@@@@@@@@@@@%##%%@@                ⚡
 * ⚡              @%%@#@@@@@@@@@@@@@@@@@@@@@@@@*%%@@             ⚡
 * ⚡            @%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%*%@@           ⚡
 * ⚡           %%%#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%#%@@         ⚡
 * ⚡          %%%@@@@@@@@@@@@@@#-:--==+#@@@@@@@@@@@@@*%@@        ⚡
 * ⚡         %@#@@@@@@@@@@@@@@*-------::%@@@@@@@@%%%%%*%@@       ⚡
 * ⚡        %%#@@@@@@@@@@@@@@@=-------:#@@@@@@@@@%%%%%%*%@@      ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@#-------:+@@@@@@@@@@%%%%%%%#%@@     ⚡
 * ⚡       %%#@@@@@@@@@@@@@@@=------:=@@@@@@@@@@@%%%%%%%%#@@     ⚡
 * ⚡      #%#@@@%%%%%%%@@@@@%------:-@@@@@@@@@@@@@%%%%%%%#%@@    ⚡
 * ⚡      %%#@@@%%%%%%%%@@@@=------------:::@@@@@@@@%%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@%:------------::%@@@@@@@@@%%%%#%@@    ⚡
 * ⚡      %%#@@%%%%%%%%%@@@=:::---------:-@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      #%#@@@%%%%%%%@@@@*:::::::----:-@@@@@@@@@@@@@@@@#@@@    ⚡
 * ⚡      %%%%@@@@%%%%%@@@@@@@@@@-:---:=@@@@@@@@@@@@@@@@@%@@@    ⚡
 * ⚡       %%#@@@@%%%%@@@@@@@@@@@::--:*@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡       %#%#@@@%@%%%@@@@@@@@@#::::#@@@@@@@@@@@@@@@@@@%@@@     ⚡
 * ⚡        %%%%@@@%%%%%%@@@@@@@*:::%@@@@@@@@@@@@@@@@@@%@@@      ⚡
 * ⚡         %%#%@@%%%%%%%@@@@@@=.-%@@@@@@@@@@@@@@@@@@%@@@       ⚡
 * ⚡          %##*@%%%%%%%%%@@@@=+@@@@@@@@@@@@@@@@@@%%@@@        ⚡
 * ⚡           %##*%%%%%%%%%%@@@@@@@@@@@@@@@@@@@@@@%@@@@         ⚡
 * ⚡             %##+#%%%%%%%%@@@@@@@@@@@@@@@@@@@%@@@@           ⚡
 * ⚡               %##*=%%%%%%%@@@@@@@@@@@@@@@#@@@@@             ⚡
 * ⚡                 %##%#**#@@@@@@@@@@@@%%%@@@@@@               ⚡
 * ⚡                    %%%%@@%@@@%%@@@@@@@@@@@                  ⚡
 * ⚡                         %%%%%%%%%%%@@                       ⚡
 * ⚡                                                             ⚡
 * ⚡                 Development Team Focused on                 ⚡
 * ⚡                   Decentralized Solutions                   ⚡
 * ⚡                                                             ⚡
 * ⚡         Visit: http://lazysuperheroes.com/                  ⚡
 * ⚡            or: https://dapp.lazysuperheroes.com/            ⚡
 * ⚡                   to get your LAZY on!                      ⚡
 * ⚡                                                             ⚡
 * ⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡⚡
 */

/// @title Lazy Lotto
/// @author stowerling.eth / stowerling.hbar
/// @notice Degens going to degen - this contract allows users to spend their $LAZY in the hope
/// of getting prizes from the lotto.
/// @dev now uses hbar for royalty handling currently

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {
    ReentrancyGuard
} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPrngSystemContract} from "./interfaces/IPrngSystemContract.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {ILazyDelegateRegistry} from "./interfaces/ILazyDelegateRegistry.sol";
import {ILazyLottoStorage} from "./interfaces/ILazyLottoStorage.sol";
import {LazyLottoPoolManager} from "./LazyLottoPoolManager.sol";

/// @title  LazyLottoV2
/// @notice On-chain lotto pools with Hedera VRF randomness, multi-roll batching, burn on entry, and transparent prize management.
/// @dev All HTS operations are delegated to LazyLottoStorage contract. Users must approve tokens to LazyLottoStorage address.
contract LazyLotto is ReentrancyGuard, Pausable {
    using SafeCast for uint256;
    using SafeCast for int256;
    // --- DATA STRUCTURES ---
    struct PrizePackage {
        address token; // HTS token address (0 = HBAR)
        uint256 amount; // amount for fungible prizes
        address[] nftTokens; // NFT addresses
        uint256[][] nftSerials; // NFT serials
    }
    struct LottoPool {
        string ticketCID;
        string winCID;
        uint256 winRateThousandthsOfBps; // Moved up
        uint256 entryFee; // Moved up
        PrizePackage[] prizes; // Moved up
        uint256 outstandingEntries; // Moved up
        address poolTokenId;
        bool paused; // Grouped with poolTokenId and closed
        bool closed; // Grouped with poolTokenId and paused
        address feeToken; // Moved down
    }
    struct PendingPrize {
        uint256 poolId; // pool ID
        bool asNFT; // true if the prize is an NFT - Moved up to pack with prize.token
        PrizePackage prize; // prize package
    }

    /// --- CONSTANTS ---
    /// @notice Maximum possible threshold for winning (100%)
    /// @dev Expressed as integer from 0-100,000,000 where 100,000,000 represents 100%
    uint256 public constant MAX_WIN_RATE_THRESHOLD = 100_000_000;
    /// @dev Batch size of 10 NFTs because LazyLotto is token treasury and can mint+transfer for free
    uint256 public constant NFT_BATCH_SIZE = 10;
    int32 private constant DEFAULT_AUTO_RENEW_PERIOD = 7776000; // Default auto-renew period for tokens (90 days in seconds)

    // --- ENUMS ---
    enum MethodEnum {
        FALLBACK,
        RECEIVE,
        FT_TRANSFER,
        HBAR_TRANSFER
    }

    // --- ERRORS ---
    error LottoPoolNotFound(uint256 _poolId);
    error BalanceError(
        address _tokenAddress,
        uint256 _balance,
        uint256 _requestedAmount
    );

    error BadParameters();
    error NotAdmin();
    error NotAuthorized();
    error PoolManagerAlreadySet();
    error FungibleTokenTransferFailed();
    error LastAdminError();
    error PoolIsClosed();
    error PoolNotClosed();
    error NotEnoughHbar(uint256 _needed, uint256 _presented);
    error NotEnoughFungible(uint256 _needed, uint256 _presented);
    error NotEnoughTickets(
        uint256 _poolId,
        uint256 _requested,
        uint256 _available
    );
    error NoTickets(uint256 _poolId, address _user);
    error NoPendingPrizes();
    error FailedNFTCreate();
    error FailedNFTMintAndSend();
    error FailedNFTWipe();
    error PoolOnPause();
    error EntriesOutstanding(uint256 _outstanding, uint256 _tokensOutstanding);
    error NoPrizesAvailable();
    error AlreadyWinningTicket();
    error FailedToInitialize();

    /// --- EVENTS ---
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event PoolCreated(uint256 indexed poolId);
    event PoolPaused(uint256 indexed poolId);
    event PoolClosed(uint256 indexed poolId);
    event PoolOpened(uint256 indexed poolId);
    event PrizeAdded(
        uint256 indexed poolId,
        uint256 indexed prizeIndex,
        address indexed admin,
        PrizePackage prize
    );
    event PrizeRemoved(
        uint256 indexed poolId,
        uint256 indexed prizeIndex,
        address indexed admin,
        PrizePackage prize
    );
    event EntryPurchased(
        address indexed user,
        uint256 indexed poolId,
        uint256 count
    );
    event Rolled(
        address indexed user,
        uint256 indexed poolId,
        bool won,
        uint256 rollBps
    );
    event PrizeClaimed(address indexed user, PrizePackage prize);
    event TicketEvent(
        uint256 indexed poolId,
        address indexed tokenId,
        address indexed user,
        int64[] serialNumber,
        bool mint
    );
    event ContractUpdate(MethodEnum method, address _sender, uint256 _amount);

    // --- STATE ---
    mapping(address => bool) private _isAddressAdmin;
    uint256 private _adminCount;

    LazyLottoPoolManager public poolManager;

    IPrngSystemContract public prng;
    uint256 public burnPercentage;

    // HTS helper contracts
    address public lazyToken;
    ILazyGasStation public lazyGasStation;
    ILazyDelegateRegistry public lazyDelegateRegistry;
    ILazyLottoStorage public storageContract;

    LottoPool[] private pools;
    // allow a lookup of prizes available to a user

    mapping(address => PendingPrize[]) private pending;
    // switched to the hash of tokenId + serialNumber when redeemed to NFT
    mapping(bytes32 => PendingPrize) private pendingNFTs;
    // need to track how much of an FT the contract needs for prizes (won and pledged to pools)
    mapping(address => uint256) private ftTokensForPrizes;

    // mapping of poolId -> User -> entries in state
    mapping(uint256 => mapping(address => uint256)) public userEntries;

    // --- CONSTRUCTOR ---
    /// @param _lazyToken The address of the $LAZY token
    /// @param _lazyGasStation The address of the LazyGasStation contract
    /// @param _lazyDelegateRegistry The address of the LazyDelegateRegistry contract
    /// @param _prng The address of the PrngSystemContract
    /// @param _burnPercentage The percentage of the entry fee to burn on entry (0-100)
    /// @param _storageContract The address of the LazyLottoStorage contract (immutable, set once)
    constructor(
        address _lazyToken,
        address _lazyGasStation,
        address _lazyDelegateRegistry,
        address _prng,
        uint256 _burnPercentage,
        address _storageContract
    ) {
        if (
            _lazyToken == address(0) ||
            _lazyGasStation == address(0) ||
            _lazyDelegateRegistry == address(0) ||
            _prng == address(0) ||
            _storageContract == address(0)
        ) {
            revert BadParameters();
        }

        // Initialize HTS helper contracts
        lazyToken = _lazyToken;
        lazyGasStation = ILazyGasStation(_lazyGasStation);
        lazyDelegateRegistry = ILazyDelegateRegistry(_lazyDelegateRegistry);
        storageContract = ILazyLottoStorage(_storageContract);

        prng = IPrngSystemContract(_prng);

        burnPercentage = _burnPercentage;

        // Initialize the admin with the deployer
        _isAddressAdmin[msg.sender] = true;
        _adminCount = 1;
        emit AdminAdded(msg.sender);
    }

    // --- INTERNAL REQUIREMENT FUNCTIONS ---
    /// @dev Internal function to check if caller is admin (replaces onlyAdmin modifier)
    function _requireAdmin() internal view {
        if (!_isAddressAdmin[msg.sender]) {
            revert NotAdmin();
        }
    }

    /// @dev Internal function to validate pool exists and is not closed (replaces validPool modifier)
    function _requireValidPool(uint256 id) internal view {
        if (id >= pools.length) {
            revert LottoPoolNotFound(id);
        }
        if (pools[id].closed) {
            revert PoolIsClosed();
        }
    }

    // --- ADMIN FUNCTIONS ---
    /// @notice Adds a new admin address
    /// @param a The address of the new admin
    function addAdmin(address a) external {
        _requireAdmin();
        if (a == address(0)) revert BadParameters();
        if (!_isAddressAdmin[a]) {
            _isAddressAdmin[a] = true;
            _adminCount++;
            emit AdminAdded(a);
        }
    }

    /// @notice Removes an admin address
    /// @param a The address of the admin to remove
    function removeAdmin(address a) external {
        _requireAdmin();
        if (a == address(0)) revert BadParameters();
        if (_adminCount <= 1) {
            revert LastAdminError();
        }
        if (_isAddressAdmin[a]) {
            _isAddressAdmin[a] = false;
            _adminCount--;
            emit AdminRemoved(a);
        } else {
            revert NotAdmin();
        }
    }

    /// @notice Set PoolManager contract address (one-time only, called by admin after deployment)
    /// @param _poolManager The LazyLottoPoolManager contract address
    function setPoolManager(address payable _poolManager) external {
        _requireAdmin();
        if (_poolManager == address(0)) revert BadParameters();
        if (address(poolManager) != address(0)) revert PoolManagerAlreadySet();
        poolManager = LazyLottoPoolManager(_poolManager);
    }

    /// @notice Sets the burn percentage for the entry fee
    /// @param _burnPercentage The new burn percentage (0-100)
    function setBurnPercentage(uint256 _burnPercentage) external {
        _requireAdmin();
        if (_burnPercentage > 100) {
            revert BadParameters();
        }
        burnPercentage = _burnPercentage;
    }

    /// @notice Sets the PRNG contract address (for testing purposes)
    /// @param _prng The address of the new PRNG contract
    function setPrng(address _prng) external {
        _requireAdmin();
        if (_prng == address(0)) {
            revert BadParameters();
        }
        prng = IPrngSystemContract(_prng);
    }

    /// Initializes a fresh Lotto pool with the given parameters
    /// @param _name The name of the Pool (for the token)
    /// @param _symbol The symbol of the pool token
    /// @param _memo The memo for the token
    /// @param _royalties The royalties for the token (NFT)
    /// @param _ticketCID The CID for the (unrolled) ticket metadata
    /// @param _winCID The CID for the winning metadata
    /// @param _winRateTenThousandthsOfBps The winning rate in basis points (0-100_000_000)
    /// @param _entryFee The entry fee for the pool
    /// @param _feeToken The token to use for fees
    /// @return poolId The ID of the created pool
    function createPool(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        ILazyLottoStorage.NFTFeeObject[] memory _royalties,
        string memory _ticketCID,
        string memory _winCID,
        uint256 _winRateTenThousandthsOfBps,
        uint256 _entryFee,
        address _feeToken
    ) external payable nonReentrant returns (uint256 poolId) {
        // check the parameters are valid
        if (
            bytes(_name).length == 0 ||
            bytes(_symbol).length == 0 ||
            bytes(_memo).length == 0 ||
            bytes(_ticketCID).length == 0 ||
            bytes(_winCID).length == 0 ||
            bytes(_memo).length > 100 ||
            _royalties.length > 10 ||
            _winRateTenThousandthsOfBps > MAX_WIN_RATE_THRESHOLD ||
            _entryFee == 0
        ) {
            revert BadParameters();
        }

        bool isGlobalAdmin = _isAddressAdmin[msg.sender];

        // Non-admins pay creation fees via PoolManager
        // Cache fee values to prevent mid-transaction changes from admin
        uint256 cachedHbarFee;
        uint256 cachedLazyFee;
        uint256 hbarForToken = msg.value;
        if (!isGlobalAdmin) {
            (cachedHbarFee, cachedLazyFee) = poolManager.getCreationFees();

            // Pull LAZY fee via gas station (no burn for creation fees)
            if (cachedLazyFee > 0) {
                lazyGasStation.drawLazyFrom(msg.sender, cachedLazyFee, 0);
            }

            // HBAR fee: deduct from msg.value before token creation
            if (msg.value < cachedHbarFee) {
                revert NotEnoughHbar(cachedHbarFee, msg.value);
            }
            hbarForToken = msg.value - cachedHbarFee;
        }

        // Create token via storage contract (storage is treasury and auto-renew payer)
        // Forward remaining HBAR (after fee deduction) to cover token creation costs
        address tokenAddress = storageContract.createToken{value: hbarForToken}(
            _name,
            _symbol,
            _memo,
            _royalties
        );

        // now create the pool and add it to the list of pools;
        pools.push(
            LottoPool({
                ticketCID: _ticketCID,
                winCID: _winCID,
                poolTokenId: tokenAddress,
                winRateThousandthsOfBps: _winRateTenThousandthsOfBps,
                entryFee: _entryFee,
                feeToken: _feeToken,
                prizes: new PrizePackage[](0),
                outstandingEntries: 0,
                paused: false,
                closed: false
            })
        );

        poolId = pools.length - 1;

        // Register pool with PoolManager (collect fees if non-admin)
        if (!isGlobalAdmin) {
            // Use cached fee value to ensure consistency
            poolManager.recordPoolCreation{value: cachedHbarFee}(
                poolId,
                msg.sender,
                false,
                cachedLazyFee,
                burnPercentage
            );
        } else {
            poolManager.recordPoolCreation(poolId, msg.sender, true, 0, burnPercentage);
        }

        emit PoolCreated(poolId);
    }

    /// Admin, Global Prize Manager, Pool Owner, or Pool Prize Manager can add prizes to a pool
    /// @param poolId The ID of the pool to add prizes to
    /// @param token The address of the token to add as a prize
    /// @param amount The amount of the token to add as a prize
    /// @param nftTokens The addresses of the NFT tokens to add as prizes
    function addPrizePackage(
        uint256 poolId,
        address token,
        uint256 amount,
        address[] memory nftTokens,
        uint256[][] memory nftSerials
    ) external payable nonReentrant {
        if (!poolManager.canAddPrizes(poolId, msg.sender)) {
            revert NotAuthorized();
        }
        _requireValidPool(poolId);
        if (nftTokens.length != nftSerials.length) {
            revert BadParameters();
        }

        // fungible amount can be zero if only NFTs are being added
        // nobody likes zero amount fungible prizes!
        if (amount == 0 && nftTokens.length == 0) {
            revert BadParameters();
        }

        uint256 actualAmount = _checkAndPullFungible(token, amount);
        storageContract.bulkTransferNFTs(
            true, // staking (user -> storage)
            nftTokens,
            nftSerials,
            msg.sender
        );

        LottoPool storage p = pools[poolId];
        p.prizes.push(
            PrizePackage({
                token: token,
                amount: actualAmount,
                nftTokens: nftTokens,
                nftSerials: nftSerials
            })
        );

        emit PrizeAdded(
            poolId,
            p.prizes.length - 1, // prizeIndex
            msg.sender,
            p.prizes[p.prizes.length - 1]
        );
    }

    /// Admin, Global Prize Manager, Pool Owner, or Pool Prize Manager can add multiple fungible prizes to a pool in one call
    /// @param poolId The ID of the pool to add prizes to
    /// @param tokenId The address of the token to add as a prize
    /// @param amounts The amounts of the token to add as prizes
    function addMultipleFungiblePrizes(
        uint256 poolId,
        address tokenId,
        uint256[] memory amounts
    ) external payable nonReentrant {
        if (!poolManager.canAddPrizes(poolId, msg.sender)) {
            revert NotAuthorized();
        }
        _requireValidPool(poolId);
        if (amounts.length == 0) {
            revert BadParameters();
        }

        // Accumulate total and validate no zero amounts
        uint256 totalAmount = 0;
        uint256 _length = amounts.length;
        for (uint256 i = 0; i < _length; ) {
            if (amounts[i] == 0) {
                revert BadParameters();
            }
            totalAmount += amounts[i];
            unchecked { ++i; }
        }

        // Pull all tokens in one transfer (handles HBAR msg.value correctly)
        uint256 actualTotal = _checkAndPullFungible(tokenId, totalAmount);

        LottoPool storage p = pools[poolId];

        // Distribute actual received amount proportionally across prizes
        uint256 distributed = 0;
        for (uint256 i = 0; i < _length; ) {
            uint256 prizeAmount;
            if (i == _length - 1) {
                // Last prize gets remainder to absorb rounding
                prizeAmount = actualTotal - distributed;
            } else {
                prizeAmount = (amounts[i] * actualTotal) / totalAmount;
                distributed += prizeAmount;
            }

            p.prizes.push(
                PrizePackage({
                    token: tokenId,
                    amount: prizeAmount,
                    nftTokens: new address[](0),
                    nftSerials: new uint256[][](0)
                })
            );

            emit PrizeAdded(
                poolId,
                p.prizes.length - 1, // prizeIndex
                msg.sender,
                p.prizes[p.prizes.length - 1]
            );

            unchecked {
                ++i;
            }
        }
    }

    /// Admin or Pool Owner can pause a pool preventing the purchase of further tickets
    /// @param poolId The ID of the pool to pause
    function pausePool(uint256 poolId) external {
        if (!poolManager.canManagePool(poolId, msg.sender)) {
            revert NotAuthorized();
        }
        _requireValidPool(poolId);
        LottoPool storage p = pools[poolId];
        p.paused = true;
        emit PoolPaused(poolId);
    }

    /// Admin or Pool Owner can unpause a pool allowing the purchase of further tickets
    /// @param poolId The ID of the pool to unpause
    function unpausePool(uint256 poolId) external {
        if (!poolManager.canManagePool(poolId, msg.sender)) {
            revert NotAuthorized();
        }
        _requireValidPool(poolId);
        LottoPool storage p = pools[poolId];
        p.paused = false;
        emit PoolOpened(poolId);
    }

    /// Admin or Pool Owner can permanently close a pool preventing any further actions
    /// Required to be able to remove prizes from the pool
    /// @param poolId The ID of the pool to close
    function closePool(uint256 poolId) external nonReentrant {
        if (!poolManager.canManagePool(poolId, msg.sender)) {
            revert NotAuthorized();
        }
        _requireValidPool(poolId);
        LottoPool storage p = pools[poolId];

        // we can only close a pool if there are no outstanding entries and no oustanding tokens too
        if (
            p.outstandingEntries > 0 || IERC20(p.poolTokenId).totalSupply() > 0
        ) {
            revert EntriesOutstanding(
                p.outstandingEntries,
                IERC20(p.poolTokenId).totalSupply()
            );
        }

        p.closed = true;
        emit PoolClosed(poolId);
    }

    /// Admin or Pool Owner can remove prizes from a pool if closed
    /// @param poolId The ID of the pool to remove prizes from
    /// @param prizeIndex The index of the prize to remove
    function removePrizes(uint256 poolId, uint256 prizeIndex) external nonReentrant {
        if (!poolManager.canManagePool(poolId, msg.sender)) {
            revert NotAuthorized();
        }
        LottoPool storage p = pools[poolId];
        if (!p.closed) {
            revert PoolNotClosed();
        }

        // check the prize index is valid
        if (prizeIndex >= p.prizes.length) {
            revert BadParameters();
        }

        PrizePackage memory prize = p.prizes[prizeIndex];

        // remove the prize from the pool
        p.prizes[prizeIndex] = p.prizes[p.prizes.length - 1];
        p.prizes.pop();

        // reduce the amount of the token needed for prizes
        ftTokensForPrizes[prize.token] -= prize.amount;

        // Determine recipient: pool owner for community pools, admin for global pools
        address recipient = poolManager.getPoolOwner(poolId);
        if (recipient == address(0)) {
            recipient = msg.sender;
        }

        emit PrizeRemoved(poolId, prizeIndex, msg.sender, prize);

        // transfer the fungible token amount back to the recipient
        if (prize.amount > 0) {
            _transferToken(prize.token, recipient, prize.amount);
        }

        // then transfer the NFTs back to the recipient
        storageContract.bulkTransferNFTs(
            false,
            prize.nftTokens,
            prize.nftSerials,
            recipient
        );
    }

    // PAUSE
    /// @notice Pauses the contract
    function pause() external {
        _requireAdmin();
        _pause();
    }
    /// @notice Unpauses the contract
    function unpause() external {
        _requireAdmin();
        _unpause();
    }

    // --- USER ACTIONS ---
    /// User buys entries in the specified pool
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external payable whenNotPaused nonReentrant {
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false, msg.sender);
    }

    /// Helper function to allow the user to buy and roll in one transaction
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    function buyAndRollEntry(
        uint256 poolId,
        uint256 ticketCount
    )
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false, msg.sender);
        (wins, offset) = _roll(poolId, ticketCount);
    }

    /// Helper function to allow the user to buy and redeem to NFT in one transaction
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    /// @return serials The minted NFT serial numbers
    function buyAndRedeemEntry(
        uint256 poolId,
        uint256 ticketCount
    )
        external
        payable
        whenNotPaused
        nonReentrant
        returns (int64[] memory serials)
    {
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, false, msg.sender);
        return _redeemEntriesToNFT(poolId, ticketCount);
    }

    /// Admin function to buy free entries for themselves and redeem to NFT
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    /// @return serials The minted NFT serial numbers
    function adminBuyAndRedeemEntry(
        uint256 poolId,
        uint256 ticketCount
    ) external whenNotPaused nonReentrant returns (int64[] memory serials) {
        _requireAdmin();
        _requireValidPool(poolId);
        _buyEntry(poolId, ticketCount, true, msg.sender);
        return _redeemEntriesToNFT(poolId, ticketCount);
    }

    /// Admin function to grant free entries to another user (as in-memory entries, not NFTs)
    /// @param poolId The ID of the pool to buy an entry in
    /// @param ticketCount The number of tickets to buy
    /// @param recipient The address to grant the tickets to
    function adminGrantEntry(
        uint256 poolId,
        uint256 ticketCount,
        address recipient
    ) external whenNotPaused nonReentrant {
        _requireAdmin();
        _requireValidPool(poolId);
        if (recipient == address(0)) {
            revert BadParameters();
        }
        _buyEntry(poolId, ticketCount, true, recipient);
    }

    /// User redeems existing in-memory entries to NFT tickets
    /// @param poolId The ID of the pool to redeem entries from
    /// @param ticketCount The number of entries to redeem to NFTs
    /// @return serials The minted NFT serial numbers
    function redeemEntriesToNFT(
        uint256 poolId,
        uint256 ticketCount
    ) external whenNotPaused nonReentrant returns (int64[] memory serials) {
        _requireValidPool(poolId);
        return _redeemEntriesToNFT(poolId, ticketCount);
    }

    /// User rolls all tickets in the pool (in memory not any NFT entries)
    /// @param poolId The ID of the pool to roll tickets in
    function rollAll(
        uint256 poolId
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        if (userEntries[poolId][msg.sender] == 0) {
            revert NoTickets(poolId, msg.sender);
        }
        return _roll(poolId, userEntries[poolId][msg.sender]);
    }

    /// User rolls a batch of tickets in the pool (in memory not any NFT entries)
    /// @param poolId The ID of the pool to roll tickets in
    /// @param numberToRoll The number of tickets to roll
    function rollBatch(
        uint256 poolId,
        uint256 numberToRoll
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        if (numberToRoll == 0) {
            revert BadParameters();
        }
        if (numberToRoll > userEntries[poolId][msg.sender]) {
            revert NotEnoughTickets(
                poolId,
                numberToRoll,
                userEntries[poolId][msg.sender]
            );
        }

        return _roll(poolId, numberToRoll);
    }

    /// User rolls tickets redeemed from NFTs
    /// @param poolId The ID of the pool to roll tickets in
    /// @param serialNumbers The serial numbers of the NFTs to roll
    function rollWithNFT(
        uint256 poolId,
        int64[] memory serialNumbers
    )
        external
        whenNotPaused
        nonReentrant
        returns (uint256 wins, uint256 offset)
    {
        _requireValidPool(poolId);
        if (serialNumbers.length == 0) {
            revert BadParameters();
        }

        // redeem the tickets for the user and credit the entries
        _redeemEntriesFromNFT(poolId, serialNumbers);
        return _roll(poolId, serialNumbers.length);
    }

    /// User redeems pending prizes to NFTs
    /// @param indices The indices of the pending prizes to redeem
    function redeemPrizeToNFT(
        uint256[] memory indices
    ) external nonReentrant returns (int64[] memory serials) {
        uint256 count = indices.length;
        if (count == 0) {
            revert BadParameters();
        }

        // Sort indices descending to handle removals from pending[msg.sender] correctly
        for (uint256 i = 0; i < count; ) {
            for (uint256 j = i + 1; j < count; ) {
                if (indices[i] < indices[j]) {
                    uint256 tmp = indices[i];
                    indices[i] = indices[j];
                    indices[j] = tmp;
                }
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }

        // Store prize info before removal
        PendingPrize[] memory prizesToConvert = new PendingPrize[](count);
        for (uint256 k = 0; k < count; ) {
            uint256 prizeIndexInPendingArray = indices[k];

            if (prizeIndexInPendingArray >= pending[msg.sender].length) {
                revert BadParameters();
            }

            prizesToConvert[k] = pending[msg.sender][prizeIndexInPendingArray];

            // Remove from pending array
            if (prizeIndexInPendingArray < pending[msg.sender].length - 1) {
                pending[msg.sender][prizeIndexInPendingArray] = pending[
                    msg.sender
                ][pending[msg.sender].length - 1];
            }
            pending[msg.sender].pop();

            unchecked {
                ++k;
            }
        }

        // Get pool info from first prize and validate all prizes are from the same pool
        uint256 poolId = prizesToConvert[0].poolId;
        for (uint256 v = 1; v < count; ) {
            if (prizesToConvert[v].poolId != poolId) revert BadParameters();
            unchecked { ++v; }
        }
        address poolTokenId = pools[poolId].poolTokenId;
        string memory winCID = pools[poolId].winCID;

        // Mint prize NFTs in batches
        serials = new int64[](count);
        uint256 serialIndex = 0;

        for (uint256 outer = 0; outer < count; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (count - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (count - outer);

            // Prepare metadata for batch
            bytes[] memory batchMetadata = new bytes[](thisBatch);
            for (uint256 inner = 0; inner < thisBatch; ) {
                batchMetadata[inner] = abi.encodePacked(winCID);
                unchecked {
                    ++inner;
                }
            }

            // Mint batch
            int64[] memory batchSerials = storageContract.mintAndTransferNFT(
                poolTokenId,
                msg.sender,
                batchMetadata
            );

            // Store in pendingNFTs mapping and copy serials
            for (uint256 i = 0; i < batchSerials.length; ) {
                uint256 prizeIdx = outer + i;
                serials[serialIndex] = batchSerials[i];

                prizesToConvert[prizeIdx].asNFT = true;
                bytes32 nftKey = keccak256(
                    abi.encode(poolTokenId, batchSerials[i])
                );
                pendingNFTs[nftKey] = prizesToConvert[prizeIdx];

                unchecked {
                    ++serialIndex;
                    ++i;
                }
            }

            emit TicketEvent(
                poolId,
                poolTokenId,
                msg.sender,
                batchSerials,
                true
            );
        }
    }

    /// User claims prizes redeemed from NFTs
    /// @param tokenId The NFT tokenId to claim prizes from
    /// @param serialNumbers The serial numbers of the NFTs to claim prizes from
    function claimPrizeFromNFT(
        address tokenId,
        int64[] memory serialNumbers
    ) external nonReentrant {
        uint256[] memory prizeSlots = _redeemPendingPrizeFromNFT(
            tokenId,
            serialNumbers
        );
        uint256 _length = prizeSlots.length;
        // Claim in reverse order to avoid index shifting issues
        for (uint256 i = _length; i > 0; ) {
            _claimPrize(prizeSlots[i - 1]);
            unchecked {
                --i;
            }
        }
    }

    /// User claims a specific prize by index
    /// @param pkgIdx The index of the prize package to claim
    function claimPrize(uint256 pkgIdx) external nonReentrant {
        _claimPrize(pkgIdx);
    }

    /// User claims all pending prizes
    function claimAllPrizes() external nonReentrant {
        if (pending[msg.sender].length == 0) {
            revert NoPendingPrizes();
        }
        // Iterate by always claiming the prize at index 0
        // This is safe as the array shrinks and elements shift (or last is swapped to 0 and popped)
        while (pending[msg.sender].length > 0) {
            _claimPrize(0);
        }
    }

    /// --- VIEWS (Getters) ---
    /// @notice Get the total number of pools
    /// @return uint256 The total number of pools
    function totalPools() external view returns (uint256) {
        return pools.length;
    }

    /// @notice Get basic pool information without the prizes array
    /// @dev Use this to avoid response size issues with pools that have many prizes
    /// @param id The ID of the pool
    /// @return ticketCID IPFS CID for ticket image
    /// @return winCID IPFS CID for winner image
    /// @return winRateThousandthsOfBps Win rate in thousandths of basis points
    /// @return entryFee Cost to enter (in pool token base units)
    /// @return prizeCount Number of prizes (NOT the array)
    /// @return outstandingEntries Entries purchased but not rolled
    /// @return poolTokenId Token address for pool entry
    /// @return paused Whether pool is paused
    /// @return closed Whether pool is closed
    /// @return feeToken Token address for fees
    function getPoolBasicInfo(
        uint256 id
    )
        external
        view
        returns (
            string memory ticketCID,
            string memory winCID,
            uint256 winRateThousandthsOfBps,
            uint256 entryFee,
            uint256 prizeCount,
            uint256 outstandingEntries,
            address poolTokenId,
            bool paused,
            bool closed,
            address feeToken
        )
    {
        if (id >= pools.length) {
            revert LottoPoolNotFound(id);
        }
        LottoPool storage pool = pools[id];
        return (
            pool.ticketCID,
            pool.winCID,
            pool.winRateThousandthsOfBps,
            pool.entryFee,
            pool.prizes.length,
            pool.outstandingEntries,
            pool.poolTokenId,
            pool.paused,
            pool.closed,
            pool.feeToken
        );
    }

    /// @notice Get the user's entries for a specific pool
    /// @param poolId The ID of the pool to get entries for
    /// @param user The address of the user to get entries for
    /// @return uint256 The number of entries the user has in the specified pool
    function getUsersEntries(
        uint256 poolId,
        address user
    ) external view returns (uint256) {
        return userEntries[poolId][user];
    }

    /// @notice Get a page of user entries across pools
    /// @dev Use this to avoid response size issues with many pools
    /// @param user The address of the user
    /// @param startPoolId Starting pool ID (0-based)
    /// @param count Maximum number of entries to return
    /// @return uint256[] memory Entry counts for requested pool range
    function getUserEntriesPage(
        address user,
        uint256 startPoolId,
        uint256 count
    ) external view returns (uint256[] memory) {
        uint256 poolCount = pools.length;
        if (startPoolId >= poolCount) {
            return new uint256[](0);
        }
        uint256 endPoolId = startPoolId + count;
        if (endPoolId > poolCount) {
            endPoolId = poolCount;
        }
        uint256 resultSize = endPoolId - startPoolId;
        uint256[] memory result = new uint256[](resultSize);
        for (uint256 i = 0; i < resultSize; i++) {
            result[i] = userEntries[startPoolId + i][user];
        }
        return result;
    }

    /// @notice Get count of pending prizes for a user
    /// @dev Use this before fetching to check if pagination needed
    /// @param user The address of the user
    /// @return uint256 Number of pending prizes
    function getPendingPrizesCount(
        address user
    ) external view returns (uint256) {
        return pending[user].length;
    }

    /// @notice Get a page of pending prizes for a user
    /// @dev Use this to avoid response size issues with many prizes
    /// @param user The address of the user
    /// @param startIndex Starting index (0-based)
    /// @param count Maximum number of prizes to return
    /// @return PendingPrize[] memory Slice of user's pending prizes
    function getPendingPrizesPage(
        address user,
        uint256 startIndex,
        uint256 count
    ) external view returns (PendingPrize[] memory) {
        uint256 totalPrizes = pending[user].length;
        if (startIndex >= totalPrizes) {
            return new PendingPrize[](0);
        }
        uint256 endIndex = startIndex + count;
        if (endIndex > totalPrizes) {
            endIndex = totalPrizes;
        }
        uint256 resultSize = endIndex - startIndex;
        PendingPrize[] memory result = new PendingPrize[](resultSize);
        for (uint256 i = 0; i < resultSize; i++) {
            result[i] = pending[user][startIndex + i];
        }
        return result;
    }

    /// @notice Get a specific pending prize for a user by index
    /// @param user The address of the user to get the pending prize for
    /// @param index The index of the pending prize to retrieve
    /// @return PendingPrize The pending prize at the specified index for the user
    function getPendingPrize(
        address user,
        uint256 index
    ) external view returns (PendingPrize memory) {
        // check the user has a pending prize at this index
        if (index >= pending[user].length) {
            revert BadParameters();
        }
        return pending[user][index];
    }

    /// @notice Get a specific pending prize for a user by NFT tokenId and serial number
    /// @param tokenId The NFT tokenId to get the pending prize for
    /// @param serialNumber The serial number of the NFT to get the pending prize for
    /// @return PendingPrize The pending prize for the specified NFT
    function getPendingPrizesByNFT(
        address tokenId,
        uint256 serialNumber
    ) external view returns (PendingPrize memory) {
        return pendingNFTs[keccak256(abi.encode(tokenId, serialNumber))];
    }

    /// @notice Get a specific prize package from a pool by index
    /// @param poolId The ID of the pool to get the prize package from
    /// @param prizeIndex The index of the prize package to retrieve
    /// @return PrizePackage The prize package at the specified index in the pool
    function getPrizePackage(
        uint256 poolId,
        uint256 prizeIndex
    ) external view returns (PrizePackage memory) {
        if (poolId >= pools.length) {
            revert LottoPoolNotFound(poolId);
        }
        if (prizeIndex >= pools[poolId].prizes.length) {
            revert BadParameters();
        }
        return pools[poolId].prizes[prizeIndex];
    }

    /// @notice Get the amount of fungible tokens needed for prizes
    /// @param token The address of the fungible token
    /// @return uint256 The amount of fungible tokens needed
    /// @dev Zero Address(0) indicates HBAR
    function getFungiblesNeededForPrizes(
        address token
    ) external view returns (uint256) {
        return ftTokensForPrizes[token];
    }

    /// @notice Check if an address is an admin
    /// @param a The address to check
    function isAdmin(address a) external view returns (bool) {
        return _isAddressAdmin[a];
    }

    /// @notice Calculate boost for a user based on holdings and time bonuses
    /// @dev Facade to PoolManager for backward compatibility with existing integrations
    /// @param _user The user address
    /// @return boost The calculated boost in basis points (scaled by 10,000)
    function calculateBoost(
        address _user
    ) external view returns (uint32 boost) {
        return poolManager.calculateBoost(_user);
    }

    /// --- INTERNAL FUNCTIONS ---
    /// @dev Shared payment handling logic for HBAR, LAZY, and other fungibles
    /// @param tokenId The token address (address(0) for HBAR)
    /// @param amount The amount to pull from msg.sender
    /// @param burnPercentageForLazy The burn percentage to apply if token is LAZY (0-100)
    /// @return actualAmount The actual amount received (handles fee-on-transfer tokens)
    function _pullPayment(
        address tokenId,
        uint256 amount,
        uint256 burnPercentageForLazy
    ) internal returns (uint256 actualAmount) {
        if (amount == 0) {
            return 0;
        }

        if (tokenId == address(0)) {
            // HBAR - forward to storage contract
            if (msg.value < amount) {
                revert NotEnoughHbar(amount, msg.value);
            }
            // Refund excess HBAR first (before forwarding to storage)
            if (msg.value > amount) {
                Address.sendValue(payable(msg.sender), msg.value - amount);
            }
            // Forward exact amount to storage
            storageContract.depositHbar{value: amount}();
            return amount; // HBAR doesn't have transfer fees
        } else if (tokenId == lazyToken) {
            // Transfer $LAZY to LGS (with optional burn)
            lazyGasStation.drawLazyFrom(
                msg.sender,
                amount,
                burnPercentageForLazy
            );
            return amount; // LazyGasStation handles burns internally
        } else {
            // Other FT tokens - delegate to storage for associate-pull-verify
            // Storage returns actual amount received (handles fee-on-transfer tokens)
            return storageContract.ensureFungibleBalance(tokenId, msg.sender, amount);
        }
    }

    function _checkAndPullFungible(address tokenId, uint256 amount) internal returns (uint256 actualAmount) {
        if (amount == 0) {
            return 0;
        }

        actualAmount = _pullPayment(tokenId, amount, 0);
        ftTokensForPrizes[tokenId] += actualAmount;
    }

    function _redeemEntriesFromNFT(
        uint256 _poolId,
        int64[] memory serialNumbers
    ) internal {
        LottoPool storage p = pools[_poolId];
        uint256 _numTickets = serialNumbers.length;

        // Check for winning tickets - all business logic stays here
        for (uint256 outer = 0; outer < _numTickets; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (_numTickets - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (_numTickets - outer);

            int64[] memory batchSerialsForBurn = new int64[](thisBatch);
            for (
                uint256 inner = 0;
                ((outer + inner) < _numTickets) && (inner < thisBatch);

            ) {
                // Check the serial is not a winning ticket
                if (
                    pendingNFTs[
                        keccak256(
                            abi.encode(
                                p.poolTokenId,
                                serialNumbers[outer + inner]
                            )
                        )
                    ].asNFT
                ) {
                    revert AlreadyWinningTicket();
                }

                batchSerialsForBurn[inner] = serialNumbers[outer + inner];

                unchecked {
                    ++inner;
                }
            }

            emit TicketEvent(
                _poolId,
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn,
                false
            );

            // Call storage to wipe the NFTs
            storageContract.wipeNFT(
                p.poolTokenId,
                msg.sender,
                batchSerialsForBurn
            );

            // Credit the entries to the user and re-add to outstanding for rolling
            userEntries[_poolId][msg.sender] += thisBatch;
            p.outstandingEntries += thisBatch;
        }
    }

    function _redeemPendingPrizeFromNFT(
        address poolTokenId,
        int64[] memory serialNumbers
    ) internal returns (uint256[] memory prizeSlotsInPendingArray) {
        uint256 numSerials = serialNumbers.length;
        if (numSerials == 0) {
            revert BadParameters();
        }

        prizeSlotsInPendingArray = new uint256[](numSerials);
        uint256 poolId = 0;

        // Retrieve prizes from pendingNFTs and add back to pending
        for (uint256 i = 0; i < numSerials; ) {
            bytes32 nftKey = keccak256(
                abi.encode(poolTokenId, serialNumbers[i])
            );
            PendingPrize memory prize = pendingNFTs[nftKey];

            if (!prize.asNFT) {
                revert BadParameters();
            }

            delete pendingNFTs[nftKey];
            prize.asNFT = false;
            poolId = prize.poolId;
            pending[msg.sender].push(prize);
            prizeSlotsInPendingArray[i] = pending[msg.sender].length - 1;

            unchecked {
                ++i;
            }
        }

        // Wipe NFTs in batches
        for (uint256 outer = 0; outer < numSerials; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (numSerials - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (numSerials - outer);

            int64[] memory batchSerialsForWipe = new int64[](thisBatch);
            for (uint256 inner = 0; inner < thisBatch; ) {
                batchSerialsForWipe[inner] = serialNumbers[outer + inner];
                unchecked {
                    ++inner;
                }
            }

            storageContract.wipeNFT(
                poolTokenId,
                msg.sender,
                batchSerialsForWipe
            );
        }

        emit TicketEvent(poolId, poolTokenId, msg.sender, serialNumbers, false);

        return prizeSlotsInPendingArray;
    }

    function _redeemEntriesToNFT(
        uint256 _poolId,
        uint256 _numTickets
    ) internal returns (int64[] memory allSerials) {
        if (_numTickets == 0) {
            revert BadParameters();
        }

        if (userEntries[_poolId][msg.sender] < _numTickets) {
            revert NotEnoughTickets(
                _poolId,
                _numTickets,
                userEntries[_poolId][msg.sender]
            );
        }

        // Remove the tickets from the user's entry count
        userEntries[_poolId][msg.sender] -= _numTickets;

        LottoPool storage p = pools[_poolId];
        p.outstandingEntries -= _numTickets;

        // Pre-allocate array for all serials
        allSerials = new int64[](_numTickets);
        uint256 serialIndex = 0;

        // Mint NFTs in batches
        for (uint256 outer = 0; outer < _numTickets; outer += NFT_BATCH_SIZE) {
            uint256 thisBatch = (_numTickets - outer) >= NFT_BATCH_SIZE
                ? NFT_BATCH_SIZE
                : (_numTickets - outer);

            bytes[] memory batchMetadata = new bytes[](thisBatch);
            for (uint256 inner = 0; inner < thisBatch; ) {
                batchMetadata[inner] = bytes(p.ticketCID);
                unchecked {
                    ++inner;
                }
            }

            int64[] memory batchSerials = storageContract.mintAndTransferNFT(
                p.poolTokenId,
                msg.sender,
                batchMetadata
            );

            // Copy batch serials to result array
            for (uint256 i = 0; i < batchSerials.length; ) {
                allSerials[serialIndex++] = batchSerials[i];
                unchecked {
                    ++i;
                }
            }

            emit TicketEvent(
                _poolId,
                p.poolTokenId,
                msg.sender,
                batchSerials,
                true
            );
        }
    }

    function _buyEntry(
        uint256 poolId,
        uint256 ticketCount,
        bool isFreeOfPayment,
        address recipient
    ) internal {
        if (ticketCount == 0) {
            revert BadParameters();
        }

        LottoPool storage p = pools[poolId];

        if (p.paused) {
            revert PoolOnPause();
        }

        if (!isFreeOfPayment) {
            uint256 totalFee = p.entryFee * ticketCount;
            uint256 poolBurn = poolManager.getPoolBurnPercentage(poolId);
            uint256 actualCollected = _pullPayment(p.feeToken, totalFee, poolBurn);

            // For LAZY, _pullPayment returns full amount (gas station handles burn internally)
            // so we need to calculate the post-burn amount for proceeds recording
            if (p.feeToken == lazyToken && poolBurn > 0) {
                // Account for burn on LAZY
                actualCollected =
                    totalFee -
                    ((totalFee * poolBurn) / 100);
            }
            poolManager.recordProceeds(poolId, p.feeToken, actualCollected);
        }

        p.outstandingEntries += ticketCount;
        userEntries[poolId][recipient] += ticketCount;
        emit EntryPurchased(recipient, poolId, ticketCount);
    }

    function _roll(
        uint256 poolId,
        uint256 numberToRoll
    ) internal returns (uint256 wins, uint256 offset) {
        uint32 boostBps = poolManager.calculateBoost(msg.sender);

        LottoPool storage p = pools[poolId];

        // ensure we know the total number of prizes available
        uint256 totalPrizesAvailable = p.prizes.length;
        if (totalPrizesAvailable == 0) {
            revert NoPrizesAvailable();
        }

        if (userEntries[poolId][msg.sender] < numberToRoll) {
            revert NotEnoughTickets(
                poolId,
                numberToRoll,
                userEntries[poolId][msg.sender]
            );
        }

        p.outstandingEntries -= numberToRoll;
        userEntries[poolId][msg.sender] -= numberToRoll;

        // boostBps is already scaled to 10_000s of bps in calculateBoost
        uint256 winRateWithBoost = p.winRateThousandthsOfBps + boostBps;

        if (winRateWithBoost > MAX_WIN_RATE_THRESHOLD) {
            winRateWithBoost = MAX_WIN_RATE_THRESHOLD;
        }

        offset = pending[msg.sender].length;

        // Generate random numbers for win determination
        uint256[] memory rolls = prng.getPseudorandomNumberArray(
            0, // min value for random number
            MAX_WIN_RATE_THRESHOLD, // max value for random number (exclusive for PRNG, so 0 to 99,999,999)
            uint256(
                keccak256(
                    abi.encodePacked(
                        block.timestamp,
                        msg.sender,
                        poolId,
                        numberToRoll
                    )
                )
            ), // seed
            numberToRoll
        );

        // Generate separate random numbers for prize selection (avoids modulo bias and ensures independence)
        uint256[] memory prizeRolls = prng.getPseudorandomNumberArray(
            0, // min value
            type(uint256).max, // max value (full range for better distribution)
            uint256(
                keccak256(
                    abi.encodePacked(
                        block.timestamp,
                        msg.sender,
                        poolId,
                        numberToRoll,
                        "prize" // different seed domain
                    )
                )
            ), // different seed from win rolls
            numberToRoll
        );

        for (uint256 i = 0; i < numberToRoll; i++) {
            bool won = rolls[i] < winRateWithBoost;
            emit Rolled(msg.sender, poolId, won, rolls[i]); // Emit roll event regardless of win

            if (won && totalPrizesAvailable > 0) {
                // Use independent random number for prize selection
                uint256 prizeSelectionIndex = prizeRolls[i] %
                    totalPrizesAvailable;
                PrizePackage memory pkg = p.prizes[prizeSelectionIndex];

                // Remove prize from pool by swapping with last and popping
                p.prizes[prizeSelectionIndex] = p.prizes[
                    totalPrizesAvailable - 1
                ];
                p.prizes.pop();

                totalPrizesAvailable--; // Decrement available prizes
                wins++;

                pending[msg.sender].push(
                    PendingPrize({poolId: poolId, prize: pkg, asNFT: false})
                );
            }
        }
    }

    function _claimPrize(uint256 pkgIdx) internal {
        PendingPrize[] memory userPending = pending[msg.sender];
        if (userPending.length == 0) {
            revert NoPendingPrizes();
        }

        // check the user has a pending prize at this index
        if (pkgIdx >= userPending.length) {
            revert BadParameters();
        }

        // get the prize from the array and remove it
        PendingPrize memory claimedPrize = userPending[pkgIdx];
        pending[msg.sender][pkgIdx] = pending[msg.sender][
            pending[msg.sender].length - 1
        ];
        pending[msg.sender].pop();

        emit PrizeClaimed(msg.sender, claimedPrize.prize);

        // update the ftTokensForPrizes
        ftTokensForPrizes[claimedPrize.prize.token] -= claimedPrize
            .prize
            .amount;

        // pay out the fungible prize from storage contract
        if (claimedPrize.prize.amount > 0) {
            _transferToken(claimedPrize.prize.token, msg.sender, claimedPrize.prize.amount);
        }

        storageContract.bulkTransferNFTs(
            false, // withdrawal (storage -> user)
            claimedPrize.prize.nftTokens,
            claimedPrize.prize.nftSerials,
            msg.sender
        );
    }

    /// --- Token Transfer Functions ---

    /// @notice Transfer HBAR from LazyLotto contract (for any HBAR sent directly to this contract)
    /// @param receiverAddress address in EVM format of the receiver of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbar(
        address payable receiverAddress,
        uint256 amount
    ) external nonReentrant {
        _requireAdmin();
        if (receiverAddress == address(0) || amount == 0) {
            revert BadParameters();
        }

        if (address(this).balance < amount) {
            revert BalanceError(address(0), address(this).balance, amount);
        }

        // safe transfer of hbar to the receiver address
        Address.sendValue(receiverAddress, amount);

        emit ContractUpdate(MethodEnum.HBAR_TRANSFER, msg.sender, amount);
    }

    /// @notice Transfer HBAR from LazyLottoStorage contract (with safety checks for prize obligations)
    /// @param receiverAddress address in EVM format of the receiver of the token
    /// @param amount number of tokens to send (in tinybar i.e. adjusted for decimal)
    function transferHbarFromStorage(
        address payable receiverAddress,
        uint256 amount
    ) external nonReentrant {
        _requireAdmin();
        if (receiverAddress == address(0) || amount == 0) {
            revert BadParameters();
        }

        // Safety check: ensure storage retains enough HBAR for all outstanding prizes
        uint256 storageBalance = address(storageContract).balance;
        uint256 required = _getMinStorageBalance(address(0));

        if (storageBalance < amount) {
            revert BalanceError(address(0), storageBalance, amount);
        }

        if (storageBalance - amount < required) {
            revert BalanceError(
                address(0),
                storageBalance - amount,
                required
            );
        }

        storageContract.withdrawHbar(receiverAddress, amount);

        emit ContractUpdate(MethodEnum.HBAR_TRANSFER, msg.sender, amount);
    }

    /// @notice Transfer fungible tokens from LazyLottoStorage contract (with safety checks for prize obligations)
    /// @param _tokenAddress The token address
    /// @param _receiver The receiver address
    /// @param _amount The amount to transfer
    function transferFungible(
        address _tokenAddress,
        address _receiver,
        uint256 _amount
    ) external nonReentrant {
        _requireAdmin();
        if (
            _receiver == address(0) ||
            _amount == 0 ||
            _tokenAddress == address(0)
        ) {
            revert BadParameters();
        }

        // Safety check: ensure storage retains enough for prizes + proceeds obligations
        uint256 storageBalance = IERC20(_tokenAddress).balanceOf(
            address(storageContract)
        );
        uint256 required = _getMinStorageBalance(_tokenAddress);

        if (storageBalance < _amount) {
            revert BalanceError(_tokenAddress, storageBalance, _amount);
        }

        if (storageBalance - _amount < required) {
            revert BalanceError(
                _tokenAddress,
                storageBalance - _amount,
                required
            );
        }

        storageContract.withdrawFungible(_tokenAddress, _receiver, _amount);

        emit ContractUpdate(MethodEnum.FT_TRANSFER, msg.sender, _amount);
    }

    /// @dev Calculate minimum storage balance required for prizes + proceeds obligations
    function _getMinStorageBalance(address token) internal view returns (uint256) {
        return ftTokensForPrizes[token]
            + poolManager.pendingWithdrawals(token)
            + poolManager.getPlatformBalance(token);
    }

    /// @notice Pool owner or admin withdraws proceeds from a pool
    /// @param poolId The pool ID
    /// @param token The token address (address(0) for HBAR)
    function withdrawPoolProceeds(
        uint256 poolId,
        address token
    ) external nonReentrant {
        // PoolManager validates authorization and calculates split
        uint256 ownerShare = poolManager.requestWithdrawal(
            poolId,
            token,
            msg.sender
        );

        address poolOwner = poolManager.getPoolOwner(poolId);
        _transferToken(token, poolOwner, ownerShare);
    }

    /// @notice Admin withdraws all proceeds from a global (team-owned) pool
    /// @param poolId The pool ID (must be a global pool)
    /// @param token The token address (address(0) for HBAR)
    function withdrawGlobalPoolProceeds(
        uint256 poolId,
        address token
    ) external nonReentrant {
        _requireAdmin();

        uint256 amount = poolManager.requestGlobalWithdrawal(poolId, token);
        _transferToken(token, msg.sender, amount);
    }

    /// @notice Admin withdraws platform fees accumulated from pool proceeds
    /// @param token The token address (address(0) for HBAR)
    function withdrawPlatformFees(address token) external nonReentrant {
        _requireAdmin();

        uint256 amount = poolManager.getPlatformBalance(token);
        if (amount == 0) {
            revert BadParameters();
        }

        // Reset platform balance in PoolManager
        poolManager.withdrawPlatformFees(token);
        _transferToken(token, msg.sender, amount);
    }

    /// @dev Internal helper to transfer HBAR, LAZY, or other fungible tokens
    function _transferToken(address token, address recipient, uint256 amount) internal {
        if (token == address(0)) {
            storageContract.withdrawHbar(payable(recipient), amount);
        } else if (token == lazyToken) {
            lazyGasStation.payoutLazy(recipient, amount, 0);
        } else {
            storageContract.withdrawFungible(token, recipient, amount);
        }
    }

    receive() external payable {
        emit ContractUpdate(MethodEnum.RECEIVE, msg.sender, msg.value);
    }

    fallback() external payable {
        emit ContractUpdate(MethodEnum.FALLBACK, msg.sender, msg.value);
    }
}
