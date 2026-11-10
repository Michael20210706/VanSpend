// 安全响应头(公网部署)。CSP 里 script-src/style-src 需要 'unsafe-inline': Next.js(App Router)会内联水合用的脚本，
// React 也大量使用 style 属性；没有 nonce 方案(要改成全站动态渲染)，所以这里的 CSP 挡的是"加载外部脚本/外传数据/被嵌入"，
// 不是内联脚本注入。开发模式(next dev)需要 eval，不加 CSP。securityHeaders() 在被调用时才读 NODE_ENV，方便测试。
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(env = process.env.NODE_ENV) {
  const h = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // 只在 https 下生效(http 下浏览器忽略)；不加 includeSubDomains / preload，免得影响同域下的其他服务
    { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
  ];
  if (env === 'production') h.push({ key: 'Content-Security-Policy', value: CSP });
  return h;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default nextConfig;
