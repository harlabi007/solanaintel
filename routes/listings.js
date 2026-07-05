const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const axios   = require('axios');

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

    const { data } = await axios.get(
      'https://api.dexscreener.com/latest/dex/pairs/solana',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
    );

    const pairs = data?.pairs || [];
    const now = Date.now();

    const recent = pairs.filter(p => {
      const ageHours = (now - (p.pairCreatedAt || 0)) / 3600000;
      return ageHours < 48 && p.baseToken?.address;
    });

    const result = recent.slice(0, 30).map(pair => {
      const price  = parseFloat(pair.priceUsd || 0);
      const mc     = parseFloat(pair.marketCap || pair.fdv || 0);
      const liq    = parseFloat(pair.liquidity?.usd || 0);
      const vol24h = parseFloat(pair.volume?.h24 || 0);
      const ch     = parseFloat(pair.priceChange?.h24 || 0);
      const mint   = pair.baseToken?.address || '';
      const sym    = pair.baseToken?.symbol || '???';
      const altScore = calcALT(liq, mc, vol24h);
      const grade  = altGrade(altScore);

      return {
        mint, symbol: sym, name: pair.baseToken?.name || sym,
        price, priceChange24h: ch, marketCap: mc, liquidity: liq,
        volume24h, holders: 0, holderGrowthRate: 0,
        mintRevoked: false, freezeRevoked: false,
        insiderCount: 0, smartMoneyBuys: 0,
        listedAt: pair.pairCreatedAt || now,
        dex: pair.dexId || 'raydium',
        altScore, altGrade: grade,
        solscanUrl: `https://solscan.io/token/${mint}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${mint}`
      };
    }).sort((a, b) => b.listedAt - a.listedAt);

    console.log(`New listings: ${result.length} tokens`);
    cache.set(CACHE_KEY, result, CACHE_TTL);
    res.json(result);
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