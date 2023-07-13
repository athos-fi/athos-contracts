import { ethers } from "hardhat";

import { StackManager } from "../stack";
import { DeploymentKey } from "../stack/contracts";
import { selectSigner } from "../utils";
import { expandTo18Decimals } from "../../hh_test/utilities";

import { Config__factory } from "../../typechain";

const { formatBytes32String } = ethers.utils;

const runScript = async () => {
  const stackManager = new StackManager();
  const deployer = await selectSigner();

  const config = Config__factory.connect(
    stackManager.getDeploymentChecked(DeploymentKey.Config).address,
    deployer,
  );

  // Set athUSD exchange fee rate to 0.25%
  await config.connect(deployer).setUint(
    formatBytes32String("athUSD"), // key
    expandTo18Decimals(0.0025), // value
  );
};

runScript()
  .then(() => process.exit(0))
  .catch((ex) => {
    console.error(ex);
    process.exit(1);
  });
