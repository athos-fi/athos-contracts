import { expect, use } from "chai";
import { ethers, upgrades, waffle } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import { expandTo18Decimals, expandToNDecimals } from "./utilities";
import { getBlockDateTime } from "./utilities/timeTravel";

import { OracleRouter } from "../typechain";
import { MockChainlinkAggregator } from "../typechain/src/mock/MockChainlinkAggregator";

const { arrayify, formatBytes32String, getAddress, hexlify, zeroPad } =
  ethers.utils;

use(waffle.solidity);

describe("OracleRouter", function () {
  let deployer: SignerWithAddress;

  let oracleRouter: OracleRouter, chainlinkAggregator: MockChainlinkAggregator;

  const assertPriceAndUpdateTime = async (
    currency: string,
    price: number | BigNumber,
    upateTime: number | BigNumber
  ): Promise<void> => {
    const priceAndUpdateTime = await oracleRouter.getPriceAndUpdatedTime(
      formatBytes32String(currency) // currencyKey
    );
    expect(priceAndUpdateTime.price).to.equal(price);
    expect(priceAndUpdateTime.time).to.equal(upateTime);
  };

  beforeEach(async function () {
    [deployer] = await ethers.getSigners();

    const OracleRouter = await ethers.getContractFactory("OracleRouter");
    const MockChainlinkAggregator = await ethers.getContractFactory(
      "MockChainlinkAggregator"
    );

    oracleRouter = (await upgrades.deployProxy(OracleRouter, [], {
      initializer: "__OracleRouter_init",
    })) as OracleRouter;
    chainlinkAggregator = await MockChainlinkAggregator.deploy();
  });

  it("should get result in 18 decimals regardless of Chainlink aggregator precision", async () => {
    // Set token "LINK" to use Chainlink
    await oracleRouter.connect(deployer).addChainlinkOracle(
      formatBytes32String("LINK"), // currencyKey
      chainlinkAggregator.address, // oracleAddress
      false // removeExisting
    );

    // 8 decimals
    await chainlinkAggregator.setDecimals(8);
    await chainlinkAggregator.setLatestRoundData(
      1, // newRoundId
      expandToNDecimals(10, 8), // newAnswer
      100, // newStartedAt
      200, // newUpdatedAt
      1 // newAnsweredInRound
    );
    await assertPriceAndUpdateTime("LINK", expandTo18Decimals(10), 200);

    // 18 decimals
    await chainlinkAggregator.setDecimals(18);
    await chainlinkAggregator.setLatestRoundData(
      1, // newRoundId
      expandToNDecimals(10, 18), // newAnswer
      100, // newStartedAt
      200, // newUpdatedAt
      1 // newAnsweredInRound
    );
    await assertPriceAndUpdateTime("LINK", expandTo18Decimals(10), 200);

    // 20 decimals
    await chainlinkAggregator.setDecimals(20);
    await chainlinkAggregator.setLatestRoundData(
      1, // newRoundId
      expandToNDecimals(10, 20), // newAnswer
      100, // newStartedAt
      200, // newUpdatedAt
      1 // newAnsweredInRound
    );
    await assertPriceAndUpdateTime("LINK", expandTo18Decimals(10), 200);
  });

  it("should get constant price from terminal price oracle", async () => {
    await oracleRouter.connect(deployer).addTerminalPriceOracle(
      formatBytes32String("LINK"), // currencyKey
      getAddress(
        hexlify(zeroPad(arrayify(expandTo18Decimals(999).toHexString()), 20))
      ), // oracleAddress
      false // removeExisting
    );

    await assertPriceAndUpdateTime(
      "LINK",
      expandTo18Decimals(999),
      (await getBlockDateTime(ethers.provider)).toSeconds()
    );
  });
});
