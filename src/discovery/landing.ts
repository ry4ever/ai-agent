import { Request, Response } from 'express';
import { SERVICE_DEFINITIONS } from '../config/services';

const BAZAAR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const AGENT_BASE = 'https://agents.aiscale.pro';

function badge(method: string): string {
  const colour = method === 'GET' ? '#10b981' : '#6366f1';
  return `<span class="badge" style="background:${colour}">${method}</span>`;
}

function priceTag(price: string): string {
  return `<span class="price">${price} <span class="currency">USDC</span></span>`;
}

function endpointRow(svc: (typeof SERVICE_DEFINITIONS)[number]): string {
  const endpoint = svc.endpoint.replace(/:(\w+)/g, '<em>:$1</em>');
  return `
    <tr>
      <td>${badge(svc.method)} <code>${endpoint}</code></td>
      <td>${svc.description}</td>
      <td>${priceTag('$' + svc.priceUSDC)}</td>
      <td class="mono">&lt;${svc.sla.avgLatencyMs}ms</td>
    </tr>`;
}

function curlSnippet(svc: (typeof SERVICE_DEFINITIONS)[number]): string {
  const examplePath = svc.endpoint
    .replace(':ticker', 'AAPL')
    .replace(':domain', 'stripe.com')
    .replace(':email', 'elon@x.com');

  if (svc.method === 'GET') {
    return `curl -H "X-PAYMENT: &lt;token&gt;" \\
  ${AGENT_BASE}${examplePath}`;
  }
  return `curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-PAYMENT: &lt;token&gt;" \\
  -d '{"text":"..."}' \\
  ${AGENT_BASE}${examplePath}`;
}

