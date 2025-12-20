// index.js
// Bu dosya sadece test amaçlıdır. Asıl uygulama server.js üzerinden çalışır.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const generateRandomNumber = require("./numberGenerator");
const checkGuess = require("./gameLogic");

const app = express();
const PORT = process.env.PORT || 5000; // Render kendi PORT atıyor

// Express
app.use(cors({ origin: "*" }));
app.use(express.json());

// Basit test endpoint
app.get("/", (req, res) => {
  res.send("✅ Multiplayer Socket Sunucusu Render üzerinde çalışıyor 🚀");
});

// SOCKET.IO SETUP
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"], // Render için kararlılık
});

// Oda verileri
const rooms = {};

// Rastgele oda ID üret
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Oda oluşturma endpoint'i
app.post("/create-room", (req, res) => {
  const roomId = generateRoomId();
  rooms[roomId] = {
    players: [],
    targetNumber: generateRandomNumber(),
  };
  console.log(
    `🆕 Yeni oda oluşturuldu: ${roomId} | hedef: ${rooms[roomId].targetNumber}`
  );
  res.json({ roomId });
});

// Socket olayları
io.on("connection", (socket) => {
  console.log("🔌 Yeni bağlantı:", socket.id);

  socket.on("joinRoom", ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit("error", "Geçersiz oda ID");
      return;
    }

    if (!room.players.includes(playerId)) {
      room.players.push(playerId);
    }

    socket.join(roomId);
    console.log(`👤 Oyuncu ${playerId} odaya katıldı: ${roomId}`);

    if (room.players.length === 2) {
      io.to(roomId).emit("gameStart");
      console.log(`🎮 Oda ${roomId}: Oyun başlatıldı.`);
    }
  });

  socket.on("guess", ({ roomId, guess, playerId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const { plus, minus } = checkGuess(guess, room.targetNumber);
    io.to(roomId).emit("newGuess", { playerId, guess, plus, minus });

    console.log(`Oda ${roomId} | ${playerId}: ${guess} → +${plus} -${minus}`);

    if (plus === 4) {
      io.to(roomId).emit("gameOver", { winnerId: playerId });
      delete rooms[roomId];
    }
  });

  socket.on("leaveRoom", (roomId) => {
    socket.leave(roomId);
    io.to(roomId).emit("playerLeft", "Bir oyuncu odadan ayrıldı.");
    console.log(`👋 Oyuncu ${socket.id} odadan ayrıldı: ${roomId}`);
  });

  socket.on("disconnect", () => {
    console.log("❌ Bağlantı koptu:", socket.id);
  });
});

// Sunucu dinle
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Socket sunucusu ${PORT} portunda Render üzerinde çalışıyor`);
});
