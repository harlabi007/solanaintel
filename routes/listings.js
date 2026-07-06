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

    const now = Date.now();

    // Get latest boosted tokens on Solana from DexScreener
    const { data } = await axios.get(
      'https://api.dexscreener.com/token-boosts/latest/v1',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
    );

    const solana = (Array.isArray(data) ? data : [])
      .filter(p => p.chainId === 'solana' && p.tokenAddress)
      .slice(0, 20);

    const results = await Promise.allSettled(
      solana.map(async item => {
        try {
          const r = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${item.tokenAddress}`,
            { timeout: 5000 }
          );
          const pair = r.data?.pairs?.[0];
          if (!pair) return null;

          const price  = parseFloat(pair.priceUsd || 0);
          const mc     = parseFloat(pair.marketCap || pair.fdv || 0);
          const liq    = parseFloat(pair.liquidity?.usd || 0);
          const vol24h = parseFloat(pair.volume?.h24 || 0);
          const ch     = parseFloat(pair.priceChange?.h24 || 0);
          const altScore = calcALT(liq, mc, vol24h);

          return {
            mint: item.tokenAddress,
            symbol: pair.baseToken?.symbol || '???',
            name: pair.baseToken?.name || '???',
            price, priceChange24h: ch, marketCap: mc,
            liquidity: liq, volume24h, holders: 0, holderGrowthRate: 0,
            mintRevoked: false, freezeRevoked: false,
            insiderCount: 0, smartMoneyBuys: 0,
            listedAt: pair.pairCreatedAt || now,
            dex: pair.dexId || 'raydium',
            altScore, altGrade: altGrade(altScore),
            solscanUrl: `https://solscan.io/token/${item.tokenAddress}`,
            dexscreenerUrl: `https://dexscreener.com/solana/${item.tokenAddress}`
          };
        } catch {
          return null;
        }
      })
    );

    const final = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a, b) => b.listedAt - a.listedAt);

    console.log(`New listings: ${final.length} tokens`);
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