export function landingHandler(_req: Request, res: Response): void {
  const dataApis = SERVICE_DEFINITIONS.filter(s => s.category === 'data-api');
  const subAgents = SERVICE_DEFINITIONS.filter(s => s.category === 'sub-agent');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AiScale Agent Services — Pay-Per-Call AI APIs on Base</title>
  <meta name="description" content="Production-ready AI APIs secured by x402 micropayments on Base. No keys, no subscriptions — pay per call in USDC.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #09090b;
      --surface:   #18181b;
      --border:    #27272a;
      --muted:     #71717a;
      --text:      #e4e4e7;
      --accent:    #60a5fa;
      --accent2:   #a78bfa;
      --green:     #34d399;
      --font-mono: 'SF Mono', 'Fira Code', Consolas, monospace;
    }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Layout ── */
    .container { max-width: 1100px; margin: 0 auto; padding: 0 1.5rem; }

    /* ── Nav ── */
    nav {
      border-bottom: 1px solid var(--border);
      padding: 1rem 0;
      position: sticky; top: 0;
      background: rgba(9,9,11,.85);
      backdrop-filter: blur(12px);
      z-index: 10;
    }
    nav .inner {
      max-width: 1100px; margin: 0 auto;
      padding: 0 1.5rem;
      display: flex; align-items: center; justify-content: space-between;
    }
    .logo { font-weight: 700; font-size: 1.1rem; color: var(--text); }
    .logo span { color: var(--accent); }
    nav a { color: var(--muted); font-size: .9rem; margin-left: 1.5rem; }
    nav a:hover { color: var(--text); text-decoration: none; }

    /* ── Hero ── */
    .hero {
      padding: 5rem 0 4rem;
      text-align: center;
    }
    .hero-tag {
      display: inline-flex; align-items: center; gap: .5rem;
      background: rgba(96,165,250,.1); border: 1px solid rgba(96,165,250,.25);
      border-radius: 99px; padding: .3rem .9rem;
      font-size: .8rem; color: var(--accent);
      margin-bottom: 1.5rem;
    }
    .hero-tag .dot { width: 6px; height: 6px; background: var(--accent); border-radius: 50%; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    h1 {
      font-size: clamp(2rem, 5vw, 3.2rem);
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: -.02em;
      margin-bottom: 1.25rem;
    }
    h1 .grad {
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .hero-sub {
      font-size: 1.1rem; color: var(--muted);
      max-width: 600px; margin: 0 auto 2.5rem;
    }
    .hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .btn {
      display: inline-block;
      padding: .65rem 1.4rem; border-radius: 8px;
      font-weight: 600; font-size: .95rem;
      transition: opacity .15s, transform .15s;
      cursor: pointer; border: none;
    }
    .btn:hover { opacity: .85; transform: translateY(-1px); text-decoration: none; }
    .btn-primary { background: var(--accent); color: #000; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }

    /* ── Stats bar ── */
    .stats {
      display: flex; gap: 0; flex-wrap: wrap;
      border: 1px solid var(--border); border-radius: 12px;
      margin-bottom: 5rem; overflow: hidden;
    }
    .stat {
      flex: 1; min-width: 160px;
      padding: 1.25rem 1.5rem;
      border-right: 1px solid var(--border);
      text-align: center;
    }
    .stat:last-child { border-right: none; }
    .stat-value { font-size: 1.6rem; font-weight: 700; color: var(--text); }
    .stat-label { font-size: .8rem; color: var(--muted); margin-top: .2rem; }

    /* ── Section titles ── */
    section { margin-bottom: 5rem; }
    .section-label {
      font-size: .75rem; text-transform: uppercase; letter-spacing: .1em;
      color: var(--accent); font-weight: 600; margin-bottom: .5rem;
    }
    h2 { font-size: 1.75rem; font-weight: 700; margin-bottom: .5rem; letter-spacing: -.01em; }
    .section-sub { color: var(--muted); margin-bottom: 2rem; font-size: .95rem; }

    /* ── How it works ── */
    .steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; }
    .step {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 12px; padding: 1.5rem;
    }
    .step-num {
      width: 32px; height: 32px;
      background: rgba(96,165,250,.12); border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: .85rem; font-weight: 700; color: var(--accent);
      margin-bottom: 1rem;
    }
    .step h3 { font-size: 1rem; font-weight: 600; margin-bottom: .4rem; }
    .step p { font-size: .875rem; color: var(--muted); }

    /* ── Pricing table ── */
    .pricing-group { margin-bottom: 2rem; }
    .pricing-group-label {
      font-size: .75rem; text-transform: uppercase; letter-spacing: .08em;
      color: var(--muted); font-weight: 600;
      padding: .6rem .75rem; background: var(--surface);
      border: 1px solid var(--border); border-bottom: none;
      border-radius: 8px 8px 0 0;
    }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      text-align: left; font-size: .8rem;
      text-transform: uppercase; letter-spacing: .06em;
      color: var(--muted); font-weight: 600;
      padding: .75rem 1rem; background: var(--surface);
      border: 1px solid var(--border); border-top: none;
    }
    thead th:first-child { border-left: 1px solid var(--border); }
    thead th:last-child  { border-right: 1px solid var(--border); }
    tbody tr { border-bottom: 1px solid var(--border); }
    tbody tr:last-child { border-bottom: none; }
    tbody td {
      padding: .875rem 1rem; font-size: .875rem;
      border-left: 1px solid var(--border);
    }
    tbody td:last-child { border-right: 1px solid var(--border); }
    tbody tr:last-child td:first-child { border-radius: 0 0 0 8px; }
    tbody tr:last-child td:last-child  { border-radius: 0 0 8px 0; }
    tbody tr:hover td { background: rgba(255,255,255,.02); }
    code {
      font-family: var(--font-mono); font-size: .82rem;
      background: rgba(255,255,255,.06); padding: .1em .4em; border-radius: 4px;
    }
    .badge {
      display: inline-block; font-size: .7rem; font-weight: 700;
      padding: .15em .5em; border-radius: 4px; color: #000;
      font-family: var(--font-mono); margin-right: .4rem;
    }
    .price { font-weight: 700; color: var(--green); font-family: var(--font-mono); }
    .currency { font-size: .75rem; font-weight: 400; color: var(--muted); }
    .mono { font-family: var(--font-mono); font-size: .82rem; color: var(--muted); }

    /* ── Code block ── */
    .code-tabs { display: flex; gap: .5rem; margin-bottom: .5rem; flex-wrap: wrap; }
    .tab-btn {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 6px; padding: .35rem .75rem;
      font-size: .8rem; color: var(--muted); cursor: pointer;
      font-family: var(--font-mono); transition: all .15s;
    }
    .tab-btn:hover, .tab-btn.active { color: var(--text); border-color: var(--accent); }
    .code-block {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; padding: 1.25rem;
      font-family: var(--font-mono); font-size: .82rem;
      line-height: 1.7; color: #a3e635; overflow-x: auto;
      white-space: pre;
    }
    .code-block .dim { color: var(--muted); }
    .code-block .hi  { color: var(--accent); }

    /* ── CTA ── */
    .cta-banner {
      background: linear-gradient(135deg, rgba(96,165,250,.08), rgba(167,139,250,.08));
      border: 1px solid rgba(96,165,250,.2);
      border-radius: 16px; padding: 3rem 2rem;
      text-align: center;
    }
    .cta-banner h2 { font-size: 1.75rem; margin-bottom: .75rem; }
    .cta-banner p  { color: var(--muted); margin-bottom: 1.75rem; }
    .cta-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      padding: 2rem 0; text-align: center;
      font-size: .85rem; color: var(--muted);
      margin-top: 2rem;
    }
    footer a { color: var(--muted); }

    @media (max-width: 640px) {
      .stats { flex-direction: column; }
      .stat { border-right: none; border-bottom: 1px solid var(--border); }
      thead { display: none; }
      tbody td { display: block; border-left: none; border-right: none; }
      tbody td::before { content: attr(data-label) ": "; color: var(--muted); font-size: .75rem; }
    }
  </style>
