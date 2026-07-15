#!/usr/bin/env node
// ============================================================
// prebuild.cjs —— ESA 构建前注入 Coze 令牌
//
// 阿里云 ESA「函数和 Pages」的"环境变量"只注入 process.env
//（仅 npm run build 构建阶段可用），不会传入边缘函数运行时
// 的 env 对象。因此本脚本在 Node.js 构建环境中读取分片令牌，
// 拼接为完整 token 后写入 src/.coze-token.mjs，供边缘函数
// 直接 import 使用。
//
// 用法：在 package.json 的 build 脚本中放在 next build 之前：
//   "build": "node scripts/prebuild.cjs && next build"
// ============================================================

const fs = require("fs");
const path = require("path");

function getShardedToken() {
  const parts = [];
  for (let i = 1; i <= 9; i++) {
    const val = process.env["COZE_TOKEN_" + i];
    if (val && val.trim()) {
      parts.push(val.trim());
    } else {
      break;
    }
  }
  if (parts.length > 0) return parts.join("");
  const full = process.env.COZE_TOKEN;
  if (full && full.trim()) return full.trim();
  return null;
}

const token = getShardedToken();
const outFile = path.join(__dirname, "..", "src", ".coze-token.mjs");

if (!token) {
  console.error(
    "[prebuild] ERROR: 未找到 COZE_TOKEN 或 COZE_TOKEN_1~N 环境变量。" +
      "\n  请在 ESA「函数和 Pages→基本信息→构建信息→环境变量」中配置令牌分片。"
  );
  fs.writeFileSync(
    outFile,
    '// 占位：未配置 COZE_TOKEN\nexport const COZE_TOKEN = "";\n'
  );
  process.exit(1);
}

fs.writeFileSync(
  outFile,
  `// 自动生成——由 scripts/prebuild.cjs 在构建时注入，请勿手动编辑或提交\n` +
    `export const COZE_TOKEN = ${JSON.stringify(token)};\n`
);

console.log(`[prebuild] OK: 令牌已写入 ${outFile} (${token.length} 字符)`);
