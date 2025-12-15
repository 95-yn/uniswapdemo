# 监控与优化系统设计文档

## 概述

本文档描述了 Uniswap V3 事件监听系统的监控与优化方案，涵盖数据延迟、错误率、数据完整性和查询性能四个核心指标。

## 1. 数据延迟监控（事件到存储）

### 1.1 设计目标
- 跟踪从事件发生到数据存储的完整延迟
- 区分处理延迟（事件处理）和存储延迟（数据库写入）
- 识别性能瓶颈

### 1.2 实现方案

#### 指标记录
- **事件时间戳** (`event_timestamp`): 事件在链上发生的时间
- **处理开始时间** (`processing_start`): 开始处理事件的时间
- **处理结束时间** (`processing_end`): 完成事件处理的时间
- **存储开始时间** (`storage_start`): 开始数据库写入的时间
- **存储结束时间** (`storage_end`): 完成数据库写入的时间

#### 延迟计算
```typescript
processing_latency_ms = processing_end - processing_start
storage_latency_ms = storage_end - storage_start
total_latency_ms = storage_end - event_timestamp
```

#### 数据存储
- 表名: `event_metrics`
- 每30秒批量刷新到数据库（减少数据库压力）
- 内存中最多保存1000条记录

### 1.3 API 端点

```bash
# 获取实时性能指标（内存中）
GET /api/metrics?limit=100

# 获取聚合指标（数据库）
GET /api/metrics?start_time=2024-01-01T00:00:00Z&end_time=2024-01-02T00:00:00Z
```

### 1.4 性能目标
- **处理延迟**: < 500ms
- **存储延迟**: < 200ms
- **总延迟**: < 1000ms

## 2. 错误率监控

### 2.1 设计目标
- 跟踪事件处理的成功/失败率
- 记录错误信息和错误类型
- 识别系统性问题

### 2.2 实现方案

#### 错误记录
- **成功状态** (`success`): boolean
- **错误信息** (`error_message`): 错误详情
- **事件类型** (`event_type`): swap/mint/burn/collect

#### 错误率计算
```typescript
error_rate = failed_events / total_events
```

#### 监控指标
- 实时错误率（最近N条记录）
- 历史错误率（按时间范围聚合）
- 按事件类型分类的错误率

### 2.3 告警阈值
- **警告**: 错误率 > 1%
- **严重**: 错误率 > 5%

## 3. 数据完整性检查

### 3.1 设计目标
- 确保数据的一致性和完整性
- 检测数据丢失、重复、不一致等问题
- 自动修复或报告问题

### 3.2 检查项目

#### 3.2.1 缺失交易检查
- 检查区块号连续性
- 识别超过10个区块的间隙
- 标记可能丢失的交易

#### 3.2.2 重复交易检查
- 检查 `(transaction_hash, log_index)` 唯一性
- 识别重复记录

#### 3.2.3 价格历史完整性
- 检查孤立的价格记录（没有对应的swap）
- 检查无效价格（<= 0 或 NULL）

#### 3.2.4 区块号连续性
- 检查区块号是否按时间顺序递增
- 识别时间戳不匹配的区块

#### 3.2.5 Swap 和价格一致性
- 检查有swap但没有价格记录的情况
- 确保价格历史与swap数据同步

#### 3.2.6 用户统计数据完整性
- 检查用户统计中的交易数量是否与实际记录匹配
- 验证交易量统计的准确性

### 3.3 执行频率
- **每日执行**: 在每日定时任务中自动执行（0点）
- **手动触发**: 通过 API 端点手动执行

### 3.4 API 端点

```bash
# 执行完整性检查
POST /api/integrity/check

# 获取最近的检查结果
GET /api/integrity/results?limit=10
```

### 3.5 检查结果
```json
{
  "check_type": "missing_transactions",
  "timestamp": "2024-01-01T00:00:00Z",
  "passed": false,
  "issues": [
    {
      "severity": "warning",
      "message": "发现 5 个区块号间隙",
      "affected_count": 5
    }
  ],
  "details": {
    "min_block": 1000,
    "max_block": 2000,
    "total_swaps": 100
  }
}
```

## 4. 查询性能优化

### 4.1 设计目标
- 监控数据库查询性能
- 识别慢查询
- 优化查询执行时间

### 4.2 实现方案

#### 4.2.1 查询性能监控
- **查询类型** (`query_type`): 查询分类
- **执行时间** (`execution_time_ms`): 查询执行时间（毫秒）
- **返回行数** (`rows_returned`): 查询返回的行数
- **查询文本** (`query_text`): 查询SQL（前1000字符）

#### 4.2.2 性能指标
- 平均执行时间
- P95 执行时间
- 最大执行时间
- 查询频率

### 4.3 数据库索引优化

