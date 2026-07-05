const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const axios   = require('axios');

const CACHE_KEY = 'new_listings';
const CACHE_TTL = 30;

function calcALT(t) {
  let s = 0;
  if (t.insiderCount > 0) s += 20;
  if (t.liquidity > 500000) s += 15;
  else if (t.liquidity > 100000) s += 10;
  else if (t.liquidity > 20000) s += 5;
  if (t.mintRevoked) s += 15;
  if (t.freezeRevoked) s += 10;
  const mc = t.marketCap || 0;
  if (mc > 0 && mc < 5000000) s += 15;
  else if (mc < 20000000) s += 8;
  return Math.min(100, s);
}

function altGrade(score) {
  if (score >= 80) return { g: 'S', color: '#ffd700', label: '🔥 10x-100x Potential' };
  if (score >= 65) return { g: 'A', color: '#14F195', label: '⚡ High Potential' };
  if (score >= 50) return { g: 'B', color: '#4da8ff', label: '💎 Good Potential' };
  if (score >= 35) return { g: 'C', color: '#ffb340', label: '🔶 Moderate' };
  return { g: 'D', color: '#ff3d5a', label: '⚠ Low / Risky' };
}

router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    // Use DexScreener - free, no API key needed
    const { data } = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1', {
      headers: { 'User-Agent': 'SolanaIntel/1.0' }
    });

    const items = Array.isArray(data) ? data : [];
    const solana = items.filter(t => t.chainId === 'solana').slice(0, 30);

    const result = await Promise.allSettled(solana.map(async (item) => {
      try {
        // Get pair data from DexScreener
        const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${item.tokenAddress}`, {
          headers: { 'User-Agent': 'SolanaIntel/1.0' }
        });
        const pairs = pairRes.data?.pairs || [];
        const pair = pairs[0] || {};

        const price = parseFloat(pair.priceUsd || 0);
        const mc = parseFloat(pair.marketCap || pair.fdv || 0);
        const liq = parseFloat(pair.liquidity?.usd || 0);
        const vol24h = parseFloat(pair.volume?.h24 || 0);
        const ch = parseFloat(pair.priceChange?.h24 || 0);
        const holders = 0;
        const mintRevoked = false;
        const freezeRevoked = false;
        const insiderCount = 0;
        const listedAt = pair.pairCreatedAt || Date.now();
        const dex = pair.dexId || 'raydium';

        const altScore = calcALT({ insiderCount, liquidity: liq, mintRevoked, freezeRevoked, marketCap: mc });
        const grade = altGrade(altScore);

        return {
          mint: item.tokenAddress,
          symbol: item.symbol || pair.baseToken?.symbol || '???',
          name: item.description || pair.baseToken?.name || '???',
          price, marketCap: mc, liquidity: liq, volume24h,
          priceChange24h: ch, holders, holderGrowthRate: 0,
          mintRevoked, freezeRevoked, insiderCount, smartMoneyBuys: 0,
          listedAt, dex, altScore, altGrade: grade,
          icon: item.icon || null,
          solscanUrl: `https://solscan.io/token/${item.tokenAddress}`,
          dexscreenerUrl: `https://dexscreener.com/solana/${item.tokenAddress}`
        };
      } catch { return null; }
    }));

    const final = result.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    cache.set(CACHE_KEY, final, CACHE_TTL);
    res.json(final);
  } catch (err) {
    console.error('New listings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/alt-picks', async (req, res) => {
  const cached = cache.get(CACHE_KEY) || [];
  res.json(cached.filter(t => t.altScore >= 50).sort((a, b) => b.altScore - a.altScore));
});

module.exports = router;