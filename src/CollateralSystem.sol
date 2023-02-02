// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/MathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "./interfaces/IBuildBurnSystem.sol";
import "./interfaces/ICollateralSystem.sol";
import "./interfaces/IConfig.sol";
import "./interfaces/IDebtSystem.sol";
import "./interfaces/IOracleRouter.sol";
import "./interfaces/IRewardLocker.sol";
import "./libraries/SafeDecimalMath.sol";
import "./utilities/TransferHelper.sol";

contract CollateralSystem is ICollateralSystem, PausableUpgradeable, OwnableUpgradeable {
    using SafeDecimalMath for uint256;
    using SafeMathUpgradeable for uint256;
    using AddressUpgradeable for address;

    // -------------------------------------------------------
    // need set before system running value.
    IOracleRouter public priceGetter;
    IDebtSystem public debtSystem;
    IConfig public mConfig;
    IRewardLocker public mRewardLocker;

    bytes32 public constant Currency_ETH = "ETH";
    bytes32 public constant Currency_LINA = "ATH";

    // -------------------------------------------------------
    uint256 public uniqueId; // use log

    struct TokenInfo {
        address tokenAddr;
        uint256 minCollateral; // min collateral amount.
        uint256 totalCollateral;
        bool bClose;
    }

    mapping(bytes32 => TokenInfo) public tokenInfos;
    bytes32[] public tokenSymbol; // keys of tokenInfos, use to iteration

    struct CollateralData {
        uint256 collateral; // total collateral
    }

    // [user] => ([token=> collateraldata])
    mapping(address => mapping(bytes32 => CollateralData)) public userCollateralData;

    // State variables added by upgrades
    IBuildBurnSystem public buildBurnSystem;
    address public liquidation;

    bytes32 public constant CONFIG_BUILD_RATIO = "BuildRatio";

    modifier onlyLiquidation() {
        require(msg.sender == liquidation, "CollateralSystem: not liquidation");
        _;
    }

    modifier onlyRewardLocker() {
        require(msg.sender == address(mRewardLocker), "CollateralSystem: not reward locker");
        _;
    }

    /**
     * @notice This function is deprecated as it doesn't do what its name suggests. Use
     * `getFreeCollateralInUsd()` instead. This function is not removed since it's still
     * used by `LnBuildBurnSystem`.
     */
    function MaxRedeemableInUsd(address _user) public view returns (uint256) {
        return getFreeCollateralInUsd(_user);
    }

    function getFreeCollateralInUsd(address user) public view returns (uint256) {
        uint256 totalCollateralInUsd = GetUserTotalCollateralInUsd(user);

        (uint256 debtBalance,) = debtSystem.GetUserDebtBalanceInUsd(user);
        if (debtBalance == 0) {
            return totalCollateralInUsd;
        }

        uint256 buildRatio = mConfig.getUint(CONFIG_BUILD_RATIO);
        uint256 minCollateral = debtBalance.divideDecimal(buildRatio);
        if (totalCollateralInUsd < minCollateral) {
            return 0;
        }

        return totalCollateralInUsd.sub(minCollateral);
    }

    function maxRedeemableLina(address user) public view returns (uint256) {
        (uint256 debtBalance,) = debtSystem.GetUserDebtBalanceInUsd(user);
        uint256 stakedLinaAmount = userCollateralData[user][Currency_LINA].collateral;

        if (debtBalance == 0) {
            // User doesn't have debt. All staked collateral is withdrawable
            return stakedLinaAmount;
        } else {
            // User has debt. Must keep a certain amount
            uint256 buildRatio = mConfig.getUint(CONFIG_BUILD_RATIO);
            uint256 minCollateralUsd = debtBalance.divideDecimal(buildRatio);
            uint256 minCollateralLina = minCollateralUsd.divideDecimal(priceGetter.getPrice(Currency_LINA));
            uint256 lockedLinaAmount = mRewardLocker.balanceOf(user);

            return MathUpgradeable.min(stakedLinaAmount, stakedLinaAmount.add(lockedLinaAmount).sub(minCollateralLina));
        }
    }

    // -------------------------------------------------------
    function __CollateralSystem_init(
        IOracleRouter _priceGetter,
        IDebtSystem _debtSystem,
        IConfig _mConfig,
        IRewardLocker _mRewardLocker,
        IBuildBurnSystem _buildBurnSystem,
        address _liquidation
    ) public initializer {
        __Ownable_init();

        require(address(_priceGetter) != address(0), "CollateralSystem: zero address");
        require(address(_debtSystem) != address(0), "CollateralSystem: zero address");
        require(address(_mConfig) != address(0), "CollateralSystem: zero address");
        require(address(_mRewardLocker) != address(0), "CollateralSystem: zero address");
        require(address(_buildBurnSystem) != address(0), "CollateralSystem: zero address");
        require(address(_liquidation) != address(0), "CollateralSystem: zero address");

        priceGetter = _priceGetter;
        debtSystem = _debtSystem;
        mConfig = _mConfig;
        mRewardLocker = _mRewardLocker;
        buildBurnSystem = _buildBurnSystem;
        liquidation = _liquidation;
    }

    function setLiquidationAddress(address newAddress) external onlyOwner {
        require(newAddress != address(0), "BuildBurnSystem: zero address");
        liquidation = newAddress;
    }

    function setRewardLockerAddress(IRewardLocker newAddress) external onlyOwner {
        require(address(newAddress) != address(0), "BuildBurnSystem: zero address");
        mRewardLocker = newAddress;
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused) {
            _pause();
        } else {
            _unpause();
        }
    }

    function updateTokenInfo(bytes32 _currency, address _tokenAddr, uint256 _minCollateral, bool _close)
        private
        returns (bool)
    {
        require(_currency[0] != 0, "symbol cannot empty");
        require(_currency != Currency_ETH, "ETH is used by system");
        require(_tokenAddr != address(0), "token address cannot zero");
        require(_tokenAddr.isContract(), "token address is not a contract");

        if (tokenInfos[_currency].tokenAddr == address(0)) {
            // new token
            tokenSymbol.push(_currency);
        }

        uint256 totalCollateral = tokenInfos[_currency].totalCollateral;
        tokenInfos[_currency] = TokenInfo({
            tokenAddr: _tokenAddr,
            minCollateral: _minCollateral,
            totalCollateral: totalCollateral,
            bClose: _close
        });
        emit UpdateTokenSetting(_currency, _tokenAddr, _minCollateral, _close);
        return true;
    }

    // delete token info? need to handle it's staking data.

    function UpdateTokenInfo(bytes32 _currency, address _tokenAddr, uint256 _minCollateral, bool _close)
        external
        onlyOwner
        returns (bool)
    {
        return updateTokenInfo(_currency, _tokenAddr, _minCollateral, _close);
    }

    function UpdateTokenInfos(
        bytes32[] calldata _symbols,
        address[] calldata _tokenAddrs,
        uint256[] calldata _minCollateral,
        bool[] calldata _closes
    ) external onlyOwner returns (bool) {
        require(_symbols.length == _tokenAddrs.length, "length of array not eq");
        require(_symbols.length == _minCollateral.length, "length of array not eq");
        require(_symbols.length == _closes.length, "length of array not eq");

        for (uint256 i = 0; i < _symbols.length; i++) {
            updateTokenInfo(_symbols[i], _tokenAddrs[i], _minCollateral[i], _closes[i]);
        }

        return true;
    }

    // ------------------------------------------------------------------------
    function GetSystemTotalCollateralInUsd() public view returns (uint256 rTotal) {
        for (uint256 i = 0; i < tokenSymbol.length; i++) {
            bytes32 currency = tokenSymbol[i];
            uint256 collateralAmount = tokenInfos[currency].totalCollateral;
            if (Currency_LINA == currency) {
                collateralAmount = collateralAmount.add(mRewardLocker.totalLockedAmount());
            }
            if (collateralAmount > 0) {
                rTotal = rTotal.add(collateralAmount.multiplyDecimal(priceGetter.getPrice(currency)));
            }
        }

        if (address(this).balance > 0) {
            rTotal = rTotal.add(address(this).balance.multiplyDecimal(priceGetter.getPrice(Currency_ETH)));
        }
    }

    function GetUserTotalCollateralInUsd(address _user) public view returns (uint256 rTotal) {
        for (uint256 i = 0; i < tokenSymbol.length; i++) {
            bytes32 currency = tokenSymbol[i];
            uint256 collateralAmount = userCollateralData[_user][currency].collateral;
            if (Currency_LINA == currency) {
                collateralAmount = collateralAmount.add(mRewardLocker.balanceOf(_user));
            }
            if (collateralAmount > 0) {
                rTotal = rTotal.add(collateralAmount.multiplyDecimal(priceGetter.getPrice(currency)));
            }
        }

        if (userCollateralData[_user][Currency_ETH].collateral > 0) {
            rTotal = rTotal.add(
                userCollateralData[_user][Currency_ETH].collateral.multiplyDecimal(priceGetter.getPrice(Currency_ETH))
            );
        }
    }

    function GetUserCollateral(address _user, bytes32 _currency) external view returns (uint256) {
        if (Currency_LINA != _currency) {
            return userCollateralData[_user][_currency].collateral;
        }
        return mRewardLocker.balanceOf(_user).add(userCollateralData[_user][_currency].collateral);
    }

    function getUserLinaCollateralBreakdown(address _user) external view returns (uint256 staked, uint256 locked) {
        return (userCollateralData[_user][Currency_LINA].collateral, mRewardLocker.balanceOf(_user));
    }

    // NOTE: LINA collateral not include reward in locker
    function GetUserCollaterals(address _user) external view returns (bytes32[] memory, uint256[] memory) {
        bytes32[] memory rCurrency = new bytes32[](tokenSymbol.length + 1);
        uint256[] memory rAmount = new uint256[](tokenSymbol.length + 1);
        uint256 retSize = 0;
        for (uint256 i = 0; i < tokenSymbol.length; i++) {
            bytes32 currency = tokenSymbol[i];
            if (userCollateralData[_user][currency].collateral > 0) {
                rCurrency[retSize] = currency;
                rAmount[retSize] = userCollateralData[_user][currency].collateral;
                retSize++;
            }
        }
        if (userCollateralData[_user][Currency_ETH].collateral > 0) {
            rCurrency[retSize] = Currency_ETH;
            rAmount[retSize] = userCollateralData[_user][Currency_ETH].collateral;
            retSize++;
        }

        return (rCurrency, rAmount);
    }

    /**
     * @dev A unified function for staking collateral and building lUSD atomically. Only up to one of
     * `stakeAmount` and `buildAmount` can be zero.
     *
     * @param stakeCurrency ID of the collateral currency
     * @param stakeAmount Amount of collateral currency to stake, can be zero
     * @param buildAmount Amount of lUSD to build, can be zero
     */
    function stakeAndBuild(bytes32 stakeCurrency, uint256 stakeAmount, uint256 buildAmount) external whenNotPaused {
        require(stakeAmount > 0 || buildAmount > 0, "CollateralSystem: zero amount");

        if (stakeAmount > 0) {
            _collateral(msg.sender, stakeCurrency, stakeAmount);
        }

        if (buildAmount > 0) {
            buildBurnSystem.buildFromCollateralSys(msg.sender, buildAmount);
        }
    }

    /**
     * @dev A unified function for staking collateral and building the maximum amount of lUSD atomically.
     *
     * @param stakeCurrency ID of the collateral currency
     * @param stakeAmount Amount of collateral currency to stake
     */
    function stakeAndBuildMax(bytes32 stakeCurrency, uint256 stakeAmount) external whenNotPaused {
        require(stakeAmount > 0, "CollateralSystem: zero amount");

        _collateral(msg.sender, stakeCurrency, stakeAmount);
        buildBurnSystem.buildMaxFromCollateralSys(msg.sender);
    }

    /**
     * @dev A unified function for burning lUSD and unstaking collateral atomically. Only up to one of
     * `burnAmount` and `unstakeAmount` can be zero.
     *
     * @param burnAmount Amount of lUSD to burn, can be zero
     * @param unstakeCurrency ID of the collateral currency
     * @param unstakeAmount Amount of collateral currency to unstake, can be zero
     */
    function burnAndUnstake(uint256 burnAmount, bytes32 unstakeCurrency, uint256 unstakeAmount)
        external
        whenNotPaused
    {
        require(burnAmount > 0 || unstakeAmount > 0, "CollateralSystem: zero amount");

        if (burnAmount > 0) {
            buildBurnSystem.burnFromCollateralSys(msg.sender, burnAmount);
        }

        if (unstakeAmount > 0) {
            _Redeem(msg.sender, unstakeCurrency, unstakeAmount);
        }
    }

    /**
     * @dev A unified function for burning lUSD and unstaking the maximum amount of collateral atomically.
     *
     * @param burnAmount Amount of lUSD to burn
     * @param unstakeCurrency ID of the collateral currency
     */
    function burnAndUnstakeMax(uint256 burnAmount, bytes32 unstakeCurrency) external whenNotPaused {
        require(burnAmount > 0, "CollateralSystem: zero amount");

        buildBurnSystem.burnFromCollateralSys(msg.sender, burnAmount);
        _redeemMax(msg.sender, unstakeCurrency);
    }

    // need approve
    function Collateral(bytes32 _currency, uint256 _amount) external whenNotPaused returns (bool) {
        address user = msg.sender;
        return _collateral(user, _currency, _amount);
    }

    function _collateral(address user, bytes32 _currency, uint256 _amount) private whenNotPaused returns (bool) {
        require(tokenInfos[_currency].tokenAddr.isContract(), "Invalid token symbol");
        TokenInfo storage tokeninfo = tokenInfos[_currency];
        require(_amount > tokeninfo.minCollateral, "Collateral amount too small");
        require(tokeninfo.bClose == false, "This token is closed");

        IERC20Upgradeable erc20 = IERC20Upgradeable(tokenInfos[_currency].tokenAddr);
        require(erc20.balanceOf(user) >= _amount, "insufficient balance");
        require(erc20.allowance(user, address(this)) >= _amount, "insufficient allowance, need approve more amount");

        erc20.transferFrom(user, address(this), _amount);

        userCollateralData[user][_currency].collateral = userCollateralData[user][_currency].collateral.add(_amount);
        tokeninfo.totalCollateral = tokeninfo.totalCollateral.add(_amount);

        emit CollateralLog(user, _currency, _amount, userCollateralData[user][_currency].collateral);
        return true;
    }

    function IsSatisfyTargetRatio(address _user) public view returns (bool) {
        (uint256 debtBalance,) = debtSystem.GetUserDebtBalanceInUsd(_user);
        if (debtBalance == 0) {
            return true;
        }

        uint256 buildRatio = mConfig.getUint(CONFIG_BUILD_RATIO);
        uint256 totalCollateralInUsd = GetUserTotalCollateralInUsd(_user);
        if (totalCollateralInUsd == 0) {
            return false;
        }
        uint256 myratio = debtBalance.divideDecimal(totalCollateralInUsd);
        return myratio <= buildRatio;
    }

    function RedeemMax(bytes32 _currency) external whenNotPaused {
        _redeemMax(msg.sender, _currency);
    }

    function _redeemMax(address user, bytes32 _currency) private {
        require(_currency == Currency_LINA, "CollateralSystem: only ATH is supported");
        _Redeem(user, Currency_LINA, maxRedeemableLina(user));
    }

    function _Redeem(address user, bytes32 _currency, uint256 _amount) internal {
        require(_currency == Currency_LINA, "CollateralSystem: only ATH is supported");
        require(_amount > 0, "CollateralSystem: zero amount");

        uint256 maxRedeemableLinaAmount = maxRedeemableLina(user);
        require(_amount <= maxRedeemableLinaAmount, "CollateralSystem: insufficient collateral");

        userCollateralData[user][Currency_LINA].collateral =
            userCollateralData[user][Currency_LINA].collateral.sub(_amount);

        TokenInfo storage tokeninfo = tokenInfos[Currency_LINA];
        tokeninfo.totalCollateral = tokeninfo.totalCollateral.sub(_amount);

        IERC20Upgradeable(tokeninfo.tokenAddr).transfer(user, _amount);

        emit RedeemCollateral(user, Currency_LINA, _amount, userCollateralData[user][Currency_LINA].collateral);
    }

    // 1. After redeem, collateral ratio need bigger than target ratio.
    // 2. Cannot redeem more than collateral.
    function Redeem(bytes32 _currency, uint256 _amount) external whenNotPaused returns (bool) {
        address user = msg.sender;
        _Redeem(user, _currency, _amount);
        return true;
    }

    function moveCollateral(address fromUser, address toUser, bytes32 currency, uint256 amount)
        external
        whenNotPaused
        onlyLiquidation
    {
        userCollateralData[fromUser][currency].collateral =
            userCollateralData[fromUser][currency].collateral.sub(amount);
        userCollateralData[toUser][currency].collateral = userCollateralData[toUser][currency].collateral.add(amount);
        emit CollateralMoved(fromUser, toUser, currency, amount);
    }

    function collateralFromUnlockReward(address user, address rewarder, bytes32 currency, uint256 amount)
        external
        whenNotPaused
        onlyRewardLocker
    {
        require(user != address(0), "CollateralSystem: User address cannot be zero");
        require(amount > 0, "CollateralSystem: Collateral amount must be > 0");

        TokenInfo storage tokeninfo = tokenInfos[currency];
        require(tokeninfo.tokenAddr != address(0), "CollateralSystem: Invalid token symbol");

        TransferHelper.safeTransferFrom(tokeninfo.tokenAddr, rewarder, address(this), amount);

        userCollateralData[user][currency].collateral = userCollateralData[user][currency].collateral.add(amount);
        tokeninfo.totalCollateral = tokeninfo.totalCollateral.add(amount);

        emit CollateralUnlockReward(user, currency, amount, userCollateralData[user][currency].collateral);
    }

    event UpdateTokenSetting(bytes32 symbol, address tokenAddr, uint256 minCollateral, bool close);
    event CollateralLog(address user, bytes32 _currency, uint256 _amount, uint256 _userTotal);
    event RedeemCollateral(address user, bytes32 _currency, uint256 _amount, uint256 _userTotal);
    event CollateralMoved(address fromUser, address toUser, bytes32 currency, uint256 amount);
    event CollateralUnlockReward(address user, bytes32 _currency, uint256 _amount, uint256 _userTotal);
}
