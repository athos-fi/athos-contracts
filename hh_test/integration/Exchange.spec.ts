import { DateTime, Duration } from "luxon";
import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  expandTo18Decimals,
  expandTo8Decimals,
  uint256Max,
} from "../utilities";
import { deployAthosStack, DeployedStack } from "../utilities/init";
import {
  getBlockDateTime,
  setNextBlockTimestamp,
} from "../utilities/timeTravel";

const { formatBytes32String } = ethers.utils;

describe("Integration | Exchange", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    settler: SignerWithAddress;

  let stack: DeployedStack;

  const settlementDelay: Duration = Duration.fromObject({ minutes: 1 });
  const revertDelay: Duration = Duration.fromObject({ minutes: 10 });
  const stalePeriod: Duration = Duration.fromObject({ hours: 12 });
  let priceUpdateTime: DateTime;

  const setLbtcPrice = async (price: number): Promise<void> => {
    await stack.abtcOracle.connect(deployer).setPrice(
      expandTo8Decimals(price) // price
    );
  };

  const passSettlementDelay = async (): Promise<void> => {
    await setNextBlockTimestamp(
      ethers.provider,
      (await getBlockDateTime(ethers.provider)).plus(settlementDelay)
    );
  };

  const settleTrade = (entryId: number): Promise<any> => {
    return stack.exchangeSystem.connect(settler).settle(
      entryId // pendingExchangeEntryId
    );
  };

  const settleTradeWithDelay = async (entryId: number): Promise<any> => {
    await passSettlementDelay();
    await settleTrade(entryId);
  };

  beforeEach(async function () {
    [deployer, alice, bob, settler] = await ethers.getSigners();

    stack = await deployAthosStack(deployer);

    priceUpdateTime = await getBlockDateTime(ethers.provider);

    // Set ATH price to $0.01 and aBTC to $20,000
    await stack.athOracle.connect(deployer).setPriceWithTime(
      expandTo8Decimals(0.01), // price
      priceUpdateTime.toSeconds() // updateTime
    );
    await stack.abtcOracle.connect(deployer).setPriceWithTime(
      expandTo8Decimals(20_000), // price
      priceUpdateTime.toSeconds() // updateTime
    );

    // Set BTC exchange fee rate to 1%
    await stack.config.connect(deployer).setUint(
      formatBytes32String("aBTC"), // key
      expandTo18Decimals(0.01) // value
    );

    // Set settlement delay
    await stack.config.connect(deployer).setUint(
      formatBytes32String("TradeSettlementDelay"), // key
      settlementDelay.as("seconds")
    );

    // Set revert delay
    await stack.config.connect(deployer).setUint(
      formatBytes32String("TradeRevertDelay"), // key
      revertDelay.as("seconds")
    );

    // Mint 1,000,000 ATH to Alice
    await stack.athToken
      .connect(deployer)
      .transfer(alice.address, expandTo18Decimals(1_000_000));

    // Alice stakes all ATH
    await stack.athToken
      .connect(alice)
      .approve(stack.collateralSystem.address, uint256Max);
    await stack.collateralSystem.connect(alice).Collateral(
      formatBytes32String("ATH"), // _currency
      expandTo18Decimals(1_000_000) // _amount
    );

    // Alice builds 1,000 athUSD
    await stack.buildBurnSystem.connect(alice).BuildAsset(
      expandTo18Decimals(1_000) // amount
    );
  });

  it("fee not splitted when fee holder is not set", async () => {
    // Set fee split ratio to 30%
    await stack.config.connect(deployer).setUint(
      formatBytes32String("FoundationFeeSplit"), // key
      expandTo18Decimals(0.3) // value
    );

    // Alice exchanges 500 athUSD for 0.025 lBTC
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );
    await settleTradeWithDelay(1);

    // All fees (0.025 * 0.01 * 20000 = 5) go to pool
    expect(
      await stack.ausdToken.balanceOf(stack.rewardSystem.address)
    ).to.equal(expandTo18Decimals(5));

    // Proceedings after fees: 500 / 20000 * (1 - 0.01) = 0.02475 BTC
    expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(500)
    );
    expect(await stack.abtcToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(0.02475)
    );
  });

  it("fee not splitted when split ratio is not set", async () => {
    // Set fee holder to bob
    await stack.exchangeSystem.connect(deployer).setFoundationFeeHolder(
      bob.address // _foundationFeeHolder
    );

    // Alice exchanges 500 athUSD for 0.025 lBTC
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );
    await settleTradeWithDelay(1);

    // All fees (0.025 * 0.01 * 20000 = 5) go to pool
    expect(
      await stack.ausdToken.balanceOf(stack.rewardSystem.address)
    ).to.equal(expandTo18Decimals(5));
    expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(0);

    // Proceedings after fees: 500 / 20000 * (1 - 0.01) = 0.02475 BTC
    expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(500)
    );
    expect(await stack.abtcToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(0.02475)
    );
  });

  it("fee splitted to pool and foundation", async () => {
    // Set fee split ratio to 30%
    await stack.config.connect(deployer).setUint(
      formatBytes32String("FoundationFeeSplit"), // key
      expandTo18Decimals(0.3) // value
    );

    // Set fee holder to bob
    await stack.exchangeSystem.connect(deployer).setFoundationFeeHolder(
      bob.address // _foundationFeeHolder
    );

    // Alice exchanges 500 athUSD for 0.025 lBTC
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );
    await passSettlementDelay();
    await expect(settleTrade(1))
      .to.emit(stack.exchangeSystem, "PendingExchangeSettled")
      .withArgs(
        1, // id
        settler.address, // settler
        expandTo18Decimals(0.02475), // destRecived
        expandTo18Decimals(3.5), // feeForPool
        expandTo18Decimals(1.5) // feeForFoundation
      );

    /**
     * Fee split:
     *   Total = 0.025 * 0.01 * 20000 = 5 athUSD
     *   Foundation = 5 * 0.3 = 1.5 athUSD
     *   Pool = 5 - 1.5 = 3.5 athUSD
     */
    expect(
      await stack.ausdToken.balanceOf(stack.rewardSystem.address)
    ).to.equal(expandTo18Decimals(3.5));
    expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
      expandTo18Decimals(1.5)
    );

    // Proceedings after fees: 500 / 20000 * (1 - 0.01) = 0.02475 BTC
    expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(500)
    );
    expect(await stack.abtcToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(0.02475)
    );
  });

  it("cannot settle when price is staled", async () => {
    const exchangeAction = () =>
      stack.exchangeSystem.connect(alice).exchange(
        formatBytes32String("athUSD"), // sourceKey
        expandTo18Decimals(500), // sourceAmount
        alice.address, // destAddr
        formatBytes32String("aBTC") // destKey
      );

    // Temporarily set delay to avoid settlement issue
    await stack.config.connect(deployer).setUint(
      formatBytes32String("TradeRevertDelay"), // key
      Duration.fromObject({ days: 10 }).as("seconds")
    );

    // Make 2 exchanges
    await exchangeAction();
    await exchangeAction();

    // Can settle when price is not staled
    await setNextBlockTimestamp(
      ethers.provider,
      priceUpdateTime.plus(stalePeriod)
    );
    await settleTrade(1);

    // Cannot settle once price becomes staled
    await setNextBlockTimestamp(
      ethers.provider,
      priceUpdateTime.plus(stalePeriod).plus({ seconds: 1 })
    );
    await expect(settleTrade(2)).to.be.revertedWith(
      "OracleRouter: staled price data"
    );
  });

  it("can sell when position entrance is disabled", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );
    await settleTradeWithDelay(1);

    await stack.exchangeSystem.connect(deployer).setExitPositionOnly(true);

    // Can still sell
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("aBTC"), // sourceKey
      expandTo18Decimals(0.01), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("athUSD") // destKey
    );
  });

  it("cannot buy when position entrance is disabled", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );

    await stack.exchangeSystem.connect(deployer).setExitPositionOnly(true);

    // Can no longer buy
    await expect(
      stack.exchangeSystem.connect(alice).exchange(
        formatBytes32String("athUSD"), // sourceKey
        expandTo18Decimals(500), // sourceAmount
        alice.address, // destAddr
        formatBytes32String("aBTC") // destKey
      )
    ).to.be.revertedWith("ExchangeSystem: can only exit position");
  });

  it("cannot buy when asset position entrance is disabled", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      ethers.utils.formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      ethers.utils.formatBytes32String("aBTC") // destKey
    );

    await stack.exchangeSystem
      .connect(deployer)
      .setAssetExitPositionOnly(ethers.utils.formatBytes32String("aBTC"), true);

    // Can no longer buy
    await expect(
      stack.exchangeSystem.connect(alice).exchange(
        ethers.utils.formatBytes32String("athUSD"), // sourceKey
        expandTo18Decimals(500), // sourceAmount
        alice.address, // destAddr
        ethers.utils.formatBytes32String("aBTC") // destKey
      )
    ).to.be.revertedWith(
      "ExchangeSystem: can only exit position for this asset"
    );

    // Not affected by settings for other assets (unlike global flag)
    await stack.exchangeSystem
      .connect(deployer)
      .setAssetExitPositionOnly(
        ethers.utils.formatBytes32String("aBTC"),
        false
      );
    await stack.exchangeSystem
      .connect(deployer)
      .setAssetExitPositionOnly(ethers.utils.formatBytes32String("lETH"), true);
    await stack.exchangeSystem.connect(alice).exchange(
      ethers.utils.formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      ethers.utils.formatBytes32String("aBTC") // destKey
    );
  });

  it("events should be emitted for exchange and settlement", async () => {
    await expect(
      stack.exchangeSystem.connect(alice).exchange(
        formatBytes32String("athUSD"), // sourceKey
        expandTo18Decimals(500), // sourceAmount
        alice.address, // destAddr
        formatBytes32String("aBTC") // destKey
      )
    )
      .to.emit(stack.exchangeSystem, "PendingExchangeAdded")
      .withArgs(
        1, // id
        alice.address, // fromAddr
        alice.address, // destAddr
        expandTo18Decimals(500), // fromAmount
        formatBytes32String("athUSD"), // fromCurrency
        formatBytes32String("aBTC") // toCurrency
      );

    /**
     * lBTC price changes to 40,000. Will only receive:
     *     500 / 40000 * 0.99 = 0.012375 lBTC
     */
    await passSettlementDelay();
    await setLbtcPrice(40_000);

    await expect(settleTrade(1))
      .to.emit(stack.exchangeSystem, "PendingExchangeSettled")
      .withArgs(
        1, // id
        settler.address, // settler
        expandTo18Decimals(0.012375), // destRecived
        expandTo18Decimals(5), // feeForPool
        0 // feeForFoundation
      );
  });

  it("cannot settle trade before delay is passed", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );

    // Cannot settle before delay is reached
    await setNextBlockTimestamp(
      ethers.provider,
      (await getBlockDateTime(ethers.provider))
        .plus(settlementDelay)
        .minus({ seconds: 1 })
    );
    await expect(settleTrade(1)).to.be.revertedWith(
      "ExchangeSystem: settlement delay not passed"
    );

    // Can settle once delay is reached
    await setNextBlockTimestamp(
      ethers.provider,
      (await getBlockDateTime(ethers.provider)).plus(settlementDelay)
    );
    await settleTrade(1);
  });

  it("source asset should be locked up on exchange", async () => {
    await expect(
      stack.exchangeSystem.connect(alice).exchange(
        formatBytes32String("athUSD"), // sourceKey
        expandTo18Decimals(400), // sourceAmount
        alice.address, // destAddr
        formatBytes32String("aBTC") // destKey
      )
    )
      .to.emit(stack.ausdToken, "Transfer")
      .withArgs(
        alice.address, // from
        stack.exchangeSystem.address, // to
        expandTo18Decimals(400) // value
      );

    expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(600)
    );
    expect(
      await stack.ausdToken.balanceOf(stack.exchangeSystem.address)
    ).to.equal(expandTo18Decimals(400));
  });

  it("trade cannot be settled twice", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );

    // Trade settled
    await settleTradeWithDelay(1);

    // Cannot double-settle a trade
    await expect(settleTrade(1)).to.be.revertedWith(
      "ExchangeSystem: pending entry not found"
    );
  });

  it("can only revert trade after revert delay", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );

    const exchangeTime = await getBlockDateTime(ethers.provider);

    await setNextBlockTimestamp(
      ethers.provider,
      exchangeTime.plus(revertDelay)
    );
    await expect(
      stack.exchangeSystem.connect(settler).revert(
        1 // pendingExchangeEntryId
      )
    ).to.be.revertedWith("ExchangeSystem: revert delay not passed");

    await setNextBlockTimestamp(
      ethers.provider,
      exchangeTime.plus(revertDelay).plus({ seconds: 1 })
    );
    await expect(
      stack.exchangeSystem.connect(settler).revert(
        1 // pendingExchangeEntryId
      )
    )
      .to.emit(stack.exchangeSystem, "PendingExchangeReverted")
      .withArgs(
        1 // id
      )
      .and.emit(stack.ausdToken, "Transfer")
      .withArgs(
        stack.exchangeSystem.address, // from
        alice.address, // to
        expandTo18Decimals(500) // value
      );

    expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
      expandTo18Decimals(1_000)
    );
    expect(
      await stack.ausdToken.balanceOf(stack.exchangeSystem.address)
    ).to.equal(0);
  });

  it("cannot settle trade after revert delay", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );

    const exchangeTime = await getBlockDateTime(ethers.provider);

    await setNextBlockTimestamp(
      ethers.provider,
      exchangeTime.plus(revertDelay).plus({ seconds: 1 })
    );
    await expect(settleTrade(1)).to.be.revertedWith(
      "ExchangeSystem: trade can only be reverted now"
    );
  });

  it("cannot revert trade twice", async () => {
    await stack.exchangeSystem.connect(alice).exchange(
      formatBytes32String("athUSD"), // sourceKey
      expandTo18Decimals(500), // sourceAmount
      alice.address, // destAddr
      formatBytes32String("aBTC") // destKey
    );

    const exchangeTime = await getBlockDateTime(ethers.provider);

    await setNextBlockTimestamp(
      ethers.provider,
      exchangeTime.plus(revertDelay).plus({ seconds: 1 })
    );
    await stack.exchangeSystem.connect(settler).revert(
      1 // pendingExchangeEntryId
    );

    // Cannot revert again
    await expect(
      stack.exchangeSystem.connect(settler).revert(
        1 // pendingExchangeEntryId
      )
    ).to.be.revertedWith("ExchangeSystem: pending entry not found");
  });
});
