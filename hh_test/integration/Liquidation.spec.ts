import { Duration } from "luxon";
import { ethers } from "hardhat";
import { BigNumber, BigNumberish } from "ethers";
import { formatBytes32String } from "ethers/lib/utils";
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

interface RewardData {
  amount: BigNumberish;
  unlockTime: BigNumberish;
}

describe("Integration | Liquidation", function () {
  let deployer: SignerWithAddress,
    alice: SignerWithAddress,
    bob: SignerWithAddress,
    charlie: SignerWithAddress;

  let stack: DeployedStack;

  const liquidationDelay: Duration = Duration.fromObject({ days: 3 });

  const passLiquidationDelay = async (): Promise<void> => {
    await setNextBlockTimestamp(
      ethers.provider,
      (await getBlockDateTime(ethers.provider))
        .plus(liquidationDelay)
        .plus({ seconds: 1 })
    );
  };

  const setAthPrice = async (price: number): Promise<void> => {
    await stack.athOracle.connect(deployer).setPrice(
      expandTo8Decimals(price) // price
    );
  };

  const stakeAndBuild = async (
    user: SignerWithAddress,
    stakeAmount: BigNumber,
    buildAmount: BigNumber
  ): Promise<void> => {
    await stack.collateralSystem.connect(user).Collateral(
      ethers.utils.formatBytes32String("ATH"), // _currency
      stakeAmount // _amount
    );
    await stack.buildBurnSystem.connect(user).BuildAsset(
      buildAmount // amount
    );
  };

  const assertUserLinaCollateral = async (
    user: string,
    staked: BigNumber,
    locked: BigNumber
  ): Promise<void> => {
    const breakdown =
      await stack.collateralSystem.getUserLinaCollateralBreakdown(user);

    expect(breakdown.staked).to.equal(staked);
    expect(breakdown.locked).to.equal(locked);
  };

  const changeStakedCollateralToLocked = async (
    user: SignerWithAddress,
    amount: BigNumber
  ): Promise<void> => {
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [user.address], // _users
      [amount], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );
    await stack.collateralSystem.connect(user).Redeem(
      formatBytes32String("ATH"), // _currency
      amount // _amount
    );
  };

  const assertIdenticalAggregation = (
    expected: Map<number, BigNumber>,
    actual: Map<number, BigNumber>
  ): void => {
    expect(actual.size).to.equal(expected.size);

    expected.forEach((value, key) => {
      expect(actual.get(key)).to.equal(value);
    });
  };

  const aggregateLockedRewards = async (
    addresses: string[]
  ): Promise<Map<number, BigNumber>> => {
    const aggregation = new Map<number, BigNumber>();

    // Inefficiently brute force the whole list of entries since it's not on-chain
    const lastEntryId = await stack.rewardLocker.lastRewardEntryId();

    for (let entryId = 1; entryId <= lastEntryId.toNumber(); entryId++) {
      for (const address of addresses) {
        const currentEntry = await stack.rewardLocker.rewardEntries(
          entryId,
          address
        );
        if (currentEntry.amount.gt(0)) {
          aggregation.set(
            currentEntry.unlockTime,
            currentEntry.amount.add(
              aggregation.has(currentEntry.unlockTime)
                ? aggregation.get(currentEntry.unlockTime)!
                : 0
            )
          );
        }
      }
    }

    return aggregation;
  };

  const buildAggregation = (): Promise<Map<number, BigNumber>> => {
    return aggregateLockedRewards([
      alice.address,
      bob.address,
      charlie.address,
    ]);
  };

  beforeEach(async function () {
    [deployer, alice, bob, charlie] = await ethers.getSigners();

    stack = await deployAthosStack(deployer);

    // Set ATH price to $0.1
    await setAthPrice(0.1);

    // Grant Alice and Bob 1,000,000 ATH each
    for (const user of [alice, bob]) {
      await stack.athToken
        .connect(deployer)
        .transfer(user.address, expandTo18Decimals(1_000_000));
      await stack.athToken
        .connect(user)
        .approve(stack.collateralSystem.address, uint256Max);
    }

    // Alice stakes 1,000 ATH ($100) and builds 20 aUSD
    await stakeAndBuild(
      alice,
      expandTo18Decimals(1_000),
      expandTo18Decimals(20)
    );

    // Bob staks 1,000,000 ATH nd builds 1,000 aUSD
    await stakeAndBuild(
      bob,
      expandTo18Decimals(1_000_000),
      expandTo18Decimals(1_000)
    );
  });

  it("can mark position only when C-ratio is below liquidation ratio", async () => {
    // Price of ATH changes to $0.04 such that Alice's C-ratio becomes 200%
    await setAthPrice(0.04);

    // Can't mark Alice's position as it's not *below* liquidation ratio
    await expect(
      stack.liquidation
        .connect(bob)
        .markPositionAsUndercollateralized(alice.address)
    ).to.be.revertedWith("Liquidation: not undercollateralized");

    // Price of ATH drops such that Alice's C-ratio falls below liquidation ratio
    await setAthPrice(0.038);

    // Can mark position normally
    await expect(
      stack.liquidation
        .connect(bob)
        .markPositionAsUndercollateralized(alice.address)
    )
      .to.emit(stack.liquidation, "PositionMarked")
      .withArgs(
        alice.address, // user
        bob.address // marker
      );

    // Confirm mark
    expect(
      await stack.liquidation.isPositionMarkedAsUndercollateralized(
        alice.address
      )
    ).to.equal(true);
    expect(
      await stack.liquidation.getUndercollateralizationMarkMarker(alice.address)
    ).to.equal(bob.address);
  });

  it("can remove position mark only when C-ratio is not below issuance ratio", async () => {
    // Alice gets marked for liquidation
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(bob)
      .markPositionAsUndercollateralized(alice.address);

    // ATH price goes to $0.099. Alice cannot remove mark
    await setAthPrice(0.099);

    await expect(
      stack.liquidation
        .connect(alice)
        .removeUndercollateralizationMark(alice.address)
    ).to.be.revertedWith("Liquidation: still undercollateralized");

    // ATH price goes to $0.1. Alice can now remove mark
    await setAthPrice(0.1);
    await expect(
      stack.liquidation
        .connect(alice)
        .removeUndercollateralizationMark(alice.address)
    )
      .to.emit(stack.liquidation, "PositionUnmarked")
      .withArgs(
        alice.address // user
      );
  });

  it("cannot liquidate position without mark", async () => {
    // Alice should be liquidated at $0.035
    await setAthPrice(0.035);

    await expect(
      stack.liquidation.connect(bob).liquidatePosition(alice.address, 1, [])
    ).to.be.revertedWith("Liquidation: not marked for undercollateralized");
  });

  it("can liquidate position only when delay is passed", async () => {
    // Alice gets marked for liquidation
    await setAthPrice(0.035);
    const markTime = (await getBlockDateTime(ethers.provider)).plus({
      days: 1,
    });
    await setNextBlockTimestamp(ethers.provider, markTime);
    await stack.liquidation
      .connect(bob)
      .markPositionAsUndercollateralized(alice.address);

    // Cannot liquidate before delay is passed
    await setNextBlockTimestamp(
      ethers.provider,
      markTime.plus(liquidationDelay)
    );
    await expect(
      stack.liquidation.connect(bob).liquidatePosition(alice.address, 1, [])
    ).to.be.revertedWith("Liquidation: liquidation delay not passed");

    // Can liquidate after delay is passed
    await setNextBlockTimestamp(
      ethers.provider,
      markTime.plus(liquidationDelay).plus({ seconds: 1 })
    );
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, 1, []);
  });

  it("cannot liquidate position even if delay is passed if C-ratio is restored", async () => {
    // Alice gets marked for liquidation
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(bob)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();

    // C-ratio restored but mark is not removed
    await setAthPrice(0.1);

    // Position cannot be liquidated now
    await expect(
      stack.liquidation.connect(bob).liquidatePosition(alice.address, 1, [])
    ).to.be.revertedWith("Liquidation: not undercollateralized");

    // C-ratio falls below issuance ratio
    await setAthPrice(0.09);

    // Position can now be liquidated
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, 1, []);
  });

  it("locked reward should be counted towards collateral for liquidation", async () => {
    // Alice is granted 1,000 locked ATH
    await stack.rewardLocker.connect(deployer).migrateRewards(
      [alice.address], // _users
      [expandTo18Decimals(1_000)], // _amounts
      [(await getBlockDateTime(ethers.provider)).plus({ years: 1 }).toSeconds()] // _lockTo
    );

    // Alice has 2,000 ATH now, and will only be liquidated below $0.02
    await setAthPrice(0.02);
    await expect(
      stack.liquidation
        .connect(bob)
        .markPositionAsUndercollateralized(alice.address)
    ).to.be.revertedWith("Liquidation: not undercollateralized");

    // ATH price drops to $0.019 and Alice can be liquidated
    await setAthPrice(0.019);
    await stack.liquidation
      .connect(bob)
      .markPositionAsUndercollateralized(alice.address);
  });

  it("can liquidate up to the amount to restore C-ratio to issuance ratio", async () => {
    // Alice gets marked for liquidation
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(bob)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();

    /**
     * Formula:
     *     Max aUSD to Burn = (Debt Balance - Collateral Value * Issuance Ratio) / (1 - (1 + Liquidation Reward) * Issuance Ratio)
     *
     * Calculation:
     *     Max aUSD to Burn = (20 - 0.035 * 1000 * 0.2) / (1 - (1 + 0.15) * 0.2) = 16.883116883116883116
     */
    const maxAusdToBurn = BigNumber.from("16883116883116883116");

    // Burning 1 unit more aUSD fails
    await expect(
      stack.liquidation
        .connect(bob)
        .liquidatePosition(alice.address, maxAusdToBurn.add(1), [])
    ).to.be.revertedWith("Liquidation: burn amount too large");

    // Can burn exactly the max amount
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, maxAusdToBurn, []);

    // Mark is removed after buring the max amount
    expect(
      await stack.liquidation.isPositionMarkedAsUndercollateralized(
        alice.address
      )
    ).to.equal(false);
  });

  it("can burn max amount directly without specifying concrete amount", async () => {
    // Same as last case
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(bob)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();

    await stack.liquidation
      .connect(bob)
      .liquidatePositionMax(alice.address, []);

    // Mark is removed after buring the max amount
    expect(
      await stack.liquidation.isPositionMarkedAsUndercollateralized(
        alice.address
      )
    ).to.equal(false);
  });

  it("liquidation of position backed by staked collateral only", async () => {
    // Alice gets marked for liquidation by Charlie
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(charlie)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();

    // Bob liquidates Alice's position by burning 10 aUSD
    await expect(
      stack.liquidation
        .connect(bob)
        .liquidatePosition(alice.address, expandTo18Decimals(10), [])
    )
      .to.emit(stack.liquidation, "PositionLiquidated")
      .withArgs(
        alice.address, // user
        charlie.address, // marker
        bob.address, // liquidator
        expandTo18Decimals(10), // debtBurnt
        formatBytes32String("ATH"), // collateralCurrency
        BigNumber.from("328571428571428571427"), // collateralWithdrawnFromStaked
        BigNumber.from(0), // collateralWithdrawnFromLocked
        BigNumber.from("14285714285714285714"), // markerReward
        BigNumber.from("28571428571428571428") // liquidatorReward
      );

    /**
     * Collateral withdrawal = 10 / 0.035 = 285.714285714285714285 ATH
     * Marker reward = 285.714285714285714285 * 0.05 = 14.285714285714285714 ATH
     * Liquidator reward = 285.714285714285714285 * 0.1 = 28.571428571428571428 ATH
     * Total withdrawal = 285.714285714285714285 + 14.285714285714285714 + 28.571428571428571428 = 328.571428571428571427 ATH
     *
     * Alice's balance = 1000 - 328.571428571428571427 = 671.428571428571428573 ATH
     * Bob's balance = 1000000 + 285.714285714285714285 + 28.571428571428571428 = 1000314.285714285714285713 ATH
     * Charlie's balance = 14.285714285714285714 ATH
     */
    await assertUserLinaCollateral(
      alice.address,
      BigNumber.from("671428571428571428573"),
      BigNumber.from(0)
    );
    await assertUserLinaCollateral(
      bob.address,
      BigNumber.from("1000314285714285714285713"),
      BigNumber.from(0)
    );
    await assertUserLinaCollateral(
      charlie.address,
      BigNumber.from("14285714285714285714"),
      BigNumber.from(0)
    );
  });

  it("liquidation of position backed by 1 locked collateral entry only", async () => {
    // Change Alice's staked collateral to locked
    await changeStakedCollateralToLocked(alice, expandTo18Decimals(1_000));

    // Aggregate reward entries
    const aggregation = await buildAggregation();

    // The rest is the same as the last case. For calculations see the last case
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(charlie)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, expandTo18Decimals(10), [1]);

    await assertUserLinaCollateral(
      alice.address,
      BigNumber.from(0),
      BigNumber.from("671428571428571428573")
    );
    await assertUserLinaCollateral(
      bob.address,
      BigNumber.from("1000000000000000000000000"),
      BigNumber.from("314285714285714285713")
    );
    await assertUserLinaCollateral(
      charlie.address,
      BigNumber.from(0),
      BigNumber.from("14285714285714285714")
    );

    assertIdenticalAggregation(aggregation, await buildAggregation());
  });

  it("staked collateral shared by withdrawal and reward", async () => {
    // Change 700 ATH of Alice's staked collateral to locked
    await changeStakedCollateralToLocked(alice, expandTo18Decimals(700));

    // Aggregate reward entries
    const aggregation = await buildAggregation();

    // Same as last case
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(charlie)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, expandTo18Decimals(10), [1]);

    /**
     * Collateral withdrawal = 285.714285714285714285 ATH
     * Marker reward = 14.285714285714285714 ATH
     * Liquidator reward = 28.571428571428571428 ATH
     * Total reward = 14.285714285714285714 + 28.571428571428571428 = 42.857142857142857142 ATH
     *
     * Collateral withdrawal is covered by staked collateral
     *
     * Reward from staked = 300 - 285.714285714285714285 = 14.285714285714285715 ATH
     * Reward from locked = 42.857142857142857142 - 14.285714285714285715 = 28.571428571428571427 ATH
     *
     * Marker reward from staked = 14.285714285714285715 * 14.285714285714285714 / 42.857142857142857142 = 4.761904761904761905 ATH
     * Liquidator reward from staked = 14.285714285714285715 - 4.761904761904761905 = 9.523809523809523810 ATH
     *
     * Marker reward from locked = 14.285714285714285714 - 4.761904761904761905 = 9.523809523809523809 ATH
     * Liquidator reward from locked = 28.571428571428571427 - 9.523809523809523809 = 19.047619047619047618 ATH
     *
     * Bob's staked balance = 1000000 + 285.714285714285714285 + 9.523809523809523810 = 1000295.238095238095238095 ATH
     * Bob's locked balance = 19.047619047619047618 ATH
     *
     * Charlie's staked balance = 4.761904761904761905 ATH
     * Charlie's locked balance = 9.523809523809523809 ATH
     */
    await assertUserLinaCollateral(
      alice.address,
      BigNumber.from(0),
      BigNumber.from("671428571428571428573")
    );
    await assertUserLinaCollateral(
      bob.address,
      BigNumber.from("1000295238095238095238095"),
      BigNumber.from("19047619047619047618")
    );
    await assertUserLinaCollateral(
      charlie.address,
      BigNumber.from("4761904761904761905"),
      BigNumber.from("9523809523809523809")
    );

    assertIdenticalAggregation(aggregation, await buildAggregation());
  });

  it("locked collateral shared by withdrawal and reward", async () => {
    // Change 800 ATH of Alice's staked collateral to locked
    await changeStakedCollateralToLocked(alice, expandTo18Decimals(800));

    // Aggregate reward entries
    const aggregation = await buildAggregation();

    // Same as last case
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(charlie)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, expandTo18Decimals(10), [1]);

    /**
     * Collateral withdrawal = 285.714285714285714285 ATH
     * Marker reward = 14.285714285714285714 ATH
     * Liquidator reward = 28.571428571428571428 ATH
     * Total reward = 14.285714285714285714 + 28.571428571428571428 = 42.857142857142857142 ATH
     *
     * Collateral withdrawal from staked = 200 ATH
     * Collateral withdrawal from locked = 85.714285714285714285 ATH
     *
     * Bob's staked balance = 1000000 + 200 = 1000200 ATH
     * Bob's locked balance = 85.714285714285714285 + 28.571428571428571428 = 114.285714285714285713 ATH
     *
     * Charlie's staked balance = 0 ATH
     * Charlie's locked balance = 14.285714285714285714 ATH
     */
    await assertUserLinaCollateral(
      alice.address,
      BigNumber.from(0),
      BigNumber.from("671428571428571428573")
    );
    await assertUserLinaCollateral(
      bob.address,
      BigNumber.from("1000200000000000000000000"),
      BigNumber.from("114285714285714285713")
    );
    await assertUserLinaCollateral(
      charlie.address,
      BigNumber.from("0"),
      BigNumber.from("14285714285714285714")
    );

    assertIdenticalAggregation(aggregation, await buildAggregation());
  });

  it("multiple reward entries", async () => {
    // Change 800 ATH of Alice's staked collateral to locked but in batches
    for (let ind = 0; ind < 20; ind++) {
      await changeStakedCollateralToLocked(alice, expandTo18Decimals(40));
    }

    // Aggregate reward entries
    const aggregation = await buildAggregation();

    // Same as last case
    await setAthPrice(0.035);
    await stack.liquidation
      .connect(charlie)
      .markPositionAsUndercollateralized(alice.address);
    await passLiquidationDelay();
    await stack.liquidation
      .connect(bob)
      .liquidatePosition(alice.address, expandTo18Decimals(10), [1, 2, 3, 4]);

    // Same as last case
    await assertUserLinaCollateral(
      alice.address,
      BigNumber.from(0),
      BigNumber.from("671428571428571428573")
    );
    await assertUserLinaCollateral(
      bob.address,
      BigNumber.from("1000200000000000000000000"),
      BigNumber.from("114285714285714285713")
    );
    await assertUserLinaCollateral(
      charlie.address,
      BigNumber.from("0"),
      BigNumber.from("14285714285714285714")
    );

    assertIdenticalAggregation(aggregation, await buildAggregation());
  });
});
