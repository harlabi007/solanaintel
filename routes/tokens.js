const express  = require('express');
const router   = express.Router();
const cache    = require('../lib/cache');
const birdeye  = require('../lib/birdeye');
const rugcheck = require('../lib/rugcheck');
const { INSIDER_ADDRESSES, SMART_ADDRESSES } = require('../lib/wallets');

// ─── GET /api/tokens/trending ─────────────────────────────────────────────────
router.get('/trending', async (req, res) => {
  try {
    const cached = cache.get('trending');
    if (cached) return res.json(cached);

    const tokens = await birdeye.getTrendingTokens(20);
    const result = tokens.map(t => ({
      mint: t.address,
      symbol: t.symbol,
      name: t.name,
      price: t.price,
      priceChange24h: t.priceChange24hPercent,
      volume24h: t.v24hUSD,
      marketCap: t.marketCap,
      liquidity: t.liquidity,
      holders: t.holder,
      logoURI: t.logoURI,
      solscanUrl: `https://solscan.io/token/${t.address}`,
      dexscreenerUrl: `https://dexscreener.com/solana/${t.address}`
    }));

    cache.set('trending', result, 60);
    res.json(result);
  } catch (err) {
    console.error('Trending error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/search?q=BONK ───────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const results = await birdeye.searchTokens(q, 20);
    res.json(results.map(t => ({
      mint: t.address,
      symbol: t.symbol,
      name: t.name,
      price: t.price,
      marketCap: t.marketCap,
      volume24h: t.volume24h
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/:mint/analyze ────────────────────────────────────────────
router.get('/:mint/analyze', async (req, res) => {
  try {
    const { mint } = req.params;
    const cacheKey = `analyze_${mint}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Run RugCheck + Birdeye in parallel
    const [rugReport, overview, security, holders] = await Promise.allSettled([
      rugcheck.getTokenReport(mint),
      birdeye.getTokenOverview(mint),
      birdeye.getTokenSecurity(mint),
      birdeye.getTokenHolders(mint, 20)
    ]);

    const rug = rugReport.status === 'fulfilled' ? rugcheck.parseReport(rugReport.value) : null;
    const ov  = overview.status === 'fulfilled' ? overview.value : null;
    const sec = security.status === 'fulfilled' ? security.value : null;
    const hld = holders.status === 'fulfilled' ? holders.value : [];

    // Count insider/smart money among holders
    const holderAddresses = hld.map(h => h.owner);
    const insiderCount    = INSIDER_ADDRESSES.filter(a => holderAddresses.includes(a)).length;
    const smartMoneyCount = SMART_ADDRESSES.filter(a => holderAddresses.includes(a)).length;

    // Merge data
    const mintRevoked   = rug?.mintRevoked   ?? (sec ? !sec.mintAuthority : null);
    const freezeRevoked = rug?.freezeRevoked ?? (sec ? !sec.freezeAuthority : null);
    const lpLocked      = rug?.lpLocked ?? false;

    const trustScore = rug?.trustScore ?? (mintRevoked && freezeRevoked && lpLocked ? 75 : 40);

    // ALT score
    const mc  = ov?.marketCap || 0;
    const liq = ov?.liquidity || rug?.markets?.[0]?.liquidity || 0;
    let altScore = 0;
    if (insiderCount > 0) altScore += 20;
    if (smartMoneyCount > 0) altScore += 15;
    if (mintRevoked) altScore += 15;
    if (freezeRevoked) altScore += 10;
    if (lpLocked) altScore += 10;
    if (mc > 0 && mc < 5000000) altScore += 15;
    else if (mc < 20000000) altScore += 8;
    if (liq > 100000) altScore += 10;
    altScore = Math.min(100, altScore);

    function grade(s) {
      if (s >= 80) return { g: 'S', c: '#ffd700', l: '🔥 10x-100x Potential' };
      if (s >= 65) return { g: 'A', c: '#14F195', l: '⚡ High Potential' };
      if (s >= 50) return { g: 'B', c: '#4da8ff', l: '💎 Good Potential' };
      if (s >= 35) return { g: 'C', c: '#ffb340', l: '🔶 Moderate' };
      return { g: 'D', c: '#ff3d5a', l: '⚠ Low / Risky' };
    }

    const result = {
      mint,
      symbol: rug?.symbol || ov?.symbol || '???',
      name: rug?.name || ov?.name || '???',
      trustScore,
      altScore,
      altGrade: grade(altScore),
      mintRevoked,
      freezeRevoked,
      lpLocked,
      lpLockedPct: rug?.lpLockedPct || 0,
      honeypot: rug?.honeypot || false,
      rugRisk: rug ? (rug.riskScore > 60 ? 'HIGH' : rug.riskScore > 35 ? 'MEDIUM' : 'LOW') : 'UNKNOWN',
      risks: rug?.risks || [],
      topHolders: (rug?.topHolders || hld.slice(0, 10)).map(h => ({
        address: h.address || h.owner,
        pct: h.pct || (h.amount / (ov?.supply || 1) * 100),
        isInsider: INSIDER_ADDRESSES.includes(h.address || h.owner),
        isSmart: SMART_ADDRESSES.includes(h.address || h.owner)
      })),
      top10Pct: rug?.top10Pct || 0,
      devHoldingPct: rug?.devHoldingPct || 0,
      creator: rug?.creator || null,
      insiderHolders: insiderCount,
      smartMoneyHolders: smartMoneyCount,
      price: ov?.price || 0,
      marketCap: mc,
      volume24h: ov?.v24hUSD || 0,
      liquidity: liq,
      holders: ov?.holder || 0,
      priceChange24h: ov?.priceChange24hPercent || 0,
      auditStatus: rug?.auditStatus || 'Not audited',
      verified: rug?.verified || false,
      markets: rug?.markets || [],
      solscanUrl: `https://solscan.io/token/${mint}`,
      dexscreenerUrl: `https://dexscreener.com/solana/${mint}`,
      rugcheckUrl: `https://rugcheck.xyz/tokens/${mint}`
    };

    cache.set(cacheKey, result, 120); // cache 2 min
    res.json(result);

  } catch (err) {
    console.error('Token analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/:mint/overview ──────────────────────────────────────────
router.get('/:mint/overview', async (req, res) => {
  try {
    const { mint } = req.params;
    const cacheKey = `overview_${mint}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);
    const data = await birdeye.getTokenOverview(mint);
    cache.set(cacheKey, data, 30);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/:mint/ohlcv ─────────────────────────────────────────────
router.get('/:mint/ohlcv', async (req, res) => {
  try {
    const { mint } = req.params;
    const { type = '15m' } = req.query;
    const data = await birdeye.getOHLCV(mint, type, 96);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
