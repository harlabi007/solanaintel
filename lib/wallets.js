/**
 * Known wallet registry.
 *
 * These are publicly documented on-chain addresses associated with
 * known funds, smart money, or historically accurate insider activity.
 * Add more as you identify them by analyzing on-chain patterns.
 *
 * Sources: Nansen public labels, Solscan labels, community research.
 */

const KNOWN_WALLETS = [
  // ── Insider / Smart Money ──────────────────────────────────────────────────
  {
    address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    label: 'Insider Wallet #1',
    tag: 'insider',
    source: 'Community identified'
  },
  {
    address: '5tzFkiKscXHK5PFhBsRzr8YFPPWMiDEBKTa4H9pXFPLk',
    label: 'Insider Wallet #2',
    tag: 'insider',
    source: 'Community identified'
  },
  {
    address: '2C5oNQhSm1W9m67Hv81JqY5KeVYEFJGcfNPhkBD3QRVA',
    label: 'Insider Fund C',
    tag: 'insider',
    source: 'Community identified'
  },
  {
    address: '48CJZVjT3cApjDRWvYHRYL3r9Zb3Eo3KpAkxZjqKGmF',
    label: 'Insider Wallet #3',
    tag: 'insider',
    source: 'Community identified'
  },
  {
    address: '8NvtznYEKM1x1Nd8b9rHvivKrKBzp8aSsYBP5KsErwZD',
    label: 'Insider Wallet #5',
    tag: 'insider',
    source: 'Community identified'
  },

  // ── Smart Money ────────────────────────────────────────────────────────────
  {
    address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    label: 'Smart Money Alpha',
    tag: 'smart',
    source: 'Nansen'
  },
  {
    address: '3h1zGmCwsRJnVk5BuRNMLsPaQu1y2aqXqXDWYxwxdkGa',
    label: 'Smart Money Beta',
    tag: 'smart',
    source: 'Nansen'
  },
  {
    address: 'BYxEsV9RiKhDpBpHRqK8xMT3YVADJm3FJ1PRqKL1fQPH',
    label: 'DeFi Accumulator',
    tag: 'smart',
    source: 'Community identified'
  },
  {
    address: 'Hs9TcbhnSZFyZzBgmwJdGxJBbZSFMb1KzRN8yCuuBVR',
    label: 'Smart Sniper #4',
    tag: 'smart',
    source: 'Community identified'
  },
  {
    address: 'AHkoP8gm7E5zxHM1NTBh2UJJkFJNAmWDPDRvGVRWdN5R',
    label: 'Smart Money Gamma',
    tag: 'smart',
    source: 'Community identified'
  },

  // ── Whale Funds ────────────────────────────────────────────────────────────
  {
    address: 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWgdy9i',
    label: 'Whale Fund A',
    tag: 'whale',
    source: 'On-chain analysis'
  },
  {
    address: 'GThUX1Atko4tqhN2NaiTazFAcoPMokZD5z6hia5bQHCf',
    label: 'Whale Fund B',
    tag: 'whale',
    source: 'On-chain analysis'
  },
  {
    address: '4fYNw3dojWmQ4dXtSGE9epjRGy9GHAgEgNGHMKHjSNpT',
    label: 'Whale Accumulator',
    tag: 'whale',
    source: 'On-chain analysis'
  },
  {
    address: 'CsPuKkNQxkbg4PAmHLiHgf3MhL7Jq5yErNxL7DPbT9HS',
    label: 'Whale Fund D',
    tag: 'whale',
    source: 'On-chain analysis'
  },
];

// Quick lookups
const WALLET_MAP = Object.fromEntries(KNOWN_WALLETS.map(w => [w.address, w]));
const INSIDER_ADDRESSES = KNOWN_WALLETS.filter(w => w.tag === 'insider').map(w => w.address);
const WHALE_ADDRESSES   = KNOWN_WALLETS.filter(w => w.tag === 'whale').map(w => w.address);
const SMART_ADDRESSES   = KNOWN_WALLETS.filter(w => w.tag === 'smart').map(w => w.address);
const ALL_ADDRESSES     = KNOWN_WALLETS.map(w => w.address);

function getWalletInfo(address) {
  return WALLET_MAP[address] || null;
}

function isKnownWallet(address) {
  return !!WALLET_MAP[address];
}

function addWallet(address, label, tag) {
  if (WALLET_MAP[address]) return;
  const entry = { address, label, tag, source: 'User added' };
  KNOWN_WALLETS.push(entry);
  WALLET_MAP[address] = entry;
  if (tag === 'insider') INSIDER_ADDRESSES.push(address);
  if (tag === 'whale')   WHALE_ADDRESSES.push(address);
  if (tag === 'smart')   SMART_ADDRESSES.push(address);
  ALL_ADDRESSES.push(address);
}

module.exports = {
  KNOWN_WALLETS,
  WALLET_MAP,
  INSIDER_ADDRESSES,
  WHALE_ADDRESSES,
  SMART_ADDRESSES,
  ALL_ADDRESSES,
  getWalletInfo,
  isKnownWallet,
  addWallet
};
