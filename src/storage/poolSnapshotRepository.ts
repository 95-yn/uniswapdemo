// Pool 快照数据存储
import sql from "./supabaseClient";

export interface PoolSnapshotData {
  snapshot_time: Date;
  block_number: number;
  sqrt_price_x96: string | bigint;
  tick: number;
  liquidity: string | bigint;
  price_token0?: number | string | null;
  price_token1?: number | string | null;
  tvl_usd?: number | string | null;
  token0_balance?: number | string | null;
  token1_balance?: number | string | null;
  volume_24h_usd?: number | string | null;
  fees_24h_usd?: number | string | null;
  transactions_24h?: number | null;
}

export async function savePoolSnapshot(
  snapshot: PoolSnapshotData
): Promise<void> {
  try {
    await sql`
      INSERT INTO pool_snapshots (
        snapshot_time, block_number, sqrt_price_x96, tick, liquidity,
        price_token0, price_token1, tvl_usd,
        token0_balance, token1_balance,
        volume_24h_usd, fees_24h_usd, transactions_24h
      ) VALUES (
        ${snapshot.snapshot_time},
        ${snapshot.block_number},
        ${String(snapshot.sqrt_price_x96)}::DECIMAL(78, 0),
        ${snapshot.tick},
        ${String(snapshot.liquidity)}::DECIMAL(78, 0),
        ${snapshot.price_token0 ?? null}::DECIMAL(28, 18),
        ${snapshot.price_token1 ?? null}::DECIMAL(28, 18),
        ${snapshot.tvl_usd ?? null}::DECIMAL(18, 2),
        ${snapshot.token0_balance ?? null}::DECIMAL(28, 18),
        ${snapshot.token1_balance ?? null}::DECIMAL(28, 18),
        ${snapshot.volume_24h_usd ?? null}::DECIMAL(18, 2),
        ${snapshot.fees_24h_usd ?? null}::DECIMAL(18, 2),
        ${snapshot.transactions_24h ?? null}
      )
      ON CONFLICT (snapshot_time) DO UPDATE SET
        block_number = EXCLUDED.block_number,
        sqrt_price_x96 = EXCLUDED.sqrt_price_x96,
        tick = EXCLUDED.tick,
        liquidity = EXCLUDED.liquidity,
        price_token0 = EXCLUDED.price_token0,
        price_token1 = EXCLUDED.price_token1,
        tvl_usd = EXCLUDED.tvl_usd,
        token0_balance = EXCLUDED.token0_balance,
        token1_balance = EXCLUDED.token1_balance,
        volume_24h_usd = EXCLUDED.volume_24h_usd,
        fees_24h_usd = EXCLUDED.fees_24h_usd,
        transactions_24h = EXCLUDED.transactions_24h;
    `;
    console.log(
      `✅ Pool 快照已保存: ${snapshot.snapshot_time.toISOString()}`
    );
  } catch (error) {
    console.error("保存 Pool 快照失败:", error);
    throw error;
  }
}

export async function getLatestSnapshot() {
  const snapshot = await sql`
    SELECT * FROM pool_snapshots 
    ORDER BY snapshot_time DESC 
    LIMIT 1
  `;
  return snapshot[0] || null;
}

