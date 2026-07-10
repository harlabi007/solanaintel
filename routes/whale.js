const express = require('express');
const router  = express.Router();
const cache   = require('../lib/cache');
const axios   = require('axios');
const { ALL_ADDRESSES, getWalletInfo } = require('../lib/wallets');

router.get('/', async (req, res) => {
  try {
    const cached = cache.get('whale_alerts');
    if (cached) return res.json(cached);

    const results = [];
    for (const address of ALL_ADDRESSES.slice(0, 8)) {
      try {
        const { data } = await axios.get(
          `https://api.helius.xyz/v0/addresses/${address}/transactions`,
          { params: { 'api-key': process.env.HELIUS_API_KEY, limit: 10 }, timeout: 8000 }
        );
        if (!Array.isArray(data)) continue;
        const walletInfo = getWalletInfo(address);
        for (const tx of data) {
          const nativeAmt = (tx.nativeTransfers||[]).reduce((s,t)=>s+(t.amount||0),0)/1e9;
          const amountUSD = nativeAmt * (global.solPrice || 78);
          if (amountUSD < 50) continue;
          const tokenTransfers = tx.tokenTransfers || [];
          const token = tokenTransfers.find(t => t.mint !== 'So11111111111111111111111111111111111111112' && t.mint);
          results.push({
            wallet: address,
            walletLabel: walletInfo?.label || 'Unknown',
            walletTag: walletInfo?.tag || 'whale',
            tokenMint: token?.mint || '',
            tokenSymbol: token?.symbol || 'SOL',
            amountUSD,
            type: token ? (token.toUserAccount === address ? 'buy' : 'sell') : 'transfer',
            timestamp: (tx.timestamp||0)*1000,
            signature: tx.signature,
            dex: tx.source || 'Unknown',
            solscanUrl: `https://solscan.io/tx/${tx.signature}`,
            solscanWallet: `https://solscan.io/account/${address}`
          });
        }
      } catch(err) { console.error(`Whale ${address.slice(0,8)}: ${err.message}`); }
    }

    results.sort((a,b) => b.amountUSD - a.amountUSD);
    const seen = new Set();
    const unique = results.filter(t => { if(seen.has(t.signature)) return false; seen.add(t.signature); return true; });

    const summary = {
      totalEvents: unique.length,
      totalVolumeUSD: unique.reduce((s,t)=>s+t.amountUSD,0),
      biggestTradeUSD: unique[0]?.amountUSD || 0,
      buyCount: unique.filter(t=>t.type==='buy').length,
      sellCount: unique.filter(t=>t.type==='sell').length,
      trades: unique
    };

    cache.set('whale_alerts', summary, 20);
    res.json(summary);
  } catch(err) {
    console.error('Whale error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;