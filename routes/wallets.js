const express  = require('express');
const router   = express.Router();
const cache    = require('../lib/cache');
const helius   = require('../lib/helius');
const birdeye  = require('../lib/birdeye');
const { KNOWN_WALLETS, getWalletInfo, addWallet, ALL_ADDRESSES } = require('../lib/wallets');

// ─── GET /api/wallets/leaderboard ─────────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const cacheKey = 'leaderboard';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Fetch PnL for all known wallets in parallel
    const results = await Promise.allSettled(
      KNOWN_WALLETS.map(async (w) => {
        try {
          const pnl = await birdeye.getWalletPnL(w.address);
          return {
            address: w.address,
            label: w.label,
            tag: w.tag,
            roi: pnl?.pnlPercent || 0,
            pnl: pnl?.pnl || 0,
            winRate: pnl?.winRate || 0,
            volume: pnl?.volume || 0,
            totalTrades: pnl?.totalTrades || 0,
            solscanUrl: `https://solscan.io/account/${w.address}`
          };
        } catch {
          return { address: w.address, label: w.label, tag: w.tag, roi: 0, pnl: 0, winRate: 0, volume: 0 };
        }
      })
    );

    const leaderboard = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value)
      .sort((a, b) => b.roi - a.roi);

    cache.set(cacheKey, leaderboard, 120);
    res.json(leaderboard);
  } catch (err) {
    console.error('Leaderboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallets/known ───────────────────────────────────────────────────
router.get('/known', (req, res) => {
  res.json(KNOWN_WALLETS.map(w => ({
    address: w.address,
    label: w.label,
    tag: w.tag,
    solscanUrl: `https://solscan.io/account/${w.address}`
  })));
});

// ─── POST /api/wallets/add ────────────────────────────────────────────────────
router.post('/add', (req, res) => {
  const { address, label, tag } = req.body;
  if (!address || address.length < 32) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  addWallet(address, label || 'Custom Wallet', tag || 'custom');
  res.json({ success: true, address, label, tag });
});

// ─── GET /api/wallets/:address/portfolio ──────────────────────────────────────
router.get('/:address/portfolio', async (req, res) => {
  try {
    const { address } = req.params;
    const cacheKey = `portfolio_${address}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const [tokens, pnl] = await Promise.allSettled([
      birdeye.getWalletPortfolio(address),
      birdeye.getWalletPnL(address)
    ]);

    const result = {
      address,
      walletInfo: getWalletInfo(address),
      tokens: tokens.status === 'fulfilled' ? tokens.value : [],
      pnl: pnl.status === 'fulfilled' ? pnl.value : null,
      solscanUrl: `https://solscan.io/account/${address}`
    };

    cache.set(cacheKey, result, 60);
    res.json(result);
  } catch (err) {
    console.error('Portfolio error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallets/:address/trades ─────────────────────────────────────────
router.get('/:address/trades', async (req, res) => {
  try {
    const { address } = req.params;
    const cacheKey = `trades_${address}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const txs = await helius.getWalletTransactions(address, 50);
    const walletInfo = getWalletInfo(address);
    const swaps = txs.map(tx => helius.parseSwap(tx, address, walletInfo?.label)).filter(Boolean);

    cache.set(cacheKey, swaps, 30);
    res.json(swaps);
  } catch (err) {
    console.error('Wallet trades error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/wallets/dna - detect coordinated wallets ───────────────────────
router.get('/dna', async (req, res) => {
  try {
    const cacheKey = 'wallet_dna';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Get recent txs for all wallets
    const allTxs = await helius.getTransactionsByAddresses(ALL_ADDRESSES, 20);
    const swaps = allTxs
      .map(tx => helius.parseSwap(tx, tx._wallet))
      .filter(tx => tx && tx.tokenMint);

    // Group by token — find tokens bought by 2+ wallets within 30 minutes
    const tokenBuyers = {};
    swaps.forEach(tx => {
      if (tx.type !== 'buy') return;
      if (!tokenBuyers[tx.tokenMint]) tokenBuyers[tx.tokenMint] = [];
      tokenBuyers[tx.tokenMint].push({ wallet: tx.wallet, timestamp: tx.timestamp, amount: tx.amountUSD });
    });

    const clusters = [];
    Object.entries(tokenBuyers).forEach(([mint, buyers]) => {
      if (buyers.length < 2) return;

      // Check if buys happened within 30 min of each other
      buyers.sort((a, b) => a.timestamp - b.timestamp);
      const first = buyers[0].timestamp;
      const last  = buyers[buyers.length - 1].timestamp;
      const windowMs = 30 * 60 * 1000;

      if (last - first <= windowMs) {
        clusters.push({
          tokenMint: mint,
          wallets: buyers.map(b => ({
            address: b.wallet,
            ...getWalletInfo(b.wallet),
            amountUSD: b.amount,
            timestamp: b.timestamp
          })),
          syncWindow: Math.round((last - first) / 60000) + ' minutes',
          syncRate: Math.round((1 - (last - first) / windowMs) * 100) + '%',
          type: buyers.some(b => getWalletInfo(b.wallet)?.tag === 'insider') ? 'Insider Ring' : 'Coordinated Buy',
          risk: buyers.length >= 3 ? 'High' : 'Medium',
          dexscreenerUrl: `https://dexscreener.com/solana/${mint}`
        });
      }
    });

    cache.set(cacheKey, clusters, 60);
    res.json(clusters);
  } catch (err) {
    console.error('DNA error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
