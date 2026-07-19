import { NextResponse } from 'next/server';

// 统一错误响应，对应旧 Express 版本 server.js 里的 wrap()
export function wrap(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  };
}
