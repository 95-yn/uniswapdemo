/**
 * Uniswap V3 Quoter 服务 - 使用链上合约获取实时报价
 */
import { ethers } from "ethers";

// Uniswap V3 Quoter 合约 ABI
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
  "function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn)",
];

// Quoter 合约地址（Ethereum 和 Arbitrum 使用相同地址）
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

// 常见的稳定币地址（用于识别 USD 计价）
const STABLE_COINS: Record<string, { symbol: string; decimals: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 }, // Ethereum USDC
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 }, // Ethereum USDT
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831": { symbol: "USDC", decimals: 6 }, // Arbitrum USDC
  "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": { symbol: "USDT", decimals: 6 }, // Arbitrum USDT
  "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": { symbol: "DAI", decimals: 18 }, // Arbitrum DAI
};

// 常见的 fee tiers
const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

export class QuoterService {
  private provider: ethers.JsonRpcProvider;
  private quoterContract: ethers.Contract;
  private cache: Map<string, { price: number; timestamp: number }> = new Map();
  private cacheTTL = 10 * 60 * 1000; // 10 分钟缓存

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.quoterContract = new ethers.Contract(
      QUOTER_ADDRESS,
      QUOTER_ABI,
      provider
    );
  }

  /**
   * 检查是否是稳定币
   */
  private isStableCoin(tokenAddress: string): boolean {
    return !!STABLE_COINS[tokenAddress.toLowerCase()];
  }

  /**
   * 获取稳定币信息
   */
  private getStableCoinInfo(tokenAddress: string): {
    symbol: string;
    decimals: number;
  } | null {
    return STABLE_COINS[tokenAddress.toLowerCase()] || null;
  }

  /**
   * 使用 Quoter 合约获取价格
   * @param tokenIn 输入 token 地址
   * @param tokenOut 输出 token 地址
   * @param fee 手续费等级（通常为 500, 3000, 10000）
   * @param amountIn 输入数量（使用 1 token，考虑 decimals）
   * @returns 输出数量
   */
  private async quotePrice(
    tokenIn: string,
    tokenOut: string,
    fee: number,
    amountIn: bigint
  ): Promise<bigint | null> {
    try {
      const amountOut = await this.quoterContract.quoteExactInputSingle.staticCall(
        tokenIn,
        tokenOut,
        fee,
        amountIn,
        0 // sqrtPriceLimitX96 = 0 表示没有价格限制
      );
      return amountOut;
    } catch (error: any) {
      // 如果这个 fee tier 不存在，会失败，尝试下一个
      return null;
    }
  }

  /**
   * 获取 token 相对于稳定币的价格（USD）
   * @param tokenAddress token 地址
   * @param tokenDecimals token 精度
   * @param stableCoinAddress 稳定币地址（如果已知）
   * @returns USD 价格
   */
  async getTokenPriceInUSD(
    tokenAddress: string,
    tokenDecimals: number,
    stableCoinAddress?: string
  ): Promise<number | null> {
    try {
      // 检查缓存
      const cacheKey = `${tokenAddress.toLowerCase()}-${stableCoinAddress?.toLowerCase() || "auto"}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        console.log(`📦 使用缓存价格 (${tokenAddress}): $${cached.price}`);
        return cached.price;
      }

      // 如果 token 本身就是稳定币，返回 1
      const stableCoinInfo = this.getStableCoinInfo(tokenAddress);
      if (stableCoinInfo) {
        const price = 1.0;
        this.cache.set(cacheKey, { price, timestamp: Date.now() });
        return price;
      }

      // 确定使用哪个稳定币
      let usdTokenAddress = stableCoinAddress;
      let usdTokenDecimals = 6; // 默认 USDC/USDT 精度

      if (!usdTokenAddress) {
        // 尝试常见的稳定币地址（根据链选择）
        const network = await this.provider.getNetwork();
        const chainId = Number(network.chainId);
        
        if (chainId === 42161) {
          // Arbitrum
          usdTokenAddress = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // USDC
        } else {
          // Ethereum mainnet
          usdTokenAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"; // USDC
        }
      } else {
        const info = this.getStableCoinInfo(usdTokenAddress);
        if (info) {
          usdTokenDecimals = info.decimals;
        }
      }

      // 使用 1 token 作为输入（考虑 decimals）
      const oneToken = 10n ** BigInt(tokenDecimals);
      
      // 尝试不同的 fee tiers
      let amountOut: bigint | null = null;
      let usedFee = 0;

      for (const fee of FEE_TIERS) {
        amountOut = await this.quotePrice(
          tokenAddress,
          usdTokenAddress,
          fee,
          oneToken
        );
        if (amountOut !== null) {
          usedFee = fee;
          break;
        }
      }

      if (amountOut === null) {
        console.warn(`⚠️  无法通过 Quoter 获取价格: ${tokenAddress}`);
        return null;
      }

      // 计算价格：amountOut / amountIn（考虑 decimals）
      const price =
        Number(amountOut) / Number(oneToken) / 10 ** (usdTokenDecimals - tokenDecimals);

      console.log(
        `✅ 通过 Quoter 获取到价格 (${tokenAddress}): $${price.toFixed(6)} (fee: ${usedFee})`
      );

      // 更新缓存
      this.cache.set(cacheKey, { price, timestamp: Date.now() });

      return price;
    } catch (error: any) {
      console.error(`获取 Quoter 价格失败 (${tokenAddress}):`, error.message);
      return null;
    }
  }

  /**
   * 计算交易的 USD 值
   * @param amount0 token0 数量（可读格式）
   * @param amount1 token1 数量（可读格式）
   * @param token0Address token0 地址
   * @param token1Address token1 地址
   * @param token0Decimals token0 精度
   * @param token1Decimals token1 精度
   * @returns USD 总值
   */
  async calculateUSDValue(
    amount0: number,
    amount1: number,
    token0Address: string,
    token1Address: string,
    token0Decimals: number,
    token1Decimals: number
  ): Promise<number | null> {
    try {
      // 检查哪个是稳定币
      const isToken0Stable = this.isStableCoin(token0Address);
      const isToken1Stable = this.isStableCoin(token1Address);

      let usdValue: number | null = null;

      if (isToken0Stable) {
        // token0 是稳定币，直接使用 amount0
        usdValue = Math.abs(amount0);
        console.log(`💰 使用稳定币 token0 计算 USD 值: $${usdValue.toFixed(2)}`);
      } else if (isToken1Stable) {
        // token1 是稳定币，直接使用 amount1
        usdValue = Math.abs(amount1);
        console.log(`💰 使用稳定币 token1 计算 USD 值: $${usdValue.toFixed(2)}`);
      } else {
        // 都不是稳定币，需要获取两个 token 的价格
        const [price0, price1] = await Promise.all([
          this.getTokenPriceInUSD(token0Address, token0Decimals),
          this.getTokenPriceInUSD(token1Address, token1Decimals),
        ]);

        if (price0 !== null && price1 !== null) {
          const value0 = Math.abs(amount0) * price0;
          const value1 = Math.abs(amount1) * price1;
          // 取平均值（更准确）
          usdValue = (value0 + value1) / 2;
          console.log(
            `💰 通过价格计算 USD 值: $${usdValue.toFixed(2)} (price0: $${price0.toFixed(6)}, price1: $${price1.toFixed(6)})`
          );
        } else if (price0 !== null) {
          usdValue = Math.abs(amount0) * price0;
          console.log(`💰 使用 token0 价格计算 USD 值: $${usdValue.toFixed(2)}`);
        } else if (price1 !== null) {
          usdValue = Math.abs(amount1) * price1;
          console.log(`💰 使用 token1 价格计算 USD 值: $${usdValue.toFixed(2)}`);
        }
      }

      return usdValue;
    } catch (error: any) {
      console.error("计算 USD 值失败:", error.message);
      return null;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// 导出单例
let quoterServiceInstance: QuoterService | null = null;

export function getQuoterService(
  provider: ethers.JsonRpcProvider
): QuoterService {
  if (!quoterServiceInstance) {
    quoterServiceInstance = new QuoterService(provider);
  }
  return quoterServiceInstance;
}

