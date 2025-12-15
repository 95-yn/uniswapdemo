-- =====================================================
-- 数据库索引优化 - 提升查询性能
-- =====================================================

-- 1. Swaps 表索引优化
-- 复合索引：按时间范围和交易类型查询
CREATE INDEX IF NOT EXISTS idx_swaps_time_type_usd 
  ON swaps(block_timestamp DESC, swap_type, usd_value DESC NULLS LAST)
  WHERE usd_value IS NOT NULL;

-- 复合索引：按发送者和时间查询（用户交易历史）
CREATE INDEX IF NOT EXISTS idx_swaps_sender_time 
  ON swaps(sender, block_timestamp DESC);

-- 复合索引：按接收者和时间查询
CREATE INDEX IF NOT EXISTS idx_swaps_recipient_time 
  ON swaps(recipient, block_timestamp DESC);

-- 部分索引：大额交易（用于鲸鱼交易分析）
CREATE INDEX IF NOT EXISTS idx_swaps_whale_transactions 
  ON swaps(block_timestamp DESC, usd_value DESC)
  WHERE usd_value > 10000; -- 大于 $10,000 的交易

-- 2. Liquidity Events 表索引优化
-- 复合索引：按事件类型和时间查询
CREATE INDEX IF NOT EXISTS idx_liquidity_events_type_time 
  ON liquidity_events(event_type, block_timestamp DESC);

-- 复合索引：按所有者和时间查询
CREATE INDEX IF NOT EXISTS idx_liquidity_events_owner_time 
  ON liquidity_events(owner, block_timestamp DESC);

-- 3. Price History 表索引优化
-- 时间范围查询优化
CREATE INDEX IF NOT EXISTS idx_price_history_time_price 
  ON price_history(timestamp DESC, price);

-- 4. Hourly Stats 表索引优化
-- 时间范围查询
CREATE INDEX IF NOT EXISTS idx_hourly_stats_time_range 
  ON hourly_stats(hour_start DESC, hour_end);

-- 5. Daily Stats 表索引优化
-- 日期范围查询
CREATE INDEX IF NOT EXISTS idx_daily_stats_date_range 
  ON daily_stats(date DESC);

-- 6. User Stats 表索引优化
-- 按交易量排序
CREATE INDEX IF NOT EXISTS idx_user_stats_volume 
  ON user_stats(total_volume_usd DESC NULLS LAST)
  WHERE total_volume_usd IS NOT NULL;

-- 按交易次数排序
CREATE INDEX IF NOT EXISTS idx_user_stats_transactions 
  ON user_stats(total_transactions DESC);

-- 按用户类型查询
CREATE INDEX IF NOT EXISTS idx_user_stats_type 
  ON user_stats(user_type);

-- 7. Event Metrics 表索引优化
-- 按事件类型和时间查询
CREATE INDEX IF NOT EXISTS idx_event_metrics_type_time 
  ON event_metrics(event_type, event_timestamp DESC);

-- 按成功率和延迟查询
CREATE INDEX IF NOT EXISTS idx_event_metrics_performance 
  ON event_metrics(success, total_latency_ms DESC);

-- 8. Query Performance 表索引优化
-- 按查询类型和时间查询
CREATE INDEX IF NOT EXISTS idx_query_performance_type_time 
  ON query_performance(query_type, timestamp DESC);

-- 慢查询识别（执行时间超过阈值）
CREATE INDEX IF NOT EXISTS idx_query_performance_slow 
  ON query_performance(timestamp DESC, execution_time_ms DESC)
  WHERE execution_time_ms > 1000; -- 超过 1 秒的查询

-- =====================================================
-- 表统计信息更新（PostgreSQL 查询优化器使用）
-- =====================================================

-- 定期运行 ANALYZE 以更新统计信息（建议在定时任务中执行）
-- ANALYZE swaps;
-- ANALYZE liquidity_events;
-- ANALYZE price_history;
-- ANALYZE hourly_stats;
-- ANALYZE daily_stats;
-- ANALYZE user_stats;
-- ANALYZE event_metrics;
-- ANALYZE query_performance;

-- =====================================================
-- 查询性能视图
-- =====================================================

-- 慢查询统计视图
CREATE OR REPLACE VIEW v_slow_queries AS
SELECT 
  query_type,
  COUNT(*) as slow_query_count,
  AVG(execution_time_ms) as avg_time_ms,
  MAX(execution_time_ms) as max_time_ms,
  MIN(timestamp) as first_occurrence,
  MAX(timestamp) as last_occurrence
FROM query_performance
WHERE execution_time_ms > 1000
  AND timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY query_type
ORDER BY avg_time_ms DESC;

-- 事件处理性能视图
CREATE OR REPLACE VIEW v_event_performance AS
SELECT 
  event_type,
  COUNT(*) as total_events,
  COUNT(*) FILTER (WHERE success = true) as successful_events,
  COUNT(*) FILTER (WHERE success = false) as failed_events,
  AVG(processing_latency_ms) as avg_processing_latency_ms,
  AVG(storage_latency_ms) as avg_storage_latency_ms,
  AVG(total_latency_ms) as avg_total_latency_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_latency_ms) as p95_latency_ms,
  MAX(total_latency_ms) as max_latency_ms
FROM event_metrics
WHERE event_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY event_type
ORDER BY avg_total_latency_ms DESC;

COMMENT ON VIEW v_slow_queries IS '慢查询统计（执行时间 > 1秒）';
COMMENT ON VIEW v_event_performance IS '事件处理性能统计（最近24小时）';

