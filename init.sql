-- =====================================================
-- Uniswap Pool 交易数据统计系统 - Database Schema
-- Database: PostgreSQL (Supabase)
-- Pool: ARB/WETH on Arbitrum
-- =====================================================

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =====================================================
-- 1. 交易记录表 (Swap Events)
-- =====================================================
CREATE TABLE IF NOT EXISTS swaps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 区块链基础信息
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    log_index INTEGER NOT NULL,
    
    -- 交易参与方
    sender VARCHAR(42) NOT NULL,
    recipient VARCHAR(42) NOT NULL,
    
    -- 交易数据
    amount0 DECIMAL(78, 0) NOT NULL, -- token0 数量变化（wei）
    amount1 DECIMAL(78, 0) NOT NULL, -- token1 数量变化（wei）
    sqrt_price_x96 DECIMAL(78, 0) NOT NULL, -- 价格 (Q64.96 格式)
    liquidity DECIMAL(78, 0) NOT NULL,
    tick INTEGER NOT NULL,
    
    -- 计算字段
    amount0_readable DECIMAL(28, 18), -- token0 可读数量
    amount1_readable DECIMAL(28, 18), -- token1 可读数量
    price_token0 DECIMAL(28, 18), -- token0 价格（以 token1 计价）
    price_token1 DECIMAL(28, 18), -- token1 价格（以 token0 计价）
    swap_type VARCHAR(4) NOT NULL CHECK (swap_type IN ('BUY', 'SELL')), -- 买入/卖出 ARB
    usd_value DECIMAL(18, 2), -- 交易价值（USD）
    
    -- Gas 信息
    gas_used BIGINT,
    gas_price DECIMAL(28, 0), -- wei
    transaction_fee DECIMAL(28, 18), -- ETH
    
    -- 元数据
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- 唯一约束
    UNIQUE(transaction_hash, log_index)
);

-- 索引优化
CREATE INDEX idx_swaps_block_number ON swaps(block_number DESC);
CREATE INDEX idx_swaps_block_timestamp ON swaps(block_timestamp DESC);
CREATE INDEX idx_swaps_sender ON swaps(sender);
CREATE INDEX idx_swaps_recipient ON swaps(recipient);
CREATE INDEX idx_swaps_swap_type ON swaps(swap_type);
CREATE INDEX idx_swaps_usd_value ON swaps(usd_value DESC) WHERE usd_value IS NOT NULL;
CREATE INDEX idx_swaps_composite ON swaps(block_timestamp DESC, swap_type);

-- 分区表（按月分区，提高大数据查询性能）
-- CREATE TABLE swaps_2024_01 PARTITION OF swaps
--     FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

COMMENT ON TABLE swaps IS 'Uniswap V3 Swap 事件记录';
COMMENT ON COLUMN swaps.amount0 IS '正数表示流入池子，负数表示流出池子';
COMMENT ON COLUMN swaps.swap_type IS 'BUY=买入ARB，SELL=卖出ARB';

-- =====================================================
-- 2. 流动性事件表 (Mint/Burn Events)
-- =====================================================
CREATE TABLE IF NOT EXISTS liquidity_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 区块链基础信息
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    log_index INTEGER NOT NULL,
    
    -- 事件类型
    event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('MINT', 'BURN', 'COLLECT')),
    
    -- 用户信息
    owner VARCHAR(42) NOT NULL,
    sender VARCHAR(42),
    
    -- 流动性信息
    liquidity_delta DECIMAL(78, 0) NOT NULL, -- 流动性变化
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    
    -- Token 数量
    amount0 DECIMAL(78, 0) NOT NULL,
    amount1 DECIMAL(78, 0) NOT NULL,
    amount0_readable DECIMAL(28, 18),
    amount1_readable DECIMAL(28, 18),
    usd_value DECIMAL(18, 2),
    
    -- 元数据
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(transaction_hash, log_index)
);

CREATE INDEX idx_liquidity_events_block_timestamp ON liquidity_events(block_timestamp DESC);
CREATE INDEX idx_liquidity_events_owner ON liquidity_events(owner);
CREATE INDEX idx_liquidity_events_event_type ON liquidity_events(event_type);
CREATE INDEX idx_liquidity_events_tick_range ON liquidity_events(tick_lower, tick_upper);

COMMENT ON TABLE liquidity_events IS '流动性变化事件（添加/移除/收集）';

-- =====================================================
-- 3. Pool 状态快照表
-- =====================================================
CREATE TABLE IF NOT EXISTS pool_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 快照时间
    snapshot_time TIMESTAMP WITH TIME ZONE NOT NULL,
    block_number BIGINT NOT NULL,
    
    -- Pool 状态
    sqrt_price_x96 DECIMAL(78, 0) NOT NULL,
    tick INTEGER NOT NULL,
    liquidity DECIMAL(78, 0) NOT NULL,
    
    -- 计算字段
    price_token0 DECIMAL(28, 18),
    price_token1 DECIMAL(28, 18),
    tvl_usd DECIMAL(18, 2), -- Total Value Locked
    
    -- Token 余额
    token0_balance DECIMAL(28, 18),
    token1_balance DECIMAL(28, 18),
    
    -- 24h 统计
    volume_24h_usd DECIMAL(18, 2),
    fees_24h_usd DECIMAL(18, 2),
    transactions_24h INTEGER,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(snapshot_time)
);

