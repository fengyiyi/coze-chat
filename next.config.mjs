/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESA 对 Next.js 采用静态导出 + 边缘函数模式：
  // 前端 UI 导出为纯静态资源（out/），由 ESA Pages 托管；
  // /api/chat 由 ESA 边缘函数（src/index.ts）处理，详见 README。
  output: "export",
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
  trailingSlash: false,
};

export default nextConfig;
