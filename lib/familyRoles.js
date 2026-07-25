// 家庭角色枚举，和 src/captcha.cjs 无关，纯前端展示用；后端合法值见 app/api/auth/register/route.js 的 FAMILY_ROLES
export const FAMILY_ROLES = [
  { value: '', label: '不选择' },
  { value: 'dad', label: '爸爸' },
  { value: 'mom', label: '妈妈' },
  { value: 'child', label: '孩子' },
  { value: 'other', label: '其他' },
];

export const FAMILY_ROLE_LABELS = { dad: '爸爸', mom: '妈妈', child: '孩子', other: '其他' };
