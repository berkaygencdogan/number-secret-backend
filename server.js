const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const bodyParser = require("body-parser");

const { admin, db, auth } = require("./firebase");
const checkGuess = require("./gameLogic");
const generateRandomNumber = require("./numberGenerator");

const PORT = process.env.PORT || 5000;

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(bodyParser.json());
app.use(express.json());

const rooms = {};

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return next(); // eski endpoint’ler için engelleme yok

    const token = authHeader.split("Bearer ")[1];
    if (!token) return next();

    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    return res.status(401).json({ message: "Geçersiz token." });
  }
};

app.use(authMiddleware);

/* =========================================================
   🔁 CAN AUTO UPDATE (AYNI)
   ========================================================= */
function autoUpdateCan(user) {
  const MAX_CAN = 5;
  const INTERVAL = 10 * 60 * 1000;

  const now = Date.now();
  const last = user.lastCanUpdate || now;

  if (user.can >= MAX_CAN) {
    return { can: MAX_CAN, lastCanUpdate: last };
  }

  const elapsed = now - last;
  const gained = Math.floor(elapsed / INTERVAL);

  if (gained <= 0) {
    return { can: user.can, lastCanUpdate: last };
  }

  const newCan = Math.min(MAX_CAN, user.can + gained);
  const newLast = newCan >= MAX_CAN ? now : last + gained * INTERVAL;

  return { can: newCan, lastCanUpdate: newLast };
}

app.get("/", (req, res) => {
  res.send("Sunucu aktif");
});

/* =========================================================
   📝 REGISTER (ZATEN DOĞRUYDU)
   ========================================================= */
app.post("/register", async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ message: "Eksik bilgi." });
    }

    const userRecord = await auth.createUser({
      email,
      password,
      displayName: nickname,
    });

    const uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
      uid,
      email,
      nickname,
      score: 0,
      can: 5,
      lastCanUpdate: Date.now(),
      createdAt: Date.now(),
    });

    res.status(201).json({ success: true });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      return res.status(409).json({ message: "Email kayıtlı." });
    }
    res.status(500).json({ message: "Kayıt başarısız." });
  }
});

/* =========================================================
   🔑 LOGIN (TOKEN)
   ========================================================= */
app.post("/login", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token gerekli." });

    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) {
      return res.status(404).json({ message: "Kullanıcı yok." });
    }

    res.json({ success: true, user: snap.data() });
  } catch {
    res.status(401).json({ message: "Geçersiz token." });
  }
});

app.get("/getUser", authMiddleware, async (req, res) => {
  try {
    const ref = db.collection("users").doc(req.uid);

    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ message: "Kullanıcı yok." });

    const user = doc.data();
    const updated = autoUpdateCan(user);

    await ref.update(updated);

    res.json({ ...user, ...updated });
  } catch {
    res.status(500).json({ message: "Hata oluştu." });
  }
});

app.post("/changeScore", authMiddleware, async (req, res) => {
  try {
    const { scoreToAdd } = req.body;
    if (typeof scoreToAdd !== "number")
      return res.status(400).json({ message: "Hatalı skor." });

    const ref = db.collection("users").doc(req.uid);
    const doc = await ref.get();

    if (!doc.exists) return res.status(404).json({ message: "Kullanıcı yok." });

    const newScore = (doc.data().score || 0) + scoreToAdd;
    await ref.update({ score: newScore });

    res.json({ success: true, newScore });
  } catch {
    res.status(500).json({ message: "Skor güncellenemedi." });
  }
});

app.post("/updateUser", authMiddleware, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data) return res.status(400).json({ message: "Eksik veri." });

    const ref = db.collection("users").doc(req.uid);
    const doc = await ref.get();

    if (!doc.exists) return res.status(404).json({ message: "Kullanıcı yok." });

    await ref.update(data);
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Update hatası." });
  }
});

app.delete("/deleteUser", authMiddleware, async (req, res) => {
  try {
    await db.collection("users").doc(req.uid).delete();
    await auth.deleteUser(req.uid);

    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Silme hatası." });
  }
});

app.post("/create-room", (req, res) => {
  const { password, socketId, mode } = req.body;
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

  rooms[roomId] =
    mode === "online"
      ? {
          mode: "online",
          players: [],
          password: password || null,
          started: false,
          playerNumbers: {},
          readyCount: 0,
          turn: null,
        }
      : {
          mode: "classic",
          players: [],
          targetNumber: generateRandomNumber(),
          password: password || null,
          started: false,
        };

  if (socketId) {
    const client = io.sockets.sockets.get(socketId);
    if (client) client.emit("roomCreated", { roomId });
  }

  res.json({ roomId });
});

io.on("connection", (socket) => {
  socket.on("sendEmoji", ({ roomId, emoji }) => {
    socket.to(roomId).emit("receiveEmoji", emoji);
  });

  socket.on("joinRoom", ({ roomId, playerId, password }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error", "Oda yok.");

    if (room.password && room.password !== password) {
      return socket.emit("error", "Şifre yanlış.");
    }

    if (room.mode === "online") {
      room.playerNumbers = {};
      room.readyCount = 0;
    }

    if (!room.players.find((p) => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id });
    }

    socket.join(roomId);

    if (room.players.length === 2 && !room.started) {
      room.started = true;
      io.to(roomId).emit("gameStart");
    }
  });

  socket.on("guess", ({ roomId, guess, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.mode === "classic") {
      const { plus, minus } = checkGuess(guess, room.targetNumber);
      io.to(roomId).emit("newGuess", { playerId, guess, plus, minus });

      if (plus === 4) {
        io.to(roomId).emit("gameOver", { winnerId: playerId });
        delete rooms[roomId];
      }
    }
  });

  socket.on("disconnect", () => {
    Object.entries(rooms).forEach(([roomId, room]) => {
      room.players = room.players.filter((p) => p.socketId !== socket.id);
      if (room.players.length === 0) delete rooms[roomId];
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
