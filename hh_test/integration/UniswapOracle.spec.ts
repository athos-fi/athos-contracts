import { Duration } from "luxon";
import { expect, use } from "chai";
import { ethers, upgrades, waffle } from "hardhat";
import { ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  expandTo18Decimals,
  expandTo6Decimals,
  uint256Max,
  zeroAddress,
} from "../utilities";
import {
  getBlockDateTime,
  setNextBlockTimestamp,
} from "../utilities/timeTravel";

import {
  IUniswapV2Factory,
  UniswapCheckpoints,
  UniswapCheckpointer,
  AthToken,
  UniswapTwapOracle,
  WETH9,
  IUniswapV2Router02,
  OracleRouter,
} from "../../typechain";
import { MockUSDC } from "../../typechain/src/mock/MockUSDC";

import UniswapV2FactoryArtifact from "@uniswap/v2-core/build/UniswapV2Factory.json";
import UniswapV2Router02Artifact from "@uniswap/v2-periphery/build/UniswapV2Router02.json";

const { formatBytes32String } = ethers.utils;

use(waffle.solidity);

describe("Integration | UniswapOracle", function () {
  let deployer: SignerWithAddress;

  let athToken: AthToken,
    usdc: MockUSDC,
    weth: WETH9,
    uniswapFactory: IUniswapV2Factory,
    uniswapRouter: IUniswapV2Router02,
    uniswapCheckpoints: UniswapCheckpoints,
    uniswapCheckpointer: UniswapCheckpointer,
    uniswapTwapOracle: UniswapTwapOracle,
    oracleRouter: OracleRouter;

  beforeEach(async function () {
    [deployer] = await ethers.getSigners();

    const AthToken = await ethers.getContractFactory("AthToken");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const WETH9 = await ethers.getContractFactory("WETH9");
    const UniswapV2Factory = new ContractFactory(
      UniswapV2FactoryArtifact.interface,
      UniswapV2FactoryArtifact.bytecode,
      deployer,
    );
    const UniswapV2Router02 = new ContractFactory(
      UniswapV2Router02Artifact.interface,
      UniswapV2Router02Artifact.bytecode,
      deployer,
    );
    const UniswapCheckpoints = await ethers.getContractFactory(
      "UniswapCheckpoints",
    );
    const UniswapCheckpointer = await ethers.getContractFactory(
      "UniswapCheckpointer",
    );
    const UniswapTwapOracle = await ethers.getContractFactory(
      "UniswapTwapOracle",
    );
    const OracleRouter = await ethers.getContractFactory("OracleRouter");

    athToken = (await upgrades.deployProxy(
      AthToken,
      [
        deployer.address, // genesis_holder
      ],
      {
        initializer: "__AthToken_init",
      },
    )) as AthToken;
    usdc = await MockUSDC.deploy();
    weth = await WETH9.deploy();

    uniswapFactory = (await UniswapV2Factory.deploy(
      zeroAddress,
    )) as IUniswapV2Factory;
    uniswapRouter = (await UniswapV2Router02.deploy(
      uniswapFactory.address,
      weth.address,
    )) as IUniswapV2Router02;
    uniswapCheckpoints = (await upgrades.deployProxy(
      UniswapCheckpoints,
      [
        uniswapFactory.address, // _uniswapFactory
      ],
      {
        initializer: "__UniswapCheckpoints_init",
      },
    )) as UniswapCheckpoints;
    uniswapCheckpointer = (await upgrades.deployProxy(
      UniswapCheckpointer,
      [
        uniswapCheckpoints.address, // _checkpoints
      ],
      {
        initializer: "__UniswapCheckpointer_init",
      },
    )) as UniswapCheckpointer;
    uniswapTwapOracle = (await upgrades.deployProxy(
      UniswapTwapOracle,
      [
        uniswapCheckpoints.address, // _checkpoints
        [athToken.address, weth.address, usdc.address], // _priceRoute
        Duration.fromObject({ minutes: 5 }).as("seconds"), // _minInterval
        Duration.fromObject({ minutes: 15 }).as("seconds"), // _maxInterval
        0, // _minPrice
        0, // _maxPrice
      ],
      {
        initializer: "__UniswapTwapOracle_init",
      },
    )) as UniswapTwapOracle;
    oracleRouter = (await upgrades.deployProxy(OracleRouter, [], {
      initializer: "__OracleRouter_init",
    })) as OracleRouter;

    await oracleRouter
      .connect(deployer)
      .addUniswapTwapOracle(
        formatBytes32String("ATH"),
        uniswapTwapOracle.address,
        false,
      );

    await uniswapCheckpoints
      .connect(deployer)
      .setCheckpointer(uniswapCheckpointer.address);
    await uniswapTwapOracle
      .connect(deployer)
      .grantRole(formatBytes32String("UPDATE_PRICE"), deployer.address);
    await uniswapTwapOracle
      .connect(deployer)
      .grantRole(formatBytes32String("UPDATE_PRICE_RANGE"), deployer.address);

    await athToken.connect(deployer).approve(uniswapRouter.address, uint256Max);
    await usdc.connect(deployer).approve(uniswapRouter.address, uint256Max);

    // ETH-USDC pool (1 ETH = 2,000 USDC) (1 ETH = $2,000)
    await uniswapRouter.connect(deployer).addLiquidityETH(
      usdc.address, // token
      expandTo6Decimals(2_000), // amountTokenDesired
      expandTo6Decimals(2_000), // amountTokenMin
      expandTo18Decimals(1), // amountETHMin
      deployer.address, // to
      uint256Max, // deadline
      {
        value: expandTo18Decimals(1),
      },
    );

    // ATH-ETH pool (1 ETH = 200,000 ATH) (1 ATH = 0.000005 ETH) (1 ATH = $0.01)
    await uniswapRouter.connect(deployer).addLiquidityETH(
      athToken.address, // token
      expandTo18Decimals(200_000), // amountTokenDesired
      expandTo18Decimals(200_000), // amountTokenMin
      expandTo18Decimals(1), // amountETHMin
      deployer.address, // to
      uint256Max, // deadline
      {
        value: expandTo18Decimals(1),
      },
    );
  });

  it("sanity test", async () => {
    // Set checkpoint
    await uniswapCheckpointer
      .connect(deployer)
      .makeCheckpoints(
        [athToken.address, weth.address],
        [weth.address, usdc.address],
      );

    const lastCheckpointTimestamp = await getBlockDateTime(ethers.provider);
    await setNextBlockTimestamp(
      ethers.provider,
      lastCheckpointTimestamp.plus({ minutes: 5 }),
    );

    await expect(uniswapTwapOracle.connect(deployer).observePrice())
      .to.emit(uniswapTwapOracle, "PriceUpdated")
      .withArgs(
        expandTo18Decimals(0.01), // price
      );

    const latestPrice = await uniswapTwapOracle.getLatestPrice();
    expect(latestPrice.price).to.equal(expandTo18Decimals(0.01));

    expect(await oracleRouter.getPrice(formatBytes32String("ATH"))).to.equal(
      expandTo18Decimals(0.01),
    );

    // Can't update price if out of range
    await uniswapTwapOracle
      .connect(deployer)
      .setPriceRange(expandTo18Decimals(0.02), expandTo18Decimals(0.1));
    await expect(
      uniswapTwapOracle.connect(deployer).observePrice(),
    ).to.be.revertedWith("UniswapTwapOracle: price too low");
    await uniswapTwapOracle
      .connect(deployer)
      .setPriceRange(expandTo18Decimals(0.005), expandTo18Decimals(0.008));
    await expect(
      uniswapTwapOracle.connect(deployer).observePrice(),
    ).to.be.revertedWith("UniswapTwapOracle: price too high");
  });
});
