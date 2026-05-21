const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.GUI_PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let isRunning = false;
let currentProcess = null;

// Load .env file if present (for local GUI use)
function loadEnv() {
  const env = { ...process.env };
  try {
    fs.readFileSync(path.join(__dirname, '.env'), 'utf8')
      .split('\n')
      .forEach(line => {
        const [key, ...vals] = line.split('=');
        if (key && vals.length) env[key.trim()] = vals.join('=').trim().replace(/^["']|["']$/g, '');
      });
  } catch {}
  return env;
}

app.get('/api/status', (req, res) => {
  res.json({ isRunning });
});

app.get('/api/results', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'last_results.json'), 'utf8'));
    res.json(data);
  } catch {
    res.json({ deals: [], timestamp: null, modelsChecked: 0 });
  }
});

app.get('/api/config', (req, res) => {
  const env = loadEnv();
  res.json({
    minPrice:   parseInt(env.MIN_PRICE   || '3000'),
    maxPrice:   parseInt(env.MAX_PRICE   || '20000'),
    minScore:   parseInt(env.MIN_DEAL_SCORE || '80'),
    minYear:    parseInt(env.MIN_YEAR    || '2014'),
    models:     40,
    notifyEmail: env.NOTIFY_EMAIL || 'goranruter1@gmail.com',
  });
});

// SSE endpoint — streams live logs while monitor runs
// Query params (all optional):
//   models    — comma-separated "brand-model" keys, e.g. "volkswagen-golf,skoda-octavia"
//   minPrice  — override MIN_PRICE
//   maxPrice  — override MAX_PRICE
//   minYear   — override MIN_YEAR
//   minScore  — override MIN_DEAL_SCORE
app.get('/api/run', (req, res) => {
  if (isRunning) {
    res.status(409).json({ error: 'Already running' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  isRunning = true;

  const send = (type, text) => {
    try {
      res.write(`data: ${JSON.stringify({ type, text, time: new Date().toLocaleTimeString('sr-RS') })}\n\n`);
    } catch {}
  };

  send('start', '=== Monitor Starting ===');

  // Build env — start from .env file then overlay query params
  const env = loadEnv();
  if (req.query.minPrice)  env.MIN_PRICE      = req.query.minPrice;
  if (req.query.maxPrice)  env.MAX_PRICE      = req.query.maxPrice;
  if (req.query.minYear)   env.MIN_YEAR       = req.query.minYear;
  if (req.query.minScore)  env.MIN_DEAL_SCORE = req.query.minScore;
  if (req.query.models)    env.MONITOR_MODELS = req.query.models;

  currentProcess = spawn('node', ['scripts/monitor.js'], {
    cwd: __dirname,
    env,
  });

  currentProcess.stdout.on('data', (data) => {
    data.toString().split('\n').filter(Boolean).forEach(line => send('log', line));
  });

  currentProcess.stderr.on('data', (data) => {
    send('error', data.toString().trim());
  });

  currentProcess.on('close', (code) => {
    isRunning = false;
    currentProcess = null;
    send('done', `=== Završeno (exit ${code}) ===`);
    res.end();
  });

  req.on('close', () => {
    if (currentProcess) {
      currentProcess.kill();
      isRunning = false;
      currentProcess = null;
    }
  });
});

app.post('/api/stop', (req, res) => {
  if (currentProcess) {
    currentProcess.kill();
    isRunning = false;
    currentProcess = null;
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

const server = app.listen(PORT, () => {
  console.log(`\n🚗 Auto Monitor GUI → http://localhost:${PORT}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const fallback = parseInt(PORT) + 1;
    console.warn(`⚠️  Port ${PORT} in use — trying ${fallback}…`);
    app.listen(fallback, () => {
      console.log(`\n🚗 Auto Monitor GUI → http://localhost:${fallback}\n`);
    });
  } else {
    throw err;
  }
});
