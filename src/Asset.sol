// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/IAccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./interfaces/IAsset.sol";

contract Asset is IAsset, ERC20Upgradeable, OwnableUpgradeable {
    bytes32 mKeyName;
    IAccessControlUpgradeable accessCtrl;

    bytes32 private constant ROLE_ISSUE_ASSET = "ISSUE_ASSET";
    bytes32 private constant ROLE_BURN_ASSET = "BURN_ASSET";
    bytes32 private constant ROLE_MOVE_ASSET = "MOVE_ASSET";

    modifier onlyIssueAssetRole() {
        require(accessCtrl.hasRole(ROLE_ISSUE_ASSET, msg.sender), "Asset: not ISSUE_ASSET role");
        _;
    }

    modifier onlyBurnAssetRole() {
        require(accessCtrl.hasRole(ROLE_BURN_ASSET, msg.sender), "Asset: not BURN_ASSET role");
        _;
    }

    modifier onlyMoveAssetRole() {
        require(accessCtrl.hasRole(ROLE_MOVE_ASSET, msg.sender), "Asset: not MOVE_ASSET role");
        _;
    }

    function __Asset_init(
        bytes32 _key,
        string memory _name,
        string memory _symbol,
        IAccessControlUpgradeable _accessCtrl
    )
        public
        initializer
    {
        __ERC20_init(_name, _symbol);
        __Ownable_init();

        require(address(_accessCtrl) != address(0), "Asset: zero address");

        mKeyName = _key;
        accessCtrl = _accessCtrl;
    }

    function keyName() external view returns (bytes32) {
        return mKeyName;
    }

    function mint(address account, uint256 amount) external onlyIssueAssetRole {
        _mint(account, amount);
    }

    function burn(address account, uint256 amount) external onlyBurnAssetRole {
        _burn(account, amount);
    }

    function move(address from, address to, uint256 amount) external onlyMoveAssetRole {
        _transfer(from, to, amount);
    }
}
