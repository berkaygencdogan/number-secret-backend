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
  const INTERVAL = 10 * 60 * 1000; // 10 dakika

  const now = Date.now();
  const last = user.lastCanUpdate || now;

  // Eğer zaten full ise hiç hesap yapma
  if (user.can >= MAX_CAN) {
    return {
      can: MAX_CAN,
      lastCanUpdate: last,
    };
  }

  const elapsed = now - last;
  const gained = Math.floor(elapsed / INTERVAL);

  // Henüz can kazanacak kadar süre geçmemiş
  if (gained <= 0) {
    return {
      can: user.can,
      lastCanUpdate: last,
    };
  }

  const newCan = Math.min(MAX_CAN, user.can + gained);

  const newLast = newCan >= MAX_CAN ? now : last + gained * INTERVAL;

  return {
    can: newCan,
    lastCanUpdate: newLast,
  };
}

// server.js
app.get("/", (req, res) => {
  res.send("✅ Backend API Render üzerinde çalışıyor!");
});

app.get("/", (req, res) => {
  console.log("✅ Ping alındı:", new Date().toLocaleString());
  res.send("Sunucu aktif");
});

// 🔥 En iyi 10 oyuncuyu sıralayan endpoint
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
          email: doc.id, // email doc id olarak tutuluyor
        });
      }
    });

    // Skora göre büyükten küçüğe sırala
    const sorted = players.sort((a, b) => b.score - a.score);

    // İlk 10'u al
    const top10 = sorted.slice(0, 10);

    res.status(200).json({
      success: true,
      top10,
      allPlayers: sorted, // kullanıcı sırasını bulmak için
    });
  } catch (err) {
    console.error("🔥 Sıralama hatası:", err);
    res.status(500).json({ success: false, message: "Sıralama alınamadı." });
  }
});

app.post("/registerUser", async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    if (!email || !password || !nickname) {
      return res.status(400).json({ message: "Eksik bilgi gönderildi." });
    }

    // Email format kontrolü
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Geçerli bir email giriniz." });
    }

    const nicknameQuery = await db
      .collection("users")
      .where("nickname", "==", nickname)
      .get();

    if (!nicknameQuery.empty) {
      return res.status(409).json({
        message: "Bu kullanıcı adı kullanılıyor, lütfen başka bir tane seçin.",
      });
    }

    const userRef = db.collection("users").doc(email);
    const existingUser = await userRef.get();

    if (existingUser.exists) {
      return res.status(409).json({ message: "Bu email zaten kayıtlı." });
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

    res.status(201).json({
      success: true,
      message: "Kayıt başarılı.",
      user: newUser,
    });
  } catch (error) {
    console.error("Kayıt oluşturulurken hata:", error);
    res.status(500).json({
      message: "Kayıt başarısız.",
      error: error.message,
    });
  }
});

app.post("/logoutUser", (req, res) => {
  try {
    console.log("🚪 Kullanıcı çıkış yaptı.");
    res.status(200).json({ success: true, message: "Çıkış başarılı." });
  } catch (error) {
    res.status(500).json({ message: "Çıkış başarısız.", error: error.message });
  }
});

