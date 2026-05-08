// ─────────────────────────────────────────────────────────
// 環境別設定。location.hostname で自動判定する。
//   - prod : socialgift.ginzasugiden.com（GitHub Pages 本番）
//   - dev  : localhost / 127.0.0.1 / file:// など、それ以外すべて
// ─────────────────────────────────────────────────────────

const PROD_CONFIG = {
  GAS_AUTH_URL: 'https://script.google.com/macros/s/AKfycbxzIr1GBlK706VxP6BXVBQDSbVyQF69rnI2DJvw2yxBP5ByulNdjMPjnVq1nhFXpucAqg/exec',
  ACCESS_TOKEN: 'sgift_tokyoflower_20260201'
};

// dev 環境（GAS / スプレッドシート）はまだ用意していない。
// 実値は後日のタスクで差し替える。プレースホルダのままだと
// ローカルでログインを実行しても通信は失敗する（=本番を叩く事故は起きない）。
const DEV_CONFIG = {
  GAS_AUTH_URL: '<SET_DEV_DEPLOY_URL>',
  ACCESS_TOKEN: '<SET_DEV_ACCESS_TOKEN>'
};

const APP_CONFIG = (() => {
  const isProd = location.hostname === 'socialgift.ginzasugiden.com';
  const base = isProd ? PROD_CONFIG : DEV_CONFIG;
  return { ...base, MODE: isProd ? 'prod' : 'dev' };
})();
