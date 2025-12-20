const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const bodyParser = require("body-parser");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcrypt");

const { db } = require("./Firebase");
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
  console.log("Ping:", new Date().toLocaleString());
  res.send("Sunucu aktif");
});

app.get("/top-players", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();
    const players = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.nickname && typeof data.score === "number") {
        players.push({
          nickname: data.nickname,
          score: data.score,
          email: doc.id,
        });
      }
    });

    const sorted = players.sort((a, b) => b.score - a.score);
    const top10 = sorted.slice(0, 10);

    res.status(200).json({
      success: true,
      top10,
      allPlayers: sorted,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Sıralama alınamadı." });
  }
});

app.post("/registerUser", async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ message: "Eksik bilgi." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Geçersiz email." });
    }

    const nicknameQuery = await db
      .collection("users")
      .where("nickname", "==", nickname)
      .get();

    if (!nicknameQuery.empty) {
      return res.status(409).json({ message: "Nickname kullanılıyor." });
    }

    const userRef = db.collection("users").doc(email);
    const existingUser = await userRef.get();

    if (existingUser.exists) {
      return res.status(409).json({ message: "Email kayıtlı." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      nickname,
      score: 0,
      can: 5,
    };

    await userRef.set(newUser);

    res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    res.status(500).json({ message: "Kayıt başarısız." });
  }
});

app.post("/loginUser", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Eksik bilgi." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı yok." });
    }

    const user = doc.data();
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Şifre hatalı." });
    }

    res.status(200).json({
      success: true,
      user: {
        email: user.email,
        nickname: user.nickname,
        score: user.score,
        can: user.can,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Giriş başarısız." });
  }
});

app.post("/changeScore", async (req, res) => {
  try {
    const { email, scoreToAdd } = req.body;

    if (!email || typeof scoreToAdd !== "number") {
      return res.status(400).json({ message: "Hatalı veri." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı yok." });
    }

    const newScore = (doc.data().score || 0) + scoreToAdd;
    await userRef.update({ score: newScore });

    res.json({ success: true, newScore });
  } catch (err) {
    res.status(500).json({ message: "Skor güncellenemedi." });
  }
});

app.get("/getUser", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email gerekli." });

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı yok." });
    }

    let user = doc.data();
    const updated = autoUpdateCan(user);
    await userRef.update(updated);

    res.json({ ...user, ...updated });
  } catch (err) {
    res.status(500).json({ message: "Hata oluştu." });
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
