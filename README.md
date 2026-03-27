# Ferdium Local Rescue Server

A zero-dependency, single-file local server that replaces `api.ferdium.org` when it's down. It auto-detects your installed services and keeps Ferdium running entirely offline.

---

**[Scroll down for Spanish / Desplaza hacia abajo para Espanol](#espanol)**

---

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

---

<a name="espanol"></a>

# Servidor de Rescate Local para Ferdium

Un servidor local de un solo archivo, sin dependencias, que reemplaza `api.ferdium.org` cuando esta caido. Detecta automaticamente tus servicios instalados y mantiene Ferdium funcionando sin conexion al servidor oficial.

## Que hace esto?

Ferdium depende de `api.ferdium.org` para cargar tus servicios (WhatsApp, Telegram, Slack, etc.). Cuando ese servidor falla, **Ferdium ni siquiera arranca**. Este servidor de rescate corre en tu maquina y responde todas las llamadas API que Ferdium necesita, usando datos que ya estan en tu ordenador.

## Requisitos

- **Node.js 18 o superior** (comprueba con `node --version`)
- Nada mas. No necesitas `npm install` ni dependencias.

## Inicio rapido

### 1. Descarga `server.js`

Guarda el archivo en cualquier carpeta de tu ordenador.

### 2. Ejecutalo

```bash
node server.js
```

Eso es todo. El servidor:
- Detecta automaticamente tus datos de Ferdium
- Parchea `settings.json` para apuntar a localhost (creando un backup)
- Escanea tus servicios
- Arranca la API

Ahora abre Ferdium. Todo se conecta automaticamente.

### 3. Manten el servidor corriendo

Ferdium necesita este servidor ejecutandose en segundo plano mientras lo uses. Pulsa `Ctrl+C` para detenerlo cuando acabes.

## Como funciona

1. **Encuentra tus datos de Ferdium** automaticamente segun tu sistema operativo
2. **Lee tus recetas instaladas** (la carpeta `recipes/` en los datos de Ferdium)
3. **Escanea las particiones del navegador** para asociar cada UUID de servicio con una receta, extrayendo URLs de los archivos de almacenamiento local
4. **Sirve la API de Ferdium** en localhost, devolviendo tus servicios, features y recetas

Todas tus sesiones (cookies, tokens de login) se mantienen porque el servidor usa exactamente los mismos UUIDs que tus particiones existentes.

## Configuracion

| Variable de entorno | Por defecto | Descripcion |
|---|---|---|
| `FERDIUM_PORT` | `14569` | Puerto del servidor |
| `FERDIUM_DATA_DIR` | *(auto-detectado)* | Ruta al directorio de datos de Ferdium |

Ejemplo:
```bash
FERDIUM_PORT=8080 node server.js
```

## Revertir cambios

El servidor crea un backup de tu configuracion la primera vez que lo ejecutas. Lo encontraras en:
```
<datos de Ferdium>/config/settings.json.backup-<timestamp>
```
Copialo de vuelta a `settings.json` para restaurar la URL original del servidor.

## Preguntas frecuentes

**P: Perdere mi historial de chats / sesiones?**
No. Las sesiones estan almacenadas en particiones del navegador en tu disco. Este servidor solo le dice a Ferdium que servicios cargar; no toca los datos de sesion.

**P: Puedo volver a `api.ferdium.org` despues?**
Si. Restaura el backup de `settings.json` o cambia la URL del servidor en los ajustes de Ferdium.

**P: Algunos servicios no se detectaron. Que hago?**
Borra `data.json` (creado junto a `server.js`) y reinicia el servidor para re-escanear. Si un servicio sigue sin detectarse, puedes anadirlo manualmente desde la interfaz "Anadir Servicio" de Ferdium mientras el servidor local esta corriendo.

## Licencia

MIT
