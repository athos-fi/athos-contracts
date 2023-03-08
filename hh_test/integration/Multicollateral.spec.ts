import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";

import {
  expandTo18Decimals,
  expandTo8Decimals,
  uint256Max,
} from "../utilities";
import { deployAthosStack, DeployedStack } from "../utilities/init";
import { getBlockDateTime } from "../utilities/timeTravel";

const { formatBytes32String } = ethers.utils;

describe("Integration | Multicollateral", function () {
  let deployer: SignerWithAddress, alice: SignerWithAddress;

  let stack: DeployedStack;

  beforeEach(async function () {
    [deployer, alice] = await ethers.getSigners();

    stack = await deployAthosStack(deployer);

    // Set ATH price to $0.01
    await stack.athOracle.connect(deployer).setPrice(
      expandTo8Decimals(0.01) // price
    );
    // Set WBTC price to $20,000
    await stack.wbtcOracle.connect(deployer).setPrice(
      expandTo8Decimals(20_000) // price
    );

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
        await stack.collaterals.wbtc.token.balanceOf(alice.address)
      ).to.equal(expandTo8Decimals(10));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address
        )
      ).to.equal(0);

      // Alice stakes 3 WBTC
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Collateral(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(3) // _amount
      );
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address)
      ).to.equal(expandTo8Decimals(7));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address
        )
      ).to.equal(expandTo8Decimals(3));

      // Alice unstakes 1 WBTC
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Redeem(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(1) // _amount
      );
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address)
      ).to.equal(expandTo8Decimals(8));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address
        )
      ).to.equal(expandTo8Decimals(2));

      // Alice unstakes everything
      await stack.collaterals.wbtc.collateralSystem.connect(alice).RedeemMax(
        formatBytes32String("WBTC") // _currency
      );
      expect(
        await stack.collaterals.wbtc.token.balanceOf(alice.address)
      ).to.equal(expandTo8Decimals(10));
      expect(
        await stack.collaterals.wbtc.token.balanceOf(
          stack.collaterals.wbtc.collateralSystem.address
        )
      ).to.equal(0);
    });
  });

  describe("Building athUSD", function () {
    beforeEach(async function () {
      // Alice stakes 10,000 ATH
      await stack.collaterals.ath.collateralSystem.connect(alice).Collateral(
        formatBytes32String("ATH"), // _currency
        expandTo18Decimals(10_000) // _amount
      );

      // Alice stakes 1 WBTC
      await stack.collaterals.wbtc.collateralSystem.connect(alice).Collateral(
        formatBytes32String("WBTC"), // _currency
        expandTo8Decimals(1) // _amount
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
          expandTo18Decimals(10_001) // amount
        )
      ).to.revertedWith("Build amount too big, you need more collateral");

      // Building 10000 athUSD works
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10_000) // amount
      );

      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
        expandTo18Decimals(10_000)
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
        ] // _lockTo
      );

      // Alice can still only build 10,000 athUSD
      await expect(
        stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
          expandTo18Decimals(10_001) // amount
        )
      ).to.revertedWith("Build amount too big, you need more collateral");
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10_000) // amount
      );
    });

    it("athUSD from different collaterals are fungible", async function () {
      // Alice has no athUSD to begin with
      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(0);

      // Alice builds 10 athUSD from ATH
      await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10) // amount
      );

      // athUSD token balance increases
      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
        expandTo18Decimals(10)
      );

      // Alice builds 20 athUSD from WBTC
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20) // amount
      );

      // The same athUSD token balance increases
      expect(await stack.ausdToken.balanceOf(alice.address)).to.equal(
        expandTo18Decimals(30)
      );
    });

    it("debt from different collaterals are separated", async function () {
      // Alice has no debt on either side to begin with
      expect(
        (
          await stack.collaterals.ath.debtSystem.GetUserDebtBalanceInUsd(
            alice.address
          )
        )[0]
      ).to.equal(0);
      expect(
        (
          await stack.collaterals.wbtc.debtSystem.GetUserDebtBalanceInUsd(
            alice.address
          )
        )[0]
      ).to.equal(0);

      // Alice builds 10 athUSD from ATH
      await stack.collaterals.ath.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(10) // amount
      );

      // ATH debt increases
      expect(
        (
          await stack.collaterals.ath.debtSystem.GetUserDebtBalanceInUsd(
            alice.address
          )
        )[0]
      ).to.equal(expandTo18Decimals(10));
      expect(
        (
          await stack.collaterals.wbtc.debtSystem.GetUserDebtBalanceInUsd(
            alice.address
          )
        )[0]
      ).to.equal(0);

      // Alice builds 20 athUSD from WBTC
      await stack.collaterals.wbtc.buildBurnSystem.connect(alice).BuildAsset(
        expandTo18Decimals(20) // amount
      );

      // WBTC debt increases
      expect(
        (
          await stack.collaterals.ath.debtSystem.GetUserDebtBalanceInUsd(
            alice.address
          )
        )[0]
      ).to.equal(expandTo18Decimals(10));
      expect(
        (
          await stack.collaterals.wbtc.debtSystem.GetUserDebtBalanceInUsd(
            alice.address
          )
        )[0]
      ).to.equal(expandTo18Decimals(20));
    });
  });
});
