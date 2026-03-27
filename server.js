#!/usr/bin/env node

// Ferdium Local Rescue Server
// A zero-dependency drop-in replacement for api.ferdium.org
// Just run: node server.js

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = parseInt(process.env.FERDIUM_PORT || '14569', 10);
const TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJGZXJkaXVtIExvY2FsIFJlc2N1ZSBTZXJ2ZXIiLCJpYXQiOjE3MTE1MDAwMDAsImV4cCI6MjUzMzk1NDE3ODQ0LCJzdWIiOiJmZXJkaXVtQGxvY2FsaG9zdCIsInVzZXJJZCI6IjEifQ.local-rescue-server';

// ---------------------------------------------------------------------------
// Ferdium data directory detection
// ---------------------------------------------------------------------------

function detectFerdiumDir() {
  const custom = process.env.FERDIUM_DATA_DIR;
  if (custom && fs.existsSync(custom)) return custom;

  const platform = process.platform;
  let base;
  if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support', 'Ferdium');
  } else if (platform === 'win32') {
    base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Ferdium');
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    base = path.join(xdg, 'Ferdium');
  }
  if (fs.existsSync(base)) return base;

  // Try alternate names (Ferdi, FerdiumDev)
  for (const name of ['FerdiumDev', 'Ferdi']) {
    const alt = path.join(path.dirname(base), name);
    if (fs.existsSync(alt)) return alt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Partition scanner — maps service UUIDs to recipe IDs
// ---------------------------------------------------------------------------

function extractStringsFromFile(filePath, minLen = 6) {
  try {
    const buf = fs.readFileSync(filePath);
    const latin = buf.toString('latin1');
    const matches = latin.match(/https?:\/\/[a-zA-Z0-9._\-/:%?&=]+/g);
    return matches || [];
  } catch {
    return [];
  }
}

function buildRecipeCatalog(ferdiumDir) {
  const recipesDir = path.join(ferdiumDir, 'recipes');
  const catalog = [];
  if (!fs.existsSync(recipesDir)) return catalog;

  for (const entry of fs.readdirSync(recipesDir)) {
    const pkgPath = path.join(recipesDir, entry, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const serviceURL = pkg.config?.serviceURL || '';
      let domain = '';
      try {
        domain = new URL(serviceURL.replace('{teamId}', 'placeholder')).hostname;
      } catch { /* skip */ }
      catalog.push({
        recipeId: pkg.id,
        name: pkg.name,
        version: pkg.version || '1.0.0',
        serviceURL,
        domain,
        icons: { svg: pkg.defaultIcon || '' },
      });
    } catch { /* skip */ }
  }
  return catalog;
}

// Specific domains first, generic auth domains excluded to avoid false matches
// (e.g. accounts.google.com appears in YouTube, Gmail, and other Google services)
const EXTRA_DOMAIN_MAP = {
  'chatgpt.com': 'chatgpt',
  'chat.openai.com': 'chatgpt',
  'x.com': 'twitter',
  'twitter.com': 'twitter',
  'web.whatsapp.com': 'whatsapp',
  'web.telegram.org': 'telegram',
  'mail.proton.me': 'proton-mail',
  'account.proton.me': 'proton-mail',
  'app.slack.com': 'slack',
  'mail.google.com': 'gmail',
  'www.instagram.com': 'instagram-direct-messages',
  'www.youtube.com': 'youtube',
  'youtube.com': 'youtube',
  'discord.com': 'discord',
  'mail.zoho.eu': 'zoho',
  'mail.zoho.com': 'zoho',
  'www.zoho.com': 'zoho',
};

function identifyPartition(partitionDir, recipeCatalog) {
  const urlSources = [];

  const lsDir = path.join(partitionDir, 'Local Storage', 'leveldb');
  if (fs.existsSync(lsDir)) {
    for (const f of fs.readdirSync(lsDir)) {
      if (f.endsWith('.ldb') || f.endsWith('.log')) {
        urlSources.push(...extractStringsFromFile(path.join(lsDir, f)));
      }
    }
  }

  const cookiePath = path.join(partitionDir, 'Cookies');
  if (fs.existsSync(cookiePath)) {
    urlSources.push(...extractStringsFromFile(cookiePath));
  }

  const domainCounts = {};
  for (const urlStr of urlSources) {
    try {
      const hostname = new URL(urlStr).hostname;
      domainCounts[hostname] = (domainCounts[hostname] || 0) + 1;
    } catch { /* skip */ }
  }

  // Score each recipe candidate by how many URL hits it has in this partition.
  // This avoids false positives from generic auth domains (e.g. accounts.google.com
  // appearing in YouTube partitions shouldn't cause them to be identified as Gmail).
  const scores = {};

  for (const [domain, recipeId] of Object.entries(EXTRA_DOMAIN_MAP)) {
    if (domainCounts[domain]) {
      scores[recipeId] = (scores[recipeId] || 0) + domainCounts[domain];
    }
  }

  for (const recipe of recipeCatalog) {
    if (recipe.domain && domainCounts[recipe.domain]) {
      scores[recipe.recipeId] = (scores[recipe.recipeId] || 0) + domainCounts[recipe.domain];
    }
  }

  if (Object.keys(scores).length > 0) {
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    return recipeCatalog.find(r => r.recipeId === best) || null;
  }

  // Last resort: partial hostname matching (e.g. "slack" in "app.slack.com")
  for (const recipe of recipeCatalog) {
    if (!recipe.recipeId) continue;
    for (const domain of Object.keys(domainCounts)) {
      if (domain.includes(recipe.recipeId)) return recipe;
    }
  }

  return null;
}

function scanPartitions(ferdiumDir, recipeCatalog) {
  const partitionsDir = path.join(ferdiumDir, 'Partitions');
  const services = [];
  const unidentified = [];

  if (!fs.existsSync(partitionsDir)) return { services, unidentified };

  const entries = fs.readdirSync(partitionsDir)
    .filter(e => e.startsWith('service-'))
    .sort();

  const usedRecipes = new Set();
  let order = 1;

  for (const entry of entries) {
    const uuid = entry.replace('service-', '');
    const fullPath = path.join(partitionsDir, entry);
    const recipe = identifyPartition(fullPath, recipeCatalog);

    if (recipe && !usedRecipes.has(recipe.recipeId)) {
      usedRecipes.add(recipe.recipeId);
      services.push({
        id: uuid,
        name: recipe.name,
        recipeId: recipe.recipeId,
        isEnabled: true,
        isNotificationEnabled: true,
        isBadgeEnabled: true,
        isMuted: false,
        isDarkModeEnabled: '',
        isProgressbarEnabled: true,
        spellcheckerLanguage: '',
        order: order++,
        customRecipe: false,
        hasCustomIcon: false,
        iconUrl: null,
        userId: 1,
        workspaces: [],
        trapLinkClicks: false,
        useFavicon: false,
      });
    } else if (!recipe) {
      unidentified.push(uuid);
    }
  }

  return { services, unidentified };
}

// ---------------------------------------------------------------------------
// Data persistence (JSON file next to server.js)
// ---------------------------------------------------------------------------

const DATA_FILE = path.join(__dirname, 'data.json');

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function initData(ferdiumDir) {
  let data = loadData();
  if (data) {
    log(`Loaded existing data (${data.services.length} services)`);
    return data;
  }

  log('First run — scanning Ferdium data...');
  const recipeCatalog = buildRecipeCatalog(ferdiumDir);
  log(`  Found ${recipeCatalog.length} installed recipes`);

  const { services, unidentified } = scanPartitions(ferdiumDir, recipeCatalog);

  data = {
    user: {
      accountType: 'individual',
      beta: false,
      donor: {},
      email: 'ferdium@localhost',
      emailValidated: true,
      features: {},
      firstname: 'Ferdium',
      id: '82c1cf9d-ab58-4da2-b55e-aaa41d2142d8',
      isPremium: true,
      isSubscriptionOwner: true,
      lastname: 'User',
      locale: 'en-US',
    },
    services,
    workspaces: [],
    recipes: recipeCatalog,
  };

  saveData(data);

  if (services.length > 0) {
    log(`  Reconstructed ${services.length} services:`);
    for (const s of services) {
      log(`    ${String(s.order).padStart(2)}. ${s.name.padEnd(25)} (${s.recipeId})`);
    }
  }
  if (unidentified.length > 0) {
    log(`  ${unidentified.length} partitions could not be identified:`);
    for (const u of unidentified) log(`    - ${u}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Minimal HTTP router
// ---------------------------------------------------------------------------

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function matchRoute(method, urlPath, pattern) {
  if (typeof pattern === 'string') {
    return method === null || true ? urlPath === pattern ? {} : null : null;
  }
  const match = urlPath.match(pattern);
  if (!match) return null;
  return match.groups || {};
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function createRoutes(data) {
  return function handleRequest(method, urlPath, query, body) {
    // Health
    if (method === 'GET' && urlPath === '/health') {
      return { api: 'success', db: 'success' };
    }

    // Auth
    if (method === 'POST' && urlPath === '/v1/auth/login') {
      return { message: 'Successfully logged in', token: TOKEN };
    }
    if (method === 'POST' && urlPath === '/v1/auth/signup') {
      return { message: 'Successfully created account', token: TOKEN };
    }

    // User
    if (method === 'GET' && urlPath === '/v1/me') {
      return { ...data.user };
    }
    if (method === 'PUT' && urlPath === '/v1/me') {
      Object.assign(data.user, body);
      saveData(data);
      return { data: { ...data.user }, status: ['data-updated'] };
    }
    if (method === 'GET' && urlPath === '/v1/me/newtoken') {
      return { token: TOKEN };
    }

    // Services
    if (method === 'GET' && urlPath === '/v1/me/services') {
      return data.services;
    }
    if (method === 'GET' && urlPath === '/v1/recipe') {
      return data.services;
    }
    if (method === 'POST' && urlPath === '/v1/service') {
      const id = crypto.randomUUID();
      const service = {
        id,
        userId: 1,
        isEnabled: true,
        isNotificationEnabled: true,
        isBadgeEnabled: true,
        isMuted: false,
        isDarkModeEnabled: '',
        isProgressbarEnabled: true,
        spellcheckerLanguage: '',
        order: data.services.length + 1,
        customRecipe: false,
        hasCustomIcon: false,
        iconUrl: null,
        workspaces: [],
        ...body,
      };
      data.services.push(service);
      saveData(data);
      return { data: service, status: ['created'] };
    }

    // Service edit: PUT /v1/service/:id
    const editMatch = urlPath.match(/^\/v1\/service\/([a-f0-9-]+)$/);
    if (method === 'PUT' && editMatch) {
      const svcId = editMatch[1];
      const idx = data.services.findIndex(s => s.id === svcId);
      if (idx >= 0) {
        Object.assign(data.services[idx], body);
        saveData(data);
        return { data: data.services[idx], status: ['updated'] };
      }
      return { message: 'Service not found', status: 404 };
    }

    // Service delete: DELETE /v1/service/:id
    if (method === 'DELETE' && editMatch) {
      const svcId = editMatch[1];
      data.services = data.services.filter(s => s.id !== svcId);
      saveData(data);
      return { message: 'Sucessfully deleted service', status: 200 };
    }

    // Service reorder
    if (method === 'PUT' && urlPath === '/v1/service/reorder') {
      for (const [svcId, order] of Object.entries(body)) {
        const svc = data.services.find(s => s.id === svcId);
        if (svc) svc.order = order;
      }
      saveData(data);
      return data.services;
    }

    // Recipes
    if (method === 'GET' && urlPath === '/v1/recipes') {
      return data.recipes.map(r => ({
        id: r.recipeId,
        name: r.name,
        version: r.version,
        icons: r.icons,
      }));
    }
    if (method === 'GET' && urlPath === '/v1/recipes/popular') {
      return data.recipes.slice(0, 10).map(r => ({
        id: r.recipeId,
        name: r.name,
        version: r.version,
        featured: true,
        icons: r.icons,
      }));
    }
    if (method === 'GET' && urlPath === '/v1/recipes/search') {
      const needle = (query.needle || '').toLowerCase();
      return data.recipes
        .filter(r => r.name.toLowerCase().includes(needle) || r.recipeId.includes(needle))
        .map(r => ({ id: r.recipeId, name: r.name, version: r.version, icons: r.icons }));
    }
    if (method === 'POST' && urlPath === '/v1/recipes/update') {
      return [];
    }

    // Recipe download
    const dlMatch = urlPath.match(/^\/v1\/recipes\/download\/(.+)$/);
    if (method === 'GET' && dlMatch) {
      return { '$status': 404, message: 'Recipe not found', code: 'recipe-not-found' };
    }

    // Workspaces
    if (method === 'GET' && urlPath === '/v1/workspace') {
      return data.workspaces;
    }
    if (method === 'POST' && urlPath === '/v1/workspace') {
      const wsId = crypto.randomUUID();
      const ws = {
        id: wsId,
        userId: 1,
        name: body.name || 'New Workspace',
        order: data.workspaces.length,
        services: body.services || [],
      };
      data.workspaces.push(ws);
      saveData(data);
      return ws;
    }

    const wsMatch = urlPath.match(/^\/v1\/workspace\/([a-f0-9-]+)$/);
    if (method === 'PUT' && wsMatch) {
      const wsId = wsMatch[1];
      const idx = data.workspaces.findIndex(w => w.id === wsId);
      if (idx >= 0) {
        Object.assign(data.workspaces[idx], body);
        saveData(data);
        return data.workspaces[idx];
      }
      return { message: 'Workspace not found' };
    }
    if (method === 'DELETE' && wsMatch) {
      const wsId = wsMatch[1];
      data.workspaces = data.workspaces.filter(w => w.id !== wsId);
      saveData(data);
      return { message: 'Successfully deleted workspace' };
    }

    // Features
    if (method === 'GET' && urlPath.startsWith('/v1/features')) {
      return {
        isServiceProxyEnabled: true,
        isWorkspaceEnabled: true,
        isAnnouncementsEnabled: true,
        isSettingsWSEnabled: false,
        isMagicBarEnabled: true,
        isTodosEnabled: true,
      };
    }

    // Static empties
    if (method === 'GET' && urlPath === '/v1/services') return [];
    if (method === 'GET' && urlPath === '/v1/news') return [];
    if (method === 'GET' && urlPath.startsWith('/v1/announcements')) return {};

    // Icon (not available)
    if (method === 'GET' && urlPath.startsWith('/v1/icon/')) {
      return { '$status': 404, status: "Icon doesn't exist" };
    }

    // Invite (no-op)
    if (method === 'POST' && urlPath === '/v1/invite') {
      return { message: 'Invite sent' };
    }

    // Password reset (no-op)
    if (method === 'POST' && urlPath === '/v1/auth/password') {
      return { message: 'Password reset not available on local server' };
    }

    // Fallback
    return null;
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`  ${msg}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log();
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║   Ferdium Local Rescue Server  v1.0   ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log();

  const ferdiumDir = detectFerdiumDir();
  if (!ferdiumDir) {
    log('ERROR: Could not find Ferdium data directory.');
    log('Set FERDIUM_DATA_DIR environment variable to the correct path.');
    log('');
    log('Typical locations:');
    log('  macOS:   ~/Library/Application Support/Ferdium');
    log('  Linux:   ~/.config/Ferdium');
    log('  Windows: %APPDATA%\\Ferdium');
    process.exit(1);
  }

  log(`OS:           ${process.platform}`);
  log(`Ferdium data: ${ferdiumDir}`);
  log('');

  // Auto-patch settings.json to point to this server
  const settingsPath = path.join(ferdiumDir, 'config', 'settings.json');
  const localUrl = `http://localhost:${PORT}`;

  if (fs.existsSync(settingsPath)) {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

    if (settings.server !== localUrl) {
      const backupPath = settingsPath + '.backup-' + Date.now();
      fs.copyFileSync(settingsPath, backupPath);
      const oldServer = settings.server;
      settings.server = localUrl;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      log(`Patched settings.json:`);
      log(`  "${oldServer}" -> "${localUrl}"`);
      log(`  Backup: ${backupPath}`);
    } else {
      log('Settings already point to this server.');
    }
  }
  log('');

  const data = initData(ferdiumDir);
  const handle = createRoutes(data);

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      return res.end();
    }

    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const urlPath = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = Object.fromEntries(parsed.searchParams);
    const method = req.method;

    const body = ['POST', 'PUT', 'PATCH'].includes(method)
      ? await parseBody(req)
      : {};

    const result = handle(method, urlPath, query, body);

    if (result === null) {
      json(res, { message: 'Route not found' }, 404);
    } else if (result['$status']) {
      const status = result['$status'];
      delete result['$status'];
      json(res, result, status);
    } else {
      json(res, result);
    }
  });

  server.listen(PORT, () => {
    log('');
    log(`Server running on ${localUrl}`);
    log('');
    log('Open Ferdium and it will connect automatically.');
    log('');
    log('Press Ctrl+C to stop the server.');
    log('');
  });
}

main();
