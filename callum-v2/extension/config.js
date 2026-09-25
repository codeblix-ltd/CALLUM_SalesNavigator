globalThis.CallumConfig = Object.freeze({
  validate(x) {
    const keys = ['profileHeading','actionScope','connect','more','pending','connected'];
    if (!x || typeof x !== 'object' || Array.isArray(x) || Object.keys(x).some(k => ![...keys,'labels','degree','waitMs'].includes(k))) throw new Error('CONFIG_INVALID');
    for (const key of keys) {
      if (!Array.isArray(x[key]) || x[key].length < 1 || x[key].length > 12 || x[key].some(s => typeof s !== 'string' || !s.length || s.length > 180 || /[{};\\]|:has\(|:contains\(|script|iframe|input\[type=.password/i.test(s))) throw new Error('CONFIG_INVALID');
    }
    if (!x.labels || typeof x.labels !== 'object' || Object.keys(x.labels).some(k => !['connect','more','pending','connected','send'].includes(k))) throw new Error('CONFIG_INVALID');
    for (const key of ['connect','more','pending','connected','send']) {
      if (!Array.isArray(x.labels[key]) || x.labels[key].length < 1 || x.labels[key].length > 12 || x.labels[key].some(s => typeof s !== 'string' || s.length < 2 || s.length > 40 || /[<>]/.test(s))) throw new Error('CONFIG_INVALID');
    }
    if (!Array.isArray(x.degree) || x.degree.length !== 3 || x.degree.some(s => typeof s !== 'string' || s.length > 24)) throw new Error('CONFIG_INVALID');
    if (!Number.isInteger(x.waitMs) || x.waitMs < 250 || x.waitMs > 10000) throw new Error('CONFIG_INVALID');
    return x;
  }
});
