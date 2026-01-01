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

  // 🔥 KRİTİK KORUMA
  const last =
    typeof user.lastCanUpdate === "number" ? user.lastCanUpdate : now;

  const currentCan = typeof user.can === "number" ? user.can : MAX_CAN;

  if (currentCan >= MAX_CAN) {
    return { can: MAX_CAN, lastCanUpdate: last };
  }

  const elapsed = now - last;
  const gained = Math.floor(elapsed / INTERVAL);

  if (gained <= 0) {
    return { can: currentCan, lastCanUpdate: last };
  }

  const newCan = Math.min(MAX_CAN, currentCan + gained);
  const newLast = newCan >= MAX_CAN ? now : last + gained * INTERVAL;

  return {
    can: newCan,
    lastCanUpdate: newLast,
  };
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

app.get("/top-players", async (req, res) => {
  try {
    const snapshot = await db.collection("users").get();

    const players = [];

    snapshot.forEach((doc) => {
      const data = doc.data();

      // Güvenlik: eksik veri varsa alma
      if (
        typeof data.nickname === "string" &&
        typeof data.score === "number" &&
        typeof data.email === "string"
      ) {
        players.push({
          uid: doc.id,
          email: data.email,
          nickname: data.nickname,
          score: data.score,
        });
      }
    });

    // Skora göre büyükten küçüğe sırala
    players.sort((a, b) => b.score - a.score);

    const top10 = players.slice(0, 10);

    res.status(200).json({
      success: true,
      top10,
      allPlayers: players,
    });
  } catch (error) {
    console.error("❌ /top-players error:", error);
    res.status(500).json({
      success: false,
      message: "Leaderboard alınamadı.",
    });
  }
});

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
  console.log("object");
  try {
    console.log("backend girdi");
    const ref = db.collection("users").doc(req.uid);

    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ message: "Kullanıcı yok." });

    const user = doc.data();
    const updated = autoUpdateCan(user);
    console.log("updated", updated);
    if (
      updated.can !== user.can ||
      updated.lastCanUpdate !== user.lastCanUpdate
    ) {
      await ref.update(updated);
    }

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

app.get("/rooms", (req, res) => {
  try {
    const roomList = Object.entries(rooms).map(([roomId, room]) => {
      return {
        roomId,
        mode: room.mode === "multiplayer" ? "multiplayer" : "online",
        difficulty: room.difficulty || "easy",
        players: room.players?.length || 0,
        hasPassword: !!room.password,
      };
    });

    res.status(200).json(roomList);
  } catch (err) {
    console.error("ROOM LIST ERROR:", err);
    res.status(500).json([]);
  }
});

app.post("/create-room", (req, res) => {
  const { password, socketId, mode, difficulty } = req.body;
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  console.log("mode ve zorluk", mode, difficulty);
  if (mode === "multiplayer") {
    rooms[roomId] = {
      // 👥 REKABET MODU
      mode: "multiplayer",
      players: [],
      targetNumber: generateRandomNumber(),
      password: password || null,
      started: false,
      difficulty: difficulty || "easy",
    };
  } else if (mode === "online") {
    rooms[roomId] = {
      // 🌐 ONLINE MOD
      mode: "online",
      difficulty: difficulty || "easy",
      players: [],
      password: password || null,
      started: false,
      playerNumbers: {},
      readyCount: 0,
      turn: null,
    };
  } else if (mode === "single") {
    rooms[roomId] = {
      mode: "single",
      difficulty,
      targetNumber: generateRandomNumber(),
      players: [{ id: playerId, socketId }],
      started: true,
      attempts: 0, // 🔥 EKLE
    };
  }

  if (mode === "multiplayer") {
    console.log(
      `🎯 ROOM ${roomId} TARGET NUMBER →`,
      rooms[roomId].targetNumber,
      `(difficulty: ${rooms[roomId].difficulty})`
    );
  }

  if (socketId) {
    const client = io.sockets.sockets.get(socketId);
    if (client) client.emit("roomCreated", { roomId });
  }

  res.json({ roomId });
});

app.post("/rewardCan", authMiddleware, async (req, res) => {
  try {
    if (!req.uid) {
      return res.status(401).json({ message: "Auth gerekli" });
    }

    const ref = db.collection("users").doc(req.uid);
    const doc = await ref.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı yok" });
    }

    const user = doc.data();
    const MAX_CAN = 5;

    if (user.can >= MAX_CAN) {
      return res.json({ can: user.can, user });
    }

    const newCan = user.can + 1;

    await ref.update({
      can: newCan,
      lastCanUpdate: Date.now(),
    });

    const updatedUser = {
      ...user,
      can: newCan,
      lastCanUpdate: Date.now(),
    };

    res.json({
      can: newCan,
      user: updatedUser,
    });
  } catch (err) {
    console.error("rewardCan error:", err);
    res.status(500).json({ message: "Reward can error" });
  }
});

