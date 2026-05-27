const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Bonjour } = require("bonjour-service");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: false
  }
});

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const FRIENDLY_HOST = "lan-chat";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const publicDir = __dirname;
const uploadDir = path.join(__dirname, "uploads");
const connectedUsers = new Map();
const sharedFiles = new Map();
let bonjour;
let mdnsService;

fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.static(publicDir));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.post("/upload", express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }), (req, res) => {
  const socketId = String(req.header("x-socket-id") || "");
  const username = connectedUsers.get(socketId);

  if (!username) {
    return res.status(401).json({ error: "This device is not registered in the chat yet." });
  }

  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    return res.status(400).json({ error: "The file is empty or could not be read." });
  }

  const fileName = sanitizeFileName(req.header("x-file-name") || "file");
  const mimeType = String(req.header("content-type") || "application/octet-stream").slice(0, 120);
  const fileId = crypto.randomUUID();
  const storedName = `${fileId}${path.extname(fileName).slice(0, 16)}`;
  const storedPath = path.join(uploadDir, storedName);
  const timestamp = nowIso();

  fs.writeFile(storedPath, req.body, (error) => {
    if (error) {
      console.error("Failed to save file:", error);
      return res.status(500).json({ error: "Failed to save the file on the server." });
    }

    const file = {
      id: fileId,
      name: fileName,
      size: req.body.length,
      mimeType,
      storedName,
      timestamp
    };

    sharedFiles.set(fileId, file);

    const payload = {
      id: socketId,
      username,
      timestamp,
      file: {
        id: file.id,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        downloadUrl: `/download/${file.id}`
      }
    };

    io.emit("file message", payload);
    res.status(201).json(payload.file);
  });
});

app.get("/download/:id", (req, res) => {
  const file = sharedFiles.get(req.params.id);

  if (!file) {
    return res.status(404).send("File not found or the server has been restarted.");
  }

  const storedPath = path.join(uploadDir, file.storedName);

  res.download(storedPath, file.name, (error) => {
    if (error && !res.headersSent) {
      res.status(404).send("File is not available.");
    }
  });
});

function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32);
}

function normalizeMessage(message) {
  return String(message || "")
    .trim()
    .slice(0, 1000);
}

function sanitizeFileName(fileName) {
  let decodedName = String(fileName || "file");

  try {
    decodedName = decodeURIComponent(decodedName);
  } catch (error) {
    decodedName = "file";
  }

  const safeName = path.basename(decodedName)
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return safeName || "file";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function nowIso() {
  return new Date().toISOString();
}

function getLocalIPv4Addresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();

  for (const infos of Object.values(interfaces)) {
    for (const info of infos || []) {
      if (info.family === "IPv4" && !info.internal) {
        addresses.push(info.address);
      }
    }
  }

  return addresses;
}

const color = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  orange: "\x1b[38;5;209m",
  white: "\x1b[97m"
};

