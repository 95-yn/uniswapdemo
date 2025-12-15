// 小时统计数据存储
import sql from "./supabaseClient";

export interface HourlyStatsData {
  hour_start: Date;
  hour_end: Date;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  total_transactions: number;
  buy_transactions: number;
  sell_transactions: number;
  volume_token0: number;
  volume_token1: number;
  volume_usd: number;
  fees_token0: number;
  fees_token1: number;
  fees_usd: number;
  unique_addresses: number;
  unique_senders: number;
  avg_liquidity?: string | bigint | null;
  min_liquidity?: string | bigint | null;
  max_liquidity?: string | bigint | null;
}

export async function saveHourlyStats(
  stats: HourlyStatsData
): Promise<void> {
  try {
    await sql`
      INSERT INTO hourly_stats (
        hour_start, hour_end,
        open_price, high_price, low_price, close_price,
        total_transactions, buy_transactions, sell_transactions,
        volume_token0, volume_token1, volume_usd,
        fees_token0, fees_token1, fees_usd,
        unique_addresses, unique_senders,
        avg_liquidity, min_liquidity, max_liquidity
      ) VALUES (
        ${stats.hour_start}, ${stats.hour_end},
        ${stats.open_price}::DECIMAL(28, 18),
        ${stats.high_price}::DECIMAL(28, 18),
        ${stats.low_price}::DECIMAL(28, 18),
        ${stats.close_price}::DECIMAL(28, 18),
        ${stats.total_transactions},
        ${stats.buy_transactions},
        ${stats.sell_transactions},
        ${stats.volume_token0}::DECIMAL(28, 18),
        ${stats.volume_token1}::DECIMAL(28, 18),
        ${stats.volume_usd}::DECIMAL(18, 2),
        ${stats.fees_token0}::DECIMAL(28, 18),
        ${stats.fees_token1}::DECIMAL(28, 18),
        ${stats.fees_usd}::DECIMAL(18, 2),
        ${stats.unique_addresses},
        ${stats.unique_senders},
        ${stats.avg_liquidity ? String(stats.avg_liquidity) : null}::DECIMAL(78, 0),
        ${stats.min_liquidity ? String(stats.min_liquidity) : null}::DECIMAL(78, 0),
        ${stats.max_liquidity ? String(stats.max_liquidity) : null}::DECIMAL(78, 0)
      )
      ON CONFLICT (hour_start) DO UPDATE SET
        hour_end = EXCLUDED.hour_end,
        open_price = EXCLUDED.open_price,
        high_price = EXCLUDED.high_price,
        low_price = EXCLUDED.low_price,
        close_price = EXCLUDED.close_price,
        total_transactions = EXCLUDED.total_transactions,
        buy_transactions = EXCLUDED.buy_transactions,
        sell_transactions = EXCLUDED.sell_transactions,
        volume_token0 = EXCLUDED.volume_token0,
        volume_token1 = EXCLUDED.volume_token1,
        volume_usd = EXCLUDED.volume_usd,
        fees_token0 = EXCLUDED.fees_token0,
        fees_token1 = EXCLUDED.fees_token1,
        fees_usd = EXCLUDED.fees_usd,
        unique_addresses = EXCLUDED.unique_addresses,
        unique_senders = EXCLUDED.unique_senders,
        avg_liquidity = EXCLUDED.avg_liquidity,
        min_liquidity = EXCLUDED.min_liquidity,
        max_liquidity = EXCLUDED.max_liquidity;
    `;
    console.log(
      `✅ 小时统计数据已保存: ${stats.hour_start.toISOString()} - ${stats.hour_end.toISOString()}`
    );
  } catch (error) {
    console.error("保存小时统计数据失败:", error);
    throw error;
  }
}

export async function getHourlyStats(
  limit: number = 100
): Promise<HourlyStatsData[]> {
  const stats = await sql`
    SELECT * FROM hourly_stats 
    ORDER BY hour_start DESC 
    LIMIT ${limit}
  `;
  return stats;
}

export async function getHourlyStatsByDateRange(
  startDate: Date,
  endDate: Date
): Promise<HourlyStatsData[]> {
  const stats = await sql`
    SELECT * FROM hourly_stats 
    WHERE hour_start >= ${startDate} AND hour_start < ${endDate}
    ORDER BY hour_start ASC
  `;
  return stats;
}

