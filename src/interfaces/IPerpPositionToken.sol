// SPDX-License-Identifier: MIT
pragma solidity >=0.6.12 <0.9.0;

interface IPerpPositionToken {
    function positionExists(address perpAddress, uint256 positionId) external view returns (bool);

    function mint(address perpAddress, address to) external returns (uint256 tokenId);

    function burn(uint256 tokenId) external;
}
