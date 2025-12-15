/**
 * 小时统计服务 - 聚合过去一小时的数据并生成统计
 */
import sql from "../storage/supabaseClient";
import { HourlyStatsData } from "../storage/hourlyStatsRepository";

export class HourlyStatsService {
  /**
   * 生成过去一小时的统计数据
   * @param hourStart 小时开始时间（整点）
   * @returns 统计数据
   */
  async generateHourlyStats(hourStart: Date): Promise<HourlyStatsData> {
    const hourEnd = new Date(hourStart);
    hourEnd.setHours(hourEnd.getHours() + 1);

    console.log(
      `📊 开始生成小时统计: ${hourStart.toISOString()} - ${hourEnd.toISOString()}`
    );

    try {
      // 1. 获取该小时内的所有交易
      const swaps = await sql`
        SELECT 
          price_token0,
          amount0_readable,
          amount1_readable,
          usd_value,
          swap_type,
          sender,
          recipient,
          liquidity
        FROM swaps
        WHERE block_timestamp >= ${hourStart}
          AND block_timestamp < ${hourEnd}
          AND price_token0 IS NOT NULL
        ORDER BY block_timestamp ASC
      `;

      if (swaps.length === 0) {
        console.warn("⚠️  该小时内没有交易数据");
        // 返回默认值
        return this.createEmptyStats(hourStart, hourEnd);
      }

      // 2. 计算 OHLC 数据
      const prices = swaps
        .map((s) => Number(s.price_token0))
        .filter((p) => !isNaN(p) && p > 0);
      
      const openPrice = prices[0] || 0;
      const closePrice = prices[prices.length - 1] || 0;
      const highPrice = Math.max(...prices, 0);
      const lowPrice = Math.min(...prices.filter((p) => p > 0), 0) || openPrice;

      // 3. 交易统计
      const buyTransactions = swaps.filter((s) => s.swap_type === "BUY").length;
      const sellTransactions = swaps.filter((s) => s.swap_type === "SELL").length;
      const totalTransactions = swaps.length;

      // 4. 交易量统计
      const volumeToken0 = swaps.reduce(
        (sum, s) => sum + Math.abs(Number(s.amount0_readable || 0)),
        0
      );
      const volumeToken1 = swaps.reduce(
        (sum, s) => sum + Math.abs(Number(s.amount1_readable || 0)),
        0
      );
      const volumeUsd = swaps.reduce(
        (sum, s) => sum + (Number(s.usd_value || 0)),
        0
      );

      // 5. 手续费统计（假设 0.05% 手续费）
      const feeRate = 0.0005;
      const feesUsd = volumeUsd * feeRate;
      const feesToken0 = volumeToken0 * feeRate;
      const feesToken1 = volumeToken1 * feeRate;

      // 6. 用户统计
      const uniqueSenders = new Set(swaps.map((s) => s.sender)).size;
      const uniqueRecipients = new Set(swaps.map((s) => s.recipient)).size;
      const uniqueAddresses = new Set([
        ...swaps.map((s) => s.sender),
        ...swaps.map((s) => s.recipient),
      ]).size;

      // 7. 流动性统计
      const liquidities = swaps
        .map((s) => s.liquidity)
        .filter((l) => l !== null && l !== undefined)
        .map((l) => Number(l));

      let avgLiquidity: bigint | null = null;
      let minLiquidity: bigint | null = null;
      let maxLiquidity: bigint | null = null;

      if (liquidities.length > 0) {
        const avg = liquidities.reduce((a, b) => a + b, 0) / liquidities.length;
        const min = Math.min(...liquidities);
        const max = Math.max(...liquidities);
        avgLiquidity = BigInt(Math.floor(avg));
        minLiquidity = BigInt(Math.floor(min));
        maxLiquidity = BigInt(Math.floor(max));
      }

      const stats: HourlyStatsData = {
        hour_start: hourStart,
        hour_end: hourEnd,
        open_price: openPrice,
        high_price: highPrice,
        low_price: lowPrice,
        close_price: closePrice,
        total_transactions: totalTransactions,
        buy_transactions: buyTransactions,
        sell_transactions: sellTransactions,
        volume_token0: volumeToken0,
        volume_token1: volumeToken1,
        volume_usd: volumeUsd,
        fees_token0: feesToken0,
        fees_token1: feesToken1,
        fees_usd: feesUsd,
        unique_addresses: uniqueAddresses,
        unique_senders: uniqueSenders,
        avg_liquidity: avgLiquidity,
        min_liquidity: minLiquidity,
        max_liquidity: maxLiquidity,
      };

      console.log(
        `✅ 小时统计生成完成: 交易数=${totalTransactions}, 交易量=$${volumeUsd.toFixed(2)}, OHLC=[${openPrice.toFixed(6)}, ${highPrice.toFixed(6)}, ${lowPrice.toFixed(6)}, ${closePrice.toFixed(6)}]`
      );

      return stats;
    } catch (error: any) {
      console.error("生成小时统计失败:", error.message || error);
      throw error;
    }
  }

  /**
   * 创建空的统计数据（当没有交易时）
   */
  private createEmptyStats(
    hourStart: Date,
    hourEnd: Date
  ): HourlyStatsData {
    // 尝试获取上一个小时的收盘价作为当前小时的开盘价
    return {
      hour_start: hourStart,
      hour_end: hourEnd,
      open_price: 0,
      high_price: 0,
      low_price: 0,
      close_price: 0,
      total_transactions: 0,
      buy_transactions: 0,
      sell_transactions: 0,
      volume_token0: 0,
      volume_token1: 0,
      volume_usd: 0,
      fees_token0: 0,
      fees_token1: 0,
      fees_usd: 0,
      unique_addresses: 0,
      unique_senders: 0,
      avg_liquidity: null,
      min_liquidity: null,
      max_liquidity: null,
    };
  }

  /**
   * 获取上一个小时的收盘价作为当前小时的开盘价
   */
  async getPreviousHourClosePrice(currentHourStart: Date): Promise<number | null> {
    try {
      const previousHourStart = new Date(currentHourStart);
      previousHourStart.setHours(previousHourStart.getHours() - 1);

      const previousStats = await sql`
        SELECT close_price FROM hourly_stats
        WHERE hour_start = ${previousHourStart}
        LIMIT 1
      `;

      if (previousStats.length > 0 && previousStats[0].close_price) {
        return Number(previousStats[0].close_price);
      }

      // 如果没有上一个小时的统计，尝试从最近的交易获取价格
      const recentSwap = await sql`
        SELECT price_token0 FROM swaps
        WHERE block_timestamp < ${currentHourStart}
          AND price_token0 IS NOT NULL
        ORDER BY block_timestamp DESC
        LIMIT 1
      `;

      if (recentSwap.length > 0 && recentSwap[0].price_token0) {
        return Number(recentSwap[0].price_token0);
      }

      return null;
    } catch (error) {
      console.warn("获取上一个小时收盘价失败:", error);
      return null;
    }
  }
}

