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

/// @title LazyLottoStorage
/// @author stowerling.eth / stowerling.hbar
/// @notice Handles all HTS token operations and acts as token custody/treasury for LazyLotto
/// @dev This contract holds all tokens (HBAR, FT, NFT) and is called exclusively by authorized admin addresses (LazyLotto)
/// @dev Users must approve tokens to this contract address for LazyLotto operations to work

import {IHederaTokenServiceLite} from "./interfaces/IHederaTokenServiceLite.sol";
import {HederaTokenServiceLite} from "./HederaTokenServiceLite.sol";
import {KeyHelperLite} from "./KeyHelperLite.sol";
import {HederaResponseCodes} from "./HederaResponseCodes.sol";
import {ILazyGasStation} from "./interfaces/ILazyGasStation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title LazyLottoStorage
/// @notice Storage and HTS operations contract - holds all tokens and executes all token operations for LazyLotto
contract LazyLottoStorage is HederaTokenServiceLite, KeyHelperLite {
    using SafeCast for uint256;
    using SafeCast for int256;

    // --- ERRORS ---
    error NotAdmin();
    error NotContractUser();
    error BadParameters();
    error LastAdminError();
    error ContractUserAlreadySet();
    error FailedNFTCreate();
    error FailedNFTMintAndSend();
    error FailedNFTWipe();
    error AssociationFailed(address tokenAddress);
    error InsufficientTokenBalance(address token, uint256 required, uint256 available);
    error FungibleWithdrawalFailed(address token);
    error InsufficientHbarBalance(uint256 required, uint256 available);
    error PullFungibleFailed(address token, address from);
    error FungibleTransferFailed(address token);
    error CryptoTransferFailed(int32 responseCode);
    error NFTCollectionTransferFailed(address token, int32 responseCode);
    error NFTBulkTransferFailed(int32 responseCode);

    // --- EVENTS ---
    event AdminAdded(address indexed admin);
    event AdminRemoved(address indexed admin);
    event ContractUserSet(address indexed contractUser);
    event HbarWithdrawn(address indexed recipient, uint256 amount);
    event TokenCreated(address indexed tokenAddress, address indexed creator);
    event TokenAssociated(address indexed tokenAddress);
    event HbarTransferred(address indexed to, uint256 amount);
    event HbarDeposited(uint256 amount);
    event FungibleTransferred(
        address indexed token,
        address indexed to,
        uint256 amount
    );
    event FungiblePulled(
        address indexed token,
        address indexed from,
        uint256 requestedAmount,
        uint256 actualAmount
    );
    event NFTCollectionTransferred(
        address indexed token,
        address indexed from,
        address indexed to,
        uint256 count
    );

    // --- CONSTANTS ---
    uint32 private constant DEFAULT_AUTO_RENEW_PERIOD = 7776000; // 90 days
    /// @dev Maximum 8 NFTs per transaction because HTS cryptoTransfer has 10-leg limit:
    /// 8 NFT transfers + 2 HBAR legs (dust transfer for discovery) = 10 total legs
    uint256 private constant MAX_NFTS_PER_TX = 8;
    uint256 private constant MIN_HBAR_BALANCE = 20; // Minimum HBAR before refill (in tinybars)
    uint256 private constant HBAR_REFILL_AMOUNT = 100; // Standard refill amount (in tinybars)

    // --- STATE ---
    mapping(address => bool) private _isAddressAdmin;
    uint256 private _adminCount;
    address private _contractUser; // LazyLotto contract address (one-time settable)
    bool private _contractUserSet; // Lock flag
    ILazyGasStation public lazyGasStation; // For HBAR refills during bulk transfers

    // --- STRUCTS ---
    struct NFTFeeObject {
        uint32 numerator;
        uint32 denominator;
        uint32 fallbackfee;
        address account;
    }

    // --- CONSTRUCTOR ---
    /// @param _lazyGasStation The address of the LazyGasStation contract for HBAR refills
    /// @param _lazyToken The address of the LAZY token to associate during deployment
    constructor(address _lazyGasStation, address _lazyToken) {
        if (_lazyGasStation == address(0) || _lazyToken == address(0)) {
            revert BadParameters();
        }

        lazyGasStation = ILazyGasStation(_lazyGasStation);

        // Associate LAZY token to storage contract during deployment
        // This must happen in storage constructor BEFORE LazyLotto tries to use it
        _associateToken(_lazyToken);

        _isAddressAdmin[msg.sender] = true;
        _adminCount = 1;
        emit AdminAdded(msg.sender);
    }

    // --- MODIFIERS ---
    modifier onlyAdmin() {
        if (!_isAddressAdmin[msg.sender]) {
            revert NotAdmin();
        }
        _;
    }

    modifier onlyContractUser() {
        if (msg.sender != _contractUser) {
            revert NotContractUser();
        }
        _;
    }

    // --- ADMIN MANAGEMENT ---
    /// @notice Add an admin address
    /// @param a The address to add as admin
    function addAdmin(address a) external onlyAdmin {
        if (a == address(0)) revert BadParameters();
        if (!_isAddressAdmin[a]) {
            _isAddressAdmin[a] = true;
            _adminCount++;
            emit AdminAdded(a);
        }
    }

    /// @notice Remove an admin address
    /// @param a The address to remove as admin
    function removeAdmin(address a) external onlyAdmin {
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

    /// @notice Set the contract user (one-time only - typically the LazyLotto contract)
    /// @param contractUser The address of the contract that will use HTS operations
    /// @dev Can only be set once and cannot be changed afterwards
    function setContractUser(address contractUser) external onlyAdmin {
        if (contractUser == address(0)) revert BadParameters();
        if (_contractUserSet) revert ContractUserAlreadySet();

        _contractUser = contractUser;
        _contractUserSet = true;
        emit ContractUserSet(contractUser);
    }

    /// @notice Check if an address is an admin
    /// @param a The address to check
    /// @return True if the address is an admin
    function isAdmin(address a) external view returns (bool) {
        return _isAddressAdmin[a];
    }

    /// @notice Get the contract user address
    /// @return The address of the contract user
    function getContractUser() external view returns (address) {
        return _contractUser;
    }

    // --- TOKEN ASSOCIATION ---
    /// @notice Associate a token to an account
    /// @param token The token address to associate
    function associateTokenToStorage(address token) external onlyContractUser {
        _associateToken(token);
    }

    /// @notice Internal helper to associate token and emit event
    /// @param token The token address to associate
    function _associateToken(address token) internal {
        int32 responseCode = associateToken(address(this), token);

        if (
            responseCode != HederaResponseCodes.SUCCESS &&
            responseCode !=
            HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT
        ) {
            revert AssociationFailed(token);
        }

        emit TokenAssociated(token);
    }

    // --- HBAR OPERATIONS ---
    /// @notice Withdraw HBAR from contract (called by LazyLotto with safety checks)
    /// @param recipient The address to receive the HBAR
    /// @param amount The amount of HBAR to withdraw (in tinybars)
    function withdrawHbar(
        address payable recipient,
        uint256 amount
    ) external onlyContractUser {
        if (recipient == address(0) || amount == 0) {
            revert BadParameters();
        }
        if (address(this).balance < amount) {
            revert BadParameters();
        }

        Address.sendValue(recipient, amount);
        emit HbarWithdrawn(recipient, amount);
    }

    /// @notice Withdraw fungible tokens from contract (called by LazyLotto with safety checks)
    /// @param token The token address
    /// @param recipient The address to receive the tokens
    /// @param amount The amount of tokens to withdraw
    function withdrawFungible(
        address token,
        address recipient,
        uint256 amount
    ) external onlyContractUser {
        if (token == address(0) || recipient == address(0) || amount == 0) {
            revert BadParameters();
        }

        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) {
            revert InsufficientTokenBalance(token, amount, balance);
        }

        bool success = IERC20(token).transfer(recipient, amount);
        if (!success) {
            revert FungibleWithdrawalFailed(token);
        }

        emit FungibleTransferred(token, recipient, amount);
    }

    /// @notice Transfer HBAR from contract to recipient
    /// @param to The recipient address
    /// @param amount The amount of HBAR to transfer (in tinybars)
    function transferHbar(
        address payable to,
        uint256 amount
    ) external onlyContractUser {
        if (to == address(0) || amount == 0) {
            revert BadParameters();
        }
        if (address(this).balance < amount) {
            revert InsufficientHbarBalance(amount, address(this).balance);
        }

        Address.sendValue(to, amount);
        emit HbarTransferred(to, amount);
    }

    /// @notice Receive HBAR into storage (called with value transfer)
    /// @dev Used for entry fees and prize deposits
    function depositHbar() external payable onlyContractUser {
        if (msg.value == 0) {
            revert BadParameters();
        }
        // HBAR is now held in this contract's balance
        emit HbarDeposited(msg.value);
    }

    // --- FUNGIBLE TOKEN OPERATIONS ---
    /// @notice Pull fungible tokens from a user to this storage contract
    /// @param token The token address
    /// @param from The address to pull tokens from
    /// @param amount The amount to pull
    /// @return actualAmount The actual amount received (handles fee-on-transfer tokens)
    /// @dev Requires the user to have approved this storage contract for the token
    function pullFungibleFrom(
        address token,
        address from,
        uint256 amount
    ) external onlyContractUser returns (uint256 actualAmount) {
        if (token == address(0) || from == address(0) || amount == 0) {
            revert BadParameters();
        }

        // Check balance before transfer (for fee-on-transfer token detection)
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));

        // Use standard ERC20 transferFrom - storage contract uses its allowance
        bool success = IERC20(token).transferFrom(from, address(this), amount);

        if (!success) {
            revert PullFungibleFailed(token, from);
        }

        // Check balance after transfer to get actual received amount
        uint256 balanceAfter = IERC20(token).balanceOf(address(this));
        actualAmount = balanceAfter - balanceBefore;

        emit FungiblePulled(token, from, amount, actualAmount);

        return actualAmount;
    }

    /// @notice Ensure storage has sufficient balance, auto-associating and pulling if needed
    /// @param token The token address
    /// @param from The address to pull tokens from
    /// @param amountToPull The amount to pull from user
    /// @return actualAmount The actual amount received (handles fee-on-transfer tokens)
    /// @dev Auto-associates if first time seeing token, then pulls requested amount
    function ensureFungibleBalance(
        address token,
        address from,
        uint256 amountToPull
    ) external onlyContractUser returns (uint256 actualAmount) {
        if (token == address(0) || from == address(0)) {
            revert BadParameters();
        }

        // Auto-associate if balance is zero (first time seeing this token)
        uint256 currentBalance = IERC20(token).balanceOf(address(this));
        if (currentBalance == 0) {
            _associateToken(token); // Reuse internal helper
        }

        // Pull the requested amount from user (if any)
        if (amountToPull > 0) {
            // Check balance before transfer (for fee-on-transfer token detection)
            uint256 balanceBefore = IERC20(token).balanceOf(address(this));

            bool success = IERC20(token).transferFrom(
                from,
                address(this),
                amountToPull
            );
            if (!success) {
                revert PullFungibleFailed(token, from);
            }

            // Check balance after transfer to get actual received amount
            uint256 balanceAfter = IERC20(token).balanceOf(address(this));
            actualAmount = balanceAfter - balanceBefore;

            emit FungiblePulled(token, from, amountToPull, actualAmount);
        }

        return actualAmount;
    }

    /// @notice Transfer fungible tokens from contract to recipient
    /// @param token The token address
    /// @param to The recipient address
    /// @param amount The amount to transfer
    function transferFungible(
        address token,
        address to,
        uint256 amount
    ) external onlyContractUser {
        if (token == address(0) || to == address(0) || amount == 0) {
            revert BadParameters();
        }

        // Use cryptoTransfer for fungible token transfers
        IHederaTokenServiceLite.AccountAmount[]
            memory transfers = new IHederaTokenServiceLite.AccountAmount[](2);
        transfers[0] = IHederaTokenServiceLite.AccountAmount({
            accountID: address(this),
            amount: -amount.toInt256().toInt64(),
            isApproval: false
        });
        transfers[1] = IHederaTokenServiceLite.AccountAmount({
            accountID: to,
            amount: amount.toInt256().toInt64(),
            isApproval: false
        });

        IHederaTokenServiceLite.TokenTransferList[]
            memory tokenTransferList = new IHederaTokenServiceLite.TokenTransferList[](
                1
            );
        tokenTransferList[0] = IHederaTokenServiceLite.TokenTransferList({
            token: token,
            transfers: transfers,
            nftTransfers: new IHederaTokenServiceLite.NftTransfer[](0)
        });

        int32 responseCode = cryptoTransfer(
            IHederaTokenServiceLite.TransferList({
                transfers: new IHederaTokenServiceLite.AccountAmount[](0)
            }),
            tokenTransferList
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FungibleTransferFailed(token);
        }

        emit FungibleTransferred(token, to, amount);
    }

    /// @notice Execute atomic multi-token transfer (for prize distributions)
    /// @param transferList The HBAR transfer list
    /// @param tokenTransfers The token transfer list
    function executeCryptoTransfer(
        IHederaTokenServiceLite.TransferList memory transferList,
        IHederaTokenServiceLite.TokenTransferList[] memory tokenTransfers
    ) external onlyContractUser {
        int32 responseCode = cryptoTransfer(transferList, tokenTransfers);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert CryptoTransferFailed(responseCode);
        }
    }

    // --- TOKEN CREATION ---
    /// @notice Create an NFT token
    /// @param _name Token name
    /// @param _symbol Token symbol
    /// @param _memo Token memo
    /// @param _royalties Array of royalty fee objects
    /// @return tokenAddress The address of the created token
    function createToken(
        string memory _name,
        string memory _symbol,
        string memory _memo,
        NFTFeeObject[] memory _royalties
    ) external payable onlyContractUser returns (address tokenAddress) {
        if (
            bytes(_name).length == 0 ||
            bytes(_symbol).length == 0 ||
            bytes(_memo).length == 0 ||
            bytes(_memo).length > 100 ||
            _royalties.length > 10
        ) {
            revert BadParameters();
        }

        // Setup token keys - storage contract (this) has supply and wipe keys
        IHederaTokenServiceLite.TokenKey[]
            memory _keys = new IHederaTokenServiceLite.TokenKey[](1);

        _keys[0] = getSingleKey(
            KeyType.SUPPLY,
            KeyType.WIPE,
            KeyValueType.CONTRACT_ID,
            address(this)
        );

        IHederaTokenServiceLite.HederaToken memory _token;
        _token.name = _name;
        _token.symbol = _symbol;
        _token.memo = _memo;
        _token.treasury = address(this); // Storage contract is the treasury
        _token.tokenKeys = _keys;
        _token.tokenSupplyType = true; // finite supply (default is infinite)
        _token.maxSupply = 0x7FFFFFFFFFFFFFFF; // int64 max

        _token.expiry = createAutoRenewExpiry(
            address(this), // Storage contract is auto-renew account
            DEFAULT_AUTO_RENEW_PERIOD
        );

        // Setup royalty fees
        IHederaTokenServiceLite.RoyaltyFee[]
            memory _fees = new IHederaTokenServiceLite.RoyaltyFee[](
                _royalties.length
            );

        for (uint256 f = 0; f < _royalties.length; ) {
            IHederaTokenServiceLite.RoyaltyFee memory _fee;
            _fee.numerator = _royalties[f].numerator;
            _fee.denominator = _royalties[f].denominator;
            _fee.feeCollector = _royalties[f].account;

            if (_royalties[f].fallbackfee != 0) {
                _fee.amount = _royalties[f].fallbackfee;
                _fee.useHbarsForPayment = true;
            }

            _fees[f] = _fee;

            unchecked {
                ++f;
            }
        }

        (
            int32 responseCode,
            address _tokenAddress
        ) = createNonFungibleTokenWithCustomFees(
                _token,
                new IHederaTokenServiceLite.FixedFee[](0),
                _fees
            );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedNFTCreate();
        }

        emit TokenCreated(_tokenAddress, msg.sender);
        return _tokenAddress;
    }

    // --- NFT MINTING & TRANSFER ---
    /// @notice Mint NFTs and transfer them to a receiver
    /// @param token The NFT token address
    /// @param receiver The receiver address
    /// @param metadata Array of metadata for the NFTs
    /// @return serialNumbers Array of minted serial numbers
    /// @dev NFTs are minted to treasury (this contract) and then transferred to receiver
    function mintAndTransferNFT(
        address token,
        address receiver,
        bytes[] memory metadata
    ) external onlyContractUser returns (int64[] memory serialNumbers) {
        // 1. Mint NFT to treasury (this contract)
        int32 responseCode;
        uint64 newTotalSupply;
        (responseCode, newTotalSupply, serialNumbers) = mintToken(
            token,
            0,
            metadata
        );

        if (
            responseCode != HederaResponseCodes.SUCCESS ||
            serialNumbers.length == 0
        ) {
            revert FailedNFTMintAndSend();
        }

        // 2. Transfer the minted NFTs from treasury to receiver
        address[] memory senderAddresses = new address[](serialNumbers.length);
        address[] memory receiverAddresses = new address[](
            serialNumbers.length
        );

        for (uint256 i = 0; i < serialNumbers.length; i++) {
            senderAddresses[i] = address(this); // Always treasury
            receiverAddresses[i] = receiver;
        }

        responseCode = transferNFTs(
            token,
            senderAddresses,
            receiverAddresses,
            serialNumbers
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedNFTMintAndSend();
        }
    }

    /// @notice Transfer NFT collection from one account to another
    /// @param token The NFT token address
    /// @param from The sender address
    /// @param to The receiver address
    /// @param serialNumbers Array of serial numbers to transfer
    function transferNFTCollection(
        address token,
        address from,
        address to,
        int64[] memory serialNumbers
    ) external onlyContractUser {
        if (
            token == address(0) ||
            from == address(0) ||
            to == address(0) ||
            serialNumbers.length == 0
        ) {
            revert BadParameters();
        }

        address[] memory senderAddresses = new address[](serialNumbers.length);
        address[] memory receiverAddresses = new address[](
            serialNumbers.length
        );

        for (uint256 i = 0; i < serialNumbers.length; i++) {
            senderAddresses[i] = from;
            receiverAddresses[i] = to;
        }

        int32 responseCode = transferNFTs(
            token,
            senderAddresses,
            receiverAddresses,
            serialNumbers
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTCollectionTransferFailed(token, responseCode);
        }

        emit NFTCollectionTransferred(token, from, to, serialNumbers.length);
    }

    // --- NFT WIPING ---
    /// @notice Wipe (burn) NFTs from an account
    /// @param token The NFT token address
    /// @param account The account to wipe from
    /// @param serialNumbers Array of serial numbers to wipe
    function wipeNFT(
        address token,
        address account,
        int64[] memory serialNumbers
    ) external onlyContractUser {
        int256 responseCode = wipeTokenAccountNFT(
            token,
            account,
            serialNumbers
        );

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert FailedNFTWipe();
        }
    }

    // --- BULK NFT TRANSFER OPERATIONS ---
    /// @notice Move NFTs with HBAR dust transfer for discovery
    /// @param isStaking True if staking (user->contract), false if withdrawing (contract->user)
    /// @param collectionAddress The NFT collection address
    /// @param serials Array of serial numbers (max 8)
    /// @param eoaAddress The user's address
    function moveNFTsWithHbar(
        bool isStaking,
        address collectionAddress,
        uint256[] memory serials,
        address eoaAddress
    ) public onlyContractUser {
        _moveNFTsWithHbar(isStaking, collectionAddress, serials, eoaAddress);
    }

    /// @notice Bulk transfer NFTs for prizes (staking or withdrawal)
    /// @param isStaking True if staking (user->storage), false if withdrawing (storage->user)
    /// @param nftTokens Array of NFT collection addresses
    /// @param nftSerials 2D array of serial numbers for each collection
    /// @param eoaAddress The user's address
    function bulkTransferNFTs(
        bool isStaking,
        address[] memory nftTokens,
        uint256[][] memory nftSerials,
        address eoaAddress
    ) external onlyContractUser {
        // Check HBAR balance and refill if needed
        if (address(this).balance < MIN_HBAR_BALANCE) {
            lazyGasStation.refillHbar(HBAR_REFILL_AMOUNT);
        }

        uint256 length = nftTokens.length;
        for (uint256 i = 0; i < length; ) {
            // Auto-associate if staking and not yet associated
            if (isStaking) {
                if (IERC721(nftTokens[i]).balanceOf(address(this)) == 0) {
                    _associateToken(nftTokens[i]);
                }
            }

            // Transfer NFTs in batches of MAX_NFTS_PER_TX
            _batchMoveNFTs(isStaking, nftTokens[i], nftSerials[i], eoaAddress);

            unchecked {
                ++i;
            }
        }
    }

    /// @notice Internal helper to move NFTs in batches
    /// @param isStaking True if staking (user->storage), false if withdrawing (storage->user)
    /// @param collectionAddress The NFT collection address
    /// @param serials Array of serial numbers
    /// @param eoaAddress The user's address
    function _batchMoveNFTs(
        bool isStaking,
        address collectionAddress,
        uint256[] memory serials,
        address eoaAddress
    ) internal {
        for (
            uint256 outer = 0;
            outer < serials.length;
            outer += MAX_NFTS_PER_TX
        ) {
            uint256 batchSize = (serials.length - outer) >= MAX_NFTS_PER_TX
                ? MAX_NFTS_PER_TX
                : (serials.length - outer);

            uint256[] memory batchSerials = new uint256[](batchSize);
            for (uint256 inner = 0; inner < batchSize; ) {
                if (outer + inner < serials.length) {
                    batchSerials[inner] = serials[outer + inner];
                }
                unchecked {
                    ++inner;
                }
            }

            // Call internal implementation
            _moveNFTsWithHbar(
                isStaking,
                collectionAddress,
                batchSerials,
                eoaAddress
            );
        }
    }

    /// @notice Internal implementation of NFT transfer with HBAR dust
    /// @param isStaking True if staking (user->storage), false if withdrawing (storage->user)
    /// @param collectionAddress The NFT collection address
    /// @param serials Array of serial numbers (max 8)
    /// @param eoaAddress The user's address
    function _moveNFTsWithHbar(
        bool isStaking,
        address collectionAddress,
        uint256[] memory serials,
        address eoaAddress
    ) internal {
        if (serials.length > 8) revert BadParameters();

        address receiverAddress;
        address senderAddress;
        bool isHbarApproval;

        if (isStaking) {
            receiverAddress = address(this); // storage contract receives
            senderAddress = eoaAddress;
        } else {
            receiverAddress = eoaAddress;
            senderAddress = address(this); // storage contract sends
            isHbarApproval = true;
        }

        // prep the hbar transfer (1 tinybar for discovery). hbar legs sit separate from NFT moves
        // (max 8 NFTs + 2 hbar legs stays within Hedera's per-tx balance/ownership-change limits).
        IHederaTokenServiceLite.TransferList memory hbarTransfer;
        hbarTransfer.transfers = new IHederaTokenServiceLite.AccountAmount[](2);

        hbarTransfer.transfers[0].accountID = receiverAddress;
        hbarTransfer.transfers[0].amount = -1;
        hbarTransfer.transfers[0].isApproval = isHbarApproval;

        hbarTransfer.transfers[1].accountID = senderAddress;
        hbarTransfer.transfers[1].amount = 1;

        // A SINGLE TokenTransferList for the collection, carrying one NftTransfer per serial.
        // (One list per serial repeats the token ID -> TOKEN_ID_REPEATED_IN_TOKEN_LIST, which
        // reverted every multi-serial single-collection move.) Size to the non-zero serials.
        uint256 count;
        for (uint256 i = 0; i < serials.length; i++) {
            if (serials[i] != 0) {
                unchecked {
                    ++count;
                }
            }
        }

        IHederaTokenServiceLite.TokenTransferList[]
            memory transfers = new IHederaTokenServiceLite.TokenTransferList[](
                1
            );
        transfers[0].token = collectionAddress;
        transfers[0].nftTransfers = new IHederaTokenServiceLite.NftTransfer[](
            count
        );

        uint256 j;
        for (uint256 i = 0; i < serials.length; i++) {
            if (serials[i] == 0) {
                continue;
            }
            transfers[0].nftTransfers[j].senderAccountID = senderAddress;
            transfers[0].nftTransfers[j].receiverAccountID = receiverAddress;
            transfers[0].nftTransfers[j].serialNumber = int64(
                int256(serials[i])
            );
            transfers[0].nftTransfers[j].isApproval = !isHbarApproval;
            unchecked {
                ++j;
            }
        }

        int32 responseCode = cryptoTransfer(hbarTransfer, transfers);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert NFTBulkTransferFailed(responseCode);
        }
    }

    // --- FALLBACK ---
    receive() external payable {}
    fallback() external payable {}
}
