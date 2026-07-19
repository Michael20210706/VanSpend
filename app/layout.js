import './globals.css';

export const metadata = {
  title: 'VanSpend · 小票扫描记账',
  description: '温哥华家庭小票精细化记账 · GST/PST 拆分',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
