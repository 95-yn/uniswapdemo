// 价格历史数据存储
import sql from "./supabaseClient";

export interface PriceHistoryData {
  timestamp: Date;
  block_number: number | bigint;
  price: number;
}

/**
 * 保存价格历史记录
 */
export async function savePriceHistory(
  data: PriceHistoryData
): Promise<void> {
  try {
    const blockNumber =
      typeof data.block_number === "bigint"
        ? Number(data.block_number)
        : data.block_number;

    await sql`
      INSERT INTO price_history (
        timestamp,
        block_number,
        price
      ) VALUES (
        ${data.timestamp},
        ${blockNumber},
        ${data.price}::DECIMAL(28, 18)
      )
      ON CONFLICT (timestamp) DO UPDATE SET
        block_number = EXCLUDED.block_number,
        price = EXCLUDED.price;
    `;
  } catch (error) {
    console.error("保存价格历史记录失败:", error);
    throw error;
  }
}

/**
 * 获取价格历史记录
 */
export async function getPriceHistory(
  startTime?: Date,
  endTime?: Date,
  limit: number = 1000
) {
  if (startTime && endTime) {
    const history = await sql`
      SELECT * FROM price_history
      WHERE timestamp >= ${startTime} AND timestamp <= ${endTime}
      ORDER BY timestamp ASC
      LIMIT ${limit}
    `;
    return history;
  } else {
    const history = await sql`
      SELECT * FROM price_history
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;
    return history;
  }
}

/**
 * 获取最新价格
 */
export async function getLatestPrice() {
  const result = await sql`
    SELECT * FROM price_history
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  return result[0] || null;
}

