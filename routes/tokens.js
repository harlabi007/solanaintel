const express  = require('express');
const router   = express.Router();
const cache    = require('../lib/cache');
const axios    = require('axios');
const { INSIDER_ADDRESSES, SMART_ADDRESSES } = require('../lib/wallets');

const headers = () => ({
  'X-API-KEY': process.env.BIRDEYE_API_KEY,
  'x-chain': 'solana'
});

// ─── GET /api/tokens/trending ─────────────────────────────────
router.get('/trending', async (req, res) => {
  try {
    const cached = cache.get('trending');
    if (cached) return res.json(cached);

    const { data } = await axios.get(
      'https://public-api.birdeye.so/defi/token_trending',
      {
        headers: headers(),
        params: { sort_by: 'rank', sort_type: 'asc', offset: 0, limit: 20 },
        timeout: 15000
      }
    );

    const items = data?.data?.tokens || data?.data?.items || [];
    const result = items.map(t => ({
      mint: t.address,
      symbol: t.symbol || '???',
      name: t.name || t.symbol || '???',
      price: t.price || 0,
      priceChange24h: t.priceChange24hPercent || 0,
      volume24h: t.v24hUSD || 0,
      marketCap: t.marketCap || t.mc || 0,
      liquidity: t.liquidity || 0,
      holders: t.holder || 0,
      solscanUrl: `https://solscan.io/token/${t.address}`,
      dexscreenerUrl: `https://dexscreener.com/solana/${t.address}`
    }));

    cache.set('trending', result, 60);
    console.log(`Trending: ${result.length} tokens`);
    res.json(result);
  } catch (err) {
    console.error('Trending error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/search ───────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const { data } = await axios.get(
      'https://public-api.birdeye.so/defi/v3/search',
      {
        headers: headers(),
        params: { chain: 'solana', keyword: q, target: 'token', sort_by: 'volume_24h_usd', sort_type: 'desc', offset: 0, limit: 10 },
        timeout: 10000
      }
    );
    res.json(data?.data?.tokens?.items || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/:mint/analyze ───────────────────────────
router.get('/:mint/analyze', async (req, res) => {
  try {
    const { mint } = req.params;
    const cacheKey = `analyze_${mint}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [overviewRes, securityRes, holdersRes] = await Promise.allSettled([
      axios.get('https://public-api.birdeye.so/defi/token_overview', { headers: headers(), params: { address: mint }, timeout: 10000 }),
      axios.get('https://public-api.birdeye.so/defi/token_security', { headers: headers(), params: { address: mint }, timeout: 10000 }),
      axios.get('https://public-api.birdeye.so/defi/v3/token/holder', { headers: headers(), params: { address: mint, offset: 0, limit: 20 }, timeout: 10000 })
    ]);

    const ov  = overviewRes.status === 'fulfilled' ? overviewRes.value.data?.data : null;
    const sec = securityRes.status === 'fulfilled' ? securityRes.value.data?.data : null;
    const hld = holdersRes.status === 'fulfilled' ? holdersRes.value.data?.data?.items || [] : [];

    const holderAddresses = hld.map(h => h.owner);
    const insiderHolders  = INSIDER_ADDRESSES.filter(a => holderAddresses.includes(a)).length;
    const smartHolders    = SMART_ADDRESSES.filter(a => holderAddresses.includes(a)).length;

    const mintRevoked   = sec ? !sec.mintAuthority : false;
    const freezeRevoked = sec ? !sec.freezeAuthority : false;
    const top10Pct      = hld.slice(0,10).reduce((s,h) => s + (h.ui_amount / (ov?.supply||1) * 100), 0);

    let altScore = 0;
    if (insiderHolders > 0) altScore += 20;
    if (smartHolders > 0)   altScore += 15;
    if (mintRevoked)         altScore += 15;
    if (freezeRevoked)       altScore += 10;
    const mc = ov?.marketCap || ov?.mc || 0;
    if (mc > 0 && mc < 5000000)  altScore += 15;
    else if (mc < 20000000)      altScore += 8;
    altScore = Math.min(100, altScore);

    function grade(s) {
      if (s >= 80) return { g: 'S', c: '#ffd700', l: '🔥 10x-100x Potential' };
      if (s >= 65) return { g: 'A', c: '#14F195', l: '⚡ High Potential' };
      if (s >= 50) return { g: 'B', c: '#4da8ff', l: '💎 Good Potential' };
      if (s >= 35) return { g: 'C', c: '#ffb340', l: '🔶 Moderate' };
      return { g: 'D', c: '#ff3d5a', l: '⚠ Low / Risky' };
    }

    const trustScore = Math.min(100, (mintRevoked?20:0) + (freezeRevoked?15:0) + (top10Pct<30?25:top10Pct<50?15:0) + 20);

    const result = {
      mint,
      symbol: ov?.symbol || '???',
      name: ov?.name || '???',
      trustScore,
      altScore,
      altGrade: grade(altScore),
      mintRevoked,
      freezeRevoked,
      lpLocked: false,
      lpLockedPct: 0,
      honeypot: false,
      rugRisk: top10Pct > 60 ? 'HIGH' : top10Pct > 30 ? 'MEDIUM' : 'LOW',
      risks: [],
      topHolders: hld.slice(0,10).map(h => ({
        address: h.owner,
        pct: (h.ui_amount / (ov?.supply||1) * 100),
        isInsider: INSIDER_ADDRESSES.includes(h.owner),
        isSmart: SMART_ADDRESSES.includes(h.owner)
      })),
      top10Pct,
      devHoldingPct: 0,
      creator: sec?.creatorAddress || null,
      insiderHolders,
      smartMoneyHolders: smartHolders,
      price: ov?.price || 0,
      marketCap: mc,
      volume24h: ov?.v24hUSD || 0,
      liquidity: ov?.liquidity || 0,
      holders: ov?.holder || 0,
      priceChange24h: ov?.priceChange24hPercent || 0,
      auditStatus: 'Not audited',
      verified: false,
      solscanUrl: `https://solscan.io/token/${mint}`,
      dexscreenerUrl: `https://dexscreener.com/solana/${mint}`,
      rugcheckUrl: `https://rugcheck.xyz/tokens/${mint}`
    };

    cache.set(cacheKey, result, 120);
    res.json(result);
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/tokens/:mint/overview ──────────────────────────
router.get('/:mint/overview', async (req, res) => {
  try {
    const { mint } = req.params;
    const cached = cache.get(`ov_${mint}`);
    if (cached) return res.json(cached);
    const { data } = await axios.get('https://public-api.birdeye.so/defi/token_overview', { headers: headers(), params: { address: mint }, timeout: 10000 });
    cache.set(`ov_${mint}`, data?.data, 30);
    res.json(data?.data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;