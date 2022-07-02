// SPDX-License-Identifier: MIT
pragma solidity =0.8.15;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "./interfaces/IPerpPositionToken.sol";

contract PerpPositionToken is
    IPerpPositionToken,
    ERC721Upgradeable,
    OwnableUpgradeable
{
    event PositionTokenMinted(
        uint256 indexed tokenId,
        address indexed perpAddress,
        address indexed to
    );

    uint256 public lastPositionId;
    mapping(uint256 => address) public positionPerpAddresses; // Provides access to underlying position data on-chain

    address public minter;
    address public burner;

    modifier onlyMinter() {
        require(msg.sender == minter, "PerpPositionToken: not minter");
        _;
    }

    modifier onlyBurner() {
        require(msg.sender == burner, "PerpPositionToken: not burner");
        _;
    }

    function positionExists(address perpAddress, uint256 positionId)
        external
        view
        override
        returns (bool)
    {
        return positionPerpAddresses[positionId] == perpAddress;
    }

    function __PerpPositionToken_init() public initializer {
        __Ownable_init();
        __ERC721_init("Athos Perpetual Positions NFT", "ATHOS-PERP-POS");
    }

    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
    }

    function setBurner(address newBurner) external onlyOwner {
        burner = newBurner;
    }

    function mint(address perpAddress, address to)
        external
        onlyMinter
        returns (uint256 tokenId)
    {
        tokenId = ++lastPositionId;

        positionPerpAddresses[tokenId] = perpAddress;
        _mint(to, tokenId);

        emit PositionTokenMinted(tokenId, perpAddress, to);
    }

    function burn(uint256 tokenId) external onlyBurner {
        _burn(tokenId);
        delete positionPerpAddresses[tokenId];
    }
}
