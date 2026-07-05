const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const axios   = require('axios');
const { KNOWN_WALLETS, INSIDER_ADDRESSES, SMART_ADDRESSES, getWalletInfo } = require('../lib/wallets');

const CACHE_KEY = 'insider_trades';
const CACHE_TTL = 20;

router.get('/', async (req, res) => {
  try {
    const cached = cache.get(CACHE_KEY);
    if (cached) return res.json(cached);

    const addresses = [...INSIDER_ADDRESSES, ...SMART_ADDRESSES];
    const results = [];

    // Use Helius enhanced transactions API
    for (const address of addresses.slice(0, 8)) {
      try {
        const { data } = await axios.get(
          `https://api.helius.xyz/v0/addresses/${address}/transactions`,
          { params: { 'api-key': process.env.HELIUS_API_KEY, limit: 15 } }
        );

        if (!Array.isArray(data)) continue;

        for (const tx of data) {
          const swap = tx.events?.swap;
          if (!swap) continue;

          const tokenOut = swap.tokenOutputs?.[0];
          const tokenIn  = swap.tokenInputs?.[0];
          const isBuy    = tokenOut && tokenOut.mint !== 'So11111111111111111111111111111111111111112';
          const token    = isBuy ? tokenOut : tokenIn;
          if (!token) continue;

          const walletInfo = getWalletInfo(address);
          const amountSOL  = (tx.nativeTransfers||[]).reduce((s,t)=>s+(t.amount||0),0) / 1e9;
          const amountUSD  = amountSOL * (global.solPrice || 180);

          results.push({
            wallet:       address,
            walletLabel:  walletInfo?.label || 'Unknown',
            walletTag:    walletInfo?.tag || 'smart',
            tokenMint:    token.mint,
            tokenSymbol:  token.symbol || token.mint?.slice(0,6) || '???',
            amountUSD,
            priceChange24h: Math.random() * 200 - 20, // will be replaced with real price data
            timestamp:    (tx.timestamp || 0) * 1000,
            signature:    tx.signature,
            type:         isBuy ? 'buy' : 'sell',
            dex:          tx.source || 'Raydium',
            signalStrength: walletInfo?.tag === 'insider' ? 5 : 3,
            signalTags:   walletInfo?.tag === 'insider'
              ? ['Known insider wallet', 'Early accumulation']
              : ['Smart money', 'Tracked wallet'],
            solscanUrl:    `https://solscan.io/tx/${tx.signature}`,
            solscanWallet: `https://solscan.io/account/${address}`,
            dexscreenerUrl:`https://dexscreener.com/solana/${token.mint}`
          });
        }
      } catch (err) {
        console.error(`Wallet ${address.slice(0,8)} error:`, err.message);
      }
    }

    // Sort by most recent
    results.sort((a, b) => b.timestamp - a.timestamp);
    const unique = results.filter((tx, i, arr) =>
      arr.findIndex(t => t.signature === tx.signature) === i
    );

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
      { params: { 'api-key': process.env.HELIUS_API_KEY, limit: 50 } }
    );
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;