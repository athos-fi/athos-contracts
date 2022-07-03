// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IAssetRegistry.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IOracleRouter.sol";
import "./libraries/SafeDecimalMath.sol";

contract ExchangeSystem is OwnableUpgradeable {
    using SafeDecimalMath for uint256;
    using SafeMathUpgradeable for uint256;

    event ExchangeAsset(
        address fromAddr,
        bytes32 sourceKey,
        uint256 sourceAmount,
        address destAddr,
        bytes32 destKey,
        uint256 destRecived,
        uint256 feeForPool,
        uint256 feeForFoundation
    );
    event FoundationFeeHolderChanged(address oldHolder, address newHolder);
    event ExitPositionOnlyChanged(bool oldValue, bool newValue);
    event PendingExchangeAdded(
        uint256 id,
        address fromAddr,
        address destAddr,
        uint256 fromAmount,
        bytes32 fromCurrency,
        bytes32 toCurrency
    );
    event PendingExchangeSettled(
        uint256 id,
        address settler,
        uint256 destRecived,
        uint256 feeForPool,
        uint256 feeForFoundation
    );
    event PendingExchangeReverted(uint256 id);
    event AssetExitPositionOnlyChanged(bytes32 asset, bool newValue);

    struct PendingExchangeEntry {
        uint64 id;
        uint64 timestamp;
        address fromAddr;
        address destAddr;
        uint256 fromAmount;
        bytes32 fromCurrency;
        bytes32 toCurrency;
    }

    IAssetRegistry mAssets;
    IOracleRouter mPrices;
    IConfig mConfig;
    address mRewardSys;
    address foundationFeeHolder;

    bool public exitPositionOnly;

    uint256 public lastPendingExchangeEntryId;
    mapping(uint256 => PendingExchangeEntry) public pendingExchangeEntries;

    mapping(bytes32 => bool) assetExitPositionOnly;

    bytes32 private constant CONFIG_FEE_SPLIT = "FoundationFeeSplit";
    bytes32 private constant CONFIG_TRADE_SETTLEMENT_DELAY =
        "TradeSettlementDelay";
    bytes32 private constant CONFIG_TRADE_REVERT_DELAY = "TradeRevertDelay";

    bytes32 private constant LUSD_KEY = "aUSD";

    function __ExchangeSystem_init(
        IAssetRegistry _mAssets,
        IOracleRouter _mPrices,
        IConfig _mConfig,
        address _mRewardSys
    )
        public
        initializer
    {
        __Ownable_init();

        require(address(_mAssets) != address(0), "ExchangeSystem: zero address");
        require(address(_mPrices) != address(0), "ExchangeSystem: zero address");
        require(address(_mConfig) != address(0), "ExchangeSystem: zero address");
        require(
            address(_mRewardSys) != address(0), "ExchangeSystem: zero address"
        );

        mAssets = _mAssets;
        mPrices = _mPrices;
        mConfig = _mConfig;
        mRewardSys = _mRewardSys;
    }

    function setFoundationFeeHolder(address _foundationFeeHolder)
        public
        onlyOwner
    {
        require(
            _foundationFeeHolder != address(0), "ExchangeSystem: zero address"
        );
        require(
            _foundationFeeHolder != foundationFeeHolder,
            "ExchangeSystem: foundation fee holder not changed"
        );

        address oldHolder = foundationFeeHolder;
        foundationFeeHolder = _foundationFeeHolder;

        emit FoundationFeeHolderChanged(oldHolder, foundationFeeHolder);
    }

    function setExitPositionOnly(bool newValue) public onlyOwner {
        require(
            exitPositionOnly != newValue, "ExchangeSystem: value not changed"
        );

        bool oldValue = exitPositionOnly;
        exitPositionOnly = newValue;

        emit ExitPositionOnlyChanged(oldValue, newValue);
    }

    function setAssetExitPositionOnly(bytes32 asset, bool newValue)
        public
        onlyOwner
    {
        require(
            assetExitPositionOnly[asset] != newValue,
            "LnExchangeSystem: value not changed"
        );

        assetExitPositionOnly[asset] = newValue;

        emit AssetExitPositionOnlyChanged(asset, newValue);
    }

    function exchange(
        bytes32 sourceKey,
        uint256 sourceAmount,
        address destAddr,
        bytes32 destKey
    )
        external
    {
        return _exchange(msg.sender, sourceKey, sourceAmount, destAddr, destKey);
    }

    function settle(uint256 pendingExchangeEntryId) external {
        _settle(pendingExchangeEntryId, msg.sender);
    }

    function revert(uint256 pendingExchangeEntryId) external {
        _revert(pendingExchangeEntryId, msg.sender);
    }

    function _exchange(
        address fromAddr,
        bytes32 sourceKey,
        uint256 sourceAmount,
        address destAddr,
        bytes32 destKey
    )
        private
    {
        // The global flag forces everyone to trade into lUSD
        if (exitPositionOnly) {
            require(
                destKey == LUSD_KEY, "ExchangeSystem: can only exit position"
            );
        }

        // The asset-specific flag only forbids entering (can sell into other assets)
        require(
            !assetExitPositionOnly[destKey],
            "LnExchangeSystem: can only exit position for this asset"
        );

        // We don't need the return value here. It's just for preventing entering invalid trades
        getAssetByKey(destKey);

        IAsset source = getAssetByKey(sourceKey);

        // Only lock up the source amount here. Everything else will be performed in settlement.
        // The `move` method is a special variant of `transferForm` that doesn't require approval.
        source.move(fromAddr, address(this), sourceAmount);

        // Record the pending entry
        PendingExchangeEntry memory newPendingEntry = PendingExchangeEntry({
            id: uint64(
                ++lastPendingExchangeEntryId
                ),
            timestamp: uint64(
                block.timestamp
                ),
            fromAddr: fromAddr,
            destAddr: destAddr,
            fromAmount: sourceAmount,
            fromCurrency: sourceKey,
            toCurrency: destKey
        });
        pendingExchangeEntries[uint256(newPendingEntry.id)] = newPendingEntry;

        // Emit event for off-chain indexing
        emit PendingExchangeAdded(
            newPendingEntry.id, fromAddr, destAddr, sourceAmount, sourceKey, destKey
            );
    }

    function _settle(uint256 pendingExchangeEntryId, address settler)
        private
    {
        PendingExchangeEntry memory exchangeEntry =
            pendingExchangeEntries[pendingExchangeEntryId];
        require(exchangeEntry.id > 0, "ExchangeSystem: pending entry not found");

        uint256 settlementDelay = mConfig.getUint(CONFIG_TRADE_SETTLEMENT_DELAY);
        uint256 revertDelay = mConfig.getUint(CONFIG_TRADE_REVERT_DELAY);
        require(settlementDelay > 0, "ExchangeSystem: settlement delay not set");
        require(revertDelay > 0, "ExchangeSystem: revert delay not set");
        require(
            block.timestamp >= exchangeEntry.timestamp + settlementDelay,
            "ExchangeSystem: settlement delay not passed"
        );
        require(
            block.timestamp <= exchangeEntry.timestamp + revertDelay,
            "ExchangeSystem: trade can only be reverted now"
        );

        IAsset source = getAssetByKey(exchangeEntry.fromCurrency);
        IAsset dest = getAssetByKey(exchangeEntry.toCurrency);
        uint256 destAmount = mPrices.exchange(
            exchangeEntry.fromCurrency,
            exchangeEntry.fromAmount,
            exchangeEntry.toCurrency
        );

        // This might cause a transaction to deadlock, but impact would be negligible
        require(destAmount > 0, "ExchangeSystem: zero dest amount");

        uint256 feeRate = mConfig.getUint(exchangeEntry.toCurrency);
        uint256 destRecived =
            destAmount.multiplyDecimal(SafeDecimalMath.unit().sub(feeRate));
        uint256 fee = destAmount.sub(destRecived);

        // Fee going into the pool, to be adjusted based on foundation split
        uint256 feeForPoolInUsd =
            mPrices.exchange(exchangeEntry.toCurrency, fee, LUSD_KEY);

        // Split the fee between pool and foundation when both holder and ratio are set
        uint256 foundationSplit;
        if (foundationFeeHolder == address(0)) {
            foundationSplit = 0;
        } else {
            uint256 splitRatio = mConfig.getUint(CONFIG_FEE_SPLIT);

            if (splitRatio == 0) {
                foundationSplit = 0;
            } else {
                foundationSplit = feeForPoolInUsd.multiplyDecimal(splitRatio);
                feeForPoolInUsd = feeForPoolInUsd.sub(foundationSplit);
            }
        }

        IAsset lusd = getAssetByKey(LUSD_KEY);

        if (feeForPoolInUsd > 0) lusd.mint(mRewardSys, feeForPoolInUsd);
        if (foundationSplit > 0) lusd.mint(foundationFeeHolder, foundationSplit);

        source.burn(address(this), exchangeEntry.fromAmount);
        dest.mint(exchangeEntry.destAddr, destRecived);

        delete pendingExchangeEntries[pendingExchangeEntryId];

        emit PendingExchangeSettled(
            exchangeEntry.id, settler, destRecived, feeForPoolInUsd, foundationSplit
            );
    }

    function _revert(uint256 pendingExchangeEntryId, address reverter)
        private
    {
        PendingExchangeEntry memory exchangeEntry =
            pendingExchangeEntries[pendingExchangeEntryId];
        require(exchangeEntry.id > 0, "ExchangeSystem: pending entry not found");

        uint256 revertDelay = mConfig.getUint(CONFIG_TRADE_REVERT_DELAY);
        require(revertDelay > 0, "ExchangeSystem: revert delay not set");
        require(
            block.timestamp > exchangeEntry.timestamp + revertDelay,
            "ExchangeSystem: revert delay not passed"
        );

        IAsset source = getAssetByKey(exchangeEntry.fromCurrency);

        // Refund the amount locked
        source.move(
            address(this), exchangeEntry.fromAddr, exchangeEntry.fromAmount
        );

        delete pendingExchangeEntries[pendingExchangeEntryId];

        emit PendingExchangeReverted(exchangeEntry.id);
    }

    function getAssetByKey(bytes32 key) private view returns (IAsset asset) {
        address assetAddress = mAssets.assetSymbolToAddresses(key);
        require(assetAddress != address(0), "ExchangeSystem: asset no tfound");

        return IAsset(assetAddress);
    }
}
