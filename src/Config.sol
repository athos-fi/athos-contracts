// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/IConfig.sol";

contract Config is IConfig, OwnableUpgradeable {
    mapping(bytes32 => uint256) internal mUintConfig;

    function __Config_init() public initializer {
        __Ownable_init();
    }

    function getUint(bytes32 key) external view returns (uint256) {
        return mUintConfig[key];
    }

    function setUint(bytes32 key, uint256 value) external onlyOwner {
        mUintConfig[key] = value;
        emit SetUintConfig(key, value);
    }

    function deleteUint(bytes32 key) external onlyOwner {
        delete mUintConfig[key];
        emit SetUintConfig(key, 0);
    }

    event SetUintConfig(bytes32 key, uint256 value);
}
