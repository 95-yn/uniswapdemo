/**
 * 每日统计服务 - 聚合过去一天的数据并生成统计
 */
import sql from "../storage/supabaseClient";
import { DailyStatsData } from "../storage/dailyStatsRepository";

export class DailyStatsService {
  /**
   * 生成过去一天的统计数据
   * @param date 日期（当天）
   * @returns 统计数据
   */
  async generateDailyStats(date: Date): Promise<DailyStatsData> {
    // 计算当天的开始和结束时间
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    console.log(
      `📊 开始生成每日统计: ${dayStart.toISOString().split('T')[0]}`
    );

    try {
      // 1. 获取当天的所有交易
      const swaps = await sql`
        SELECT 
          price_token0,
          amount0_readable,
          amount1_readable,
          usd_value,
          swap_type,
          sender,
          recipient,
          block_timestamp
        FROM swaps
        WHERE block_timestamp >= ${dayStart}
          AND block_timestamp <= ${dayEnd}
          AND price_token0 IS NOT NULL
        ORDER BY block_timestamp ASC
      `;

      if (swaps.length === 0) {
        console.warn("⚠️  该天内没有交易数据");
        return this.createEmptyStats(date);
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
      const sellTransactions = swaps.filter((s) => s.swap_type === "SELL")
        .length;
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
        (sum, s) => sum + Number(s.usd_value || 0),
        0
      );

      // 5. 手续费统计（0.05% 手续费）
      const feeRate = 0.0005;
      const feesUsd = volumeUsd * feeRate;
      const feesToken0 = volumeToken0 * feeRate;
      const feesToken1 = volumeToken1 * feeRate;

      // 6. 用户统计
      const uniqueAddresses = new Set([
        ...swaps.map((s) => s.sender),
        ...swaps.map((s) => s.recipient),
      ]).size;

      // 计算新地址（当天首次出现的地址）
      const previousDayStart = new Date(dayStart);
      previousDayStart.setDate(previousDayStart.getDate() - 1);
      const previousDayEnd = new Date(dayStart);
      previousDayEnd.setMilliseconds(-1);

      const previousDayAddresses = await sql`
        SELECT DISTINCT sender, recipient
        FROM swaps
        WHERE block_timestamp >= ${previousDayStart}
          AND block_timestamp < ${dayStart}
      `;

      const previousAddresses = new Set([
        ...previousDayAddresses.map((s: any) => s.sender),
        ...previousDayAddresses.map((s: any) => s.recipient),
      ]);

      const todayAddresses = new Set([
        ...swaps.map((s) => s.sender),
        ...swaps.map((s) => s.recipient),
      ]);

      const newAddresses = Array.from(todayAddresses).filter(
        (addr) => !previousAddresses.has(addr)
      ).length;

      // 7. 大额交易统计（> 10,000 USD）
      const whaleThreshold = 10000;
      const whaleTransactions = swaps.filter(
        (s) => Number(s.usd_value || 0) > whaleThreshold
      ).length;
      const largestTransactionUsd = Math.max(
        ...swaps.map((s) => Number(s.usd_value || 0)),
        0
      );

      // 8. TVL 统计（从 pool_snapshots 获取）
      const tvlStats = await sql`
        SELECT 
          AVG(tvl_usd) as avg_tvl_usd,
          MAX(tvl_usd) FILTER (WHERE snapshot_time::date = ${dayStart}::date) as end_tvl_usd
        FROM pool_snapshots
        WHERE snapshot_time >= ${dayStart}
          AND snapshot_time <= ${dayEnd}
          AND tvl_usd IS NOT NULL
      `;

      const avgTvlUsd =
        tvlStats[0]?.avg_tvl_usd
          ? Number(tvlStats[0].avg_tvl_usd)
          : null;
      const endTvlUsd =
        tvlStats[0]?.end_tvl_usd
          ? Number(tvlStats[0].end_tvl_usd)
          : null;

      const stats: DailyStatsData = {
        date: dayStart,
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
        new_addresses: newAddresses,
        avg_tvl_usd: avgTvlUsd,
        end_tvl_usd: endTvlUsd,
        whale_transactions: whaleTransactions,
        largest_transaction_usd: largestTransactionUsd > 0 ? largestTransactionUsd : null,
      };

      console.log(
        `✅ 每日统计生成完成: 交易数=${totalTransactions}, 交易量=$${volumeUsd.toFixed(2)}, OHLC=[${openPrice.toFixed(6)}, ${highPrice.toFixed(6)}, ${lowPrice.toFixed(6)}, ${closePrice.toFixed(6)}], 新地址=${newAddresses}, 大额交易=${whaleTransactions}`
      );

      return stats;
    } catch (error: any) {
      console.error("生成每日统计失败:", error.message || error);
      throw error;
    }
  }

  /**
   * 创建空的统计数据（当没有交易时）
   */
  private createEmptyStats(date: Date): DailyStatsData {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);

    return {
      date: dayStart,
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
      new_addresses: 0,
      avg_tvl_usd: null,
      end_tvl_usd: null,
      whale_transactions: 0,
      largest_transaction_usd: null,
    };
  }

  /**
   * 获取前一天的收盘价作为当天的开盘价
   */
  async getPreviousDayClosePrice(currentDate: Date): Promise<number | null> {
    try {
      const previousDate = new Date(currentDate);
      previousDate.setDate(previousDate.getDate() - 1);

      const previousStats = await sql`
        SELECT close_price FROM daily_stats
        WHERE date = ${previousDate}
        LIMIT 1
      `;

      if (previousStats.length > 0 && previousStats[0].close_price) {
        return Number(previousStats[0].close_price);
      }

      // 如果没有前一天的统计，尝试从最近的交易获取价格
      const dayStart = new Date(currentDate);
      dayStart.setHours(0, 0, 0, 0);

      const recentSwap = await sql`
        SELECT price_token0 FROM swaps
        WHERE block_timestamp < ${dayStart}
          AND price_token0 IS NOT NULL
        ORDER BY block_timestamp DESC
        LIMIT 1
      `;

      if (recentSwap.length > 0 && recentSwap[0].price_token0) {
        return Number(recentSwap[0].price_token0);
      }

      return null;
    } catch (error) {
      console.warn("获取前一天收盘价失败:", error);
      return null;
    }
  }
}

