const axios = require('axios');

const BASE = 'https://api.helius.xyz/v0';
const RPC  = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
const KEY  = () => process.env.HELIUS_API_KEY;

// ─── Get recent transactions for a wallet ───────────────────────────────────
async function getWalletTransactions(address, limit = 50) {
  const { data } = await axios.get(`${BASE}/addresses/${address}/transactions`, {
    params: { 'api-key': KEY(), limit, type: 'SWAP' }
  });
  return data;
}

// ─── Get parsed transactions for multiple wallets ───────────────────────────
async function getTransactionsByAddresses(addresses, limit = 20) {
  const results = await Promise.allSettled(
    addresses.map(addr => getWalletTransactions(addr, limit))
  );
  const txs = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      r.value.forEach(tx => { tx._wallet = addresses[i]; txs.push(tx); });
    }
  });
  return txs.sort((a, b) => b.timestamp - a.timestamp);
}

// ─── Get token metadata ──────────────────────────────────────────────────────
async function getTokenMetadata(mintAddresses) {
  const { data } = await axios.post(`${BASE}/token-metadata?api-key=${KEY()}`, {
    mintAccounts: mintAddresses,
    includeOffChain: true,
    disableCache: false
  });
  return data;
}

// ─── Get account balances (SOL + SPL tokens) ────────────────────────────────
async function getBalances(address) {
  const { data } = await axios.get(`${BASE}/addresses/${address}/balances`, {
    params: { 'api-key': KEY() }
  });
  return data;
}

// ─── Get NFTs owned by wallet ────────────────────────────────────────────────
async function getNFTs(address) {
  const { data } = await axios.get(`${BASE}/addresses/${address}/nfts`, {
    params: { 'api-key': KEY() }
  });
  return data;
}

// ─── RPC call helper ─────────────────────────────────────────────────────────
async function rpcCall(method, params) {
  const { data } = await axios.post(RPC, {
    jsonrpc: '2.0', id: 1, method, params
  });
  if (data.error) throw new Error(data.error.message);
  return data.result;
}

// ─── Get SOL price via Helius RPC ────────────────────────────────────────────
async function getSOLPrice() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    return res.data?.solana?.usd || null;
  } catch {
    try {
      const res2 = await axios.get('https://price.jup.ag/v6/price?ids=SOL');
      return res2.data?.data?.SOL?.price || null;
    } catch {
      return null;
    }
  }
}

// ─── Parse a Helius swap transaction into clean format ───────────────────────
function parseSwap(tx, walletAddr, walletLabel) {
  try {
    const swap = tx.events?.swap;
    if (!swap) return null;

    const tokenIn  = swap.tokenInputs?.[0];
    const tokenOut = swap.tokenOutputs?.[0];
    if (!tokenIn && !tokenOut) return null;

    const isBuy = tokenOut && tokenOut.mint !== 'So11111111111111111111111111111111111111112';
    const token = isBuy ? tokenOut : tokenIn;
    const amountUSD = tx.nativeTransfers?.reduce((s, t) => s + (t.amount || 0), 0) / 1e9;

    return {
      signature: tx.signature,
      wallet: walletAddr,
      walletLabel: walletLabel || 'Unknown',
      type: isBuy ? 'buy' : 'sell',
      tokenMint: token?.mint,
      tokenSymbol: token?.symbol || '???',
      tokenAmount: token?.rawTokenAmount?.tokenAmount,
      amountUSD: amountUSD * (global.solPrice || 180),
      timestamp: tx.timestamp * 1000,
      slot: tx.slot,
      dex: tx.source || 'Unknown DEX',
      solscanUrl: `https://solscan.io/tx/${tx.signature}`
    };
  } catch {
    return null;
  }
}

module.exports = {
  getWalletTransactions,
  getTransactionsByAddresses,
  getTokenMetadata,
  getBalances,
  getNFTs,
  rpcCall,
  getSOLPrice,
  parseSwap
};
