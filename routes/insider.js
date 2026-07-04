const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const helius  = require('../lib/helius');
const birdeye = require('../lib/birdeye');
const { KNOWN_WALLETS, INSIDER_ADDRESSES, SMART_ADDRESSES, getWalletInfo } = require('../lib/wallets');

const CACHE_KEY   = 'insider_trades';
const CACHE_TTL   = 20; // seconds

// ─── Calculate insider signal strength ───────────────────────────────────────
function signalStrength(tx, priceChangeAfter) {
  let score = 0;
  if (priceChangeAfter > 100) score += 2;
  if (priceChangeAfter > 300) score += 1;
  if (tx.amountUSD > 10000)   score += 1;
  if (tx.amountUSD > 50000)   score += 1;
  return Math.min(5, Math.max(1, score));
}

// ─── Build signal tags ────────────────────────────────────────────────────────
function buildSignalTags(tx, walletInfo, allTxsForToken) {
  const tags = [];
  const others = allTxsForToken.filter(t => t.wallet !== tx.wallet);
  if (others.length > 0)  tags.push('Multi-wallet sync');
  if (tx.amountUSD < 5000) tags.push('Low-cap entry');
  if (walletInfo?.tag === 'insider') tags.push('Known insider wallet');
  if (walletInfo?.tag === 'smart')   tags.push('Smart money');
  tags.push('Early accumulation');
  return tags.slice(0, 4);
}

// ─── GET /api/insider-trades ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    // Fetch recent transactions from all insider + smart wallets
    const addresses = [...INSIDER_ADDRESSES, ...SMART_ADDRESSES];
    const rawTxs = await helius.getTransactionsByAddresses(addresses, 25);

    // Filter to only buys (swaps where they acquired a token)
    const swaps = rawTxs
      .map(tx => {
        const walletInfo = getWalletInfo(tx._wallet);
        return helius.parseSwap(tx, tx._wallet, walletInfo?.label);
      })
      .filter(tx => tx && tx.type === 'buy' && tx.amountUSD > (process.env.INSIDER_THRESHOLD_USD || 1000));

    // Deduplicate by signature
    const seen = new Set();
    const unique = swaps.filter(tx => {
      if (seen.has(tx.signature)) return false;
      seen.add(tx.signature);
      return true;
    });

    // Enrich with current token price to calculate gain since entry
    const mints = [...new Set(unique.map(tx => tx.tokenMint).filter(Boolean))];
    let priceMap = {};
    if (mints.length > 0) {
      try {
        priceMap = await birdeye.getMultiTokenPrice(mints);
      } catch (e) {
        console.error('Price fetch failed:', e.message);
      }
    }

    const result = unique.map(tx => {
      const walletInfo = getWalletInfo(tx.wallet);
      const currentData = priceMap[tx.tokenMint];
      const currentPrice = currentData?.value || null;
      const priceChangeAfter = currentData?.priceChange24h || 0;

      const allTxsForToken = unique.filter(t => t.tokenMint === tx.tokenMint);

      return {
        wallet: tx.wallet,
        walletLabel: walletInfo?.label || 'Unknown',
        walletTag: walletInfo?.tag || 'unknown',
        tokenMint: tx.tokenMint,
        tokenSymbol: tx.tokenSymbol,
        amountUSD: tx.amountUSD,
        currentPrice,
        priceChange24h: priceChangeAfter,
        timestamp: tx.timestamp,
        signature: tx.signature,
        dex: tx.dex,
        solscanUrl: tx.solscanUrl,
        signalStrength: signalStrength(tx, priceChangeAfter),
        signalTags: buildSignalTags(tx, walletInfo, allTxsForToken),
        solscanWallet: `https://solscan.io/account/${tx.wallet}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${tx.tokenMint}`
      };
    });

    // Sort by most recent first
    result.sort((a, b) => b.timestamp - a.timestamp);

    cache.set(CACHE_KEY, result, CACHE_TTL);
    res.json(result);

  } catch (err) {
    console.error('Insider trades error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/insider-trades/wallet/:address ──────────────────────────────────
router.get('/wallet/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const cacheKey = `insider_wallet_${address}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const txs = await helius.getWalletTransactions(address, 50);
    const walletInfo = getWalletInfo(address);

    const swaps = txs
      .map(tx => helius.parseSwap(tx, address, walletInfo?.label))
      .filter(Boolean);

    cache.set(cacheKey, swaps, 60);
    res.json(swaps);
  } catch (err) {
    console.error('Wallet trades error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
