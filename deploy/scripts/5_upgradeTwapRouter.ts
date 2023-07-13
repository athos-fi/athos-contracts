import { ethers, upgrades } from "hardhat";

import { StackManager } from "../stack";
import { DeploymentKey } from "../stack/contracts";
import { selectSigner } from "../utils";

const runScript = async () => {
  const stackManager = new StackManager();
  const deployer = await selectSigner();

  const UniswapTwapOracle = await ethers.getContractFactory(
    "UniswapTwapOracle",
    deployer
  );

  await upgrades.upgradeProxy(
    stackManager.getDeploymentChecked(DeploymentKey.AthTwapOracle).address,
    UniswapTwapOracle,
    {
      // We renamed `baseDecimals` to `quoteDecimals`
      unsafeAllowRenames: true,
    }
  );
};

runScript()
  .then(() => process.exit(0))
  .catch((ex) => {
    console.error(ex);
    process.exit(1);
  });
