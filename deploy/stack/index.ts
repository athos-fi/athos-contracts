import { utils } from "ethers";
import * as fs from "fs";
import * as os from "os";

import { Config } from "./config";
import {
  contractNamesByDeploymentKey,
  Contracts,
  Deployment,
  DeploymentKey,
} from "./contracts";

const { getAddress } = utils;

export interface Stack {
  config: Config;
  contracts: Contracts;
}

export class StackManager {
  stackFile: string;
  stack: Stack;

  constructor() {
    if (!process.env.STACK_FILE) {
      throw new Error("STACK_FILE environment variable not set");
    }

    this.stackFile = process.env.STACK_FILE;

    if (fs.existsSync(this.stackFile)) {
      this.stack = JSON.parse(fs.readFileSync(this.stackFile).toString());
    } else {
      throw new Error("Stack file not found");
    }
  }

  public get config(): Config {
    return this.stack.config;
  }

  public getDeployment(key: DeploymentKey): Deployment | null {
    const deployment: Deployment | null = this.stack.contracts[key];
    return deployment;
  }

  public getDeploymentChecked(key: DeploymentKey): Deployment {
    const deployment: Deployment | null = this.stack.contracts[key];
    if (!deployment) {
      throw new Error(`Deployment not found for ${key}`);
    }
    return deployment;
  }

  public setDeployment(key: DeploymentKey, address: string) {
    if (this.stack.contracts[key]) {
      throw new Error(`Deployment already set ${key}`);
    }
    this.overwriteDeployment(key, address);
  }

  public overwriteDeployment(key: DeploymentKey, address: string) {
    this.stack.contracts[key] = {
      contract: contractNamesByDeploymentKey[key],
      address: getAddress(address),
    };
    this.saveStack();
  }

  saveStack() {
    fs.writeFileSync(
      this.stackFile,
      JSON.stringify(this.stack, undefined, 2) + os.EOL
    );
  }
}
