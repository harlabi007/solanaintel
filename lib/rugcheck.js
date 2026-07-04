const axios = require('axios');

const BASE = 'https://api.rugcheck.xyz/v1';

// ─── Get full token report ───────────────────────────────────────────────────
async function getTokenReport(mintAddress) {
  const { data } = await axios.get(`${BASE}/tokens/${mintAddress}/report`);
  return data;
}

// ─── Get token report summary (faster, less data) ────────────────────────────
async function getTokenSummary(mintAddress) {
  const { data } = await axios.get(`${BASE}/tokens/${mintAddress}/report/summary`);
  return data;
}

// ─── Parse RugCheck report into clean format ─────────────────────────────────
function parseReport(report) {
  if (!report) return null;

  const risks = report.risks || [];
  const riskScore = risks.reduce((sum, r) => sum + (r.score || 0), 0);
  const trustScore = Math.max(0, Math.min(100, 100 - riskScore));

  const mintAuthority   = report.mintAuthority;
  const freezeAuthority = report.freezeAuthority;
  const lpLocked        = report.markets?.some(m => m.lp?.lpLockedPct > 80) || false;

  const topHolders = report.topHolders || [];
  const top10Pct = topHolders
    .slice(0, 10)
    .reduce((s, h) => s + (h.pct || 0), 0);

  const devWallet = topHolders.find(h => h.owner === report.creator);

  return {
    mint: report.mint,
    name: report.tokenMeta?.name || '???',
    symbol: report.tokenMeta?.symbol || '???',
    trustScore,
    riskScore,
    risks: risks.map(r => ({ name: r.name, level: r.level, score: r.score, description: r.description })),
    mintRevoked: !mintAuthority,
    freezeRevoked: !freezeAuthority,
    lpLocked,
    lpLockedPct: report.markets?.[0]?.lp?.lpLockedPct || 0,
    topHolders: topHolders.slice(0, 10).map(h => ({
      address: h.owner,
      pct: h.pct,
      uiAmount: h.uiAmount,
      isInsider: h.insider || false
    })),
    top10Pct,
    devHoldingPct: devWallet?.pct || 0,
    totalSupply: report.token?.supply,
    decimals: report.token?.decimals,
    creator: report.creator,
    markets: report.markets?.map(m => ({
      dex: m.marketType,
      liquidity: m.liquidity?.usd || 0,
      lpLocked: m.lp?.lpLockedPct || 0
    })),
    honeypot: risks.some(r => r.name?.toLowerCase().includes('honeypot')),
    verified: report.verification?.jup || false,
    auditStatus: report.verification?.jup ? 'Jupiter Verified' : 'Not verified'
  };
}

module.exports = { getTokenReport, getTokenSummary, parseReport };
