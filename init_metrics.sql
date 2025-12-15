-- =====================================================
-- 性能监控和数据完整性表
-- =====================================================

-- 事件指标表（跟踪延迟和错误率）
CREATE TABLE IF NOT EXISTS event_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- 事件信息
    event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('swap', 'mint', 'burn', 'collect')),
    event_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    
    -- 处理时间戳
    processing_start TIMESTAMP WITH TIME ZONE NOT NULL,
    processing_end TIMESTAMP WITH TIME ZONE NOT NULL,
    storage_start TIMESTAMP WITH TIME ZONE NOT NULL,
    storage_end TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- 延迟指标（毫秒）
    processing_latency_ms INTEGER NOT NULL,
    storage_latency_ms INTEGER NOT NULL,
    total_latency_ms INTEGER NOT NULL,
    
    -- 成功/失败状态
    success BOOLEAN NOT NULL,
    error_message TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引优化
CREATE INDEX idx_event_metrics_timestamp ON event_metrics(event_timestamp DESC);
CREATE INDEX idx_event_metrics_type ON event_metrics(event_type);
CREATE INDEX idx_event_metrics_success ON event_metrics(success);
CREATE INDEX idx_event_metrics_latency ON event_metrics(total_latency_ms DESC);
CREATE INDEX idx_event_metrics_composite ON event_metrics(event_timestamp DESC, event_type, success);

-- 完整性检查结果表
CREATE TABLE IF NOT EXISTS integrity_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    check_type VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    passed BOOLEAN NOT NULL,
    issues_count INTEGER NOT NULL DEFAULT 0,
    details JSONB,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_integrity_checks_timestamp ON integrity_checks(timestamp DESC);
CREATE INDEX idx_integrity_checks_type ON integrity_checks(check_type);
CREATE INDEX idx_integrity_checks_passed ON integrity_checks(passed);

-- 查询性能监控表
CREATE TABLE IF NOT EXISTS query_performance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    query_type VARCHAR(100) NOT NULL,
    query_hash VARCHAR(64) NOT NULL, -- 查询的哈希值，用于识别相同查询
    execution_time_ms INTEGER NOT NULL,
    rows_returned INTEGER,
    query_text TEXT,
    
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_query_performance_timestamp ON query_performance(timestamp DESC);
CREATE INDEX idx_query_performance_type ON query_performance(query_type);
CREATE INDEX idx_query_performance_time ON query_performance(execution_time_ms DESC);

COMMENT ON TABLE event_metrics IS '事件处理性能指标（延迟、错误率）';
COMMENT ON TABLE integrity_checks IS '数据完整性检查结果';
COMMENT ON TABLE query_performance IS '查询性能监控';

