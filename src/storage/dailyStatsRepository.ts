// 每日统计数据存储
import sql from "./supabaseClient";

export interface DailyStatsData {
  date: Date;
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
  new_addresses: number;
  avg_tvl_usd?: number | null;
  end_tvl_usd?: number | null;
  whale_transactions: number;
  largest_transaction_usd?: number | null;
}

export async function saveDailyStats(stats: DailyStatsData): Promise<void> {
  try {
    await sql`
      INSERT INTO daily_stats (
        date,
        open_price, high_price, low_price, close_price,
        total_transactions, buy_transactions, sell_transactions,
        volume_token0, volume_token1, volume_usd,
        fees_token0, fees_token1, fees_usd,
        unique_addresses, new_addresses,
        avg_tvl_usd, end_tvl_usd,
        whale_transactions, largest_transaction_usd
      ) VALUES (
        ${stats.date},
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
        ${stats.new_addresses},
        ${stats.avg_tvl_usd ?? null}::DECIMAL(18, 2),
        ${stats.end_tvl_usd ?? null}::DECIMAL(18, 2),
        ${stats.whale_transactions},
        ${stats.largest_transaction_usd ?? null}::DECIMAL(18, 2)
      )
      ON CONFLICT (date) DO UPDATE SET
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
        new_addresses = EXCLUDED.new_addresses,
        avg_tvl_usd = EXCLUDED.avg_tvl_usd,
        end_tvl_usd = EXCLUDED.end_tvl_usd,
        whale_transactions = EXCLUDED.whale_transactions,
        largest_transaction_usd = EXCLUDED.largest_transaction_usd;
    `;
    console.log(`✅ 每日统计数据已保存: ${stats.date.toISOString().split('T')[0]}`);
  } catch (error) {
    console.error("保存每日统计数据失败:", error);
    throw error;
  }
}

export async function getDailyStats(limit: number = 100) {
  const stats = await sql`
    SELECT * FROM daily_stats 
    ORDER BY date DESC 
    LIMIT ${limit}
  `;
  return stats;
}

export async function getDailyStatsByDateRange(
  startDate: Date,
  endDate: Date
) {
  const stats = await sql`
    SELECT * FROM daily_stats 
    WHERE date >= ${startDate} AND date < ${endDate}
    ORDER BY date ASC
  `;
  return stats;
}

