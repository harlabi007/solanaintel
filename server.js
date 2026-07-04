require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const http       = require('http');
const { WebSocketServer } = require('ws');
const cache      = require('./lib/cache');
const helius     = require('./lib/helius');
const { ALL_ADDRESSES, getWalletInfo } = require('./lib/wallets');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST']
}));
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/insider-trades', require('./routes/insider'));
app.use('/api/whale-alerts',   require('./routes/whale'));
app.use('/api/new-listings',   require('./routes/listings'));
app.use('/api/tokens',         require('./routes/tokens'));
app.use('/api/wallets',        require('./routes/wallets'));

// ─── SOL Price ────────────────────────────────────────────────────────────────
app.get('/api/sol-price', async (req, res) => {
  try {
    const cached = cache.get('sol_price');
    if (cached) return res.json({ price: cached });
    const price = await helius.getSOLPrice();
    if (price) {
      global.solPrice = price;
      cache.set('sol_price', price, 15);
    }
    res.json({ price: price || global.solPrice || 180 });
  } catch (err) {
    res.json({ price: global.solPrice || 180 });
  }
});

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    helius: !!process.env.HELIUS_API_KEY,
    birdeye: !!process.env.BIRDEYE_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// ─── WebSocket — live event streaming ────────────────────────────────────────
const wsClients = new Set();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected. Total:', wsClients.size + 1);
  wsClients.add(ws);

  ws.send(JSON.stringify({ type: 'connected', message: 'Solana Intel stream live' }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('Client disconnected. Total:', wsClients.size);
  });
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data, timestamp: Date.now() });
  wsClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(payload);
  });
}

// ─── Background polling — stream live events to connected clients ─────────────
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS) || 15000;
const WHALE_THRESHOLD = parseFloat(process.env.WHALE_THRESHOLD_USD) || 50000;

let lastSeenSignatures = new Set();

async function pollLiveTransactions() {
  try {
    if (wsClients.size === 0) return; // don't poll if nobody is connected

    const txs = await helius.getTransactionsByAddresses(ALL_ADDRESSES, 10);

    txs.forEach(tx => {
      if (lastSeenSignatures.has(tx.signature)) return;
      lastSeenSignatures.add(tx.signature);

      const walletInfo = getWalletInfo(tx._wallet);
      const parsed = helius.parseSwap(tx, tx._wallet, walletInfo?.label);
      if (!parsed) return;

      parsed.walletTag  = walletInfo?.tag || 'unknown';
      parsed.walletLabel = walletInfo?.label || 'Unknown';
      parsed.solscanWallet = `https://solscan.io/account/${parsed.wallet}`;

      // Broadcast to all connected frontend clients
      broadcast('trade', parsed);

      // Also broadcast as whale alert if large enough
      if (parsed.amountUSD >= WHALE_THRESHOLD) {
        broadcast('whale', { ...parsed, isWhale: true });
      }

      // Broadcast as insider signal if wallet is insider/smart
      if (walletInfo?.tag === 'insider' || walletInfo?.tag === 'smart') {
        broadcast('insider', { ...parsed, signalTags: ['Known insider wallet', 'Early accumulation'] });
      }
    });

    // Keep signature set bounded
    if (lastSeenSignatures.size > 500) {
      lastSeenSignatures = new Set([...lastSeenSignatures].slice(-200));
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
}

// ─── Update SOL price every 15 seconds ───────────────────────────────────────
async function updateSolPrice() {
  try {
    const price = await helius.getSOLPrice();
    if (price) {
      global.solPrice = price;
      cache.set('sol_price', price, 15);
      broadcast('sol_price', { price });
    }
  } catch {}
}

// ─── Start polling ────────────────────────────────────────────────────────────
setInterval(pollLiveTransactions, POLL_INTERVAL);
setInterval(updateSolPrice, 15000);
updateSolPrice(); // run immediately on boot

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║       SOLANA INTEL BACKEND           ║
  ║   Real-time blockchain intelligence  ║
  ╚══════════════════════════════════════╝

  REST API   → http://localhost:${PORT}/api
  WebSocket  → ws://localhost:${PORT}
  Health     → http://localhost:${PORT}/health

  Helius API  : ${process.env.HELIUS_API_KEY ? '✓ Connected' : '✗ Missing HELIUS_API_KEY'}
  Birdeye API : ${process.env.BIRDEYE_API_KEY ? '✓ Connected' : '✗ Missing BIRDEYE_API_KEY'}
  `);
});
