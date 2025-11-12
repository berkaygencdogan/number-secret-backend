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
    console.log(`🟢 Yeni kullanıcı kaydı: ${email}`);
    res
      .status(201)
      .json({ success: true, message: "Kayıt başarılı.", user: newUser });
  } catch (error) {
    console.error("Kayıt oluşturulurken hata:", error);
    res.status(500).json({ message: "Kayıt başarısız.", error: error.message });
  }
});

app.post("/logoutUsers", (req, res) => {
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
  const { password, socketId } = req.body; // 👈 socket id'yi de alıyoruz
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  const targetNumber = generateRandomNumber();

  rooms[roomId] = {
    players: [],
    targetNumber,
    password: password || null,
    started: false,
  };

  console.log(
    `Yeni oda oluşturuldu: ${roomId} | Şifre: ${
      password || "Yok"
    } | Hedef: ${targetNumber}`
  );

  // ✅ İlgili istemciye odayı bildir
  if (socketId) {
    const client = io.sockets.sockets.get(socketId);
    if (client) {
      client.emit("roomCreated", { roomId });
    }
  }

  res.json({ roomId });
});

// ======================= SOCKET EVENTLER =======================
io.on("connection", (socket) => {
  console.log("Yeni bağlantı:", socket.id);

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

    if (!room.players.find((p) => p.id === playerId)) {
      room.players.push({ id: playerId, socketId: socket.id });
    }

    socket.join(roomId);
    console.log(`Oyuncu ${playerId} odaya katıldı: ${roomId}`);

    // İki oyuncu varsa oyunu başlat
    if (room.players.length === 2 && !room.started) {
      room.started = true;
      io.to(roomId).emit("gameStart");
      console.log(`Oda ${roomId}: Oyun başlatıldı.`);
    }
  });

  // ⚡ Hızlı giriş (şifresiz, başlamamış odalardan rastgele seçim)
  socket.on("quickJoin", ({ playerId }) => {
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

// server.js
setInterval(() => {
  fetch("https://number-secret-backend.onrender.com/")
    .then(() => console.log("🔁 Ping atıldı - sunucu aktif tutuluyor"))
    .catch(() => console.log("⚠️ Ping başarısız"));
}, 5 * 60 * 1000); // her 5 dakikada bir

// ======================= SERVER START =======================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Sunucu http://0.0.0.0:${PORT} üzerinde çalışıyor.`);
});