CREATE INDEX idx_pool_snapshots_time ON pool_snapshots(snapshot_time DESC);
CREATE INDEX idx_pool_snapshots_block ON pool_snapshots(block_number DESC);

COMMENT ON TABLE pool_snapshots IS '每小时 Pool 状态快照';

-- =====================================================
-- 4. 小时统计表 (OHLC)
-- =====================================================
CREATE TABLE IF NOT EXISTS hourly_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 时间范围
    hour_start TIMESTAMP WITH TIME ZONE NOT NULL,
    hour_end TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- OHLC 数据
    open_price DECIMAL(28, 18) NOT NULL,
    high_price DECIMAL(28, 18) NOT NULL,
    low_price DECIMAL(28, 18) NOT NULL,
    close_price DECIMAL(28, 18) NOT NULL,
    
    -- 交易统计
    total_transactions INTEGER NOT NULL DEFAULT 0,
    buy_transactions INTEGER NOT NULL DEFAULT 0,
    sell_transactions INTEGER NOT NULL DEFAULT 0,
    
    -- 交易量
    volume_token0 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    volume_token1 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    volume_usd DECIMAL(18, 2) NOT NULL DEFAULT 0,
    
    -- 手续费
    fees_token0 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    fees_token1 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    fees_usd DECIMAL(18, 2) NOT NULL DEFAULT 0,
    
    -- 用户统计
    unique_addresses INTEGER NOT NULL DEFAULT 0,
    unique_senders INTEGER NOT NULL DEFAULT 0,
    
    -- 流动性
    avg_liquidity DECIMAL(78, 0),
    min_liquidity DECIMAL(78, 0),
    max_liquidity DECIMAL(78, 0),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(hour_start)
);

CREATE INDEX idx_hourly_stats_time ON hourly_stats(hour_start DESC);

COMMENT ON TABLE hourly_stats IS '每小时交易统计和 OHLC 数据';

-- =====================================================
-- 5. 日统计表
-- =====================================================
CREATE TABLE IF NOT EXISTS daily_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 日期
    date DATE NOT NULL,
    
    -- OHLC 数据
    open_price DECIMAL(28, 18) NOT NULL,
    high_price DECIMAL(28, 18) NOT NULL,
    low_price DECIMAL(28, 18) NOT NULL,
    close_price DECIMAL(28, 18) NOT NULL,
    
    -- 交易统计
    total_transactions INTEGER NOT NULL DEFAULT 0,
    buy_transactions INTEGER NOT NULL DEFAULT 0,
    sell_transactions INTEGER NOT NULL DEFAULT 0,
    
    -- 交易量
    volume_token0 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    volume_token1 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    volume_usd DECIMAL(18, 2) NOT NULL DEFAULT 0,
    
    -- 手续费
    fees_token0 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    fees_token1 DECIMAL(28, 18) NOT NULL DEFAULT 0,
    fees_usd DECIMAL(18, 2) NOT NULL DEFAULT 0,
    
    -- 用户统计
    unique_addresses INTEGER NOT NULL DEFAULT 0,
    new_addresses INTEGER NOT NULL DEFAULT 0,
    
    -- 流动性
    avg_tvl_usd DECIMAL(18, 2),
    end_tvl_usd DECIMAL(18, 2),
    
    -- 大额交易
    whale_transactions INTEGER NOT NULL DEFAULT 0, -- > 10,000 USD
    largest_transaction_usd DECIMAL(18, 2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(date)
);

CREATE INDEX idx_daily_stats_date ON daily_stats(date DESC);

COMMENT ON TABLE daily_stats IS '每日交易统计汇总';

-- =====================================================
-- 6. 用户统计表
-- =====================================================
CREATE TABLE IF NOT EXISTS user_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 用户地址
    address VARCHAR(42) NOT NULL,
    
    -- 交易统计
    total_transactions INTEGER NOT NULL DEFAULT 0,
    buy_transactions INTEGER NOT NULL DEFAULT 0,
    sell_transactions INTEGER NOT NULL DEFAULT 0,
    
    -- 交易量
    total_volume_usd DECIMAL(18, 2) NOT NULL DEFAULT 0,
    largest_transaction_usd DECIMAL(18, 2),
    
    -- 时间信息
    first_transaction_at TIMESTAMP WITH TIME ZONE,
    last_transaction_at TIMESTAMP WITH TIME ZONE,
    
    -- 流动性提供
    is_liquidity_provider BOOLEAN DEFAULT FALSE,
    total_liquidity_provided_usd DECIMAL(18, 2) DEFAULT 0,
    
    -- 标签
    user_type VARCHAR(20) CHECK (user_type IN ('RETAIL', 'WHALE', 'BOT', 'LP', 'MEV')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(address)
);