#### 4.3.1 Swaps 表索引
```sql
-- 时间范围和交易类型复合索引
idx_swaps_time_type_usd (block_timestamp DESC, swap_type, usd_value DESC)

-- 用户交易历史索引
idx_swaps_sender_time (sender, block_timestamp DESC)

-- 鲸鱼交易索引（部分索引）
idx_swaps_whale_transactions (block_timestamp DESC, usd_value DESC)
WHERE usd_value > 10000
```

#### 4.3.2 其他表索引
- `liquidity_events`: 按事件类型和时间
- `price_history`: 按时间范围
- `user_stats`: 按交易量和交易次数
- `event_metrics`: 按事件类型和时间
- `query_performance`: 按查询类型和时间

### 4.4 API 端点

```bash
# 获取查询性能统计
GET /api/query-performance?start_time=2024-01-01T00:00:00Z&end_time=2024-01-02T00:00:00Z
```

### 4.5 性能视图

#### 慢查询视图 (`v_slow_queries`)
- 显示执行时间 > 1秒的查询
- 按查询类型聚合统计

#### 事件处理性能视图 (`v_event_performance`)
- 显示最近24小时的事件处理性能
- 包含延迟统计和错误率

## 5. 系统架构

### 5.1 组件关系

```
Event Listener
    ↓
Event Processor (记录 processing_start/end)
    ↓
Storage Repository (记录 storage_start/end)
    ↓
Metrics Service (记录指标)
    ↓
Database (event_metrics 表)
```

### 5.2 数据流

1. **事件捕获**: Event Listener 捕获链上事件
2. **事件处理**: Processor 处理事件数据（记录处理时间）
3. **数据存储**: Repository 写入数据库（记录存储时间）
4. **指标记录**: Metrics Service 记录性能指标
5. **批量刷新**: 每30秒将指标刷新到数据库

### 5.3 定时任务

- **每小时**: 快照 + 小时统计
- **每天0点**: 日统计 + 完整性检查

## 6. 使用指南

### 6.1 初始化数据库

```bash
# 1. 创建基础表结构
psql -d your_database -f init.sql

# 2. 创建监控表
psql -d your_database -f init_metrics.sql

# 3. 优化索引
psql -d your_database -f init_indexes_optimization.sql
```

### 6.2 查看监控数据

```bash
# 实时性能指标
curl http://localhost:3000/api/metrics

# 历史性能指标
curl "http://localhost:3000/api/metrics?start_time=2024-01-01T00:00:00Z&end_time=2024-01-02T00:00:00Z"

# 执行完整性检查
curl -X POST http://localhost:3000/api/integrity/check

# 查询性能统计
curl http://localhost:3000/api/query-performance
```

### 6.3 数据库查询示例

```sql
-- 查看最近1小时的事件处理性能
SELECT * FROM v_event_performance;

-- 查看慢查询
SELECT * FROM v_slow_queries;

-- 查看错误率趋势
SELECT 
  DATE_TRUNC('hour', event_timestamp) as hour,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE success = false) as failed,
  COUNT(*) FILTER (WHERE success = false)::float / COUNT(*)::float as error_rate
FROM event_metrics
WHERE event_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY hour
ORDER BY hour DESC;
```

## 7. 最佳实践

### 7.1 性能优化
1. **批量操作**: 使用批量插入减少数据库往返
2. **连接池**: 合理配置数据库连接池大小
3. **索引优化**: 根据查询模式创建合适的索引
4. **查询优化**: 避免全表扫描，使用 LIMIT 限制结果集

### 7.2 监控告警
1. **设置阈值**: 根据业务需求设置合理的告警阈值
2. **定期检查**: 每天执行完整性检查
3. **日志记录**: 记录所有错误和异常情况
4. **性能分析**: 定期分析慢查询并优化

### 7.3 数据完整性
1. **唯一约束**: 使用数据库唯一约束防止重复数据
2. **事务处理**: 使用事务确保数据一致性
3. **定期验证**: 定期执行完整性检查
4. **错误恢复**: 实现错误重试和恢复机制

## 8. 故障排查

### 8.1 高延迟问题
1. 检查 RPC 节点响应时间
2. 检查数据库连接池状态
3. 检查网络延迟
4. 分析慢查询日志

### 8.2 高错误率
1. 检查错误日志详情
2. 检查数据库连接状态
3. 检查 RPC 节点可用性
4. 检查数据格式验证

### 8.3 数据完整性问题
1. 执行完整性检查
2. 检查事件监听器状态
3. 检查数据库事务日志
4. 验证数据同步状态

## 9. 未来改进

1. **实时告警**: 集成告警系统（如 Prometheus + Alertmanager）
2. **可视化仪表板**: 创建 Grafana 仪表板
3. **自动修复**: 实现自动数据修复机制
4. **性能预测**: 基于历史数据预测性能趋势
5. **分布式追踪**: 集成分布式追踪系统（如 Jaeger）

