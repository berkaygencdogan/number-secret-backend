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

// ======================= MULTIPLAYER / SOCKET.IO =======================

// Oda yapısı: { roomId: { players: [], targetNumber: "1234", password, started } }
const rooms = {};

// 🔹 Rastgele oda kodu
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// server.js
app.get("/", (req, res) => {
  res.send("✅ Backend API Render üzerinde çalışıyor!");
});

app.get("/", (req, res) => {
  console.log("✅ Ping alındı:", new Date().toLocaleString());
  res.send("Sunucu aktif");
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

    console.log("🟦 Nickname kontrol başlıyor:", nickname);

    const nicknameQuery = await db
      .collection("users")
      .where("nickname", "==", nickname)
      .get();

    console.log("🟩 Nickname sorgu sonucu boş mu =", nicknameQuery.empty);
    console.log("🟩 Kaç adet eşleşen kullanıcı var:", nicknameQuery.size);

    if (!nicknameQuery.empty) {
      return res.status(409).json({
        message: "Bu kullanıcı adı kullanılıyor, lütfen başka bir tane seçin.",
      });
    }

    // Email unique check
    const userRef = db.collection("users").doc(email);
    const existingUser = await userRef.get();

    if (existingUser.exists) {
      return res.status(409).json({ message: "Bu email zaten kayıtlı." });
    }

    // Password hash
    const hashedPassword = await bcrypt.hash(password, 10);

    // Yeni kullanıcı oluştur
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
    const { email, amount } = req.body;

    if (!email || typeof amount !== "number") {
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
    await userRef.update({ score: currentScore + amount });

    console.log(`🏆 ${email} kullanıcısının skoru güncellendi: +${amount}`);
    res.status(200).json({ success: true, message: "Skor güncellendi." });
  } catch (error) {
    console.error("Skor güncellenirken hata:", error);
    res
      .status(500)
      .json({ message: "Skor güncellenemedi.", error: error.message });
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

    const userData = doc.data();
    console.log(`✅ Kullanıcı verisi alındı: ${email}`);
    res.status(200).json(userData);
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
  console.log("📥 /create-room endpoint çağrıldı");
  console.log("➡ Gelen body:", req.body);

  const { password, socketId, mode } = req.body;
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

  console.log("🆕 Oluşturulan RoomID:", roomId);

  let targetNumber = null;

  if (mode === "online") {
    console.log("🌐 ONLINE modda oda oluşturuluyor");

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
    console.log("🎮 CLASSIC modda oda oluşturuluyor");

    targetNumber = generateRandomNumber();

    rooms[roomId] = {
      mode: "classic",
      players: [],
      targetNumber,
      password: password || null,
      started: false,
    };

    console.log("🎯 Classic Mod Target Number:", targetNumber);
  }

  // socket id geldiyse logla
  console.log("🔌 socketId geldi mi?", socketId);

  // Eğer socketId geldiyse client’a özel roomCreated gönder
  if (socketId) {
    const client = io.sockets.sockets.get(socketId);
    if (client) {
      console.log("📤 roomCreated emit gönderildi:", roomId);
      client.emit("roomCreated", { roomId });
    } else {
      console.log("❌ socketId eşleşmedi, client bulunamadı");
    }
  }

  console.log("📤 Response olarak roomId yollandı:", roomId);
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

    // ============================================================
    // 🟦 MODE: ONLINE (SIRALI + HER OYUNCU KENDİ SAYISINI BELİRLER)
    // ============================================================
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

    console.log(
      `Oda ${roomId} | Oyuncu ${playerId} tahmin: ${guess} -> +${plus} -${minus}`
    );

    io.to(roomId).emit("newGuess", { playerId, guess, plus, minus });

    if (plus === 4) {
      console.log(`Oda ${roomId}: ${playerId} kazandı!`);
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