app.post("/changeScore", async (req, res) => {
  try {
    const { email, scoreToAdd } = req.body;

    if (!email || typeof scoreToAdd !== "number") {
      return res
        .status(400)
        .json({ message: "Eksik veya hatalı veri gönderildi." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const currentScore = doc.data().score || 0;
    const newScore = currentScore + scoreToAdd;

    await userRef.update({ score: newScore });

    console.log(
      `🏆 Skor güncellendi → ${email}: ${currentScore} → ${newScore}`
    );

    res.status(200).json({
      success: true,
      message: "Skor güncellendi.",
      newScore,
    });
  } catch (error) {
    console.error("Skor güncellenirken hata:", error);
    res.status(500).json({
      message: "Skor güncellenemedi.",
      error: error.message,
    });
  }
});

app.get("/getUser", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).json({ message: "Email parametresi gerekli." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    let user = doc.data();

    // CAN SİSTEMİ BURADA ÇALIŞIYOR 🔥
    const updated = autoUpdateCan(user);

    // Güncellenmiş değerleri Firestore’a yaz
    await userRef.update(updated);

    // Frontend'e gönder
    user = { ...user, ...updated };

    console.log(`🔋 Can güncellendi:`, updated);

    res.status(200).json(user);
  } catch (error) {
    console.error("Kullanıcı verisi alınırken hata:", error);
    res.status(500).json({
      message: "Kullanıcı verisi alınamadı.",
      error: error.message,
    });
  }
});

app.delete("/deleteUser", async (req, res) => {
  try {
    // email hem body'den hem query'den alınabilir
    const email = req.body.email || req.query.email;
    if (!email) {
      return res.status(400).json({ message: "Email gerekli." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    await userRef.delete();
    console.log(`🗑️ Kullanıcı Firestore'dan silindi: ${email}`);

    res
      .status(200)
      .json({ success: true, message: "Kullanıcı başarıyla silindi!" });
  } catch (error) {
    console.error("Kullanıcı silinirken hata:", error);
    res
      .status(500)
      .json({ message: "Kullanıcı silinemedi.", error: error.message });
  }
});

app.post("/loginUser", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email ve şifre gerekli." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    const user = doc.data();

    // 🔒 Şifre kontrolü
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Şifre hatalı." });
    }

    console.log(`✅ Giriş başarılı: ${email}`);
    res.status(200).json({
      success: true,
      message: "Giriş başarılı.",
      user: {
        email: user.email,
        nickname: user.nickname,
        score: user.score,
        can: user.can,
      },
    });
  } catch (error) {
    console.error("Giriş yapılırken hata oluştu:", error);
    res.status(500).json({
      message: "Giriş başarısız.",
      error: error.message,
    });
  }
});

app.post("/updateUser", async (req, res) => {
  try {
    const { email, data } = req.body;

    if (!email || !data) {
      return res.status(400).json({ message: "Eksik bilgi gönderildi." });
    }

    const userRef = db.collection("users").doc(email);
    const doc = await userRef.get();

    if (!doc.exists) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    }

    await userRef.update(data);

    console.log(`Kullanıcı başarıyla güncellendi: ${email}`);
    res.status(200).json({ success: true, message: "Kullanıcı güncellendi." });
  } catch (error) {
    console.error("Kullanıcı güncellenirken hata oluştu:", error);
    res.status(500).json({
      message: "Kullanıcı güncellenemedi.",
      error: error.message,
    });
  }
});

// 🔸 Oda oluşturma (şifreli veya şifresiz)
app.post("/create-room", (req, res) => {
  const { password, socketId, mode } = req.body;
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

  let targetNumber = null;

  if (mode === "online") {
    rooms[roomId] = {
      mode: "online",
      players: [],
      targetNumber: null,
      password: password || null,
      started: false,
      playerNumbers: {},
      readyCount: 0,
      turn: null,
    };
  } else {
    targetNumber = generateRandomNumber();

    rooms[roomId] = {
      mode: "classic",
      players: [],
      targetNumber,
      password: password || null,
      started: false,
    };
  }

  // socket id geldiyse logla

  // Eğer socketId geldiyse client’a özel roomCreated gönder
  if (socketId) {
    const client = io.sockets.sockets.get(socketId);
    if (client) {
      client.emit("roomCreated", { roomId });
    } else {
      console.log("❌ socketId eşleşmedi, client bulunamadı");
    }
  }

  res.json({ roomId });
});

// ======================= SOCKET EVENTLER =======================
io.on("connection", (socket) => {
  console.log("Yeni bağlantı:", socket.id);

  socket.on("sendEmoji", ({ roomId, emoji }) => {
    console.log(`🎭 Emoji gönderildi: ${emoji} → oda: ${roomId}`);
    socket.to(roomId).emit("receiveEmoji", emoji);
  });

  // 🎯 Oyuncu kendi gizli sayısını belirliyor
  socket.on("setNumber", ({ roomId, playerId, number }) => {
    const room = rooms[roomId];
    if (!room) return;

    // Kontroller
    if (number.length !== 4) {
      socket.emit("error", "Sayı 4 basamaklı olmalıdır.");
      return;
    }
    if (number[0] === "0") {
      socket.emit("error", "İlk basamak 0 olamaz.");
      return;
    }
    if (new Set(number).size !== 4) {
      socket.emit("error", "Tüm rakamlar farklı olmalıdır.");
      return;
    }

    room.playerNumbers[playerId] = number;
    room.readyCount++;

    console.log(`🎯 Oyuncu ${playerId} gizli sayı belirledi → ${number}`);

    // İki oyuncu da sayı belirlediyse oyun başlar
    if (room.readyCount === 2) {
      const firstPlayer = room.players[0].id;
      room.turn = firstPlayer;

      io.to(roomId).emit("bothReady");
      io.to(roomId).emit("turn", room.turn);

      console.log(
        `🚀 Oda ${roomId}: Her iki oyuncu hazır. İlk sıra: ${firstPlayer}`
      );
    }
  });

  // 🏗️ Odaya katılma
  socket.on("joinRoom", ({ roomId, playerId, password }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("error", "Oda bulunamadı.");
      return;
    }

    if (room.password && room.password !== password) {
      socket.emit("error", "Oda şifresi hatalı.");
      return;
    }

    // 🔥 Online modda eski sayı verilerini sıfırla (ÇOOOOK ÖNEMLİ)
    if (room.mode === "online") {
      room.playerNumbers = {};
      room.readyCount = 0;
    }

    if (!room.players.find((p) => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id });
    }

    socket.join(roomId);
    console.log(`Oyuncu ${playerId} odaya katıldı: ${roomId}`);

    if (room.players.length === 2 && !room.started) {
      room.started = true;
      io.to(roomId).emit("gameStart");
    }
  });

  // ⚡ Hızlı giriş (şifresiz, başlamamış odalardan rastgele seçim)
  socket.on("quickJoin", ({ playerId }) => {
    console.log("⚠ quickJoin playerId:", playerId);

    if (!playerId) {
      socket.emit("error", "Player ID alınamadı.");
      console.log("❌ quickJoin reddedildi: PlayerId yok");
      return;
    }

    const availableRooms = Object.entries(rooms)
      .filter(([_, r]) => !r.password && !r.started)
      .map(([id]) => id);

    if (availableRooms.length === 0) {
      socket.emit("noRoom");
      return;
    }

    const randomRoomId =
      availableRooms[Math.floor(Math.random() * availableRooms.length)];
    const room = rooms[randomRoomId];

    if (!room.players.find((p) => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id });
    }

    socket.join(randomRoomId);
    socket.emit("joinedRoom", randomRoomId);
    console.log(`Oyuncu ${playerId} hızlı giriş yaptı: ${randomRoomId}`);

    if (room.players.length === 2 && !room.started) {
      room.started = true;
      io.to(randomRoomId).emit("gameStart");
      console.log(`Oda ${randomRoomId}: Oyun başlatıldı.`);
    }
  });

  // 🎯 Tahmin yapma
  socket.on("guess", ({ roomId, guess, playerId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Oda bulunamadı.");
      return;
    }

    if (!guess || guess.length !== 4) {
      socket.emit("error", "4 basamaklı sayı girin.");
      return;
    }

    if (room.mode === "online") {
      // Sıra kontrolü
      if (room.turn !== playerId) {
        socket.emit("error", "Sıra sende değil!");
        return;
      }

      // Rakibin gizli sayısını bul
      const targetPlayer = room.players.find((p) => p.id !== playerId)?.id;
      const targetNumber = room.playerNumbers[targetPlayer];

      if (!targetNumber) {
        socket.emit("error", "Rakibin sayısı henüz hazır değil.");
        return;
      }

      // Plus/minus hesapla
      const { plus, minus } = checkGuess(guess, targetNumber);

      io.to(roomId).emit("newGuess", { playerId, guess, plus, minus });

      // Kazandı mı?
      if (plus === 4) {
        io.to(roomId).emit("gameOver", { winnerId: playerId });
        delete rooms[roomId];
        return;
      }

      // Sıra değiştir
      const otherPlayer = targetPlayer;
      room.turn = otherPlayer;
      io.to(roomId).emit("turn", otherPlayer);

      return;
    }

    // ============================================================
    // 🟩 MODE: CLASSIC (ORTAK TARGETNUMBER ÜZERİNDEN)
    // ============================================================

    const { targetNumber } = room;
    const { plus, minus } = checkGuess(guess, targetNumber);

    io.to(roomId).emit("newGuess", { playerId, guess, plus, minus });

    if (plus === 4) {
      io.to(roomId).emit("gameOver", { roomId, winnerId: playerId });
      delete rooms[roomId];
    }
  });

  // 🚪 Odayı terk etme
  socket.on("leaveRoom", (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    room.players = room.players.filter((p) => p.socketId !== socket.id);
    socket.leave(roomId);

    if (room.players.length === 0) {
      delete rooms[roomId];
      console.log(`Oda ${roomId} boşaldı, silindi.`);
    } else {
      io.to(roomId).emit("playerLeft", "Rakip oyundan ayrıldı.");
      room.started = false;
    }
  });

  // 🧹 Bağlantı koptu
  socket.on("disconnect", () => {
    console.log("Bağlantı koptu:", socket.id);
    for (const [roomId, room] of Object.entries(rooms)) {
      const playerIndex = room.players.findIndex(
        (p) => p.socketId === socket.id
      );
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomId).emit("playerLeft", "Rakip bağlantısı koptu.");
        if (room.players.length === 0) delete rooms[roomId];
      }
    }
  });
});

// ======================= SERVER START =======================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Sunucu http://0.0.0.0:${PORT} üzerinde çalışıyor.`);
});
