// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface IConfig {
    function getUint(bytes32 key) external view returns (uint256);

    function getBuildRatioKey(bytes32 currencySymbol) external pure returns (bytes32);
}
