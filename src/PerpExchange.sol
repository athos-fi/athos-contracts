// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IAssetRegistry.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IPerpetual.sol";
import "./interfaces/IPerpExchange.sol";
import "./interfaces/IPerpPositionToken.sol";

contract PerpExchange is IPerpExchange, OwnableUpgradeable {
    using SafeCastUpgradeable for uint256;
    using SafeMathUpgradeable for uint256;

    event OpenPositionActionQueued(
        uint256 actionId,
        address user,
        bytes32 underlying,
        bool isLong,
        uint256 size,
        uint256 collateral
    );
    event IncreasePositionActionQueued(
        uint256 actionId,
        address user,
        bytes32 underlying,
        uint256 positionId,
        uint256 size,
        uint256 collateral
    );
    event ClosePositionActionQueued(
        uint256 actionId,
        address user,
        bytes32 underlying,
        uint256 positionId,
        uint256 amount,
        address to
    );
    event ActionSettled(uint256 actionId, uint256 underlyingPrice);
    event ActionReverted(uint256 actionId);
    event PoolFeeHolderChanged(address newPoolFeeHolder);
    event FoundationFeeHolderChanged(address newFoundationFeeHolder);
    event FeesCharged(
        uint256 positionId, uint256 feeForPool, uint256 feeForFoundation
    );
    event InsuranceFundContribution(uint256 positionId, uint256 amount);

    struct PendingActionMeta {
        uint64 timestamp;
        address user;
        uint8 actionType;
    }

    struct OpenPositionActionData {
        bytes32 underlying;
        bool isLong;
        uint256 size;
        uint256 collateral;
    }

    struct IncreasePositionActionData {
        bytes32 underlying;
        uint256 positionId;
        uint256 size;
        uint256 collateral;
    }

    struct ClosePositionActionData {
        bytes32 underlying;
        uint256 positionId;
        uint256 amount;
        address to;
    }

    IAssetRegistry public lnAssetSystem;
    IConfig public lnConfig;
    IPerpPositionToken public positionToken;
    IAsset public lusdToken;
    address public override insuranceFundHolder;
    address public poolFeeHolder;
    address public foundationFeeHolder;

    uint256 public lastPendingActionId;
    mapping(uint256 => PendingActionMeta) public pendingActionMetas;
    mapping(uint256 => OpenPositionActionData) public openPositionActions;
    mapping(uint256 => IncreasePositionActionData) public
        increasePositionActions;
    mapping(uint256 => ClosePositionActionData) public closePositionActions;

    uint8 public constant ACTION_TYPE_OPEN_POSITION = 1;
    uint8 public constant ACTION_TYPE_INCREASE_POSITION = 2;
    uint8 public constant ACTION_TYPE_CLOSE_POSITION = 3;

    uint256 private constant UNIT = 10 ** 18;
    bytes32 private constant CONFIG_TRADE_SETTLEMENT_DELAY =
        "TradeSettlementDelay";
    bytes32 private constant CONFIG_TRADE_REVERT_DELAY = "TradeRevertDelay";
    bytes32 private constant CONFIG_FEE_SPLIT = "FoundationFeeSplit";

    function __PerpExchange_init(
        IAssetRegistry _lnAssetSystem,
        IConfig _lnConfig,
        IPerpPositionToken _positionToken,
        IAsset _lusdToken,
        address _insuranceFundHolder
    )
        public
        initializer
    {
        __Ownable_init();

        require(
            address(_lnAssetSystem) != address(0), "PerpExchange: zero address"
        );
        require(address(_lnConfig) != address(0), "PerpExchange: zero address");
        require(
            address(_positionToken) != address(0), "PerpExchange: zero address"
        );
        require(address(_lusdToken) != address(0), "PerpExchange: zero address");

        lnAssetSystem = _lnAssetSystem;
        lnConfig = _lnConfig;
        positionToken = _positionToken;
        lusdToken = _lusdToken;
        insuranceFundHolder = _insuranceFundHolder;
    }

    function setPoolFeeHolder(address newPoolFeeHolder) external onlyOwner {
        poolFeeHolder = newPoolFeeHolder;

        emit PoolFeeHolderChanged(newPoolFeeHolder);
    }

    function setFoundationFeeHolder(address newFoundationFeeHolder)
        external
        onlyOwner
    {
        foundationFeeHolder = newFoundationFeeHolder;

        emit FoundationFeeHolderChanged(newFoundationFeeHolder);
    }

    function openPosition(
        bytes32 underlying,
        bool isLong,
        uint256 size,
        uint256 collateral
    )
        external
    {
        // TODO: perform basic argument validation

        // Lock up user's lUSD until settlement
        IERC20Upgradeable(address(lusdToken)).transferFrom(
            msg.sender, address(this), collateral
        );

        uint256 actionId =
            _queueActionMeta(msg.sender, ACTION_TYPE_OPEN_POSITION);
        openPositionActions[actionId] = OpenPositionActionData({
            underlying: underlying,
            isLong: isLong,
            size: size,
            collateral: collateral
        });

        emit OpenPositionActionQueued(
            actionId, msg.sender, underlying, isLong, size, collateral
            );
    }

    function increasePosition(
        bytes32 underlying,
        uint256 positionId,
        uint256 size,
        uint256 collateral
    )
        external
    {
        // TODO: perform basic argument validation
        _assertPositionExists(underlying, positionId);

        // Lock up user's lUSD until settlement
        IERC20Upgradeable(address(lusdToken)).transferFrom(
            msg.sender, address(this), collateral
        );

        uint256 actionId =
            _queueActionMeta(msg.sender, ACTION_TYPE_INCREASE_POSITION);
        increasePositionActions[actionId] = IncreasePositionActionData({
            underlying: underlying,
            positionId: positionId,
            size: size,
            collateral: collateral
        });

        emit IncreasePositionActionQueued(
            actionId, msg.sender, underlying, positionId, size, collateral
            );
    }

    function closePositionByAmount(
        bytes32 underlying,
        uint256 positionId,
        uint256 amount,
        address to
    )
        external
    {
        // TODO: perform basic argument validation
        require(amount > 0, "PerpExchange: zero amount");
        _assertPositionExists(underlying, positionId);

        uint256 actionId =
            _queueActionMeta(msg.sender, ACTION_TYPE_CLOSE_POSITION);
        closePositionActions[actionId] = ClosePositionActionData({
            underlying: underlying,
            positionId: positionId,
            amount: amount,
            to: to
        });

        emit ClosePositionActionQueued(
            actionId, msg.sender, underlying, positionId, amount, to
            );
    }

    function closePosition(bytes32 underlying, uint256 positionId, address to)
        external
    {
        // TODO: perform basic argument validation
        _assertPositionExists(underlying, positionId);

        uint256 actionId =
            _queueActionMeta(msg.sender, ACTION_TYPE_CLOSE_POSITION);
        closePositionActions[actionId] = ClosePositionActionData({
            underlying: underlying,
            positionId: positionId,
            amount: 0,
            to: to
        });

        emit ClosePositionActionQueued(
            actionId, msg.sender, underlying, positionId, 0, to
            );
    }

    function settleAction(uint256 pendingActionId) external {
        PendingActionMeta memory actionMeta =
            pendingActionMetas[pendingActionId];
        require(
            actionMeta.actionType > 0, "PerpExchange: pending action not found"
        );

        // Assert settlement delay
        uint256 settlementDelay =
            lnConfig.getUint(CONFIG_TRADE_SETTLEMENT_DELAY);
        uint256 revertDelay = lnConfig.getUint(CONFIG_TRADE_REVERT_DELAY);
        require(settlementDelay > 0, "PerpExchange: settlement delay not set");
        require(revertDelay > 0, "PerpExchange: revert delay not set");
        require(
            block.timestamp >= actionMeta.timestamp + settlementDelay,
            "PerpExchange: settlement delay not passed"
        );
        require(
            block.timestamp <= actionMeta.timestamp + revertDelay,
            "PerpExchange: action can only be reverted now"
        );

        uint256 underlyingPrice;

        if (actionMeta.actionType == ACTION_TYPE_OPEN_POSITION) {
            OpenPositionActionData memory data =
                openPositionActions[pendingActionId];

            IPerpetual perpContract = _getPerpContract(data.underlying);
            IERC20Upgradeable(address(lusdToken)).approve(
                address(perpContract), data.collateral
            );
            (, underlyingPrice) = perpContract.openPosition(
                actionMeta.user, data.isLong, data.size, data.collateral
            );
        } else if (actionMeta.actionType == ACTION_TYPE_INCREASE_POSITION) {
            IncreasePositionActionData memory data =
                increasePositionActions[pendingActionId];

            IPerpetual perpContract = _getPerpContract(data.underlying);
            IERC20Upgradeable(address(lusdToken)).approve(
                address(perpContract), data.collateral
            );
            underlyingPrice = perpContract.increasePosition(
                actionMeta.user, data.positionId, data.size, data.collateral
            );
        } else if (actionMeta.actionType == ACTION_TYPE_CLOSE_POSITION) {
            ClosePositionActionData memory data =
                closePositionActions[pendingActionId];

            if (data.amount > 0) {
                underlyingPrice = _getPerpContract(data.underlying)
                    .closePositionByAmount(
                    actionMeta.user, data.positionId, data.amount, data.to
                );
            } else {
                underlyingPrice = _getPerpContract(data.underlying)
                    .closePosition(actionMeta.user, data.positionId, data.to);
            }
        } else {
            require(false, "PerpExchange: unknown action type");
        }

        // Remove action data from storage
        _removeActionData(pendingActionId, actionMeta.actionType);

        emit ActionSettled(pendingActionId, underlyingPrice);
    }

    function revertAction(uint256 pendingActionId) external {
        PendingActionMeta memory actionMeta =
            pendingActionMetas[pendingActionId];
        require(
            actionMeta.actionType > 0, "PerpExchange: pending action not found"
        );

        // Assert revert delay
        uint256 revertDelay = lnConfig.getUint(CONFIG_TRADE_REVERT_DELAY);
        require(revertDelay > 0, "PerpExchange: revert delay not set");
        require(
            block.timestamp > actionMeta.timestamp + revertDelay,
            "PerpExchange: revert delay not passed"
        );

        // Refund collateral taken
        if (actionMeta.actionType == ACTION_TYPE_OPEN_POSITION) {
            IERC20Upgradeable(address(lusdToken)).transfer(
                actionMeta.user, openPositionActions[pendingActionId].collateral
            );
        } else if (actionMeta.actionType == ACTION_TYPE_INCREASE_POSITION) {
            IERC20Upgradeable(address(lusdToken)).transfer(
                actionMeta.user,
                increasePositionActions[pendingActionId].collateral
            );
        }

        // Remove action data from storage
        _removeActionData(pendingActionId, actionMeta.actionType);

        emit ActionReverted(pendingActionId);
    }

    function submitFees(uint256 positionId, uint256 amount) external override {
        require(poolFeeHolder != address(0), "PerpExchange: fee pool not set");

        IERC20Upgradeable(address(lusdToken)).transferFrom(
            msg.sender, address(this), amount
        );

        uint256 foundationSplit;
        if (foundationFeeHolder == address(0)) {
            foundationSplit = 0;
        } else {
            uint256 splitRatio = lnConfig.getUint(CONFIG_FEE_SPLIT);

            if (splitRatio == 0) {
                foundationSplit = 0;
            } else {
                foundationSplit = amount.mul(splitRatio).div(UNIT);
                amount = amount.sub(foundationSplit);
            }
        }

        if (amount > 0) {
            IERC20Upgradeable(address(lusdToken)).transfer(
                poolFeeHolder, amount
            );
        }
        if (foundationSplit > 0) {
            IERC20Upgradeable(address(lusdToken)).transfer(
                foundationFeeHolder, foundationSplit
            );
        }

        emit FeesCharged(positionId, amount, foundationSplit);
    }

    function submitInsuranceFund(uint256 positionId, uint256 amount)
        external
        override
    {
        IERC20Upgradeable(address(lusdToken)).transferFrom(
            msg.sender, insuranceFundHolder, amount
        );
        emit InsuranceFundContribution(positionId, amount);
    }

    function requestPositionMint(address to)
        external
        override
        returns (uint256 positionId)
    {
        _assertRegisteredPerp(msg.sender);
        positionId = positionToken.mint(msg.sender, to);
    }

    function requestPositionBurn(uint256 positionId) external override {
        _assertRegisteredPerp(msg.sender);
        positionToken.burn(positionId);
    }

    function requestAssetMint(address asset, address account, uint256 amount)
        external
        override
    {
        _assertRegisteredPerp(msg.sender);
        IAsset(asset).mint(account, amount);
    }

    function requestAssetBurn(address asset, address account, uint256 amount)
        external
        override
    {
        _assertRegisteredPerp(msg.sender);
        IAsset(asset).burn(account, amount);
    }

    function _queueActionMeta(address user, uint8 actionType)
        private
        returns (uint256 actionId)
    {
        actionId = ++lastPendingActionId;
        pendingActionMetas[actionId] = PendingActionMeta({
            timestamp: block.timestamp.toUint64(),
            user: user,
            actionType: actionType
        });
    }

    function _getPerpContract(bytes32 symbol)
        private
        view
        returns (IPerpetual)
    {
        address perpAddress = lnAssetSystem.perpAddresses(symbol);
        require(
            perpAddress != address(0), "PerpExchange: perp address not found"
        );

        return IPerpetual(perpAddress);
    }

    function _assertRegisteredPerp(address perpAddress) private view {
        require(
            lnAssetSystem.isPerpAddressRegistered(perpAddress),
            "PerpExchange: perp address not registered"
        );
    }

    function _assertPositionExists(bytes32 symbol, uint256 positionId)
        private
        view
    {
        require(
            positionToken.positionExists(address(_getPerpContract(symbol)), positionId),
            "PerpExchange: position not found"
        );
    }

    function _removeActionData(uint256 actionId, uint8 actionType) private {
        delete pendingActionMetas[actionId];
        if (actionType == ACTION_TYPE_OPEN_POSITION) {
            delete openPositionActions[actionId];
        } else if (actionType == ACTION_TYPE_INCREASE_POSITION) {
            delete increasePositionActions[actionId];
        } else if (actionType == ACTION_TYPE_CLOSE_POSITION) {
            delete closePositionActions[actionId];
        } else {
            require(false, "PerpExchange: unknown action type");
        }
    }
}
