import './globals.css';

export const metadata = {
  title: 'VanSpend · 小票扫描记账',
  description: '拍一下小票，商品、金额和 GST / PST 自动逐行读出来，核对后进入全家共用的账本。温哥华家庭自建部署。',
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
