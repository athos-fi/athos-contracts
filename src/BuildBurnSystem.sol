// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/ICollateralSystem.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IDebtSystem.sol";
import "./interfaces/IOracleRouter.sol";
import "./libraries/SafeDecimalMath.sol";

contract BuildBurnSystem is PausableUpgradeable, OwnableUpgradeable {
    using SafeMathUpgradeable for uint256;
    using SafeDecimalMath for uint256;

    IAsset public lUSDToken;

    IDebtSystem public debtSystem;
    IOracleRouter public priceGetter;
    ICollateralSystem public collaterSys;
    IConfig public mConfig;
    address public liquidation;

    bytes32 public constant CONFIG_BUILD_RATIO = "BuildRatio";

    modifier onlyCollaterSys() {
        require(msg.sender == address(collaterSys), "BuildBurnSystem: not collateral system");
        _;
    }

    modifier onlyLiquidation() {
        require(msg.sender == liquidation, "BuildBurnSystem: not liquidation");
        _;
    }

    function __BuildBurnSystem_init(
        IAsset _lUSDToken,
        IDebtSystem _debtSystem,
        IOracleRouter _priceGetter,
        ICollateralSystem _collaterSys,
        IConfig _mConfig,
        address _liquidation
    ) public initializer {
        __Ownable_init();

        require(address(_lUSDToken) != address(0), "BuildBurnSystem: zero address");
        require(address(_debtSystem) != address(0), "BuildBurnSystem: zero address");
        require(address(_priceGetter) != address(0), "BuildBurnSystem: zero address");
        require(address(_collaterSys) != address(0), "BuildBurnSystem: zero address");
        require(address(_mConfig) != address(0), "BuildBurnSystem: zero address");
        require(address(_liquidation) != address(0), "BuildBurnSystem: zero address");

        lUSDToken = _lUSDToken;
        debtSystem = _debtSystem;
        priceGetter = _priceGetter;
        collaterSys = _collaterSys;
        mConfig = _mConfig;
        liquidation = _liquidation;
    }

    function setCollateralSystemAddress(ICollateralSystem newAddress) external onlyOwner {
        require(address(newAddress) != address(0), "BuildBurnSystem: zero address");
        collaterSys = newAddress;
    }

    function setLiquidationAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "BuildBurnSystem: zero address");
        liquidation = newAddress;
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            _pause();
        } else {
            _unpause();
        }
    }

    function MaxCanBuildAsset(address user) public view returns (uint256) {
        uint256 buildRatio = mConfig.getUint(CONFIG_BUILD_RATIO);
        uint256 maxCanBuild = collaterSys.getFreeCollateralInUsd(user).mul(buildRatio).div(SafeDecimalMath.unit());
        return maxCanBuild;
    }

    // build lUSD
    function BuildAsset(uint256 amount) external whenNotPaused returns (bool) {
        address user = msg.sender;
        return _buildAsset(user, amount);
    }

    function _buildAsset(address user, uint256 amount) internal returns (bool) {
        uint256 buildRatio = mConfig.getUint(CONFIG_BUILD_RATIO);
        uint256 maxCanBuild = collaterSys.getFreeCollateralInUsd(user).multiplyDecimal(buildRatio);
        require(amount <= maxCanBuild, "Build amount too big, you need more collateral");

        // calc debt
        (uint256 oldUserDebtBalance, uint256 totalAssetSupplyInUsd) = debtSystem.GetUserDebtBalanceInUsd(user);

        uint256 newTotalAssetSupply = totalAssetSupplyInUsd.add(amount);
        // update debt data
        uint256 buildDebtProportion = amount.divideDecimalRoundPrecise(newTotalAssetSupply); // debtPercentage
        uint256 oldTotalProportion = SafeDecimalMath.preciseUnit().sub(buildDebtProportion); //
        uint256 newUserDebtProportion = buildDebtProportion;
        if (oldUserDebtBalance > 0) {
            newUserDebtProportion = oldUserDebtBalance.add(amount).divideDecimalRoundPrecise(newTotalAssetSupply);
        }

        // update debt
        debtSystem.UpdateDebt(user, newUserDebtProportion, oldTotalProportion);

        // mint asset
        lUSDToken.mint(user, amount);

        return true;
    }

    function BuildMaxAsset() external whenNotPaused {
        _buildMaxAsset(msg.sender);
    }

    function _buildMaxAsset(address user) private {
        uint256 max = MaxCanBuildAsset(user);
        _buildAsset(user, max);
    }

    function _burnAsset(address debtUser, address burnUser, uint256 amount) internal {
        //uint256 buildRatio = mConfig.getUint(mConfig.BUILD_RATIO());
        require(amount > 0, "amount need > 0");
        // calc debt
        (uint256 oldUserDebtBalance, uint256 totalAssetSupplyInUsd) = debtSystem.GetUserDebtBalanceInUsd(debtUser);
        require(oldUserDebtBalance > 0, "no debt, no burn");
        uint256 burnAmount = oldUserDebtBalance < amount ? oldUserDebtBalance : amount;
        // burn asset
        lUSDToken.burn(burnUser, burnAmount);

        uint256 newTotalDebtIssued = totalAssetSupplyInUsd.sub(burnAmount);

        uint256 oldTotalProportion = 0;
        if (newTotalDebtIssued > 0) {
            uint256 debtPercentage = burnAmount.divideDecimalRoundPrecise(newTotalDebtIssued);
            oldTotalProportion = SafeDecimalMath.preciseUnit().add(debtPercentage);
        }

        uint256 newUserDebtProportion = 0;
        if (oldUserDebtBalance > burnAmount) {
            uint256 newDebt = oldUserDebtBalance.sub(burnAmount);
            newUserDebtProportion = newDebt.divideDecimalRoundPrecise(newTotalDebtIssued);
        }

        // update debt
        debtSystem.UpdateDebt(debtUser, newUserDebtProportion, oldTotalProportion);
    }

    // burn
    function BurnAsset(uint256 amount) external whenNotPaused returns (bool) {
        address user = msg.sender;
        _burnAsset(user, user, amount);
        return true;
    }

    // burn to target ratio
    function BurnAssetToTarget() external whenNotPaused returns (bool) {
        address user = msg.sender;

        uint256 buildRatio = mConfig.getUint(CONFIG_BUILD_RATIO);
        uint256 totalCollateral = collaterSys.GetUserTotalCollateralInUsd(user);
        uint256 maxBuildAssetToTarget = totalCollateral.multiplyDecimal(buildRatio);
        (uint256 debtAsset,) = debtSystem.GetUserDebtBalanceInUsd(user);
        require(debtAsset > maxBuildAssetToTarget, "You maybe want build to target");

        uint256 needBurn = debtAsset.sub(maxBuildAssetToTarget);
        uint256 balance = IERC20Upgradeable(address(lUSDToken)).balanceOf(user); // burn as many as possible
        if (balance < needBurn) {
            needBurn = balance;
        }
        _burnAsset(user, user, needBurn);
        return true;
    }

    function buildFromCollateralSys(address user, uint256 amount) external whenNotPaused onlyCollaterSys {
        _buildAsset(user, amount);
    }

    function buildMaxFromCollateralSys(address user) external whenNotPaused onlyCollaterSys {
        _buildMaxAsset(user);
    }

    function burnFromCollateralSys(address user, uint256 amount) external whenNotPaused onlyCollaterSys {
        _burnAsset(user, user, amount);
    }

    function burnForLiquidation(address user, address liquidator, uint256 amount)
        external
        whenNotPaused
        onlyLiquidation
    {
        _burnAsset(user, liquidator, amount);
    }
}
