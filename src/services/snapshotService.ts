/**
 * Pool 快照服务 - 收集和保存 Pool 状态快照
 */
import { ethers } from "ethers";
import { PoolSnapshotData } from "../storage/poolSnapshotRepository";
import sql from "../storage/supabaseClient";
import { PriceCalculator } from "../collectors/priceCalculator";

// Uniswap V3 Pool 合约 ABI
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// ERC20 Token ABI
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export class SnapshotService {
  private provider: ethers.JsonRpcProvider;
  private poolAddress: string;
  private priceCalculator: PriceCalculator;
  private token0Address?: string;
  private token1Address?: string;
  private token0Decimals?: number;
  private token1Decimals?: number;

  constructor(provider: ethers.JsonRpcProvider, poolAddress: string) {
    this.provider = provider;
    this.poolAddress = poolAddress;
    this.priceCalculator = new PriceCalculator();
  }

  /**
   * 设置 Token 信息
   */
  setTokenInfo(
    token0Address: string,
    token1Address: string,
    token0Decimals: number,
    token1Decimals: number
  ): void {
    this.token0Address = token0Address;
    this.token1Address = token1Address;
    this.token0Decimals = token0Decimals;
    this.token1Decimals = token1Decimals;
    this.priceCalculator.setTokenInfo(
      { address: token0Address, decimals: token0Decimals },
      { address: token1Address, decimals: token1Decimals }
    );
  }

  /**
   * 获取 Pool 当前状态
   */
  private async getPoolState(): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    liquidity: bigint;
    blockNumber: number;
  }> {
    const poolContract = new ethers.Contract(
      this.poolAddress,
      POOL_ABI,
      this.provider
    );

    const [slot0, liquidity] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity(),
    ]);

    const blockNumber = await this.provider.getBlockNumber();

    return {
      sqrtPriceX96: slot0.sqrtPriceX96,
      tick: slot0.tick,
      liquidity: liquidity,
      blockNumber,
    };
  }

  /**
   * 获取 Token 余额
   */
  private async getTokenBalances(): Promise<{
    token0Balance: number;
    token1Balance: number;
  } | null> {
    if (
      !this.token0Address ||
      !this.token1Address ||
      this.token0Decimals === undefined ||
      this.token1Decimals === undefined
    ) {
      return null;
    }

    try {
      const token0Contract = new ethers.Contract(
        this.token0Address,
        ERC20_ABI,
        this.provider
      );
      const token1Contract = new ethers.Contract(
        this.token1Address,
        ERC20_ABI,
        this.provider
      );

      const [balance0, balance1] = await Promise.all([
        token0Contract.balanceOf(this.poolAddress),
        token1Contract.balanceOf(this.poolAddress),
      ]);

      return {
        token0Balance:
          Number(balance0) / 10 ** this.token0Decimals,
        token1Balance:
          Number(balance1) / 10 ** this.token1Decimals,
      };
    } catch (error) {
      console.warn("获取 Token 余额失败:", error);
      return null;
    }
  }

  /**
   * 计算价格
   */
  private calculatePrice(sqrtPriceX96: bigint): {
    priceToken0: number;
    priceToken1: number;
  } {
    const price = this.priceCalculator.calculatePriceFromSqrtPriceX96(
      sqrtPriceX96
    );
    return {
      priceToken0: price,
      priceToken1: 1 / price,
    };
  }

  /**
   * 计算 TVL (Total Value Locked)
   */
  private async calculateTVL(
    token0Balance: number,
    token1Balance: number
  ): Promise<number | null> {
    if (
      !this.token0Address ||
      !this.token1Address ||
      this.token0Decimals === undefined ||
      this.token1Decimals === undefined
    ) {
      return null;
    }

    try {
      // 使用 Quoter 服务获取价格
      const { getQuoterService } = await import("./quoterService");
      const quoterService = getQuoterService(this.provider);

      const [price0, price1] = await Promise.all([
        quoterService.getTokenPriceInUSD(
          this.token0Address,
          this.token0Decimals
        ),
        quoterService.getTokenPriceInUSD(
          this.token1Address,
          this.token1Decimals
        ),
      ]);

      if (price0 !== null && price1 !== null) {
        return token0Balance * price0 + token1Balance * price1;
      } else if (price0 !== null) {
        return token0Balance * price0;
      } else if (price1 !== null) {
        return token1Balance * price1;
      }

      return null;
    } catch (error) {
      console.warn("计算 TVL 失败:", error);
      return null;
    }
  }

  /**
   * 获取 24 小时统计数据
   */
  private async get24hStats(): Promise<{
    volume_24h_usd: number;
    fees_24h_usd: number;
    transactions_24h: number;
  }> {
    try {
      const oneDayAgo = new Date();
      oneDayAgo.setHours(oneDayAgo.getHours() - 24);

      const stats = await sql`
        SELECT
          COALESCE(SUM(usd_value), 0) as volume_24h_usd,
          COALESCE(SUM(usd_value) * 0.0005, 0) as fees_24h_usd,
          COUNT(*)::INTEGER as transactions_24h
        FROM swaps
        WHERE block_timestamp >= ${oneDayAgo}
          AND usd_value IS NOT NULL
      `;

      return {
        volume_24h_usd: Number(stats[0]?.volume_24h_usd || 0),
        fees_24h_usd: Number(stats[0]?.fees_24h_usd || 0),
        transactions_24h: Number(stats[0]?.transactions_24h || 0),
      };
    } catch (error) {
      console.error("获取 24h 统计数据失败:", error);
      return {
        volume_24h_usd: 0,
        fees_24h_usd: 0,
        transactions_24h: 0,
      };
    }
  }

  /**
   * 创建快照
   */
  async createSnapshot(): Promise<PoolSnapshotData> {
    console.log("📸 开始创建 Pool 快照...");

    // 1. 获取 Pool 状态
    const poolState = await this.getPoolState();
    console.log(
      `   Pool 状态: tick=${poolState.tick}, liquidity=${poolState.liquidity.toString()}`
    );

    // 2. 计算价格
    const prices = this.calculatePrice(poolState.sqrtPriceX96);
    console.log(
      `   价格: token0=${prices.priceToken0.toFixed(6)}, token1=${prices.priceToken1.toFixed(6)}`
    );

    // 3. 获取 Token 余额
    const balances = await this.getTokenBalances();
    console.log(
      `   Token 余额: token0=${balances?.token0Balance.toFixed(4) || "N/A"}, token1=${balances?.token1Balance.toFixed(4) || "N/A"}`
    );

    // 4. 计算 TVL
    let tvl: number | null = null;
    if (balances) {
      tvl = await this.calculateTVL(
        balances.token0Balance,
        balances.token1Balance
      );
      console.log(`   TVL: $${tvl?.toFixed(2) || "N/A"}`);
    }

    // 5. 获取 24h 统计
    const stats24h = await this.get24hStats();
    console.log(
      `   24h 统计: 交易量=$${stats24h.volume_24h_usd.toFixed(2)}, 手续费=$${stats24h.fees_24h_usd.toFixed(2)}, 交易数=${stats24h.transactions_24h}`
    );

    // 6. 构建快照数据
    const snapshot: PoolSnapshotData = {
      snapshot_time: new Date(),
      block_number: poolState.blockNumber,
      sqrt_price_x96: poolState.sqrtPriceX96,
      tick: poolState.tick,
      liquidity: poolState.liquidity,
      price_token0: prices.priceToken0,
      price_token1: prices.priceToken1,
      tvl_usd: tvl,
      token0_balance: balances?.token0Balance || null,
      token1_balance: balances?.token1Balance || null,
      volume_24h_usd: stats24h.volume_24h_usd,
      fees_24h_usd: stats24h.fees_24h_usd,
      transactions_24h: stats24h.transactions_24h,
    };

    console.log("✅ Pool 快照数据准备完成");
    return snapshot;
  }
}

