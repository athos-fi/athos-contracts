import { Duration } from "luxon";
import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumberish } from "ethers";
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

import { IDebtSystem } from "../../typechain";

const { formatBytes32String } = ethers.utils;

enum CollateralType {
  ATH,
  WBTC,
}

describe("Integration | Multicollateral", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress;

  let stack: DeployedStack;

  const setAthPrice = async (price: number): Promise<void> => {
    await stack.athOracle.connect(deployer).setPrice(
      expandTo8Decimals(price), // price
    );
  };

  const setWbtcPrice = async (price: number): Promise<void> => {
    await stack.wbtcOracle.connect(deployer).setPrice(
      expandTo8Decimals(price), // price
    );
  };

  const assertDebtBalance = async (
    user: string,
    collateral: CollateralType,
    amount: BigNumberish,
  ) => {
    let debtSystem: IDebtSystem;
    switch (collateral) {
      case CollateralType.ATH:
        debtSystem = stack.collaterals.ath.debtSystem;
        break;
      case CollateralType.WBTC:
        debtSystem = stack.collaterals.wbtc.debtSystem;
        break;
      default:
        throw new Error("Unknown collateral type");
    }
    expect((await debtSystem.GetUserDebtBalanceInUsd(user))[0]).to.equal(
      amount,
    );
  };

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    stack = await deployAthosStack(deployer);

    // Set ATH price to $0.01
    await setAthPrice(0.01);
    // Set WBTC price to $20,000
    await setWbtcPrice(20_000);

    // Mint 1,000,000 ATH and 10 WBTC to Alice
    await stack.collaterals.ath.token
      .connect(deployer)
      .transfer(alice.address, expandTo18Decimals(1_000_000));
    await stack.collaterals.wbtc.token
      .connect(deployer)
      .transfer(alice.address, expandTo8Decimals(10));

    await stack.collaterals.ath.token
      .connect(alice)
      .approve(stack.collaterals.ath.collateralSystem.address, uint256Max);
    await stack.collaterals.wbtc.token
      .connect(alice)
      .approve(stack.collaterals.wbtc.collateralSystem.address, uint256Max);
  });

  describe("Collateral Staking", function () {
    it("can stake and unstake WBTC", async function () {
      // Alice has 10 WBTC
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address),
      ).to.equal(expandTo8Decimals(10));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address,
        ),
      ).to.equal(0);

      // Alice stakes 3 WBTC
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Collateral(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(3), // _amount
      );
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address),
      ).to.equal(expandTo8Decimals(7));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address,
        ),
      ).to.equal(expandTo8Decimals(3));

      // Alice unstakes 1 WBTC
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Redeem(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(1), // _amount
      );
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address),
      ).to.equal(expandTo8Decimals(8));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address,
        ),
      ).to.equal(expandTo8Decimals(2));

      // Alice unstakes everything
      await stack.collaterals.wbtc.collateralSystem.connect(alice).RedeemMax(
        formatBytes32String("WBTC"), // _currency
      );
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address),
      ).to.equal(expandTo8Decimals(10));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address,
        ),
      ).to.equal(0);
    });
  });

  describe("Building athUSD", function () {
    beforeEach(async function () {
      // Alice stakes 10,000 ATH
      await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
        formatBytes32String("ATH"), // _currency
        expandTo18Decimals(10_000), // _amount
      );

      // Alice stakes 1 WBTC
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Collateral(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(1), // _amount
      );
    });

    it("can build athUSD with WBTC collateral", async function () {
      // Maximun amount of athUSD Alice can build:
      //
      // 1 * 20000 * 0.5 = 10000 athUSD
      //
      // Trying to build 10001 athUSD will fail
      await expect(
        stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
          expandTo18Decimals(10_001), // amount
        ),
      ).to.revertedWith("Build amount too big, you need more collateral");

      // Building 10000 athUSD works
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10_000), // amount
      );

      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
        expandTo18Decimals(10_000),
      );
    });

    it("ATH balances should not affect building from WBTC", async function () {
      // Alice gets 10,000 ATH locked balance (she already has 10,000 ATH staked)
      await stack.rewardLocker.connect(deployer).migrateRewards(
        [alice.address], // _users
        [expandTo18Decimals(10_000)], // _amounts
        [
          (await getBlockDateTime(ethers.provider))
            .plus({ years: 1 })
            .toSeconds(),
        ], // _lockTo
      );

      // Alice can still only build 10,000 athUSD
      await expect(
        stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
          expandTo18Decimals(10_001), // amount
        ),
      ).to.revertedWith("Build amount too big, you need more collateral");
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10_000), // amount
      );
    });

    it("athUSD from different collaterals are fungible", async function () {
      // Alice has no athUSD to begin with
      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(0);

      // Alice builds 10 athUSD from ATH
      await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10), // amount
      );

      // athUSD token balance increases
      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
        expandTo18Decimals(10),
      );

      // Alice builds 20 athUSD from WBTC
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20), // amount
      );

      // The same athUSD token balance increases
      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
        expandTo18Decimals(30),
      );
    });

    it("debt from different collaterals are separated", async function () {
      // Alice has no debt on either side to begin with
      await assertDebtBalance(alice.address, CollateralType.ATH, 0);
      await assertDebtBalance(alice.address, CollateralType.WBTC, 0);

      // Alice builds 10 athUSD from ATH
      await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10), // amount
      );

      // ATH debt increases
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(10),
      );
      await assertDebtBalance(alice.address, CollateralType.WBTC, 0);

      // Alice builds 20 athUSD from WBTC
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20), // amount
      );

      // WBTC debt increases
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(10),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(20),
      );
    });
  });

  describe("Debt Changes", function () {
    const settlementDelay: Duration = Duration.fromObject({ minutes: 1 });

    // Helper functions
    const setLbtcPrice = async (price: number): Promise<void> => {
      await stack.abtcOracle.connect(deployer).setPrice(
        expandTo8Decimals(price), // price
      );
    };
    const passSettlementDelay = async (): Promise<void> => {
      await setNextBlockTimestamp(
        ethers.provider,
        (await getBlockDateTime(ethers.provider)).plus(settlementDelay),
      );
    };
    const settleTrade = (entryId: number): Promise<any> => {
      return stack.exchangeSystem.connect(deployer).settle(
        entryId, // pendingExchangeEntryId
      );
    };
    const settleTradeWithDelay = async (entryId: number): Promise<any> => {
      await passSettlementDelay();
      await settleTrade(entryId);
    };

    beforeEach(async function () {
      // Alice stakes 10,000 ATH and 1 WBTC
      await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
        formatBytes32String("ATH"), // _currency
        expandTo18Decimals(10_000), // _amount
      );
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Collateral(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(1), // _amount
      );

      // Alice builds 10 athUSD from ATH and 20 athUSD from WBTC
      await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10), // amount
      );
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20), // amount
      );

      // Set settlement delay
      await stack.config.connect(deployer).setUint(
        formatBytes32String("TradeSettlementDelay"), // key
        settlementDelay.as("seconds"),
      );
      await stack.config.connect(deployer).setUint(
        formatBytes32String("TradeRevertDelay"), // key
        Duration.fromObject({ years: 1 }).as("seconds"),
      );

      // Set lBTC price to $20,000
      await setLbtcPrice(20_000);

      // Alice exchanges 10 athUSD for 0.0005 lBTC
      await stack.exchangeSystem.connect(alice).exchange(
        formatBytes32String("athUSD"), // sourceKey
        expandTo18Decimals(10), // sourceAmount
        alice.address, // destAddr
        formatBytes32String("aBTC"), // destKey
      );
      await settleTradeWithDelay(1);
    });

    it("exchanging should not affect debt amounts", async function () {
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(10),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(20),
      );
    });

    it("debt should increase proportionally across collaterals", async function () {
      // Set lBTC price to $80,000
      await setLbtcPrice(80_000);

      // Total debt now:
      //   20 lUSD
      //   0.0005 lBTC = 0.0005 * 80,000 = 40 lUSD
      //   Total = 20 + 40 = 60 lUSD
      //
      // Per collateral:
      //   ATH: 20 lUSD
      //   WBTC: 40 lUSD
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(20),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(40),
      );
    });

    it("debt should decrease proportionally across collaterals", async function () {
      // Set lBTC price to $2,000
      await setLbtcPrice(2_000);

      // Total debt now:
      //   20 lUSD
      //   0.0005 lBTC = 0.0005 * 2,000 = 1 lUSD
      //   Total = 20 + 1 = 21 lUSD
      //
      // Per collateral:
      //   ATH: 7 lUSD
      //   WBTC: 14 lUSD
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(7),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(14),
      );
    });

    it("burning debt works after debt changes from exchange", async function () {
      // Set lBTC price to $2,000 so that debt per collateral:
      //   ATH: 7 lUSD
      //   WBTC: 14 lUSD
      await setLbtcPrice(2_000);
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(7),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(14),
      );

      // Alice burns 2 lUSD of ATH debt
      await stack.collaterals.ath.buildBurnSystem
        .connect(alice)
        .BurnAsset(expandTo18Decimals(2));
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(5),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(14),
      );

      // Alice burns 4 lUSD of WBTC debt
      await stack.collaterals.wbtc.buildBurnSystem
        .connect(alice)
        .BurnAsset(expandTo18Decimals(4));
      await assertDebtBalance(
        alice.address,
        CollateralType.ATH,
        expandTo18Decimals(5),
      );
      await assertDebtBalance(
        alice.address,
        CollateralType.WBTC,
        expandTo18Decimals(10),
      );
    });
  });

  describe("Liquidation", function () {
    beforeEach(async function () {
      // Set ATH price to $0.1 and WBTC price to $20,000
      await setAthPrice(0.1);
      await setWbtcPrice(20_000);

      // Alice stakes 1,000 ATH and 1 WBTC
      await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
        formatBytes32String("ATH"), // _currency
        expandTo18Decimals(1_000), // _amount
      );
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Collateral(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(1), // _amount
      );

      // Alice builds 20 athUSD from ATH and 20 athUSD from WBTC
      await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20), // amount
      );
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20), // amount
      );
    });

    it("WBTC debt position can be marked for liquidation", async function () {
      // Price of WBTC changes to $40 such that WBTC C-ratio becomes 200%
      await setWbtcPrice(40);

      // Can't mark Alice's position as it's not *below* liquidation ratio
      await expect(
        stack.collaterals.wbtc.liquidation
          .connect(bob)
          .markPositionAsUndercollateralized(alice.address),
      ).to.be.revertedWith("Liquidation: not undercollateralized");

      // Price of WBTC drops such that C-ratio falls below liquidation ratio
      await setWbtcPrice(39.9);

      // Can mark position normally
      await expect(
        stack.collaterals.wbtc.liquidation
          .connect(bob)
          .markPositionAsUndercollateralized(alice.address),
      )
        .to.emit(stack.collaterals.wbtc.liquidation, "PositionMarked")
        .withArgs(
          alice.address, // user
          bob.address, // marker
        );

      // Confirm mark
      expect(
        await stack.collaterals.wbtc.liquidation.isPositionMarkedAsUndercollateralized(
          alice.address,
        ),
      ).to.equal(true);
      expect(
        await stack.collaterals.wbtc.liquidation.getUndercollateralizationMarkMarker(
          alice.address,
        ),
      ).to.equal(bob.address);
    });

    it("can't mark ATH position when only WBTC position is undercollateralized", async function () {
      // WBTC price drops
      await setWbtcPrice(39.9);

      // Can only mark WBTC
      await stack.collaterals.wbtc.liquidation
        .connect(bob)
        .markPositionAsUndercollateralized(alice.address);
      await expect(
        stack.collaterals.ath.liquidation
          .connect(bob)
          .markPositionAsUndercollateralized(alice.address),
      ).to.be.revertedWith("Liquidation: not undercollateralized");
    });

    it("can't mark WBTC position when only ATH position is undercollateralized", async function () {
      // ATH price drops
      await setAthPrice(0.01);

      // Can only mark ATH
      await stack.collaterals.ath.liquidation
        .connect(bob)
        .markPositionAsUndercollateralized(alice.address);
      await expect(
        stack.collaterals.wbtc.liquidation
          .connect(bob)
          .markPositionAsUndercollateralized(alice.address),
      ).to.be.revertedWith("Liquidation: not undercollateralized");
    });
  });
});
