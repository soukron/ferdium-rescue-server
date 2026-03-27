# Ferdium Local Rescue Server

A zero-dependency, single-file local server that replaces `api.ferdium.org` when it's down. It auto-detects your installed services and keeps Ferdium running entirely offline.

NOTE: Use this project at your complete responsability. This code has been vibed coded to help in an emergency where Ferdium servers are having a bad time and I needed to make it work at any cost. For sure, it's not part of Ferdium base code and I'm not a developer of Ferdium team. 

## What does this do?

Ferdium depends on `api.ferdium.org` to load your services (WhatsApp, Telegram, Slack, etc.). When that server goes down, **Ferdium won't even start**. This rescue server runs on your machine and answers all the API calls Ferdium needs, using data already on your computer.

## Requirements

- **Node.js 18 or newer** (check with `node --version`)
- That's it. No `npm install`, no dependencies.

## Quick Start

### 1. Download `server.js`

Save the file to any folder on your computer.

### 2. Run it

```bash
node server.js
```

That's it. The server will:
- Auto-detect your Ferdium data
- Patch `settings.json` to point to localhost (creating a backup)
- Scan your services
- Start serving the API

Now open Ferdium. Everything connects automatically.

### 3. Keep the server running

Ferdium needs this server running in the background while you use it. Press `Ctrl+C` to stop it when you're done.

## How it works

1. **Finds your Ferdium data** automatically based on your OS
2. **Reads your installed recipes** (the `recipes/` folder in Ferdium's data)
3. **Scans browser partitions** to match each service UUID to a recipe by extracting URLs from local storage files
4. **Serves the Ferdium API** on localhost, returning your services, features, and recipes

All your login sessions (cookies, tokens) are preserved because the server uses the exact same service UUIDs as your existing partitions.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `FERDIUM_PORT` | `14569` | Port to run the server on |
| `FERDIUM_DATA_DIR` | *(auto-detected)* | Path to Ferdium data directory |

Example:
```bash
FERDIUM_PORT=8080 node server.js
```

## Data locations by OS

| OS | Ferdium data directory |
|---|---|
| macOS | `~/Library/Application Support/Ferdium` |
| Linux | `~/.config/Ferdium` |
| Windows | `%APPDATA%\Ferdium` |

## Reverting changes

The server creates a backup of your settings the first time it runs. You'll find it at:
```
<Ferdium data>/config/settings.json.backup-<timestamp>
```
Copy it back to `settings.json` to restore the original server URL.

## FAQ

**Q: Will I lose my chat history / login sessions?**
No. Sessions are stored in browser partitions on your disk. This server just tells Ferdium which services to load; it doesn't touch your session data.

**Q: Can I switch back to `api.ferdium.org` later?**
Yes. Just restore the backup of `settings.json` or change the server URL in Ferdium settings.

**Q: Some services weren't detected. What do I do?**
Delete `data.json` (created next to `server.js`) and restart the server to re-scan. If a service still isn't detected, you can manually add it through Ferdium's "Add Service" interface while the local server is running.

**Q: Does this work on Windows?**
Yes. It uses only built-in Node.js modules and auto-detects the Windows data directory (`%APPDATA%\Ferdium`).

## License

MIT
