# Solana Intel — Backend

Real-time Solana blockchain intelligence API. Powers insider trades, whale alerts, new listings, token analyzer, and ALT Hunter with **live on-chain data**.

---

## Stack
- **Node.js + Express** — REST API
- **WebSocket (ws)** — live event streaming to frontend
- **Helius** — wallet transactions, token metadata, Solana RPC
- **Birdeye** — new listings, token prices, market data, wallet portfolio
- **RugCheck** — token safety scores, mint/freeze authority, honeypot detection

---

## Setup

### 1. Get API Keys

| Service | Free tier | Link |
|---|---|---|
| Helius | 100k credits/mo free | https://helius.dev |
| Birdeye | Free tier available | https://birdeye.so/developer |
| RugCheck | Free, no key needed | https://rugcheck.xyz |

### 2. Clone & Install

```bash
git clone https://github.com/harlabi007/solana-intel-backend
cd solana-intel-backend
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
```
HELIUS_API_KEY=your_key_here
BIRDEYE_API_KEY=your_key_here
PORT=3001
FRONTEND_URL=https://your-frontend.vercel.app
WHALE_THRESHOLD_USD=50000
INSIDER_THRESHOLD_USD=1000
POLL_INTERVAL_MS=15000
```

### 4. Run Locally

```bash
npm run dev     # with hot reload (nodemon)
npm start       # production
```

---

## Deploy to Railway

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Connect this repo
3. Add environment variables in Railway dashboard (same as `.env`)
4. Railway auto-detects `package.json` and runs `npm start`
5. Copy your Railway URL (e.g. `https://solana-intel-backend.railway.app`)

---

## API Endpoints

### Live Data
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/insider-trades` | Real insider wallet buys with signal tags |
| GET | `/api/insider-trades/wallet/:address` | Trades for a specific wallet |
| GET | `/api/whale-alerts` | Large transactions above threshold |
| GET | `/api/new-listings` | Newly listed tokens with ALT scores |
| GET | `/api/new-listings/alt-picks` | Top ALT scored new tokens |

### Token Intelligence
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/tokens/trending` | Trending tokens by volume |
| GET | `/api/tokens/search?q=BONK` | Search tokens |
| GET | `/api/tokens/:mint/analyze` | Full trust score + ALT score report |
| GET | `/api/tokens/:mint/overview` | Price, volume, MC, holders |
| GET | `/api/tokens/:mint/ohlcv` | OHLCV candle data |

### Wallet Intelligence
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/wallets/known` | All tracked insider/whale/smart wallets |
| GET | `/api/wallets/leaderboard` | Ranked by ROI/PnL |
| GET | `/api/wallets/dna` | Coordinated wallet clusters |
| GET | `/api/wallets/:address/portfolio` | Token holdings + PnL |
| GET | `/api/wallets/:address/trades` | Trade history |
| POST | `/api/wallets/add` | Add wallet to tracking `{address, label, tag}` |

### Utility
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/sol-price` | Current SOL price |
| GET | `/health` | Server health + API key status |

### WebSocket
Connect to `ws://your-backend-url` to receive live events:

```js
const ws = new WebSocket('wss://your-backend.railway.app');
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  // type: 'trade' | 'whale' | 'insider' | 'sol_price' | 'connected'
};
```

---

## Connect Frontend

In your `solana-intel.html`, replace the mock data section with:

```js
const API = 'https://your-backend.railway.app';

// Fetch insider trades
const trades = await fetch(`${API}/api/insider-trades`).then(r => r.json());

// Fetch new listings
const listings = await fetch(`${API}/api/new-listings`).then(r => r.json());

// Analyze a token
const report = await fetch(`${API}/api/tokens/MINT_ADDRESS/analyze`).then(r => r.json());

// Live events via WebSocket
const ws = new WebSocket(`wss://your-backend.railway.app`);
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'insider') showToast('⚡', 'Insider Buy', `${data.walletLabel} bought ${data.tokenSymbol}`);
  if (type === 'whale')   showToast('🐋', 'Whale Alert', `${data.walletLabel} moved $${data.amountUSD.toLocaleString()}`);
};
```

---

## Adding More Insider Wallets

Edit `lib/wallets.js` and add entries to `KNOWN_WALLETS`:

```js
{
  address: 'THE_SOLANA_ADDRESS',
  label: 'Your Label',
  tag: 'insider',   // 'insider' | 'smart' | 'whale'
  source: 'How you identified this wallet'
}
```

The more wallets you add (with accurate tags), the better the intelligence.

---

## Rate Limits

| API | Free Tier Limit |
|---|---|
| Helius | 100k credits/month (~3 req/sec) |
| Birdeye | 100 req/minute |
| RugCheck | No auth needed, fair use |

The built-in cache (`node-cache`) prevents hammering the APIs. Default TTLs: 15–30s for live data, 60–120s for heavy queries.
