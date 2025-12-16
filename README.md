# Koa Server

一个基于 Koa.js 的 Node.js TypeScript 服务器项目。

## 功能特性

- ✅ TypeScript 支持
- ✅ Koa.js 框架
- ✅ 路由管理 (koa-router)
- ✅ 请求体解析 (koa-bodyparser)
- ✅ CORS 支持
- ✅ JSON 响应格式化
- ✅ 请求日志记录
- ✅ 错误处理

## 快速开始

### 安装依赖

```bash
npm install
# 或
yarn install
# 或
pnpm install
```

### 开发模式

```bash
npm run dev
```

服务器将在 `http://localhost:3000` 启动。

### 构建项目

```bash
npm run build
```

### 生产模式

```bash
npm start
```

## API 端点

### 健康检查

- `GET /` - 服务器信息
- `GET /health` - 健康状态检查

### API 示例

- `GET /api/hello` - Hello 端点
- `POST /api/echo` - Echo 端点（返回请求体）

## 项目结构

```
koa-server/
├── src/
│   └── index.ts          # 主入口文件
├── dist/                  # 编译输出目录
├── package.json
├── tsconfig.json
└── README.md
```

## 环境变量

可以通过环境变量配置：

- `PORT` - 服务器端口（默认: 3000）

示例：

```bash
PORT=8080 npm run dev
```

## 开发

项目使用 `tsx ` 进行 TypeScript 文件的直接运行和热重载，无需手动编译。

## 许可证

MIT
