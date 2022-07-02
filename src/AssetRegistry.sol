// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IAssetRegistry.sol";
import "./interfaces/IOracleRouter.sol";
import "./interfaces/IPerpetual.sol";
import "./libraries/SafeDecimalMath.sol";

contract AssetRegistry is IAssetRegistry, OwnableUpgradeable {
    using SafeDecimalMath for uint256;
    using SafeMathUpgradeable for uint256;

    IOracleRouter public oracleRouter;

    IAsset[] public mAssetList;
    mapping(address => bytes32) public mAddress2Names;
    mapping(bytes32 => address) public assetSymbolToAddresses;
    mapping(bytes32 => address) public perpAddresses;
    mapping(address => bytes32) public perpSymbols;

    function __AssetRegistry_init(IOracleRouter _oracleRouter)
        public
        initializer
    {
        __Ownable_init();

        require(
            address(_oracleRouter) != address(0), "AssetRegistry: zero address"
        );

        oracleRouter = _oracleRouter;
    }

    function addAsset(IAsset asset) external onlyOwner {
        bytes32 name = asset.keyName();

        require(
            assetSymbolToAddresses[name] == address(0),
            "AssetRegistry: asset already exists"
        );
        require(
            mAddress2Names[address(asset)] == bytes32(0),
            "AssetRegistry: asset address already exists"
        );

        mAssetList.push(asset);
        assetSymbolToAddresses[name] = address(asset);
        mAddress2Names[address(asset)] = name;

        emit AssetAdded(name, address(asset));
    }

    function removeAsset(bytes32 name) external onlyOwner {
        address assetToRemove = address(assetSymbolToAddresses[name]);

        require(
            assetToRemove != address(0), "AssetRegistry: asset does not exist"
        );

        // Remove from list
        for (uint256 i = 0; i < mAssetList.length; i++) {
            if (address(mAssetList[i]) == assetToRemove) {
                delete mAssetList[i];
                mAssetList[i] = mAssetList[mAssetList.length - 1];
                mAssetList.pop();
                break;
            }
        }

        // And remove it from the assets mapping
        delete mAddress2Names[assetToRemove];
        delete assetSymbolToAddresses[name];

        emit AssetRemoved(name, assetToRemove);
    }

    function addPerp(IPerpetual perp) external onlyOwner {
        require(address(perp) != address(0), "AssetRegistry: zero address");

        bytes32 symbol = perp.underlyingTokenSymbol();
        require(
            perpAddresses[symbol] == address(0),
            "AssetRegistry: perp already exists"
        );

        perpAddresses[symbol] = address(perp);
        perpSymbols[address(perp)] = symbol;

        emit PerpAdded(symbol, address(perp));
    }

    function totalAssetsInUsd() public view returns (uint256 rTotal) {
        uint256 totalSupplyValue = 0;
        uint256 totalPerpDebtValue = 0;

        for (uint256 ind = 0; ind < mAssetList.length; ind++) {
            address asset = address(mAssetList[ind]);
            bytes32 assetSymbol = IAsset(asset).keyName();

            uint256 exchangeRate = oracleRouter.getPrice(assetSymbol);
            address perpAddress = perpAddresses[assetSymbol];

            totalSupplyValue = totalSupplyValue.add(
                IERC20Upgradeable(asset).totalSupply().multiplyDecimal(exchangeRate)
            );

            if (perpAddress != address(0)) {
                totalPerpDebtValue = totalPerpDebtValue.add(
                    IPerpetual(perpAddress).totalUsdDebt()
                ).add(
                    IPerpetual(perpAddress).totalUnderlyingDebt().multiplyDecimal(exchangeRate)
                );
            }
        }

        rTotal = totalSupplyValue.sub(totalPerpDebtValue);
    }

    function getAssetAddresses() external view returns (address[] memory) {
        address[] memory addr = new address[](mAssetList.length);
        for (uint256 i = 0; i < mAssetList.length; i++) {
            addr[i] = address(mAssetList[i]);
        }
        return addr;
    }

    function isPerpAddressRegistered(address perpAddress)
        external
        view
        returns (bool)
    {
        return perpSymbols[perpAddress] != bytes32(0);
    }

    event AssetAdded(bytes32 name, address asset);
    event AssetRemoved(bytes32 name, address asset);
    event PerpAdded(bytes32 underlying, address perp);
}
