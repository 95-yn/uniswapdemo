import dotenv from "dotenv";
import postgres from "postgres";
const result = dotenv.config();
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("⚠️  DATABASE_URL 环境变量未设置，数据库功能将不可用");
  console.warn(
    "   请在 .env 文件中设置 DATABASE_URL，格式：postgresql://user:password@host:port/database"
  );
}

// 配置连接池参数以避免连接槽耗尽
// Supabase 免费计划通常限制连接数为 50-100，我们使用较小的连接池
let sql: ReturnType<typeof postgres>;

if (connectionString) {
  sql = postgres(connectionString, {
    max: 5, // 最大连接数（减少连接数以避免连接槽耗尽）
    idle_timeout: 10, // 空闲连接超时时间（秒）- 更短的空闲时间以更快释放连接
    max_lifetime: 60 * 10, // 连接最大生命周期（10分钟）- 更短的生命周期
    connect_timeout: 5, // 连接超时时间（秒）
    prepare: false, // 禁用 prepared statements 以减少连接使用
    transform: {
      // 自动转换 undefined 为 null（避免 PostgreSQL 类型错误）
      undefined: null,
    },
    onnotice: () => {}, // 禁用 notice 消息以减少日志
  });
} else {
  // 如果没有数据库连接，创建一个会抛出错误的函数
  sql = ((strings: TemplateStringsArray, ...values: any[]) => {
    throw new Error("数据库未配置，请在 .env 文件中设置 DATABASE_URL 环境变量");
  }) as any as ReturnType<typeof postgres>;
}

export default sql;