</head>
<body>

<nav>
  <div class="inner">
    <span class="logo">Ai<span>Scale</span> Agent Services</span>
    <div>
      <a href="#pricing">Pricing</a>
      <a href="#how-to-use">Docs</a>
      <a href="${BAZAAR_URL}" target="_blank" rel="noopener">Bazaar ↗</a>
    </div>
  </div>
</nav>

<!-- ── HERO ── -->
<div class="container">
  <section class="hero">
    <div class="hero-tag">
      <span class="dot"></span>
      Live on Base Mainnet · x402 Protocol
    </div>
    <h1>AI APIs that bill<br>by the <span class="grad">single call</span></h1>
    <p class="hero-sub">
      Production-ready AI services — sentiment analysis, company enrichment,
      contract review, code auditing, and more — secured by x402 micropayments.
      No API keys. No subscriptions. Pay in USDC per request.
    </p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="${BAZAAR_URL}" target="_blank" rel="noopener">Try it on x402 Bazaar</a>
      <a class="btn btn-outline" href="#pricing">View pricing &amp; endpoints</a>
    </div>
  </section>

  <!-- Stats -->
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${SERVICE_DEFINITIONS.length}</div>
      <div class="stat-label">Live endpoints</div>
    </div>
    <div class="stat">
      <div class="stat-value">$0.002</div>
      <div class="stat-label">Lowest price / call</div>
    </div>
    <div class="stat">
      <div class="stat-value">&lt;600ms</div>
      <div class="stat-label">Avg API latency</div>
    </div>
    <div class="stat">
      <div class="stat-value">USDC</div>
      <div class="stat-label">Payment token · Base</div>
    </div>
    <div class="stat">
      <div class="stat-value">99.5%</div>
      <div class="stat-label">Uptime SLA</div>
    </div>
  </div>

  <!-- ── HOW IT WORKS ── -->
  <section id="how-it-works">
    <div class="section-label">How it works</div>
    <h2>No API keys. Pay as you go.</h2>
    <p class="section-sub">The x402 protocol handles authentication and billing in a single HTTP round-trip.</p>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <h3>Call the endpoint</h3>
        <p>Send a normal HTTP request — no Authorization header required.</p>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <h3>Receive a 402</h3>
        <p>The server responds with payment details: amount, asset, and destination.</p>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <h3>Sign &amp; attach payment</h3>
        <p>Your x402-compatible client signs a USDC transfer and adds the X-PAYMENT header.</p>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <h3>Get the response</h3>
        <p>The CDP facilitator settles on-chain and you receive the API result — in one retry.</p>
      </div>
    </div>
  </section>

  <!-- ── PRICING TABLE ── -->
  <section id="pricing">
    <div class="section-label">Pricing</div>
    <h2>All prices in USDC · Base Mainnet</h2>
    <p class="section-sub">Pay exactly per call. Amounts are final at request time — no hidden fees.</p>

    <div class="pricing-group">
      <div class="pricing-group-label">Data APIs — real-time lookups</div>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Description</th>
            <th>Price / call</th>
            <th>Avg latency</th>
          </tr>
        </thead>
        <tbody>
          ${dataApis.map(endpointRow).join('')}
        </tbody>
      </table>
    </div>

    <div class="pricing-group">
      <div class="pricing-group-label">AI Sub-agents — deep analysis</div>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Description</th>
            <th>Price / call</th>
            <th>Avg latency</th>
          </tr>
        </thead>
        <tbody>
          ${subAgents.map(endpointRow).join('')}
        </tbody>
      </table>
    </div>
  </section>

  <!-- ── HOW TO USE ── -->
  <section id="how-to-use">
    <div class="section-label">Quick start</div>
    <h2>Three ways to integrate</h2>
    <p class="section-sub">Pick the integration that fits your stack.</p>

    <div class="code-tabs">
      <button class="tab-btn active" onclick="show('curl')">curl</button>
      <button class="tab-btn" onclick="show('node')">Node.js</button>
      <button class="tab-btn" onclick="show('python')">Python</button>
    </div>

    <div id="tab-curl" class="code-block"><span class="dim"># 1. Make the initial call — you'll receive a 402 with payment details</span>
