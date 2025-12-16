/**
 * 价格服务 - 获取 Token 的 USD 价格
 */
export interface TokenPrice {
  usd: number;
  symbol: string;
}

export class PriceService {
  private cache: Map<string, { price: number; timestamp: number }> = new Map();
  private cacheTTL = 10 * 60 * 1000; // 10 分钟缓存
  private maxRetries = 3; // 最大重试次数
  private retryDelay = 2000; // 重试延迟（毫秒）

  /**
   * 获取 Token 的 USD 价格
   * 支持通过 CoinGecko API 或直接传入价格
   *
   * @param tokenAddress Token 合约地址
   * @param tokenSymbol Token 符号（用于 CoinGecko）
   * @param chainId 链 ID（可选，默认为 Ethereum mainnet）
   * @returns USD 价格
   */
  async getTokenPrice(
    tokenAddress: string,
    tokenSymbol?: string,
    chainId: number = 1
  ): Promise<number | null> {
    try {
      // 检查缓存
      const cacheKey = `${chainId}-${tokenAddress.toLowerCase()}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        console.log(
          `📦 使用缓存价格 (${tokenSymbol || tokenAddress}): $${cached.price}`
        );
        return cached.price;
      }

      let price: number | null = null;

      // 方法1: 优先使用 symbol 查询（通常更快更可靠）
      if (tokenSymbol) {
        price = await this.getPriceFromCoinGecko(tokenSymbol);
      }

      // 方法2: 如果 symbol 查询失败，尝试使用合约地址查询
      if (
        !price &&
        tokenAddress &&
        tokenAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        price = await this.getPriceFromCoinGeckoByAddress(
          tokenAddress,
          chainId
        );
      }

      // 方法3: 对于 Arbitrum 上的 WETH，尝试使用 Ethereum 主网价格
      if (!price && chainId === 42161 && tokenSymbol === "WETH") {
        console.log("🔄 尝试使用 Ethereum 主网价格获取 WETH...");
        price = await this.getPriceFromCoinGecko("WETH");
      }

      // 如果获取到价格，更新缓存
      if (price !== null) {
        this.cache.set(cacheKey, {
          price,
          timestamp: Date.now(),
        });
      } else {
        console.warn(
          `⚠️  无法获取 Token 价格: ${
            tokenSymbol || "N/A"
          } (${tokenAddress}) on chain ${chainId}`
        );
      }

      return price;
    } catch (error: any) {
      console.error(
        `获取 Token 价格失败 (${tokenSymbol || "N/A"} - ${tokenAddress}):`,
        error.message
      );
      return null;
    }
  }

  /**
   * Token Symbol 到 CoinGecko ID 的映射
   */
  private getCoinGeckoId(symbol: string): string {
    const symbolMap: Record<string, string> = {
      WETH: "weth",
      ETH: "ethereum",
      USDC: "usd-coin",
      USDT: "tether",
      DAI: "dai",
      WBTC: "wrapped-bitcoin",
      ARB: "arbitrum",
      UNI: "uniswap",
      LINK: "chainlink",
      AAVE: "aave",
    };
    return symbolMap[symbol.toUpperCase()] || symbol.toLowerCase();
  }

  /**
   * 带重试的 fetch 请求
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit = {},
    retries: number = this.maxRetries
  ): Promise<Response | null> {
    for (let i = 0; i < retries; i++) {
      try {
        // 创建超时控制器（每次重试都创建新的）
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 秒超时

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        return response;
      } catch (error: any) {
        if (error.name === "AbortError") {
          if (i < retries - 1) {
            console.warn(
              `请求超时，${this.retryDelay / 1000} 秒后重试 (${
                i + 1
              }/${retries})...`
            );
            await new Promise((resolve) =>
              setTimeout(resolve, this.retryDelay)
            );
            continue;
          }
        }
        if (i === retries - 1) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }
    return null;
  }

  /**
   * 从 CoinGecko 获取价格（通过 symbol）
   */
  private async getPriceFromCoinGecko(symbol: string): Promise<number | null> {
    try {
      const coinId = this.getCoinGeckoId(symbol);
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;

      const response = await this.fetchWithRetry(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response || !response.ok) {
        if (response) {
          console.warn(
            `CoinGecko API 响应错误 (${symbol}): ${response.status} ${response.statusText}`
          );
        }
        return null;
      }

      const data = (await response.json()) as Record<string, { usd?: number }>;
      const price = data[coinId]?.usd;

      if (price) {
        console.log(`✅ 获取到 ${symbol} 价格: $${price}`);
        return price;
      }

      return null;
    } catch (error: any) {
      console.warn(`CoinGecko API 调用失败 (${symbol}):`, error.message);
      return null;
    }
  }

  /**
   * 从 CoinGecko 获取价格（通过合约地址）
   */
  private async getPriceFromCoinGeckoByAddress(
    tokenAddress: string,
    chainId: number
  ): Promise<number | null> {
    try {
      // CoinGecko 的链 ID 映射
      const chainMap: Record<number, string> = {
        1: "ethereum", // Ethereum mainnet
        42161: "arbitrum-one", // Arbitrum
        137: "polygon-pos", // Polygon
        56: "binance-smart-chain", // BSC
      };

      const chainName = chainMap[chainId];
      if (!chainName) {
        console.warn(`不支持的链 ID: ${chainId}`);
        return null;
      }

      const url = `https://api.coingecko.com/api/v3/simple/token_price/${chainName}?contract_addresses=${tokenAddress.toLowerCase()}&vs_currencies=usd`;

      const response = await this.fetchWithRetry(url, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response || !response.ok) {
        if (response) {
          console.warn(
            `CoinGecko API 响应错误 (${tokenAddress}): ${response.status} ${response.statusText}`
          );
        }
        return null;
      }

      const data = (await response.json()) as Record<string, { usd?: number }>;
      const priceData = data[tokenAddress.toLowerCase()];
      const price = priceData?.usd;

      if (price) {
        console.log(`✅ 通过地址获取到价格 (${tokenAddress}): $${price}`);
        return price;
      }

      return null;
    } catch (error: any) {
      console.warn(`CoinGecko API 调用失败 (${tokenAddress}):`, error.message);
      return null;
    }
  }

  /**
   * 计算交易 USD 值
   * @param amount0 token0 数量（可读格式）
   * @param amount1 token1 数量（可读格式）
   * @param price0 token0 USD 价格
   * @param price1 token1 USD 价格
   * @param useSum 是否使用总和（true）还是平均值（false）。对于流动性事件（Mint/Burn）应使用总和，对于 Swap 事件可使用平均值
   * @returns USD 总值
   */
  calculateUSDValue(
    amount0: number,
    amount1: number,
    price0: number | null,
    price1: number | null,
    useSum: boolean = false
  ): number | null {
    let value0 = 0;
    let value1 = 0;

    if (price0 !== null && amount0 !== 0) {
      value0 = Math.abs(amount0) * price0;
    }

    if (price1 !== null && amount1 !== 0) {
      value1 = Math.abs(amount1) * price1;
    }

    // 如果两个价格都有
    if (price0 !== null && price1 !== null) {
      // 对于流动性事件（Mint/Burn），使用总和；对于 Swap 事件，使用平均值
      return useSum ? value0 + value1 : (value0 + value1) / 2;
    }

    // 如果只有一个价格，使用那个
    if (value0 > 0) return value0;
    if (value1 > 0) return value1;

    return null;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// 导出单例
let priceServiceInstance: PriceService | null = null;

export function getPriceService(): PriceService {
  if (!priceServiceInstance) {
    priceServiceInstance = new PriceService();
  }
  return priceServiceInstance;
}
