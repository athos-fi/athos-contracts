import { DateTime, Duration } from "luxon";
import { ethers } from "hardhat";
import { BigNumber, Signer } from "ethers";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  expandTo18Decimals,
  expandTo8Decimals,
  uint256Max,
  zeroAddress,
} from "../utilities";
import { deployAthosStack, DeployedStack } from "../utilities/init";
import {
  getBlockDateTime,
  setNextBlockTimestamp,
} from "../utilities/timeTravel";

const { formatBytes32String } = ethers.utils;

describe("Integration | Perpetual", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress;

  let stack: DeployedStack;

  const settlementDelay: Duration = Duration.fromObject({ minutes: 1 });
  const revertDelay: Duration = Duration.fromObject({ minutes: 10 });
  let priceUpdateTime: DateTime;

  const passSettlementDelay = async (): Promise<void> => {
    await setNextBlockTimestamp(
      ethers.provider,
      (await getBlockDateTime(ethers.provider)).plus(settlementDelay)
    );
  };

  const passRevertDelay = async (): Promise<void> => {
    await setNextBlockTimestamp(
      ethers.provider,
      (await getBlockDateTime(ethers.provider))
        .plus(revertDelay)
        .plus({ seconds: 1 })
    );
  };

  const assertAliceDebt = async (amount: BigNumber) => {
    expect(
      (await stack.debtSystem.GetUserDebtBalanceInUsd(alice.address))[0]
    ).to.equal(amount);
  };

  const closePosition = async (
    actionId: number,
    user: SignerWithAddress,
    positionId: number
  ): Promise<void> => {
    await stack.perpExchange.connect(user).closePosition(
      formatBytes32String("aBTC"), // underlying
      positionId, // positionId
      user.address // to
    );
    await passSettlementDelay();
    await stack.perpExchange.connect(alice).settleAction(actionId);
  };

  const setLbtcPrice = async (price: number | BigNumber): Promise<void> => {
    const actualPrice = (price as any)._isBigNumber
      ? (price as BigNumber)
      : expandTo8Decimals(price as number);

    await stack.abtcOracle.connect(deployer).setPrice(
      actualPrice // price
    );
  };

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    stack = await deployAthosStack(deployer);

    priceUpdateTime = await getBlockDateTime(ethers.provider);

    // Set settlement & revert delay
    await stack.config.connect(deployer).setUint(
      ethers.utils.formatBytes32String("TradeSettlementDelay"), // key
      settlementDelay.as("seconds")
    );
    await stack.config.connect(deployer).setUint(
      ethers.utils.formatBytes32String("TradeRevertDelay"), // key
      revertDelay.as("seconds")
    );

    // Set ATH price to $0.1 and aBTC to $20,000
    await stack.athOracle.connect(deployer).setPriceWithTime(
      expandTo8Decimals(0.1), // price
      priceUpdateTime.toSeconds() // updateTime
    );
    await stack.abtcOracle.connect(deployer).setPriceWithTime(
      expandTo8Decimals(20_000), // price
      priceUpdateTime.toSeconds() // updateTime
    );

    // Mint 1,000,000 ATH to Alice
    await stack.athToken
      .connect(deployer)
      .transfer(alice.address, expandTo18Decimals(1_000_000));

    // Alice stakes all ATH and builds 10,000 aUSD
    await stack.athToken
      .connect(alice)
      .approve(stack.collateralSystem.address, uint256Max);
    await stack.collateralSystem.connect(alice).stakeAndBuild(
      formatBytes32String("ATH"), // stakeCurrnecy
      expandTo18Decimals(1_000_000), // stakeAmount
      expandTo18Decimals(10_000) // buildAmount
    );

    // Alice sends 10,000 aUSD to Bob
    await stack.ausdToken.connect(alice).transfer(
      bob.address, // recipient
      expandTo18Decimals(10_000) // amount
    );
    await stack.ausdToken.connect(bob).approve(
      stack.perpExchange.address, // spender
      uint256Max // amount
    );
  });

  it("can only open long position with sufficient collateral", async () => {
    /**
     * 10% init margin = 0.1 * 20000 * 10% = 200 aUSD
     * 1% fee = 0.1 * 20000 * 1% = 20 aUSD
     *
     * Need to send minimum 220 aUSD as collateral
     */
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      true, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(220).sub(1) // collateral
    );
    await passSettlementDelay();
    await expect(
      stack.perpExchange.connect(alice).settleAction(1)
    ).to.be.revertedWith("Perpetual: min init margin not reached");

    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      true, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(220) // collateral
    );
    await passSettlementDelay();
    await stack.perpExchange.connect(alice).settleAction(2);
  });

  it("can only open short position with sufficient collateral", async () => {
    // Same as last case
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      false, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(220).sub(1) // collateral
    );
    await passSettlementDelay();
    await expect(
      stack.perpExchange.connect(alice).settleAction(1)
    ).to.be.revertedWith("Perpetual: min init margin not reached");

    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      false, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(220) // collateral
    );
    await passSettlementDelay();
    await stack.perpExchange.connect(alice).settleAction(2);
  });

  it("collateral is locked up for queuing openPosition actions", async () => {
    expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
      expandTo18Decimals(10_000)
    );

    await expect(
      stack.perpExchange.connect(bob).openPosition(
        formatBytes32String("aBTC"), // underlying
        true, // isLong
        expandTo18Decimals(0.1), // size
        expandTo18Decimals(1000) // collateral
      )
    )
      .to.emit(stack.ausdToken, "Transfer")
      .withArgs(
        bob.address, // from
        stack.perpExchange.address, // to
        expandTo18Decimals(1000)
      );

    expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
      expandTo18Decimals(9_000)
    );
  });

  it("collateral is refunded for reverted openPosition actions", async () => {
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      true, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(1000) // collateral
    );
    expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
      expandTo18Decimals(9_000)
    );

    await passRevertDelay();
    await expect(stack.perpExchange.connect(alice).revertAction(1))
      .to.emit(stack.ausdToken, "Transfer")
      .withArgs(
        stack.perpExchange.address, // from
        bob.address, // to
        expandTo18Decimals(1000)
      );
    expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
      expandTo18Decimals(10_000)
    );
  });

  it("collateral is sent to perp contract for settled openPosition actions", async () => {
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      true, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(1000) // collateral
    );
    await passSettlementDelay();

    expect(
      await stack.ausdToken.balanceOf(stack.perpExchange.address)
    ).to.equal(expandTo18Decimals(1000));

    await expect(stack.perpExchange.connect(alice).settleAction(1))
      .to.emit(stack.ausdToken, "Transfer")
      .withArgs(
        stack.perpExchange.address, // from
        stack.abtcPerp.address, // to
        expandTo18Decimals(1000) // amount
      );
    expect(
      await stack.ausdToken.balanceOf(stack.perpExchange.address)
    ).to.equal(0);
  });

  it("fees are sent to pool fee holder", async () => {
    expect(
      await stack.ausdToken.balanceOf(stack.rewardSystem.address)
    ).to.equal(0);

    // 20 aUSD in fees
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      true, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(1000) // collateral
    );
    await passSettlementDelay();
    await stack.perpExchange.connect(alice).settleAction(1);

    expect(
      await stack.ausdToken.balanceOf(stack.rewardSystem.address)
    ).to.equal(expandTo18Decimals(20));
  });

  it("aUSD minters should not be affected when skew is zero", async () => {
    await assertAliceDebt(expandTo18Decimals(10_000));

    // Bob longs and shorts 0.1 BTC
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      true, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(1_000) // collateral
    );
    await stack.perpExchange.connect(bob).openPosition(
      formatBytes32String("aBTC"), // underlying
      false, // isLong
      expandTo18Decimals(0.1), // size
      expandTo18Decimals(1_000) // collateral
    );
    await passSettlementDelay();
    await stack.perpExchange.connect(alice).settleAction(1);
    await stack.perpExchange.connect(alice).settleAction(2);

    // Debt not changed
    await assertAliceDebt(expandTo18Decimals(10_000));

    // Debt not changed when price goes up
    await setLbtcPrice(25000);
    await assertAliceDebt(expandTo18Decimals(10_000));

    // Debt not changed when price goes down
    await setLbtcPrice(15000);
    await assertAliceDebt(expandTo18Decimals(10_000));
  });

  describe("Long positions", function () {
    beforeEach(async function () {
      // Bob longs 0.1 BTC with 1,000 aUSD
      await stack.perpExchange.connect(bob).openPosition(
        formatBytes32String("aBTC"), // underlying
        true, // isLong
        expandTo18Decimals(0.1), // size
        expandTo18Decimals(1_000) // collateral
      );
      await passSettlementDelay();
      await expect(stack.perpExchange.connect(alice).settleAction(1))
        .to.emit(stack.perpPositionToken, "Transfer")
        .withArgs(
          zeroAddress, // from
          bob.address, // to
          1 // tokenId
        );
    });

    it("position token should be minted", async () => {
      expect(await stack.perpPositionToken.balanceOf(bob.address)).to.equal(1);
      expect(await stack.perpPositionToken.ownerOf(1)).to.equal(bob.address);
    });

    it("correct position data", async () => {
      const position = await stack.abtcPerp.positions(1);
      expect(position.isLong).to.equal(true);
      expect(position.debt).to.equal(expandTo18Decimals(2_000));
      expect(position.locked).to.equal(expandTo18Decimals(0.1));
      expect(position.collateral).to.equal(expandTo18Decimals(980));
    });

    it("aUSD minter debt should not be affected", async () => {
      await assertAliceDebt(expandTo18Decimals(10_000));
    });

    it("entry fees should be sent to fee holder", async () => {
      expect(
        await stack.ausdToken.balanceOf(stack.rewardSystem.address)
      ).to.equal(expandTo18Decimals(20));
    });

    describe("Add collateral", function () {
      it("aUSD should be transferred to perp contract", async () => {
        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(9_000)
        );
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(expandTo18Decimals(980));

        await stack.ausdToken.connect(bob).approve(
          stack.abtcPerp.address, // spender
          expandTo18Decimals(1_000) // amount
        );
        await expect(
          stack.abtcPerp.connect(bob).addCollateral(
            1, // positionId
            expandTo18Decimals(1_000) // amount
          )
        )
          .to.emit(stack.ausdToken, "Transfer")
          .withArgs(
            bob.address, // from
            stack.abtcPerp.address, // to
            expandTo18Decimals(1_000) // amount
          );

        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(8_000)
        );
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(expandTo18Decimals(1_980));
      });
    });

    describe("Remove collateral", function () {
      it("can only remove collateral up to min init margin", async () => {
        /**
         * 10% init margin = 0.1 * 20000 * 10% = 200 aUSD
         * 1% fee = 0.1 * 20000 * 1% = 20 aUSD
         *
         * Sending in 1000 aUSD. Can remove up to 780 aUSD
         */

        // Trying to remove too much
        await expect(
          stack.abtcPerp.connect(bob).removeCollateral(
            1, // positionId
            expandTo18Decimals(780).add(1), // amount
            bob.address // to
          )
        ).to.be.revertedWith("Perpetual: min init margin not reached");

        // Removing the exact maximum
        await stack.abtcPerp.connect(bob).removeCollateral(
          1, // positionId
          expandTo18Decimals(780), // amount
          bob.address // to
        );

        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(expandTo18Decimals(200));
      });

      it("correct position data after collateral removeal", async () => {
        await stack.abtcPerp.connect(bob).removeCollateral(
          1, // positionId
          expandTo18Decimals(480), // amount
          bob.address // to
        );

        const position = await stack.abtcPerp.positions(1);
        expect(position.isLong).to.equal(true);
        expect(position.debt).to.equal(expandTo18Decimals(2_000));
        expect(position.locked).to.equal(expandTo18Decimals(0.1));
        expect(position.collateral).to.equal(expandTo18Decimals(500));
      });

      it("collateral removed should be sent to `to`", async () => {
        await expect(
          stack.abtcPerp.connect(bob).removeCollateral(
            1, // positionId
            expandTo18Decimals(480), // amount
            alice.address // to
          )
        )
          .to.emit(stack.ausdToken, "Transfer")
          .withArgs(
            stack.abtcPerp.address, // from
            alice.address, // to
            expandTo18Decimals(480) // amount
          );

        expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
          expandTo18Decimals(480)
        );
      });
    });

    describe("Price goes up", function () {
      beforeEach(async function () {
        // BTC price goes up from $20,000 to $30,000
        await setLbtcPrice(30000);
      });

      it("perp trader makes profit", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        /**
         * Entry fees = 0.1 * 20,000 * 0.01 = 20 aUSD
         * Exit fees = 0.1 * 30,000 * 0.01 = 30 aUSD
         * PnL = 0.1 * (30,000 - 20,000) - 20 - 30 = 950 aUSD
         */
        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(10_950)
        );

        // Perp contract should have nothing left
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
        expect(
          await stack.abtcToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
      });

      it("aUSD minter debt should increase", async () => {
        await assertAliceDebt(expandTo18Decimals(11_000));
      });

      it("exit fees should be sent to fee holder", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        expect(
          await stack.ausdToken.balanceOf(stack.rewardSystem.address)
        ).to.equal(expandTo18Decimals(50));
      });
    });

    describe("Price goes down", function () {
      beforeEach(async function () {
        // BTC price goes down from $20,000 to $15,000
        await setLbtcPrice(15000);
      });

      it("perp trader makes losses", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        /**
         * Entry fees = 0.1 * 20,000 * 0.01 = 20 aUSD
         * Exit fees = 0.1 * 15,000 * 0.01 = 15 aUSD
         * PnL = 0.1 * (15,000 - 20,000) - 20 - 15 = -535 aUSD
         */
        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(9_465)
        );

        // Perp contract should have nothing left
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
        expect(
          await stack.abtcToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
      });

      it("aUSD minter debt should decrease", async () => {
        await assertAliceDebt(expandTo18Decimals(9_500));
      });

      it("exit fees should be sent to fee holder", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        expect(
          await stack.ausdToken.balanceOf(stack.rewardSystem.address)
        ).to.equal(expandTo18Decimals(35));
      });
    });

    describe("Liquidation", function () {
      it("can only liquidate when below maintenance margin ratio", async () => {
        /**
         * liqPrice = ((maintenanceMargin + 1) * debt - collateral) / locked
         *          = ((0.05 + 1) * 2,000 - 980) / 0.1
         *          = 11,200
         */
        await setLbtcPrice(11200);

        // Cannot liquidate yet since ratio is not *below* maintenance margin
        expect(await stack.abtcPerp.getCollateralizationRatio(1)).to.equal(
          expandTo18Decimals(0.05)
        );
        await expect(
          stack.abtcPerp.connect(alice).liquidatePosition(
            1, // positionId
            expandTo18Decimals(0.005), // amount
            alice.address // rewardTo
          )
        ).to.be.revertedWith("Perpetual: not lower than maintenance margin");

        await setLbtcPrice(11199);
        await stack.abtcPerp.connect(alice).liquidatePosition(
          1, // positionId
          expandTo18Decimals(0.005), // amount
          alice.address // rewardTo
        );
      });
    });
  });

  describe("Short positions", function () {
    beforeEach(async function () {
      // Bob shorts 0.1 BTC with 1,000 aUSD
      await stack.perpExchange.connect(bob).openPosition(
        formatBytes32String("aBTC"), // underlying
        false, // isLong
        expandTo18Decimals(0.1), // size
        expandTo18Decimals(1_000) // collateral
      );
      await passSettlementDelay();
      await expect(stack.perpExchange.connect(alice).settleAction(1))
        .to.emit(stack.perpPositionToken, "Transfer")
        .withArgs(
          zeroAddress, // from
          bob.address, // to
          1 // tokenId
        );
    });

    it("position token should be minted", async () => {
      expect(await stack.perpPositionToken.balanceOf(bob.address)).to.equal(1);
      expect(await stack.perpPositionToken.ownerOf(1)).to.equal(bob.address);
    });

    it("correct position data", async () => {
      const position = await stack.abtcPerp.positions(1);
      expect(position.isLong).to.equal(false);
      expect(position.debt).to.equal(expandTo18Decimals(0.1));
      expect(position.locked).to.equal(0);
      expect(position.collateral).to.equal(expandTo18Decimals(2_980));
    });

    it("aUSD minter debt should not be affected", async () => {
      await assertAliceDebt(expandTo18Decimals(10_000));
    });

    it("entry fees should be sent to fee holder", async () => {
      expect(
        await stack.ausdToken.balanceOf(stack.rewardSystem.address)
      ).to.equal(expandTo18Decimals(20));
    });

    describe("Add collateral", function () {
      it("aUSD should be transferred to perp contract", async () => {
        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(9_000)
        );
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(expandTo18Decimals(2_980));

        await stack.ausdToken.connect(bob).approve(
          stack.abtcPerp.address, // spender
          expandTo18Decimals(1_000) // amount
        );
        await expect(
          stack.abtcPerp.connect(bob).addCollateral(
            1, // positionId
            expandTo18Decimals(1_000) // amount
          )
        )
          .to.emit(stack.ausdToken, "Transfer")
          .withArgs(
            bob.address, // from
            stack.abtcPerp.address, // to
            expandTo18Decimals(1_000) // amount
          );

        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(8_000)
        );
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(expandTo18Decimals(3_980));
      });
    });

    describe("Remove collateral", function () {
      it("can only remove collateral up to min init margin", async () => {
        /**
         * 10% init margin = 0.1 * 20000 * 10% = 200 aUSD
         * 1% fee = 0.1 * 20000 * 1% = 20 aUSD
         *
         * Sending in 1000 aUSD. Can remove up to 780 aUSD
         */

        // Trying to remove too much
        await expect(
          stack.abtcPerp.connect(bob).removeCollateral(
            1, // positionId
            expandTo18Decimals(780).add(1), // amount
            bob.address // to
          )
        ).to.be.revertedWith("Perpetual: min init margin not reached");

        // Removing the exact maximum
        await stack.abtcPerp.connect(bob).removeCollateral(
          1, // positionId
          expandTo18Decimals(780), // amount
          bob.address // to
        );

        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(expandTo18Decimals(2_200));
      });

      it("correct position data after collateral removeal", async () => {
        await stack.abtcPerp.connect(bob).removeCollateral(
          1, // positionId
          expandTo18Decimals(480), // amount
          bob.address // to
        );

        const position = await stack.abtcPerp.positions(1);
        expect(position.isLong).to.equal(false);
        expect(position.debt).to.equal(expandTo18Decimals(0.1));
        expect(position.locked).to.equal(0);
        expect(position.collateral).to.equal(expandTo18Decimals(2_500));
      });

      it("collateral removed should be sent to `to`", async () => {
        await expect(
          stack.abtcPerp.connect(bob).removeCollateral(
            1, // positionId
            expandTo18Decimals(480), // amount
            alice.address // to
          )
        )
          .to.emit(stack.ausdToken, "Transfer")
          .withArgs(
            stack.abtcPerp.address, // from
            alice.address, // to
            expandTo18Decimals(480) // amount
          );

        expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
          expandTo18Decimals(480)
        );
      });
    });

    describe("Price goes up", function () {
      beforeEach(async function () {
        // BTC price goes up from $20,000 to $25,000
        await setLbtcPrice(25000);
      });

      it("perp trader makes losses", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        /**
         * Entry fees = 0.1 * 20,000 * 0.01 = 20 aUSD
         * Exit fees = 0.1 * 25,000 * 0.01 = 25 aUSD
         * PnL = 0.1 * (20,000 - 25,000) - 20 - 25 = -545 aUSD
         */
        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(9_455)
        );

        // Perp contract should have nothing left
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
        expect(
          await stack.abtcToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
      });

      it("aUSD minter debt should increase", async () => {
        await assertAliceDebt(expandTo18Decimals(9_500));
      });

      it("exit fees should be sent to fee holder", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        expect(
          await stack.ausdToken.balanceOf(stack.rewardSystem.address)
        ).to.equal(expandTo18Decimals(45));
      });
    });

    describe("Price goes down", function () {
      beforeEach(async function () {
        // BTC price goes down from $20,000 to $15,000
        await setLbtcPrice(15000);
      });

      it("perp trader makes profit", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        /**
         * Entry fees = 0.1 * 20,000 * 0.01 = 20 aUSD
         * Exit fees = 0.1 * 15,000 * 0.01 = 15 aUSD
         * PnL = 0.1 * (20,000 - 15,000) - 20 - 15 = 465 aUSD
         */
        expect(await stack.ausdToken.balanceOf(bob.address)).to.equal(
          expandTo18Decimals(10_465)
        );

        // Perp contract should have nothing left
        expect(
          await stack.ausdToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
        expect(
          await stack.abtcToken.balanceOf(stack.abtcPerp.address)
        ).to.equal(0);
      });

      it("aUSD minter debt should decrease", async () => {
        await assertAliceDebt(expandTo18Decimals(10_500));
      });

      it("exit fees should be sent to fee holder", async () => {
        // Bob closes position
        await closePosition(
          2, // actionId
          bob, // user
          1 // positionId
        );

        expect(
          await stack.ausdToken.balanceOf(stack.rewardSystem.address)
        ).to.equal(expandTo18Decimals(35));
      });
    });

    describe("Liquidation", function () {
      it("can only liquidate when below maintenance margin ratio", async () => {
        /**
         * liqPrice = collateral / ((maintenanceMargin + 1) * debt)
         *          = 2,980 / ((0.05 + 1) * 0.1)
         *          = 28,380.95238095
         */
        const liquidationPrice = BigNumber.from("2838095238095");
        await setLbtcPrice(liquidationPrice);

        // // Cannot liquidate yet since ratio is not *below* maintenance margin
        expect(await stack.abtcPerp.getCollateralizationRatio(1))
          .to.be.gte(expandTo18Decimals(0.049999))
          .and.lte(expandTo18Decimals(0.050001));
        await expect(
          stack.abtcPerp.connect(alice).liquidatePosition(
            1, // positionId
            expandTo18Decimals(0.005), // amount
            alice.address // rewardTo
          )
        ).to.be.revertedWith("Perpetual: not lower than maintenance margin");

        await setLbtcPrice(liquidationPrice.add(expandTo8Decimals(1)));
        await stack.abtcPerp.connect(alice).liquidatePosition(
          1, // positionId
          expandTo18Decimals(0.005), // amount
          alice.address // rewardTo
        );
      });
    });
  });
});
