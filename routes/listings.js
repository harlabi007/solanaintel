const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const birdeye = require('../lib/birdeye');
const rugcheck = require('../lib/rugcheck');
const helius  = require('../lib/helius');
const { INSIDER_ADDRESSES, SMART_ADDRESSES, ALL_ADDRESSES } = require('../lib/wallets');

const CACHE_KEY = 'new_listings';
const CACHE_TTL = 30;

// ─── ALT scoring ─────────────────────────────────────────────────────────────
function calcALTScore(token) {
  let score = 0;
  if (token.insiderCount > 2) score += 25;
  else if (token.insiderCount > 0) score += 15;
  if (token.holderGrowthRate > 50) score += 20;
  else if (token.holderGrowthRate > 20) score += 12;
  else if (token.holderGrowthRate > 5) score += 6;
  if (token.liquidity > 500000) score += 15;
  else if (token.liquidity > 100000) score += 10;
  else if (token.liquidity > 20000) score += 5;
  if (token.mintRevoked && token.freezeRevoked) score += 15;
  else if (token.mintRevoked || token.freezeRevoked) score += 7;
  if (token.smartMoneyBuys > 3) score += 15;
  else if (token.smartMoneyBuys > 0) score += 8;
  const mc = token.marketCap || 0;
  if (mc > 0 && mc < 5000000) score += 10;
  else if (mc < 20000000) score += 6;
  else if (mc < 100000000) score += 3;
  return Math.min(100, score);
}

function altGrade(score) {
  if (score >= 80) return { g: 'S', color: '#ffd700', label: '🔥 10x-100x Potential' };
  if (score >= 65) return { g: 'A', color: '#14F195', label: '⚡ High Potential' };
  if (score >= 50) return { g: 'B', color: '#4da8ff', label: '💎 Good Potential' };
  if (score >= 35) return { g: 'C', color: '#ffb340', label: '🔶 Moderate' };
  return { g: 'D', color: '#ff3d5a', label: '⚠ Low / Risky' };
}

// ─── Check how many known wallets hold a token ────────────────────────────────
async function countInsiderHolders(mintAddress) {
  try {
    const holders = await birdeye.getTokenHolders(mintAddress, 50);
    const holderAddresses = holders.map(h => h.owner);
    const insiderCount  = INSIDER_ADDRESSES.filter(a => holderAddresses.includes(a)).length;
    const smartCount    = SMART_ADDRESSES.filter(a => holderAddresses.includes(a)).length;
    return { insiderCount, smartMoneyBuys: smartCount };
  } catch {
    return { insiderCount: 0, smartMoneyBuys: 0 };
  }
}

// ─── GET /api/new-listings ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    // Fetch new listings from Birdeye
    const listings = await birdeye.getNewListings(50);

    // Enrich each listing in parallel (cap to 20 to avoid rate limits)
    const toEnrich = listings.slice(0, 20);
    const enriched = await Promise.allSettled(
      toEnrich.map(async (item) => {
        const mint = item.address;

        // Get token security from Birdeye
        let security = null;
        try { security = await birdeye.getTokenSecurity(mint); } catch {}

        // Count insider/smart money holders
        const { insiderCount, smartMoneyBuys } = await countInsiderHolders(mint);

        // Get overview for price/volume/MC
        let overview = null;
        try { overview = await birdeye.getTokenOverview(mint); } catch {}

        const liquidity   = overview?.liquidity || item.liquidity || 0;
        const marketCap   = overview?.marketCap || 0;
        const price       = overview?.price || item.price || 0;
        const volume24h   = overview?.v24hUSD || 0;
        const holders     = overview?.holder || 0;
        const priceChange = overview?.priceChange24hPercent || 0;
        const mintRevoked = security ? !security.mintAuthority : false;
        const freezeRevoked = security ? !security.freezeAuthority : false;
        const holderGrowthRate = overview?.uniqueWallet24h || 0;

        const altScore = calcALTScore({ insiderCount, smartMoneyBuys, holderGrowthRate, liquidity, mintRevoked, freezeRevoked, marketCap });
        const grade = altGrade(altScore);

        return {
          mint,
          symbol: item.symbol || '???',
          name: item.name || item.symbol || '???',
          price,
          priceChange24h: priceChange,
          marketCap,
          liquidity,
          volume24h,
          holders,
          holderGrowthRate,
          mintRevoked,
          freezeRevoked,
          insiderCount,
          smartMoneyBuys,
          listedAt: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
          dex: item.source || 'Raydium',
          altScore,
          altGrade: grade,
          solscanUrl: `https://solscan.io/token/${mint}`,
          dexscreenerUrl: `https://dexscreener.com/solana/${mint}`,
          birdeyeUrl: `https://birdeye.so/token/${mint}?chain=solana`
        };
      })
    );

    const result = enriched
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .sort((a, b) => b.listedAt - a.listedAt);

    cache.set(CACHE_KEY, result, CACHE_TTL);
    res.json(result);

  } catch (err) {
    console.error('New listings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/new-listings/alt-picks ─────────────────────────────────────────
router.get('/alt-picks', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    const listings = cached || [];
    const picks = listings
      .filter(t => t.altScore >= 50)
      .sort((a, b) => b.altScore - a.altScore);
    res.json(picks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
