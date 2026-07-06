const express = require('express');
const router = express.Router();
const cache = require('../lib/cache');
const axios = require('axios');

const CACHE_KEY = 'new_listings';
const CACHE_TTL = 60;

function altGrade(score) {
  if (score >= 80) return { g: 'S', color: '#ffd700', label: '🔥 10x-100x Potential' };
  if (score >= 65) return { g: 'A', color: '#14F195', label: '⚡ High Potential' };
  if (score >= 50) return { g: 'B', color: '#4da8ff', label: '💎 Good Potential' };
  if (score >= 35) return { g: 'C', color: '#ffb340', label: '🔶 Moderate' };
  return { g: 'D', color: '#ff3d5a', label: '⚠ Low / Risky' };
}

function calcALT(liq, mc, vol) {
  let s = 0;
  if (liq > 500000) s += 20;
  else if (liq > 100000) s += 15;
  else if (liq > 20000) s += 8;
  if (mc > 0 && mc < 1000000) s += 25;
  else if (mc < 5000000) s += 15;
  else if (mc < 20000000) s += 8;
  if (vol > 100000) s += 15;
  else if (vol > 10000) s += 8;
  return Math.min(100, s);
}

router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    const now = Date.now();

    const { data } = await axios.get(
      'https://public-api.birdeye.so/defi/v2/tokens/new_listing',
      {
        headers: {
          'X-API-KEY': process.env.BIRDEYE_API_KEY,
          'x-chain': 'solana'
        },
        params: {
          limit: 20,
          meme_platform_enabled: true
        },
        timeout: 15000
      }
    );

    const items = data?.data?.items || [];
    console.log(`Birdeye returned ${items.length} new listings`);

    const result = items.map(item => {
      const liq = item.liquidity || 0;
      const mc = item.marketcap || item.mc || item.realMc || 0;
      const vol = item.v24hUSD || item.volume24hUSD || 0;
      const altScore = calcALT(liq, mc, vol);

      return {
        mint: item.address,
        symbol: item.symbol || '???',
        name: item.name || item.symbol || '???',
        price: item.price || 0,
        priceChange24h: item.priceChange24hPercent || 0,
        marketCap: mc,
        liquidity: liq,
        volume24h: vol,
        holders: item.holder || 0,
        holderGrowthRate: item.uniqueWallet24h || 0,
        mintRevoked: false,
        freezeRevoked: false,
        insiderCount: 0,
        smartMoneyBuys: 0,
        listedAt: item.listTime ? item.listTime * 1000 : now,
        dex: 'Raydium',
        altScore,
        altGrade: altGrade(altScore),
        solscanUrl: `https://solscan.io/token/${item.address}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${item.address}`
      };
    }).filter(t => t.mint).sort((a, b) => b.listedAt - a.listedAt);

    cache.set(CACHE_KEY, result, CACHE_TTL);
    res.json(result);

  } catch (err) {
    console.error('New listings error:', err.response?.status, err.response?.data || err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/alt-picks', async (req, res) => {
  const cached = cache.get(CACHE_KEY) || [];
  res.json(cached.filter(t => t.altScore >= 50).sort((a, b) => b.altScore - a.altScore));
});

module.exports = router;