# coze-chat · Coze 智能体流式对话前端

一个基于 **Next.js** 的流式对话页面，前端只负责展示，所有与 Coze 的通信都由**服务端代理**完成。
项目可在 **阿里云边缘安全加速 ESA（函数和 Pages）** 上以 Serverless 形式一键部署。

---

## 你的 4 个需求是怎么被满足的

| 需求 | 实现方式 |
| --- | --- |
| **1. 解决 CORS 跨域** | 浏览器**不直接**请求 Coze，而是请求同源的 `/api/chat`。代理层（本地 Node / ESA 边缘函数）负责转发到 Coze，跨域问题在架构层面消失。 |
| **2. Token 不明文进前端** | `COZE_TOKEN_1..4`（分片）只存在于**服务端环境变量**。前端代码里没有任何令牌字符串；本地读 `.env.local`，生产读 ESA 函数环境变量 / GitHub 仓库密钥。`.env.local` 已被 `.gitignore` 忽略，**绝不会进仓库**。 |
| **3. 限制访问域名为 ai.alfedu.com** | 代理在处理请求时校验 `Host` / `X-Forwarded-Host` 头，只有命中白名单（`ALLOWED_HOST`）才放行，否则返回 `403`。 |
| **4. ESA Serverless 部署** | 仓库导入 ESA「函数和 Pages」即可：Next.js 导出为静态站（`out/`）由 ESA Pages 托管，代理作为 ESA 边缘函数（`src/index.ts`）绑定到 `/api/chat`。 |

---

## 目录结构

```
coze-chat/
├── app/                  # Next.js 前端（导出为静态站）
│   ├── layout.tsx
│   ├── globals.css
│   └── page.tsx          # 流式对话聊天页
├── lib/
│   └── cozeProxy.mjs     # 代理核心逻辑（本地 Node 服务复用）
├── src/
│   └── index.ts          # ESA 边缘函数（自包含，fetch 处理器）
├── server.mjs            # 本地开发服务器（静态托管 + /api/chat 代理）
├── esa.jsonc             # ESA 构建/函数配置
├── next.config.mjs       # output: 'export' 静态导出
├── .env.local.example    # 环境变量模板
└── README.md
```

---

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量（复制模板后填入你的 Coze 令牌）
cp .env.local.example .env.local
#   编辑 .env.local，把 COZE_TOKEN 换成真实令牌

# 3. 构建静态站
npm run build

# 4. 启动本地服务（同时托管 UI 和代理，默认 http://localhost:3000）
npm run serve
```

> 本地未设置 `ALLOWED_HOST` 时不限制域名，方便调试。生产环境务必配置。

开发时若只想改 UI（不需要真实代理），可直接 `npm run dev`（Next 热更新），但此时 `/api/chat` 不可用，需 `npm run serve` 才能走完整链路。

---

## Token 安全管理（关键）

**令牌永远不要写进前端代码或提交到仓库。**

> ⚠️ **ESA 单条环境变量 Value 上限 200 字符**，而 Coze Bearer 令牌约 739 字符，
> 直接粘贴会超限报错。因此把令牌**按 200 字符分片**成 `COZE_TOKEN_1` / `_2` / `_3` / `_4`，
> 代理在运行时自动按顺序拼接还原，**分片本身不含完整令牌，更安全**。

1. **本地**：在 `.env.local` 填入 4 个分片（`COZE_TOKEN_1..4`），或本地直接用单行 `COZE_TOKEN=完整令牌`（本地无 200 字符限制）。`.env.local` 已被 `.gitignore` 忽略。
2. **GitHub 仓库密钥（作为来源）**：  
   打开仓库 `Settings → Secrets and variables → Actions → New repository secret`，
   新增 `COZE_TOKEN_1` / `COZE_TOKEN_2` / `COZE_TOKEN_3` / `COZE_TOKEN_4` 四个密钥（值分别为对应分片）。
3. **ESA 运行时环境变量（实际生效位置）**：  
   在 ESA 控制台给函数依次配置 `COZE_TOKEN_1`~`_4`（从上面分片取值填入），
   以及 `ALLOWED_HOST=ai.alfedu.com`。 ESA 导入 GitHub 仓库部署时，函数运行时会读取这些环境变量并拼接还原令牌。

> 说明：ESA 通过「导入 GitHub 仓库」构建时，运行时环境变量在 **ESA 控制台的函数环境变量**中配置；GitHub 仓库 Secrets 是你统一管理密钥分片的源头，二者保持同步即可。

---

## 部署到阿里云 ESA（函数和 Pages）

1. 登录阿里云控制台 → **边缘安全加速 ESA** → 左侧 **边缘计算和 AI → 函数和 Pages**。
2. 点击 **创建** → 选择 **导入 Github 仓库** → 授权并选择本仓库 `coze-chat`，分支 `main`。
3. 填写构建信息（也可直接用仓库内的 `esa.jsonc`）：
   - 安装命令：`npm install`
   - 构建命令：`npm run build`
   - 静态资源目录：`./out`
   - 函数文件路径：`./src/index.ts`
   - Node.js 版本：18 或 20
4. 在函数的 **环境变量** 中配置（注意 ESA 单变量上限 200 字符，令牌需分片）：
   - `COZE_TOKEN_1` = 令牌第 1 片（≤200 字符）
   - `COZE_TOKEN_2` = 令牌第 2 片
   - `COZE_TOKEN_3` = 令牌第 3 片
   - `COZE_TOKEN_4` = 令牌第 4 片
   - `ALLOWED_HOST` = `ai.alfedu.com`
5. 点击 **开始部署**。
6. 部署完成后，进入函数 **域名** 配置：
   - 将自定义域名 **ai.alfedu.com** 绑定到本项目（按提示添加 CNAME / 证书）。
   - 将**函数路由**绑定到 `/api/chat`（或 `/api/*`），其余路径由静态站托管。

部署成功后：
- 网站：`https://ai.alfedu.com`
- 代理：`https://ai.alfedu.com/api/chat`（仅允许来自 `ai.alfedu.com` 的请求）

---

## 如何定制

- **机器人名称 / 简介**：改 `app/page.tsx` 顶部的 `BOT_NAME`、`BOT_DESC`。
- **Coze 接口 / 项目 ID**：改 `src/index.ts` 与 `lib/cozeProxy.mjs` 顶部的常量。
- **默认会话 ID**：同上两处 `DEFAULT_SESSION_ID`（线上每个浏览器会自动生成独立 session）。
- **配色**：改 `app/globals.css` 的 `:root` 变量。

---

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 页面能开，但发消息 403 | 请求域名不在 `ALLOWED_HOST` | 检查 ESA 环境变量 `ALLOWED_HOST` 是否为 `ai.alfedu.com` |
| 发消息 500「COZE_TOKEN missing」 | 未配置令牌分片环境变量 | 在 ESA 函数环境变量中配置 `COZE_TOKEN_1`~`_4`（4 片需齐全） |
| 回复为空 / 解析异常 | Coze 返回格式与解析规则不符 | 在 `app/page.tsx` 的 `extractText` 中按实际 `data` 结构补充字段路径 |
| 本地 `npm run serve` 无响应 | 未先 `npm run build` | 先构建生成 `out/` 目录 |
