// next/headers cookies() 的最小替身: iron-session 只用到 get/set/delete
const store = new Map();

export const jar = {
  get(name) {
    return store.has(name) ? { name, value: store.get(name) } : undefined;
  },
  getAll() {
    return [...store].map(([name, value]) => ({ name, value }));
  },
  has(name) {
    return store.has(name);
  },
  set(nameOrObj, value, options) {
    const c = typeof nameOrObj === 'object' ? nameOrObj : { name: nameOrObj, value, ...options };
    // maxAge 为 0 或负数即表示删除(iron-session destroy() 的写法)
    if (c.maxAge !== undefined && c.maxAge <= 0) store.delete(c.name);
    else store.set(c.name, c.value);
  },
  delete(name) {
    store.delete(typeof name === 'object' ? name.name : name);
  },
  clear() {
    store.clear();
  },
};
