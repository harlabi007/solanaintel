const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const axios   = require('axios');
const { INSIDER_ADDRESSES, SMART_ADDRESSES, getWalletInfo } = require('../lib/wallets');

const CACHE_KEY = 'insider_trades';
const CACHE_TTL = 30;

router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    const results = [];
    const addresses = [...INSIDER_ADDRESSES, ...SMART_ADDRESSES].slice(0, 10);

    for (const address of addresses) {
      try {
        const { data } = await axios.get(
          `https://api.helius.xyz/v0/addresses/${address}/transactions`,
          { params: { 'api-key': process.env.HELIUS_API_KEY, limit: 15 }, timeout: 8000 }
        );

        if (!Array.isArray(data)) continue;
        const walletInfo = getWalletInfo(address);

        for (const tx of data) {
          const nativeAmt = (tx.nativeTransfers || []).reduce((s, t) => s + (t.amount || 0), 0) / 1e9;
          const amountUSD = nativeAmt * (global.solPrice || 80);
          if (amountUSD < 500) continue;

          const tokenTransfers = tx.tokenTransfers || [];
          const mainToken = tokenTransfers.find(t =>
            t.mint !== 'So11111111111111111111111111111111111111112' && t.mint
          );
          const swap = tx.events?.swap;
          if (!mainToken && !swap) continue;

          const tokenMint = mainToken?.mint || swap?.tokenOutputs?.[0]?.mint || '';
          const tokenSymbol = mainToken?.symbol || '???';
          const isBuy = mainToken ? mainToken.toUserAccount === address : true;

          results.push({
            wallet: address,
            walletLabel: walletInfo?.label || 'Unknown',
            walletTag: walletInfo?.tag || 'smart',
            tokenMint, tokenSymbol, amountUSD,
            priceChange24h: 0,
            timestamp: (tx.timestamp || 0) * 1000,
            signature: tx.signature,
            type: isBuy ? 'buy' : 'sell',
            dex: tx.source || 'Unknown',
            signalStrength: walletInfo?.tag === 'insider' ? 5 : 3,
            signalTags: walletInfo?.tag === 'insider'
              ? ['Known insider wallet', 'Early accumulation']
              : ['Smart money', 'Tracked wallet'],
            solscanUrl: `https://solscan.io/tx/${tx.signature}`,
            solscanWallet: `https://solscan.io/account/${address}`,
            dexscreenerUrl: tokenMint ? `https://dexscreener.com/solana/${tokenMint}` : ''
          });
        }
      } catch (err) {
        console.error(`Wallet ${address.slice(0,8)}: ${err.message}`);
      }
    }

    const seen = new Set();
    const unique = results
      .filter(tx => { if (seen.has(tx.signature)) return false; seen.add(tx.signature); return true; })
      .sort((a, b) => b.timestamp - a.timestamp);

    console.log(`Insider trades: ${unique.length} transactions`);
    cache.set(CACHE_KEY, unique, CACHE_TTL);
    res.json(unique);
  } catch (err) {
    console.error('Insider trades error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/wallet/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { data } = await axios.get(
      `https://api.helius.xyz/v0/addresses/${address}/transactions`,
      { params: { 'api-key': process.env.HELIUS_API_KEY, limit: 50 }, timeout: 10000 }
    );
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;