// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/IAssetRegistry.sol";
import "./interfaces/IDebtSystem.sol";
import "./libraries/SafeDecimalMath.sol";

contract DebtSystem is IDebtSystem, OwnableUpgradeable {
    using SafeDecimalMath for uint256;
    using SafeMathUpgradeable for uint256;

    // -------------------------------------------------------
    // need set before system running value.
    IAccessControlUpgradeable public accessCtrl;
    IAssetRegistry public assetSys;

    bytes32 public constant CURRENCY_LINA = "ATH";

    // -------------------------------------------------------
    struct DebtData {
        uint256 debtProportion;
        uint256 debtFactor; // PRECISE_UNIT
    }

    // Debt state for LINA is stored in userDebtState
    mapping(address => DebtData) public userDebtState;

    //use mapping to store array data
    mapping(uint256 => uint256) public lastDebtFactors; // PRECISE_UNIT Note: 能直接记 factor 的记 factor, 不能记的就用index查
    uint256 public debtCurrentIndex; // length of array. this index of array no value
    // follow var use to manage array size.
    uint256 public lastCloseAt; // close at array index
    uint256 public lastDeletTo; // delete to array index, lastDeletTo < lastCloseAt
    uint256 public constant MAX_DEL_PER_TIME = 50;

    bytes32 private constant ROLE_UPDATE_DEBT = "UPDATE_DEBT";

    // Debt state for other currencies is stored in userDebtStateByCurrency
    mapping(bytes32 => mapping(address => DebtData)) public userDebtStateByCurrency;
    mapping(bytes32 => mapping(uint256 => uint256)) public lastDebtFactorsByCurrency;
    mapping(bytes32 => uint256) public debtCurrentIndexByCurrency;
    mapping(bytes32 => uint256) public lastCloseAtByCurrency;
    mapping(bytes32 => uint256) public lastDeletToByCurrency;

    modifier onlyUpdateDebtRole() {
        require(accessCtrl.hasRole(ROLE_UPDATE_DEBT, msg.sender), "DebtSystem: not UPDATE_DEBT role");
        _;
    }

    function __DebtSystem_init(IAccessControlUpgradeable _accessCtrl, IAssetRegistry _assetSys) public initializer {
        __Ownable_init();

        require(address(_accessCtrl) != address(0), "DebtSystem: zero address");
        require(address(_assetSys) != address(0), "DebtSystem: zero address");

        accessCtrl = _accessCtrl;
        assetSys = _assetSys;
    }

    event UpdateAddressStorage(address oldAddr, address newAddr);
    event UpdateUserDebtLog(address addr, uint256 debtProportion, uint256 debtFactor, uint256 timestamp);
    event PushDebtLog(uint256 index, uint256 newFactor, uint256 timestamp);

    function _pushDebtFactor(uint256 _factor, bytes32 _currencySymbol) private {
        uint256 currentIndex;
        uint256 lastDebtFactor;
        if (_currencySymbol == CURRENCY_LINA) {
            currentIndex = debtCurrentIndex;
            lastDebtFactor = lastDebtFactors[debtCurrentIndex - 1];

            if (currentIndex == 0 || lastDebtFactor == 0) {
                // init or all debt has be cleared, new set value will be one unit
                lastDebtFactors[debtCurrentIndex] = SafeDecimalMath.preciseUnit();
            } else {
                lastDebtFactors[debtCurrentIndex] =
                    lastDebtFactors[debtCurrentIndex - 1].multiplyDecimalRoundPrecise(_factor);
            }

            emit PushDebtLog(debtCurrentIndex, lastDebtFactors[debtCurrentIndex], block.timestamp);

            debtCurrentIndex = debtCurrentIndex.add(1);

            // delete out of date data
            if (lastDeletTo < lastCloseAt) {
                // safe check
                uint256 delNum = lastCloseAt - lastDeletTo;
                delNum = (delNum > MAX_DEL_PER_TIME) ? MAX_DEL_PER_TIME : delNum; // not delete all in one call, for saving someone fee.
                for (uint256 i = lastDeletTo; i < delNum; i++) {
                    delete lastDebtFactors[i];
                }
                lastDeletTo = lastDeletTo.add(delNum);
            }
        } else {
            currentIndex = debtCurrentIndexByCurrency[_currencySymbol];
            lastDebtFactor = lastDebtFactorsByCurrency[_currencySymbol][currentIndex - 1];

            if (currentIndex == 0 || lastDebtFactor == 0) {
                // init or all debt has be cleared, new set value will be one unit
                lastDebtFactorsByCurrency[_currencySymbol][currentIndex] = SafeDecimalMath.preciseUnit();
            } else {
                lastDebtFactorsByCurrency[_currencySymbol][currentIndex] =
                    lastDebtFactorsByCurrency[_currencySymbol][currentIndex - 1].multiplyDecimalRoundPrecise(_factor);
            }

            emit PushDebtLog(currentIndex, lastDebtFactorsByCurrency[_currencySymbol][currentIndex], block.timestamp);

            debtCurrentIndexByCurrency[_currencySymbol] = debtCurrentIndexByCurrency[_currencySymbol].add(1);

            // delete out of date data
            if (lastDeletToByCurrency[_currencySymbol] < lastCloseAtByCurrency[_currencySymbol]) {
                // safe check
                uint256 delNum = lastCloseAtByCurrency[_currencySymbol] - lastDeletToByCurrency[_currencySymbol];
                delNum = (delNum > MAX_DEL_PER_TIME) ? MAX_DEL_PER_TIME : delNum; // not delete all in one call, for saving someone fee.
                for (uint256 i = lastDeletToByCurrency[_currencySymbol]; i < delNum; i++) {
                    delete lastDebtFactorsByCurrency[_currencySymbol][i];
                }
                lastDeletToByCurrency[_currencySymbol] = lastDeletToByCurrency[_currencySymbol].add(delNum);
            }
        }
    }

    function _updateUserDebt(address _user, uint256 _debtProportion, bytes32 _currencySymbol) private {
        if (_currencySymbol == CURRENCY_LINA) {
            userDebtState[_user].debtProportion = _debtProportion;
            userDebtState[_user].debtFactor = _lastSystemDebtFactor(_currencySymbol);
        } else {
            userDebtStateByCurrency[_currencySymbol][_user].debtProportion = _debtProportion;
            userDebtStateByCurrency[_currencySymbol][_user].debtFactor = _lastSystemDebtFactor(_currencySymbol);
        }
        emit UpdateUserDebtLog(_user, _debtProportion, userDebtState[_user].debtFactor, block.timestamp);
    }

    /**
     * @notice This function is deprecated as it only update debt with LINA
     *  as collateral. Use UpdateDebtByCurrency()` instead.
     */
    function UpdateDebt(address _user, uint256 _debtProportion, uint256 _factor) external onlyUpdateDebtRole {
        _pushDebtFactor(_factor, CURRENCY_LINA);
        _updateUserDebt(_user, _debtProportion, CURRENCY_LINA);
    }

    function UpdateDebtByCurrency(address _user, uint256 _debtProportion, uint256 _factor, bytes32 _currencySymbol)
        external
        onlyUpdateDebtRole
    {
        // TODO: check if currencySymbol is accepted
        _pushDebtFactor(_factor, _currencySymbol);
        _updateUserDebt(_user, _debtProportion, _currencySymbol);
    }

    /**
     * @notice This function is deprecated as it only get user debt data with LINA
     *  as collateral. Use GetUserDebtDataByCurrency()` instead.
     */
    function GetUserDebtData(address _user) external view returns (uint256 debtProportion, uint256 debtFactor) {
        (debtProportion, debtFactor) = _getUserDebtData(_user, CURRENCY_LINA);
    }

    function GetUserDebtDataByCurrency(address _user, bytes32 _currencySymbol)
        external
        view
        returns (uint256 debtProportion, uint256 debtFactor)
    {
        (debtProportion, debtFactor) = _getUserDebtData(_user, _currencySymbol);
    }

    function _getUserDebtData(address _user, bytes32 _currencySymbol)
        private
        view
        returns (uint256 debtProportion, uint256 debtFactor)
    {
        if (_currencySymbol == CURRENCY_LINA) {
            debtProportion = userDebtState[_user].debtProportion;
            debtFactor = userDebtState[_user].debtFactor;
        } else {
            debtProportion = userDebtStateByCurrency[_currencySymbol][_user].debtProportion;
            debtFactor = userDebtStateByCurrency[_currencySymbol][_user].debtFactor;
        }
    }

    function _lastSystemDebtFactor(bytes32 _currencySymbol) private view returns (uint256) {
        if (_currencySymbol == CURRENCY_LINA) {
            if (debtCurrentIndex == 0) {
                return SafeDecimalMath.preciseUnit();
            }
            return lastDebtFactors[debtCurrentIndex - 1];
        } else {
            if (debtCurrentIndexByCurrency[_currencySymbol] == 0) {
                return SafeDecimalMath.preciseUnit();
            }
            return lastDebtFactorsByCurrency[_currencySymbol][debtCurrentIndexByCurrency[_currencySymbol] - 1];
        }
    }

    function LastSystemDebtFactor() external view returns (uint256) {
        return _lastSystemDebtFactor(CURRENCY_LINA);
    }

    function LastSystemDebtFactorByCurrency(bytes32 _currencySymbol) external view returns (uint256) {
        return _lastSystemDebtFactor(_currencySymbol);
    }

    /**
     * @notice This function is deprecated as it only get user current debt proportion
     *  with LINA as collateral. Use GetUserDebtDataByCurrency()` instead.
     */
    function GetUserCurrentDebtProportion(address _user) public view returns (uint256) {
        return _getUserCurrentDebtProportion(_user, CURRENCY_LINA);
    }

    function GetUserCurrentDebtProportionByCurrency(address _user, bytes32 _currencySymbol)
        public
        view
        returns (uint256)
    {
        return _getUserCurrentDebtProportion(_user, _currencySymbol);
    }

    function _getUserCurrentDebtProportion(address _user, bytes32 _currencySymbol) private view returns (uint256) {
        uint256 debtProportion;
        uint256 debtFactor;
        if (_currencySymbol == CURRENCY_LINA) {
            debtProportion = userDebtState[_user].debtProportion;
            debtFactor = userDebtState[_user].debtFactor;
        } else {
            debtProportion = userDebtStateByCurrency[_currencySymbol][_user].debtProportion;
            debtFactor = userDebtStateByCurrency[_currencySymbol][_user].debtFactor;
        }

        if (debtProportion == 0) {
            return 0;
        }

        uint256 currentUserDebtProportion = _lastSystemDebtFactor(_currencySymbol).divideDecimalRoundPrecise(debtFactor)
            .multiplyDecimalRoundPrecise(debtProportion);
        return currentUserDebtProportion;
    }

    /**
     * @notice This function is deprecated as it only get user debt balance
     *  with LINA as collateral. Use GetUserDebtDataByCurrency()` instead.
     */
    function GetUserDebtBalanceInUsd(address _user) external view returns (uint256, uint256) {
        return _getUserDebtBalanceInUsd(_user, CURRENCY_LINA);
    }

    function GetUserDebtBalanceInUsdByCurrency(address _user, bytes32 _currencySymbol)
        external
        view
        returns (uint256, uint256)
    {
        return _getUserDebtBalanceInUsd(_user, _currencySymbol);
    }

    /**
     *
     * @return [0] the debt balance of user. [1] system total asset in usd.
     */
    function _getUserDebtBalanceInUsd(address _user, bytes32 _currencySymbol) private view returns (uint256, uint256) {
        uint256 totalAssetSupplyInUsd = assetSys.totalAssetsInUsd();

        uint256 debtProportion;
        uint256 debtFactor;
        if (_currencySymbol == CURRENCY_LINA) {
            debtProportion = userDebtState[_user].debtProportion;
            debtFactor = userDebtState[_user].debtFactor;
        } else {
            debtProportion = userDebtStateByCurrency[_currencySymbol][_user].debtProportion;
            debtFactor = userDebtStateByCurrency[_currencySymbol][_user].debtFactor;
        }

        if (debtProportion == 0) {
            return (0, totalAssetSupplyInUsd);
        }

        uint256 currentUserDebtProportion = _lastSystemDebtFactor(_currencySymbol).divideDecimalRoundPrecise(debtFactor)
            .multiplyDecimalRoundPrecise(debtProportion);
        uint256 userDebtBalance = totalAssetSupplyInUsd.decimalToPreciseDecimal().multiplyDecimalRoundPrecise(
            currentUserDebtProportion
        ).preciseDecimalToDecimal();
        return (userDebtBalance, totalAssetSupplyInUsd);
    }
}