function printStartupBanner() {
  const localAddresses = getLocalIPv4Addresses();
  const portSuffix = PORT === 80 ? "" : `:${PORT}`;
  const urls = localAddresses.map((address) => `http://${address}${portSuffix}`);
  const computerName = os.hostname();
  const line = `${color.dim}${"-".repeat(64)}${color.reset}`;
  const logo = [
    " _        _    _   _      _____ _   _    _  _____ ",
    "| |      / \\  | \\ | |    / ____| | | |  / \\|_   _|",
    "| |     / _ \\ |  \\| |   | |    | |_| | / _ \\ | |  ",
    "| |___ / ___ \\| |\\  |   | |____|  _  |/ ___ \\| |  ",
    "|_____/_/   \\_\\_| \\_|    \\_____|_| |_/_/   \\_\\_|  "
  ];

  console.clear();
  console.log(`${color.cyan}~${color.reset}`);
  console.log(`${color.white}lan-chat${color.reset}\n`);
  console.log(`${color.orange}${logo.join("\n")}${color.reset}`);
  console.log(`\n${color.orange}LAN Chat v1.0${color.reset}`);
  console.log(`${color.dim}Real-time group chat for local WiFi networks${color.reset}\n`);
  console.log(line);
  console.log(`${color.green}?${color.reset} Status        : ${color.green}RUNNING${color.reset}`);
  console.log(`${color.green}>${color.reset} Localhost     : ${color.white}http://localhost${portSuffix}${color.reset}`);
  console.log(`${color.green}>${color.reset} Short URL     : ${color.white}http://${FRIENDLY_HOST}.local${portSuffix}${color.reset}`);
  console.log(`${color.green}>${color.reset} PC name       : ${color.white}http://${computerName}${portSuffix}${color.reset}`);
  console.log(`${color.green}>${color.reset} Host binding  : ${color.white}${HOST}:${PORT}${color.reset}`);
  console.log(`${color.green}>${color.reset} Upload limit  : ${color.white}${formatBytes(MAX_UPLOAD_BYTES)} per file${color.reset}`);
  console.log(`${color.green}>${color.reset} mDNS          : ${color.white}${mdnsService ? "active" : "inactive"}${color.reset}`);
  console.log(line);

  if (urls.length > 0) {
    console.log(`${color.yellow}!${color.reset} Current LAN IP for phones and other devices:`);
    urls.forEach((url) => {
      console.log(`  ${color.cyan}${url}${color.reset}`);
    });
  } else {
    console.log(`${color.red}! No LAN IPv4 address was detected.${color.reset}`);
    console.log(`  Run ${color.white}ipconfig${color.reset}, then check the IPv4 address on your Wi-Fi adapter.`);
  }
}

function startMdnsAdvertisement() {
  try {
    bonjour = new Bonjour();
    mdnsService = bonjour.publish({
      name: FRIENDLY_HOST,
      host: `${FRIENDLY_HOST}.local`,
      type: "http",
      port: PORT,
      txt: {
        app: "lan-chat",
        path: "/"
      }
    });
  } catch (error) {
    mdnsService = null;
    console.warn("mDNS could not be started:", error.message);
  }
}

function stopMdnsAdvertisement() {
  if (mdnsService) {
    mdnsService.stop();
  }

  if (bonjour) {
    bonjour.destroy();
  }
}

io.on("connection", (socket) => {
  socket.on("set username", (username, ack) => {
    const cleanUsername = normalizeUsername(username);

    if (!cleanUsername) {
      if (typeof ack === "function") {
        ack({ ok: false, error: "Username is required." });
      }
      return;
    }

    socket.data.username = cleanUsername;
    connectedUsers.set(socket.id, cleanUsername);

    if (typeof ack === "function") {
      ack({ ok: true, id: socket.id, username: cleanUsername });
    }

    socket.broadcast.emit("system message", {
      text: `${cleanUsername} joined the chat`,
      timestamp: nowIso()
    });
  });

  socket.on("chat message", (message) => {
    const username = socket.data.username;
    const text = normalizeMessage(message);

    if (!username || !text) {
      return;
    }

    io.emit("chat message", {
      id: socket.id,
      username,
      text,
      timestamp: nowIso()
    });
  });

  socket.on("disconnect", () => {
    const username = socket.data.username;
    connectedUsers.delete(socket.id);

    if (username) {
      socket.broadcast.emit("system message", {
        text: `${username} left the chat`,
        timestamp: nowIso()
      });
    }
  });
});

app.use((error, req, res, next) => {
  if (error && error.type === "entity.too.large") {
    return res.status(413).json({
      error: `File is too large. Maximum size is ${formatBytes(MAX_UPLOAD_BYTES)}.`
    });
  }

  return next(error);
});

server.listen(PORT, HOST, () => {
  startMdnsAdvertisement();
  printStartupBanner();
});

process.on("SIGINT", () => {
  stopMdnsAdvertisement();
  server.close(() => {
    process.exit(0);
  });
});
