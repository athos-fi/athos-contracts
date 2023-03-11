#!/bin/bash

readarray -d '' CONTRACT_FILES < <(find ./src/ -name "*.sol" -print0)

rm -rf ./dist/*

for CONTRACT_FILE in "${CONTRACT_FILES[@]}"
do
  BASE_PATH="$(echo $(dirname $CONTRACT_FILE) | cut -c7-)/"
  if [ "$BASE_PATH" = "/" ]; then
    BASE_PATH=""
  fi

  CONTRACT_NAME="$(basename $CONTRACT_FILE .sol)"
  DIST_SRC_DIR="./dist/sources/$BASE_PATH"
  DIST_BIN_DIR="./dist/bins/$BASE_PATH"
  DIST_ABI_DIR="./dist/abis/$BASE_PATH"

  mkdir -p $DIST_SRC_DIR
  mkdir -p $DIST_BIN_DIR
  mkdir -p $DIST_ABI_DIR

  echo "Flattening contract $CONTRACT_NAME.sol"
  forge flatten $CONTRACT_FILE > $DIST_SRC_DIR$CONTRACT_NAME.sol

  forge fmt $DIST_SRC_DIR$CONTRACT_NAME.sol

  # Wrap sol into JSON
  cat $DIST_SRC_DIR$CONTRACT_NAME.sol | jq -Rs . > $DIST_SRC_DIR$CONTRACT_NAME.json
  rm $DIST_SRC_DIR$CONTRACT_NAME.sol

  if [ -d ./out/$CONTRACT_NAME.sol ]; then
    LATEST_ARTIFACT_NAME=$(ls ./out/$CONTRACT_NAME.sol | tail -1)
    cat ./out/$CONTRACT_NAME.sol/$LATEST_ARTIFACT_NAME | jq '{bytecode: .bytecode.object, linkReferences: .bytecode.linkReferences}' > $DIST_BIN_DIR$CONTRACT_NAME.json
    cat ./out/$CONTRACT_NAME.sol/$LATEST_ARTIFACT_NAME | jq '.abi' > $DIST_ABI_DIR$CONTRACT_NAME.json
  fi
done
