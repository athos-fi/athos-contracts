// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import
    "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
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

    // -------------------------------------------------------
    struct DebtData {
        uint256 debtProportion;
        uint256 debtFactor; // PRECISE_UNIT
    }

    mapping(address => DebtData) public userDebtState;

    //use mapping to store array data
    mapping(uint256 => uint256) public lastDebtFactors; // PRECISE_UNIT Note: 能直接记 factor 的记 factor, 不能记的就用index查
    uint256 public debtCurrentIndex; // length of array. this index of array no value
    // follow var use to manage array size.
    uint256 public lastCloseAt; // close at array index
    uint256 public lastDeletTo; // delete to array index, lastDeletTo < lastCloseAt
    uint256 public constant MAX_DEL_PER_TIME = 50;

    bytes32 private constant ROLE_UPDATE_DEBT = "UPDATE_DEBT";

    modifier onlyUpdateDebtRole() {
        require(
            accessCtrl.hasRole(ROLE_UPDATE_DEBT, msg.sender),
            "DebtSystem: not UPDATE_DEBT role"
        );
        _;
    }

    function __DebtSystem_init(
        IAccessControlUpgradeable _accessCtrl,
        IAssetRegistry _assetSys
    )
        public
        initializer
    {
        __Ownable_init();

        require(address(_accessCtrl) != address(0), "DebtSystem: zero address");
        require(address(_assetSys) != address(0), "DebtSystem: zero address");

        accessCtrl = _accessCtrl;
        assetSys = _assetSys;
    }

    event UpdateAddressStorage(address oldAddr, address newAddr);
    event UpdateUserDebtLog(
        address addr,
        uint256 debtProportion,
        uint256 debtFactor,
        uint256 timestamp
    );
    event PushDebtLog(uint256 index, uint256 newFactor, uint256 timestamp);

    function _pushDebtFactor(uint256 _factor) private {
        if (debtCurrentIndex == 0 || lastDebtFactors[debtCurrentIndex - 1] == 0)
        {
            // init or all debt has be cleared, new set value will be one unit
            lastDebtFactors[debtCurrentIndex] = SafeDecimalMath.preciseUnit();
        } else {
            lastDebtFactors[debtCurrentIndex] = lastDebtFactors[debtCurrentIndex
                - 1].multiplyDecimalRoundPrecise(_factor);
        }
        emit PushDebtLog(
            debtCurrentIndex, lastDebtFactors[debtCurrentIndex], block.timestamp
            );

        debtCurrentIndex = debtCurrentIndex.add(1);

        // delete out of date data
        if (lastDeletTo < lastCloseAt) {
            // safe check
            uint256 delNum = lastCloseAt - lastDeletTo;
            delNum = delNum > MAX_DEL_PER_TIME ? MAX_DEL_PER_TIME : delNum; // not delete all in one call, for saving someone fee.
            for (uint256 i = lastDeletTo; i < delNum; i++) {
                delete lastDebtFactors[i];
            }
            lastDeletTo = lastDeletTo.add(delNum);
        }
    }

    function _updateUserDebt(address _user, uint256 _debtProportion) private {
        userDebtState[_user].debtProportion = _debtProportion;
        userDebtState[_user].debtFactor = _lastSystemDebtFactor();
        emit UpdateUserDebtLog(
            _user, _debtProportion, userDebtState[_user].debtFactor, block.timestamp
            );
    }

    function UpdateDebt(address _user, uint256 _debtProportion, uint256 _factor)
        external
        onlyUpdateDebtRole
    {
        _pushDebtFactor(_factor);
        _updateUserDebt(_user, _debtProportion);
    }

    function GetUserDebtData(address _user)
        external
        view
        returns (uint256 debtProportion, uint256 debtFactor)
    {
        debtProportion = userDebtState[_user].debtProportion;
        debtFactor = userDebtState[_user].debtFactor;
    }

    function _lastSystemDebtFactor() private view returns (uint256) {
        if (debtCurrentIndex == 0) {
            return SafeDecimalMath.preciseUnit();
        }
        return lastDebtFactors[debtCurrentIndex - 1];
    }

    function LastSystemDebtFactor() external view returns (uint256) {
        return _lastSystemDebtFactor();
    }

    function GetUserCurrentDebtProportion(address _user)
        public
        view
        returns (uint256)
    {
        uint256 debtProportion = userDebtState[_user].debtProportion;
        uint256 debtFactor = userDebtState[_user].debtFactor;

        if (debtProportion == 0) {
            return 0;
        }

        uint256 currentUserDebtProportion = _lastSystemDebtFactor()
            .divideDecimalRoundPrecise(debtFactor).multiplyDecimalRoundPrecise(
            debtProportion
        );
        return currentUserDebtProportion;
    }

    /**
     *
     *@return [0] the debt balance of user. [1] system total asset in usd.
     */
    function GetUserDebtBalanceInUsd(address _user)
        external
        view
        returns (uint256, uint256)
    {
        uint256 totalAssetSupplyInUsd = assetSys.totalAssetsInUsd();

        uint256 debtProportion = userDebtState[_user].debtProportion;
        uint256 debtFactor = userDebtState[_user].debtFactor;

        if (debtProportion == 0) {
            return (0, totalAssetSupplyInUsd);
        }

        uint256 currentUserDebtProportion = _lastSystemDebtFactor()
            .divideDecimalRoundPrecise(debtFactor).multiplyDecimalRoundPrecise(
            debtProportion
        );
        uint256 userDebtBalance = totalAssetSupplyInUsd.decimalToPreciseDecimal()
            .multiplyDecimalRoundPrecise(currentUserDebtProportion)
            .preciseDecimalToDecimal();

        return (userDebtBalance, totalAssetSupplyInUsd);
    }
}
