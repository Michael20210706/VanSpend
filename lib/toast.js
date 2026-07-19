let listener = null;

export function setToastListener(fn) {
  listener = fn;
}

export function showToast(msg) {
  if (listener) listener(msg);
}
