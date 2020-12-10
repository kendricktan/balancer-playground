const fs = require("fs");
const { ethers } = require("hardhat");

const { formatEther, parseEther } = ethers.utils;

const ADDRESSES = {
  BActions: "0x2fcc6f96418764439f8dc26af559ed5cddaeefac",
  Factory: "0xed52d8e202401645edad1c0aa21e872498ce47d0",
  BFactory: "0x9424b1412450d0f8fc2255faf6046b98213b76bd",
  DSProxyRegistry: "0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4",
  ExchangeProxy: "0x3E66B66Fd1d0b02fDa6C811Da9E0547970DB2f21",
};

const getProxy = async () => {
  const [user] = await ethers.getSigners();
  const ProxyRegistry = await ethers.getContractAt(
    "ProxyRegistry",
    ADDRESSES.DSProxyRegistry
  );

  let proxyAddress = await ProxyRegistry.proxies(user.address);
  if (proxyAddress === ethers.constants.AddressZero) {
    await ProxyRegistry["build()"]();
    proxyAddress = await ProxyRegistry.proxies(user.address);
  }

  return ethers.getContractAt("DSProxy", proxyAddress);
};

const createSmartPool = async ({
  USDC,
  XSGD,
  usdcAmount,
  xsgdAmount,
  usdcWeight,
  xsgdWeight,
}) => {
  const [user] = await ethers.getSigners();

  const Proxy = await getProxy();
  const BActions = await ethers.getContractAt("BActions", ADDRESSES.BActions);

  await USDC.approve(Proxy.address, ethers.constants.MaxUint256);
  await XSGD.approve(Proxy.address, ethers.constants.MaxUint256);

  await USDC.mint(user.address, usdcAmount);
  await XSGD.mint(user.address, xsgdAmount);

  const data = BActions.interface.encodeFunctionData("createSmartPool", [
    ADDRESSES.Factory,
    ADDRESSES.BFactory,
    [
      "SPT",
      "Smart Pool",
      [USDC.address, XSGD.address],
      [usdcAmount, xsgdAmount],
      [usdcWeight, xsgdWeight],
      ethers.utils.parseEther("0.003"), // 0.3% fees
    ],
    [
      usdcAmount.add(xsgdAmount).div(ethers.BigNumber.from("2")),
      "90000",
      "500",
    ],
    [true, true, true, true, true, true],
  ]);

  const tx = await Proxy["execute(address,bytes)"](BActions.address, data, {
    gasLimit: "16000000",
  });
  const txRecp = await tx.wait();

  // Gets pool address
  const [crpAddress, bpoolAddress] = txRecp.logs[14].topics
    .slice(1, 3)
    .map((x) => ethers.utils.getAddress(`0x${x.slice(26)}`));

  return {
    CRP: await ethers.getContractAt("ConfigurableRightsPool", crpAddress),
    BPool: await ethers.getContractAt("BPool", bpoolAddress),
  };
};

const getBPoolStats = async ({ USDC, XSGD, BPool }) => {
  const usdcBal = await USDC.balanceOf(BPool.address);
  const xsgdBal = await XSGD.balanceOf(BPool.address);
  const sgd_usd_price = await BPool.getSpotPrice(USDC.address, XSGD.address);
  const usd_sgd_price = await BPool.getSpotPrice(XSGD.address, USDC.address);

  return {
    usdcBal: formatEther(usdcBal),
    xsgdBal: formatEther(xsgdBal),
    usd_sgd: formatEther(usd_sgd_price),
    sgd_usd: formatEther(sgd_usd_price),
  };
};

const main = async () => {
  const usdcWeight = 60;
  const xsgdWeight = 40;

  const USDC_SGD_PRICE = 1.345;

  const usdcAmount =
    usdcWeight > xsgdWeight ? (1000000 * usdcWeight) / xsgdWeight : 1000000;

  const xsgdAmount =
    xsgdWeight > usdcWeight
      ? (1000000 * USDC_SGD_PRICE * xsgdWeight) / usdcWeight
      : 1000000 * USDC_SGD_PRICE;

  const [user] = await ethers.getSigners();

  // ERC20
  const MockERC20 = await ethers.getContractFactory("MockERC20");

  const USDC = await MockERC20.deploy("USD Coin", "USDC");
  const XSGD = await MockERC20.deploy("Singapore Dollars", "XSGD");

  const { BPool } = await createSmartPool({
    USDC,
    XSGD,
    usdcAmount: parseEther(usdcAmount.toString()),
    xsgdAmount: parseEther(xsgdAmount.toString()),
    usdcWeight: parseEther((usdcWeight / 2).toString()),
    xsgdWeight: parseEther((xsgdWeight / 2).toString()),
  });

  let stats = `USDC Weight,${usdcWeight}\nXSGD Weight,${xsgdWeight}\n\nUSDC Reserve,XSGD Reserve,USDC_XSGD,XSGD_USDC\n`;

  let curStats = await getBPoolStats({ USDC, XSGD, BPool });

  stats =
    stats +
    `${curStats.usdcBal},${curStats.xsgdBal},${curStats.usd_sgd},${curStats.sgd_usd}\n`;

  for (let i = 0; i < 100; i++) {
    // Swap 1k USDC -> 1k XSGD
    // i.e. We WANT XSGD
    const amount = ethers.utils.parseEther("10000");

    await USDC.mint(user.address, amount);
    await USDC.approve(BPool.address, ethers.constants.MaxUint256);
    await BPool.swapExactAmountIn(
      USDC.address,
      amount,
      XSGD.address,
      ethers.constants.Zero,
      ethers.constants.MaxUint256
    );

    curStats = await getBPoolStats({ USDC, XSGD, BPool });
    stats =
      stats +
      `${curStats.usdcBal},${curStats.xsgdBal},${curStats.usd_sgd},${curStats.sgd_usd}\n`;
  }

  fs.writeFileSync(`USDC_${usdcWeight}_XSGD_${xsgdWeight}.csv`, stats);
};

main();
