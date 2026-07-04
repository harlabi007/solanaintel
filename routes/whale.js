const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const helius  = require('../lib/helius');
const { ALL_ADDRESSES, WHALE_ADDRESSES, getWalletInfo } = require('../lib/wallets');

const CACHE_KEY = 'whale_alerts';
const CACHE_TTL = 15;

// ─── GET /api/whale-alerts ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    const THRESHOLD = parseFloat(process.env.WHALE_THRESHOLD_USD) || 50000;

    // Fetch from all tracked wallets — whale alerts are any large transaction
    const rawTxs = await helius.getTransactionsByAddresses(ALL_ADDRESSES, 30);

    const alerts = rawTxs
      .map(tx => {
        const walletInfo = getWalletInfo(tx._wallet);
        return helius.parseSwap(tx, tx._wallet, walletInfo?.label);
      })
      .filter(tx => tx && tx.amountUSD >= THRESHOLD);

    // Deduplicate
    const seen = new Set();
    const unique = alerts.filter(tx => {
      if (seen.has(tx.signature)) return false;
      seen.add(tx.signature);
      return true;
    });

    // Enrich with wallet metadata
    const result = unique.map(tx => {
      const walletInfo = getWalletInfo(tx.wallet);
      return {
        ...tx,
        walletLabel: walletInfo?.label || 'Unknown Whale',
        walletTag: walletInfo?.tag || 'whale',
        isWhale: WHALE_ADDRESSES.includes(tx.wallet),
        solscanWallet: `https://solscan.io/account/${tx.wallet}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${tx.tokenMint}`
      };
    });

    result.sort((a, b) => b.amountUSD - a.amountUSD);

    const summary = {
      totalEvents: result.length,
      totalVolumeUSD: result.reduce((s, t) => s + t.amountUSD, 0),
      biggestTradeUSD: result[0]?.amountUSD || 0,
      buyCount: result.filter(t => t.type === 'buy').length,
      sellCount: result.filter(t => t.type === 'sell').length,
      trades: result
    };

    cache.set(CACHE_KEY, summary, CACHE_TTL);
    res.json(summary);

  } catch (err) {
    console.error('Whale alerts error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
