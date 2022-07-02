// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/IBuildBurnSystem.sol";
import "./interfaces/ICollateralSystem.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IDebtSystem.sol";
import "./interfaces/IOracleRouter.sol";
import "./interfaces/IRewardLocker.sol";
import "./libraries/SafeDecimalMath.sol";

contract Liquidation is OwnableUpgradeable {
    using SafeDecimalMath for uint256;
    using SafeMathUpgradeable for uint256;

    event PositionMarked(address user, address marker);
    event PositionUnmarked(address user);
    event PositionLiquidated(
        address user,
        address marker,
        address liquidator,
        uint256 debtBurnt,
        bytes32 collateralCurrency,
        uint256 collateralWithdrawnFromStaked,
        uint256 collateralWithdrawnFromLocked,
        uint256 markerReward,
        uint256 liquidatorReward
    );

    struct UndercollateralizationMark {
        address marker;
        uint64 timestamp;
    }

    struct EvalUserPositionResult {
        uint256 debtBalance;
        uint256 stakedCollateral;
        uint256 lockedCollateral;
        uint256 collateralPrice;
        uint256 collateralValue;
        uint256 collateralizationRatio;
    }

    struct FetchRatiosResult {
        uint256 issuanceRatio;
        uint256 markerRewardRatio;
        uint256 liquidatorRewardRatio;
    }

    struct LiquidationRewardCalculationResult {
        uint256 collateralWithdrawalAmount;
        uint256 markerReward;
        uint256 liquidatorReward;
        uint256 totalReward;
    }

    struct LiquidatePositionParams {
        address user;
        address liquidator;
        uint256 lusdToBurn;
    }

    struct WithdrawCollateralParams {
        address user;
        address liquidator;
        uint256 collateralWithdrawalAmount;
        uint256 stakedCollateral;
        uint256 lockedCollateral;
    }

    struct DistributeRewardsParams {
        address user;
        address marker;
        address liquidator;
        uint256 markerReward;
        uint256 liquidatorReward;
        uint256 stakedCollateral;
        uint256 lockedCollateral;
    }

    IBuildBurnSystem public buildBurnSystem;
    ICollateralSystem public collateralSystem;
    IConfig public config;
    IDebtSystem public debtSystem;
    IOracleRouter public oracleRouter;
    IRewardLocker public rewardLocker;

    mapping(address => UndercollateralizationMark) public
        undercollateralizationMarks;

    bytes32 public constant LIQUIDATION_MARKER_REWARD_KEY =
        "LiquidationMarkerReward";
    bytes32 public constant LIQUIDATION_LIQUIDATOR_REWARD_KEY =
        "LiquidationLiquidatorReward";
    bytes32 public constant LIQUIDATION_RATIO_KEY = "LiquidationRatio";
    bytes32 public constant LIQUIDATION_DELAY_KEY = "LiquidationDelay";
    bytes32 public constant BUILD_RATIO_KEY = "BuildRatio";

    function isPositionMarkedAsUndercollateralized(address user)
        public
        view
        returns (bool)
    {
        return undercollateralizationMarks[user].timestamp > 0;
    }

    function getUndercollateralizationMarkMarker(address user)
        public
        view
        returns (address)
    {
        return undercollateralizationMarks[user].marker;
    }

    function getUndercollateralizationMarkTimestamp(address user)
        public
        view
        returns (uint256)
    {
        return uint256(undercollateralizationMarks[user].timestamp);
    }

    function __Liquidation_init(
        IBuildBurnSystem _buildBurnSystem,
        ICollateralSystem _collateralSystem,
        IConfig _config,
        IDebtSystem _debtSystem,
        IOracleRouter _oracleRouter,
        IRewardLocker _rewardLocker
    )
        public
        initializer
    {
        __Ownable_init();

        require(
            address(_buildBurnSystem) != address(0), "Liquidation: zero address"
        );
        require(
            address(_collateralSystem) != address(0), "Liquidation: zero address"
        );
        require(address(_config) != address(0), "Liquidation: zero address");
        require(address(_debtSystem) != address(0), "Liquidation: zero address");
        require(
            address(_oracleRouter) != address(0), "Liquidation: zero address"
        );
        require(
            address(_rewardLocker) != address(0), "Liquidation: zero address"
        );

        buildBurnSystem = _buildBurnSystem;
        collateralSystem = _collateralSystem;
        config = _config;
        debtSystem = _debtSystem;
        oracleRouter = _oracleRouter;
        rewardLocker = _rewardLocker;
    }

    function setOracleRouter(IOracleRouter newOracleRouter)
        external
        onlyOwner
    {
        require(
            address(newOracleRouter) != address(0), "Liquidation: zero address"
        );
        oracleRouter = newOracleRouter;
    }

    function markPositionAsUndercollateralized(address user) external {
        require(
            !isPositionMarkedAsUndercollateralized(user),
            "Liquidation: already marked"
        );

        EvalUserPositionResult memory evalResult = evalUserPostion(user);
        uint256 liquidationRatio = config.getUint(LIQUIDATION_RATIO_KEY);
        require(
            evalResult.collateralizationRatio > liquidationRatio,
            "Liquidation: not undercollateralized"
        );

        undercollateralizationMarks[user] = UndercollateralizationMark({
            marker: msg
                .sender,
            timestamp: uint64(
                block.timestamp
                )
        });

        emit PositionMarked(user, msg.sender);
    }

    function removeUndercollateralizationMark(address user) external {
        require(
            isPositionMarkedAsUndercollateralized(user), "Liquidation: not marked"
        );

        // Can only remove mark if C ratio is restored to issuance ratio
        EvalUserPositionResult memory evalResult = evalUserPostion(user);
        uint256 issuanceRatio = config.getUint(BUILD_RATIO_KEY);
        require(
            evalResult.collateralizationRatio <= issuanceRatio,
            "Liquidation: still undercollateralized"
        );

        delete undercollateralizationMarks[user];

        emit PositionUnmarked(user);
    }

    function liquidatePosition(
        address user,
        uint256 lusdToBurn,
        uint256[] calldata rewardEntryIds
    )
        external
    {
        require(lusdToBurn > 0, "Liquidation: zero amount");

        _liquidatePosition(
            LiquidatePositionParams({
                user: user,
                liquidator: msg.sender,
                lusdToBurn: lusdToBurn
            }),
            rewardEntryIds
        );
    }

    function liquidatePositionMax(
        address user,
        uint256[] calldata rewardEntryIds
    )
        external
    {
        _liquidatePosition(
            LiquidatePositionParams({user: user, liquidator: msg.sender, lusdToBurn: 0}),
            rewardEntryIds
        );
    }

    function _liquidatePosition(
        LiquidatePositionParams memory params,
        uint256[] calldata rewardEntryIds
    )
        private
    {
        // Check mark and delay
        UndercollateralizationMark memory mark =
            undercollateralizationMarks[params.user];
        {
            uint256 liquidationDelay = config.getUint(LIQUIDATION_DELAY_KEY);
            require(
                mark.timestamp > 0,
                "Liquidation: not marked for undercollateralized"
            );
            require(
                block.timestamp > mark.timestamp + liquidationDelay,
                "Liquidation: liquidation delay not passed"
            );
        }

        // Confirm that the position is still undercollateralized
        FetchRatiosResult memory ratios = fetchRatios();
        EvalUserPositionResult memory evalResult = evalUserPostion(params.user);
        require(
            evalResult.collateralizationRatio > ratios.issuanceRatio,
            "Liquidation: not undercollateralized"
        );

        uint256 maxLusdToBurn = evalResult.debtBalance.sub(
            evalResult.collateralValue.multiplyDecimal(ratios.issuanceRatio)
        ).divideDecimal(
            SafeDecimalMath.unit().sub(
                SafeDecimalMath.unit().add(
                    ratios.markerRewardRatio.add(ratios.liquidatorRewardRatio)
                ).multiplyDecimal(ratios.issuanceRatio)
            )
        );
        if (params.lusdToBurn == 0) {
            // Liquidate max
            params.lusdToBurn = maxLusdToBurn;
        } else {
            // User specified amount to liquidate
            require(
                params.lusdToBurn <= maxLusdToBurn,
                "Liquidation: burn amount too large"
            );
        }

        // Burn lUSD and update debt
        buildBurnSystem.burnForLiquidation(
            params.user, params.liquidator, params.lusdToBurn
        );

        LiquidationRewardCalculationResult memory rewards = calculateRewards(
            params.lusdToBurn,
            evalResult.collateralPrice,
            ratios.markerRewardRatio,
            ratios.liquidatorRewardRatio
        );

        {
            uint256 totalCollateralToMove =
                rewards.collateralWithdrawalAmount.add(rewards.totalReward);
            uint256 totalCollateralAmount =
                evalResult.stakedCollateral.add(evalResult.lockedCollateral);
            require(
                totalCollateralToMove > 0, "Liquidation: no collateral withdrawal"
            );
            require(
                totalCollateralToMove <= totalCollateralAmount,
                "Liquidation: insufficient collateral"
            ); // Insurance fund needed to resolve this
        }

        uint256 totalFromStaked;
        uint256 totalFromLocked;

        // Collateral withdrawal
        {
            (totalFromStaked, totalFromLocked) = withdrawCollateral(
                WithdrawCollateralParams({
                    user: params.user,
                    liquidator: params.liquidator,
                    collateralWithdrawalAmount: rewards
                        .collateralWithdrawalAmount,
                    stakedCollateral: evalResult.stakedCollateral,
                    lockedCollateral: evalResult.lockedCollateral
                }),
                rewardEntryIds
            );

            // Track staked and locked amounts locally
            evalResult.stakedCollateral =
                evalResult.stakedCollateral.sub(totalFromStaked);
            evalResult.lockedCollateral =
                evalResult.lockedCollateral.sub(totalFromLocked);
        }

        // Rewards
        {
            (uint256 fromStaked, uint256 fromLocked) = distributeRewards(
                DistributeRewardsParams({
                    user: params.user,
                    marker: mark.marker,
                    liquidator: params.liquidator,
                    markerReward: rewards.markerReward,
                    liquidatorReward: rewards.liquidatorReward,
                    stakedCollateral: evalResult.stakedCollateral,
                    lockedCollateral: evalResult.lockedCollateral
                }),
                rewardEntryIds
            );

            totalFromStaked = totalFromStaked.add(fromStaked);
            totalFromLocked = totalFromLocked.add(fromLocked);
        }

        emit PositionLiquidated(
            params.user,
            mark.marker,
            params.liquidator,
            params.lusdToBurn,
            "CHAOS",
            totalFromStaked,
            totalFromLocked,
            rewards.markerReward,
            rewards.liquidatorReward
            );

        // If the position is completely liquidated, remove the marker
        if (params.lusdToBurn == maxLusdToBurn) {
            delete undercollateralizationMarks[params.user];
            emit PositionUnmarked(params.user);
        }
    }

    function evalUserPostion(address user)
        private
        view
        returns (EvalUserPositionResult memory)
    {
        (uint256 debtBalance,) = debtSystem.GetUserDebtBalanceInUsd(user);
        (uint256 stakedCollateral, uint256 lockedCollateral) =
            collateralSystem.getUserLinaCollateralBreakdown(user);

        uint256 collateralPrice = oracleRouter.getPrice("CHAOS");
        uint256 collateralValue =
            stakedCollateral.add(lockedCollateral).multiplyDecimal(collateralPrice);

        uint256 collateralizationRatio =
            collateralValue == 0 ? 0 : debtBalance.divideDecimal(collateralValue);
        return EvalUserPositionResult({
            debtBalance: debtBalance,
            stakedCollateral: stakedCollateral,
            lockedCollateral: lockedCollateral,
            collateralPrice: collateralPrice,
            collateralValue: collateralValue,
            collateralizationRatio: collateralizationRatio
        });
    }

    function fetchRatios() private view returns (FetchRatiosResult memory) {
        uint256 issuanceRatio = config.getUint(BUILD_RATIO_KEY);
        uint256 markerRewardRatio =
            config.getUint(LIQUIDATION_MARKER_REWARD_KEY);
        uint256 liquidatorRewardRatio =
            config.getUint(LIQUIDATION_LIQUIDATOR_REWARD_KEY);

        return FetchRatiosResult({
            issuanceRatio: issuanceRatio,
            markerRewardRatio: markerRewardRatio,
            liquidatorRewardRatio: liquidatorRewardRatio
        });
    }

    function calculateRewards(
        uint256 lusdToBurn,
        uint256 collateralPrice,
        uint256 markerRewardRatio,
        uint256 liquidatorRewardRatio
    )
        private
        pure
        returns (LiquidationRewardCalculationResult memory)
    {
        // Amount of collateral with the same value as the debt burnt (without taking into account rewards)
        uint256 collateralWithdrawalAmount =
            lusdToBurn.divideDecimal(collateralPrice);

        // Reward amounts
        uint256 markerReward =
            collateralWithdrawalAmount.multiplyDecimal(markerRewardRatio);
        uint256 liquidatorReward =
            collateralWithdrawalAmount.multiplyDecimal(liquidatorRewardRatio);
        uint256 totalReward = markerReward.add(liquidatorReward);

        return LiquidationRewardCalculationResult({
            collateralWithdrawalAmount: collateralWithdrawalAmount,
            markerReward: markerReward,
            liquidatorReward: liquidatorReward,
            totalReward: totalReward
        });
    }

    function withdrawCollateral(
        WithdrawCollateralParams memory params,
        uint256[] calldata rewardEntryIds
    )
        private
        returns (uint256 amountFromStaked, uint256 amountFromLocked)
    {
        amountFromStaked = MathUpgradeable.min(
            params.collateralWithdrawalAmount, params.stakedCollateral
        );
        amountFromLocked =
            params.collateralWithdrawalAmount.sub(amountFromStaked);

        require(
            amountFromLocked <= params.lockedCollateral,
            "Liquidation: insufficient locked collateral"
        );

        if (amountFromStaked > 0) {
            collateralSystem.moveCollateral(
                params.user, params.liquidator, "CHAOS", amountFromStaked
            );
        }

        if (amountFromLocked > 0) {
            rewardLocker.moveReward(
                params.user, params.liquidator, amountFromLocked, rewardEntryIds
            );
        }
    }

    function distributeRewards(
        DistributeRewardsParams memory params,
        uint256[] calldata rewardEntryIds
    )
        private
        returns (uint256 amountFromStaked, uint256 amountFromLocked)
    {
        uint256 totalReward = params.markerReward.add(params.liquidatorReward);

        amountFromStaked =
            MathUpgradeable.min(totalReward, params.stakedCollateral);
        amountFromLocked = totalReward.sub(amountFromStaked);

        require(
            amountFromLocked <= params.lockedCollateral,
            "Liquidation: insufficient locked collateral"
        );

        uint256 markerRewardFromLocked = params.markerReward;
        uint256 liquidatorRewardFromLocked = params.liquidatorReward;

        if (amountFromStaked > 0) {
            uint256 markerRewardFromStaked =
                amountFromStaked.mul(params.markerReward).div(totalReward);
            uint256 liquidatorRewardFromStaked =
                amountFromStaked.sub(markerRewardFromStaked);

            markerRewardFromLocked =
                markerRewardFromLocked.sub(markerRewardFromStaked);
            liquidatorRewardFromLocked =
                liquidatorRewardFromLocked.sub(liquidatorRewardFromStaked);

            collateralSystem.moveCollateral(
                params.user, params.marker, "CHAOS", markerRewardFromStaked
            );
            collateralSystem.moveCollateral(
                params.user, params.liquidator, "CHAOS", liquidatorRewardFromStaked
            );
        }

        if (amountFromLocked > 0) {
            rewardLocker.moveRewardProRata(
                params.user,
                params.marker,
                markerRewardFromLocked,
                params.liquidator,
                liquidatorRewardFromLocked,
                rewardEntryIds
            );
        }
    }
}