io.on("connection", (socket) => {
  console.log("🔌 CONNECT:", socket.id);

  socket.onAny((event, ...args) => {
    console.log("📡 EVENT:", event, "FROM:", socket.id, "DATA:", args);
  });

  socket.on("disconnect", (reason) => {
    console.log("❌ DISCONNECT:", socket.id, "REASON:", reason);
  });

  socket.on("sendEmoji", ({ roomId, emoji }) => {
    socket.to(roomId).emit("receiveEmoji", emoji);
  });

  socket.on("findMatch", ({ playerId, difficulty, mode }) => {
    console.log("🔍 FIND MATCH:", {
      socketId: socket.id,
      playerId,
      difficulty,
      mode,
    });

    if (mode !== "multiplayer") {
      console.log("⛔ MODE REDDEDİLDİ:", mode);
      return;
    }

    // 1️⃣ Uygun bekleyen oda ara
    const existingRoomId = Object.keys(rooms).find((roomId) => {
      const room = rooms[roomId];
      return (
        room.mode === "multiplayer" &&
        room.difficulty === difficulty &&
        room.started === false &&
        room.players.length === 1
      );
    });

    if (existingRoomId) {
      const room = rooms[existingRoomId];

      console.log("🤝 MATCH FOUND → JOIN ROOM:", existingRoomId);

      room.players.push({
        id: playerId,
        socketId: socket.id,
      });

      room.started = true;
      socket.join(existingRoomId);

      // 🎮 HERKESE GAME START
      io.to(existingRoomId).emit("gameStart", {
        roomId: existingRoomId,
        mode: "multiplayer",
        difficulty: room.difficulty,
      });

      return;
    }

    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    rooms[roomId] = {
      mode: "multiplayer",
      difficulty,
      players: [
        {
          id: playerId,
          socketId: socket.id,
        },
      ],
      targetNumber: generateRandomNumber(),
      started: false,
      password: null,
    };

    socket.join(roomId);

    console.log(
      "🆕 ROOM CREATED & WAITING:",
      roomId,
      "difficulty:",
      difficulty
    );

    socket.emit("waitingForOpponent", {
      roomId,
      difficulty,
    });
  });

  socket.on("createSingleRoom", ({ playerId, difficulty }, callback) => {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    rooms[roomId] = {
      mode: "single",
      difficulty: difficulty || "easy",
      targetNumber: generateRandomNumber(),
      players: [{ id: playerId, socketId: socket.id }],
      started: true,
      attempts: 0,
    };

    socket.join(roomId);

    console.log("🎮 SINGLE ROOM CREATED →", roomId, difficulty);

    // 🔥 CALLBACK İLE GERİ DÖN
    callback({ roomId });
  });

  socket.on("joinRoom", ({ roomId, playerId, password }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("error", "Oda yok.");

    if (room.password && room.password !== password) {
      return socket.emit("error", "Şifre yanlış.");
    }

    if (!room.players.find((p) => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id });
    }

    socket.join(roomId);

    // ✅ MODE + DIFFICULTY GÖNDER
    socket.emit("joinedRoom", {
      roomId,
      mode: room.mode, // 🔥 EKLENDİ
      difficulty: room.difficulty, // 🔥 EKLENDİ
    });

    // 🎮 GAME START
    if (room.players.length === 2 && !room.started) {
      room.started = true;

      setTimeout(() => {
        io.to(roomId).emit("gameStart", {
          roomId,
          mode: room.mode, // 🔥 EKLENDİ
          difficulty: room.difficulty, // 🔥 EKLENDİ
        });

        console.log(
          "GAME START →",
          roomId,
          "MODE:",
          room.mode,
          "DIFFICULTY:",
          room.difficulty
        );
      }, 100);
    }
  });

  socket.on("guess", async ({ roomId, guess, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // ONLINE modda sıra kontrolü
    if (room.mode === "online" && room.turn !== playerId) return;

    let targetNumber;
    let opponentId = null;

    if (room.mode === "multiplayer" || room.mode === "single") {
      targetNumber = room.targetNumber;
      opponentId = room.players.find((p) => p.id !== playerId)?.id || null;
    } else if (room.mode === "online") {
      opponentId = Object.keys(room.playerNumbers).find(
        (id) => id !== playerId
      );
      targetNumber = room.playerNumbers[opponentId];
    }

    if (!targetNumber) return;

    room.attempts = (room.attempts || 0) + 1;

    const { plus, minus } = checkGuess(guess, targetNumber);

    let colors = null;
    if (room.difficulty === "easy") {
      colors = guess
        .split("")
        .map((d, i) =>
          d === targetNumber[i]
            ? "green"
            : targetNumber.includes(d)
            ? "yellow"
            : "red"
        );
    }

    io.to(roomId).emit("newGuess", {
      playerId,
      guess,
      plus,
      minus,
      colors,
      attempts: room.attempts, // UI isterse kullanır
    });

    if (plus === 4) {
      io.to(roomId).emit("gameOver", { winnerId: playerId });

      const scoreToAdd = room.difficulty === "hard" ? 200 : 100;

      try {
        // single + multiplayer → kazanırsa puan
        if (room.mode !== "online" || opponentId) {
          await db
            .collection("users")
            .doc(playerId)
            .update({
              score: admin.firestore.FieldValue.increment(scoreToAdd),
            });

          console.log(
            `🏆 SCORE +${scoreToAdd} →`,
            playerId,
            `(mode:${room.mode}, difficulty:${room.difficulty})`
          );
        }
      } catch (err) {
        console.error("❌ SCORE UPDATE ERROR:", err.message);
      }

      delete rooms[roomId];
      return;
    }

    if (room.attempts >= 8) {
      let winnerId = null;

      // online / multiplayer → rakip kazanır
      if (room.mode !== "single" && opponentId) {
        winnerId = opponentId;
      }

      io.to(roomId).emit("gameOver", { winnerId });

      delete rooms[roomId];
      return;
    }

    /* ===============================
     🔁 ONLINE MOD SIRA
     =============================== */
    if (room.mode === "online" && opponentId) {
      room.turn = opponentId;
      io.to(roomId).emit("turn", opponentId);
    }
  });

  socket.on("setNumber", ({ roomId, playerId, number }) => {
    const room = rooms[roomId];
    if (!room || room.mode !== "online") return;

    console.log("SET NUMBER:", roomId, playerId, number);

    // 🔒 Aynı oyuncu tekrar göndermesin
    if (room.playerNumbers[playerId]) return;

    // Kaydet
    room.playerNumbers[playerId] = number;
    room.readyCount += 1;

    // 🧠 İki oyuncu da hazır mı?
    if (room.readyCount === 2) {
      // İlk başlayan rastgele
      const firstPlayer =
        room.players[Math.floor(Math.random() * room.players.length)].id;

      room.turn = firstPlayer;

      // 🔥 HERKESE BİLDİR
      io.to(roomId).emit("bothReady");
      io.to(roomId).emit("turn", firstPlayer);

      console.log("BOTH READY → TURN:", firstPlayer);
    }
  });
  socket.on("leaveRoom", async (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    // çıkan oyuncuyu bul
    const leavingPlayer = room.players.find((p) => p.socketId === socket.id);

    // oyuncuyu odadan çıkar
    room.players = room.players.filter((p) => p.socketId !== socket.id);

    socket.leave(roomId);

    /* ===============================
     👤 SINGLE MODE
     =============================== */
    if (room.mode === "single") {
      // tek oyuncu çıktı → puan YOK
      delete rooms[roomId];
      console.log("🗑 SINGLE ROOM LEFT:", roomId);
      return;
    }

    /* ===============================
     🏆 KARŞI TARAF VARSA → O KAZANIR
     =============================== */
    if (room.players.length === 1 && leavingPlayer) {
      const winnerId = room.players[0].id;

      io.to(roomId).emit("gameOver", {
        winnerId,
        reason: "player_left",
      });

      // 🔥 ZORLUKA GÖRE PUAN
      const scoreToAdd = room.difficulty === "hard" ? 200 : 100;

      try {
        const ref = db.collection("users").doc(winnerId);
        await ref.update({
          score: admin.firestore.FieldValue.increment(scoreToAdd),
        });

        console.log(
          `🏆 SCORE +${scoreToAdd} →`,
          winnerId,
          `(leaveRoom, difficulty: ${room.difficulty})`
        );
      } catch (err) {
        console.error("❌ SCORE UPDATE ERROR:", err.message);
      }
    }

    /* ===============================
     🗑 ODAYI SİL
     =============================== */
    delete rooms[roomId];
    console.log("🗑 ROOM DELETED:", roomId);
  });

  socket.on("disconnect", () => {
    Object.entries(rooms).forEach(([roomId, room]) => {
      const before = room.players.length;

      room.players = room.players.filter((p) => p.socketId !== socket.id);

      if (before !== room.players.length) {
        socket.to(roomId).emit("playerLeft");
      }

      if (room.players.length === 0) {
        delete rooms[roomId];
      }
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on ${PORT}`);
});
