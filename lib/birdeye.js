const axios = require('axios');

const BASE = 'https://public-api.birdeye.so';
const headers = () => ({
  'X-API-KEY': process.env.BIRDEYE_API_KEY,
  'x-chain': 'solana'
});

// ─── Get new token listings ──────────────────────────────────────────────────
async function getNewListings(limit = 50) {
  const { data } = await axios.get(`${BASE}/defi/v2/tokens/new_listing`, {
    headers: headers(),
    params: { limit, memeToken: false }
  });
  return data?.data?.items || [];
}

// ─── Get token overview (price, volume, MC, etc.) ───────────────────────────
async function getTokenOverview(mintAddress) {
  const { data } = await axios.get(`${BASE}/defi/token_overview`, {
    headers: headers(),
    params: { address: mintAddress }
  });
  return data?.data || null;
}

// ─── Get multiple token prices at once ───────────────────────────────────────
async function getMultiTokenPrice(mintAddresses) {
  const list = mintAddresses.join(',');
  const { data } = await axios.get(`${BASE}/defi/multi_price`, {
    headers: headers(),
    params: { list_address: list }
  });
  return data?.data || {};
}

// ─── Get trending tokens ─────────────────────────────────────────────────────
async function getTrendingTokens(limit = 20) {
  const { data } = await axios.get(`${BASE}/defi/token_trending`, {
    headers: headers(),
    params: { sort_by: 'rank', sort_type: 'asc', offset: 0, limit }
  });
  return data?.data?.items || [];
}

// ─── Get token holders ───────────────────────────────────────────────────────
async function getTokenHolders(mintAddress, limit = 20) {
  const { data } = await axios.get(`${BASE}/defi/v3/token/holder`, {
    headers: headers(),
    params: { address: mintAddress, offset: 0, limit }
  });
  return data?.data?.items || [];
}

// ─── Get OHLCV candles ───────────────────────────────────────────────────────
async function getOHLCV(mintAddress, type = '15m', limit = 48) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - (limit * 15 * 60);
  const { data } = await axios.get(`${BASE}/defi/ohlcv`, {
    headers: headers(),
    params: { address: mintAddress, type, time_from: from, time_to: now }
  });
  return data?.data?.items || [];
}

// ─── Get token security info (mint/freeze authority, top holders) ────────────
async function getTokenSecurity(mintAddress) {
  const { data } = await axios.get(`${BASE}/defi/token_security`, {
    headers: headers(),
    params: { address: mintAddress }
  });
  return data?.data || null;
}

// ─── Get wallet portfolio ─────────────────────────────────────────────────────
async function getWalletPortfolio(walletAddress) {
  const { data } = await axios.get(`${BASE}/v1/wallet/token_list`, {
    headers: headers(),
    params: { wallet: walletAddress }
  });
  return data?.data?.items || [];
}

// ─── Get wallet PnL ──────────────────────────────────────────────────────────
async function getWalletPnL(walletAddress) {
  const { data } = await axios.get(`${BASE}/v1/wallet/pnl`, {
    headers: headers(),
    params: { wallet: walletAddress }
  });
  return data?.data || null;
}

// ─── Search tokens ───────────────────────────────────────────────────────────
async function searchTokens(keyword, limit = 20) {
  const { data } = await axios.get(`${BASE}/defi/v3/search`, {
    headers: headers(),
    params: { chain: 'solana', keyword, target: 'token', sort_by: 'volume_24h_usd', sort_type: 'desc', offset: 0, limit }
  });
  return data?.data?.tokens?.items || [];
}

module.exports = {
  getNewListings,
  getTokenOverview,
  getMultiTokenPrice,
  getTrendingTokens,
  getTokenHolders,
  getOHLCV,
  getTokenSecurity,
  getWalletPortfolio,
  getWalletPnL,
  searchTokens
};
