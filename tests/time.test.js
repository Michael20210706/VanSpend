// lib/time.js: 数据库 UTC 字符串 → 查看者本地时间。TZ 在运行时切换(V8 会随 process.env.TZ 重新读取)
import { describe, it, expect, afterEach } from 'vitest';
import { formatDateTime, parseDbTime, utcTitle } from '@/lib/time.js';

const origTZ = process.env.TZ;
afterEach(() => { if (origTZ === undefined) delete process.env.TZ; else process.env.TZ = origTZ; });

describe('formatDateTime', () => {
  it('固定偏移的时区(不依赖时区库版本): Etc/GMT+8 是 UTC-8，Etc/GMT+7 是 UTC-7', () => {
    process.env.TZ = 'Etc/GMT+8';
    expect(formatDateTime('2026-11-10 03:15:42')).toBe('2026-11-09 19:15');
    process.env.TZ = 'Etc/GMT+7';
    expect(formatDateTime('2026-11-10 03:15:42')).toBe('2026-11-09 20:15');
  });
  it('有夏令时的时区: America/New_York 冬 -5、夏 -4(温哥华的夏令时规则在不同版本的时区库里不一致，所以不用它做断言)', () => {
    process.env.TZ = 'America/New_York';
    expect(formatDateTime('2026-01-10 03:15:42')).toBe('2026-01-09 22:15');
    expect(formatDateTime('2026-07-10 03:15:42')).toBe('2026-07-09 23:15');
  });
  it('TZ=UTC: 原样(去掉秒)', () => {
    process.env.TZ = 'UTC';
    expect(formatDateTime('2026-11-10 03:15:42')).toBe('2026-11-10 03:15');
  });
  it('TZ=Asia/Shanghai: +8，跨日', () => {
    process.env.TZ = 'Asia/Shanghai';
    expect(formatDateTime('2026-11-10 20:00:00')).toBe('2026-11-11 04:00');
  });
  it('空值显示 —，无法解析的原样返回', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not a date')).toBe('not a date');
  });
  it('parseDbTime 与 utcTitle', () => {
    expect(parseDbTime('2026-11-10 03:15:42').toISOString()).toBe('2026-11-10T03:15:42.000Z');
    expect(parseDbTime('2026-13-45 99:99:99')).toBeNull();
    expect(utcTitle('2026-11-10 03:15:42')).toBe('2026-11-10 03:15:42 UTC');
    expect(utcTitle(null)).toBeUndefined();
  });
});