CREATE INDEX idx_user_stats_address ON user_stats(address);
CREATE INDEX idx_user_stats_volume ON user_stats(total_volume_usd DESC);
CREATE INDEX idx_user_stats_type ON user_stats(user_type);

COMMENT ON TABLE user_stats IS '用户交易行为统计';

-- =====================================================
-- 7. 价格历史表（用于图表）
-- =====================================================
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    block_number BIGINT NOT NULL,
    
    price DECIMAL(28, 18) NOT NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(timestamp)
);

CREATE INDEX idx_price_history_timestamp ON price_history(timestamp DESC);

COMMENT ON TABLE price_history IS '价格历史记录（每笔交易后）';

-- =====================================================
-- 8. 系统监控表
-- =====================================================
CREATE TABLE IF NOT EXISTS sync_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 同步状态
    last_synced_block BIGINT NOT NULL,
    last_synced_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    current_block BIGINT,
    
    -- 统计
    total_events_synced BIGINT NOT NULL DEFAULT 0,
    sync_errors INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,
    
    -- 性能
    avg_sync_time_ms INTEGER,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 初始化同步状态
INSERT INTO sync_status (last_synced_block, last_synced_timestamp, total_events_synced)
VALUES (0, NOW() - INTERVAL '30 days', 0)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sync_status IS '数据同步状态监控';

-- =====================================================
-- 9. 触发器 - 自动更新 updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_swaps_updated_at
    BEFORE UPDATE ON swaps
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_hourly_stats_updated_at
    BEFORE UPDATE ON hourly_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_stats_updated_at
    BEFORE UPDATE ON daily_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_stats_updated_at
    BEFORE UPDATE ON user_stats
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 10. 视图 - 常用查询
-- =====================================================

-- 最近 24 小时交易统计
CREATE OR REPLACE VIEW v_stats_24h AS
SELECT
    COUNT(*) as total_transactions,
    COUNT(*) FILTER (WHERE swap_type = 'BUY') as buy_transactions,
    COUNT(*) FILTER (WHERE swap_type = 'SELL') as sell_transactions,
    SUM(usd_value) as total_volume_usd,
    AVG(usd_value) as avg_transaction_size_usd,
    MAX(usd_value) as largest_transaction_usd,
    COUNT(DISTINCT sender) as unique_traders,
    SUM(usd_value) * 0.0005 as estimated_fees_usd -- 0.05% fee
FROM swaps
WHERE block_timestamp > NOW() - INTERVAL '24 hours';

-- 最近 7 天每日统计
CREATE OR REPLACE VIEW v_stats_7d AS
SELECT
    DATE(block_timestamp) as date,
    COUNT(*) as total_transactions,
    SUM(usd_value) as volume_usd,
    COUNT(DISTINCT sender) as unique_traders,
    MIN(price_token0) as low_price,
    MAX(price_token0) as high_price
FROM swaps
WHERE block_timestamp > NOW() - INTERVAL '7 days'
GROUP BY DATE(block_timestamp)
ORDER BY date DESC;

-- 大额交易（Whale Alert）
CREATE OR REPLACE VIEW v_whale_transactions AS
SELECT
    transaction_hash,
    block_timestamp,
    sender,
    swap_type,
    usd_value,
    amount0_readable,
    amount1_readable
FROM swaps
WHERE usd_value > 10000
ORDER BY block_timestamp DESC;

-- Top 交易者
CREATE OR REPLACE VIEW v_top_traders AS
SELECT
    address,
    total_transactions,
    total_volume_usd,
    user_type,
    last_transaction_at
FROM user_stats
ORDER BY total_volume_usd DESC
LIMIT 100;

-- =====================================================
-- 11. RLS (Row Level Security) 策略
-- =====================================================
-- 如果需要多租户或权限控制，可以启用 RLS

-- ALTER TABLE swaps ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Public read access" ON swaps FOR SELECT USING (true);

-- =====================================================
-- 12. 性能优化 - 定期维护脚本
-- =====================================================

-- 定期 VACUUM 和 ANALYZE
-- 可以通过 pg_cron 扩展或外部 cron job 执行
-- VACUUM ANALYZE swaps;
-- VACUUM ANALYZE liquidity_events;

-- 清理旧数据（可选，保留最近 1 年数据）
-- DELETE FROM swaps WHERE block_timestamp < NOW() - INTERVAL '1 year';

-- =====================================================
-- 13. 初始数据和测试
-- =====================================================

-- 插入测试数据（开发环境）
-- INSERT INTO swaps (
--     transaction_hash, block_number, block_timestamp, log_index,
--     sender, recipient, amount0, amount1, sqrt_price_x96, liquidity, tick,
--     amount0_readable, amount1_readable, price_token0, swap_type, usd_value
-- ) VALUES (
--     '0x1234...', 150000000, NOW(), 0,
--     '0xabc...', '0xdef...', -1000000000000000000, 500000000000000000, 
--     79228162514264337593543950336, 1000000000000000000, 100000,
--     -1.0, 0.5, 0.5, 'SELL', 1000.00
-- );

-- =====================================================
-- 完成
-- =====================================================

-- 检查所有表
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- 检查索引
SELECT
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