curl ${AGENT_BASE}/api/v1/sentiment/AAPL

<span class="dim"># 2. Use an x402-compatible client to attach payment automatically</span>
npx x402-curl <span class="hi">\\
  --wallet-key $PRIVATE_KEY \\
  --network base-mainnet \\</span>
  ${AGENT_BASE}/api/v1/sentiment/AAPL</div>

    <div id="tab-node" class="code-block" style="display:none"><span class="dim">// npm install @coinbase/x402-fetch</span>
<span class="hi">import</span> { wrapFetchWithPayment } <span class="hi">from</span> '@coinbase/x402-fetch';

<span class="hi">const</span> fetch402 = wrapFetchWithPayment(fetch, {
  privateKey: process.env.PRIVATE_KEY,
  network: <span class="hi">'base-mainnet'</span>,
});

<span class="hi">const</span> res = <span class="hi">await</span> fetch402(
  <span class="hi">'${AGENT_BASE}/api/v1/sentiment/AAPL'</span>
);
<span class="hi">const</span> data = <span class="hi">await</span> res.json();
console.log(data.score); <span class="dim">// e.g. 0.72 (bullish)</span></div>

    <div id="tab-python" class="code-block" style="display:none"><span class="dim"># pip install x402-httpx</span>
<span class="hi">import</span> x402_httpx

client = x402_httpx.Client(
    private_key=<span class="hi">os.environ["PRIVATE_KEY"]</span>,
    network=<span class="hi">"base-mainnet"</span>,
)

resp = client.get(
    <span class="hi">"${AGENT_BASE}/api/v1/sentiment/AAPL"</span>
)
print(resp.json()[<span class="hi">"score"</span>])  <span class="dim"># e.g. 0.72</span></div>

    <p style="margin-top:1rem;font-size:.85rem;color:var(--muted)">
      Full endpoint reference at
      <a href="${AGENT_BASE}/.well-known/agent-services">${AGENT_BASE}/.well-known/agent-services</a>
      · Machine-readable agent card at
      <a href="${AGENT_BASE}/.well-known/agent.json">${AGENT_BASE}/.well-known/agent.json</a>
    </p>
  </section>

  <!-- ── CTA ── -->
  <section>
    <div class="cta-banner">
      <h2>Ready to start?</h2>
      <p>Browse the full catalogue on the x402 Bazaar — no sign-up, no API key, first call costs fractions of a cent.</p>
      <div class="cta-actions">
        <a class="btn btn-primary" href="${BAZAAR_URL}" target="_blank" rel="noopener">Try it on x402 Bazaar ↗</a>
        <a class="btn btn-outline" href="${AGENT_BASE}/.well-known/agent-services">View service manifest</a>
      </div>
    </div>
  </section>
</div>

<footer>
  <p>AiScale Agent Services · Powered by <a href="https://x402.org" target="_blank" rel="noopener">x402</a> · Payments settled on <a href="https://base.org" target="_blank" rel="noopener">Base</a></p>
</footer>

<script>
  function show(tab) {
    ['curl','node','python'].forEach(t => {
      document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
    });
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
      b.classList.toggle('active', ['curl','node','python'][i] === tab);
    });
  }
</script>

</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.send(html);
}
