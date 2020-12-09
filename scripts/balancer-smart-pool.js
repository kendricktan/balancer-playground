const { ethers } = require("hardhat");

const ADDRESSES = {
  BActions: "0x2fcc6f96418764439f8dc26af559ed5cddaeefac",
  Factory: "0xed52d8e202401645edad1c0aa21e872498ce47d0",
  BFactory: "0x9424b1412450d0f8fc2255faf6046b98213b76bd",
  DSProxyRegistry: "0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4",
  ExchangeProxy: "0x3E66B66Fd1d0b02fDa6C811Da9E0547970DB2f21",
};

const main = async () => {
  const [user] = await ethers.getSigners();

  const ProxyRegistry = await ethers.getContractAt(
    "ProxyRegistry",
    ADDRESSES.DSProxyRegistry
  );

  const BActionsFactory = await ethers.getContractFactory("BActions");
  const BActions = await BActionsFactory.deploy();

  let proxyAddress = await ProxyRegistry.proxies(user.address);
  if (proxyAddress === ethers.constants.AddressZero) {
    await ProxyRegistry["build()"]();
    proxyAddress = await ProxyRegistry.proxies(user.address);
  }

  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const Proxy = await ethers.getContractAt("DSProxy", proxyAddress);
  const Token0 = await MockERC20.deploy("Token0", "TK0");
  const Token1 = await MockERC20.deploy("Token1", "TK1");

  await Token0.mint(user.address, ethers.utils.parseEther("1000"));
  await Token1.mint(user.address, ethers.utils.parseEther("1000"));

  // ERC20
  const ERC20 = await ethers.getContractAt(
    "@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20",
    ethers.constants.AddressZero
  );

  // Approve proxy to get tokens
  await Token0.approve(proxyAddress, ethers.constants.MaxUint256);
  await Token1.approve(proxyAddress, ethers.constants.MaxUint256);

  // Creates smart pool
  let data = BActions.interface.encodeFunctionData("createSmartPool", [
    ADDRESSES.Factory,
    ADDRESSES.BFactory,
    [
      "SPT",
      "Smart Pool",
      [Token0.address, Token1.address],
      [ethers.utils.parseEther("1"), ethers.utils.parseEther("1")],
      [ethers.utils.parseEther("25"), ethers.utils.parseEther("25")],
      ethers.utils.parseEther("0.1"),
    ],
    [ethers.utils.parseEther("100"), "90000", "500"],
    [true, true, true, true, true, true],
  ]);

  let tx = await Proxy["execute(address,bytes)"](BActions.address, data, {
    gasLimit: "16000000",
  });
  let txRecp = await tx.wait();

  // Gets pool address
  const [crpAddress, bpoolAddress] = txRecp.logs[14].topics
    .slice(1, 3)
    .map((x) => ethers.utils.getAddress(`0x${x.slice(26)}`));

  // Set unlimited cap
  const CRPPool = await ethers.getContractAt(
    "ConfigurableRightsPool",
    crpAddress
  );

  data = BActions.interface.encodeFunctionData("setCap", [
    crpAddress,
    ethers.constants.MaxUint256,
  ]);
  tx = await Proxy["execute(address,bytes)"](BActions.address, data, {
    gasLimit: "16000000",
  });
  txRecp = await tx.wait();

  // Whitelist provider to add liquidity
  data = BActions.interface.encodeFunctionData("whitelistLiquidityProvider", [
    crpAddress,
    proxyAddress,
  ]);
  tx = await Proxy["execute(address,bytes)"](BActions.address, data, {
    gasLimit: "16000000",
  });
  txRecp = await tx.wait();

  // Join smart pool
  // data = BActions.interface.encodeFunctionData("joinSmartPool", [
  //   crpAddress,
  //   ethers.utils.parseEther("90"),
  //   [ethers.utils.parseEther("1"), ethers.utils.parseEther("1")],
  // ]);
  data = BActions.interface.encodeFunctionData("joinSmartPool", [
    crpAddress,
    ethers.utils.parseEther("90"),
    [ethers.utils.parseEther("1"), ethers.utils.parseEther("1")],
  ]);
  const beforeCrp = await ERC20.attach(crpAddress).balanceOf(user.address)
  const beforeT0 = await Token0.balanceOf(user.address)
  const beforeT1 = await Token1.balanceOf(user.address)
  tx = await Proxy["execute(address,bytes)"](BActions.address, data, {
    gasLimit: "16000000",
  });
  const afterCrp = await ERC20.attach(crpAddress).balanceOf(user.address)
  const afterT0 = await Token0.balanceOf(user.address)
  const afterT1 = await Token1.balanceOf(user.address)

  console.log('crp', beforeCrp.toString(), afterCrp.toString())
  console.log('t0', beforeT0.toString(), afterT0.toString())
  console.log('t1', beforeT1.toString(), afterT1.toString())
  
  txRecp = await tx.wait();

  // Swap tokens
};

main();
