const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

// Настройка CORS для Socket.IO (важно для Render)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Создаём папки, если их нет (Render даёт временную файловую систему)
const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir, { recursive: true });

app.use(express.static(publicDir));

// Multer для загрузки голосовых сообщений
const upload = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => {
            cb(null, Date.now() + ".webm");
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB лимит
});

// Данные
const users = {};
const rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() }
};
const voiceRooms = {};

io.on("connection", (socket) => {
    console.log("🔌 Новое подключение:", socket.id);

    socket.on("join", ({ name, room }) => {
        const prev = users[socket.id]?.room;
        if (prev && rooms[prev]) {
            rooms[prev].users.delete(socket.id);
            socket.leave(prev);
        }

        socket.join(room);
        users[socket.id] = { name, room };
        rooms[room].users.add(socket.id);

        socket.emit("history", rooms[room].messages);
        
        io.emit("online", Object.keys(users).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => users[id]?.name).filter(Boolean));
        
        console.log(`📢 ${name} зашёл в ${room}`);
    });

    socket.on("chat", (text) => {
        const u = users[socket.id];
        if (!u) return;
        const msg = { type: "text", name: u.name, text, time: Date.now() };
        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const u = users[socket.id];
        if (!u) return;
        const msg = { type: "voice", name: u.name, audio: url, time: Date.now() };
        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("chat", msg);
    });

    // Голосовой чат
    socket.on("voice-join", (room) => {
        const vr = "voice:" + room;
        socket.join(vr);
        if (!voiceRooms[room]) voiceRooms[room] = new Set();
        voiceRooms[room].add(socket.id);

        voiceRooms[room].forEach(id => {
            if (id !== socket.id) {
                socket.emit("voice-user", id);
            }
        });

        socket.to(vr).emit("user-joined", socket.id);
        io.to(vr).emit("voice-count", voiceRooms[room].size);
    });

    socket.on("voice-leave", (room) => {
        const vr = "voice:" + room;
        if (voiceRooms[room]) {
            voiceRooms[room].delete(socket.id);
            io.to(vr).emit("voice-count", voiceRooms[room].size);
        }
        socket.leave(vr);
    });

    socket.on("signal", ({ to, data }) => {
        io.to(to).emit("signal", { from: socket.id, data });
    });

    socket.on("disconnect", () => {
        const u = users[socket.id];
        if (u) {
            const room = u.room;
            if (rooms[room]) rooms[room].users.delete(socket.id);
            io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => users[id]?.name).filter(Boolean));
        }
        delete users[socket.id];

        for (let r in voiceRooms) {
            if (voiceRooms[r].has(socket.id)) {
                voiceRooms[r].delete(socket.id);
                io.to("voice:" + r).emit("voice-count", voiceRooms[r].size);
            }
        }
        io.emit("online", Object.keys(users).length);
        console.log("🔌 Отключение:", socket.id);
    });
});

// Эндпоинт для загрузки
app.post("/upload", upload.single("audio"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Нет файла" });
    res.json({ url: "/voices/" + req.file.filename });
});

// Важно для Render — порт из окружения
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🔥 SWILL сервер запущен на порту ${PORT}`);
    console.log(`📁 Статика из ${publicDir}`);
    console.log(`🎙️ Голосовые сохраняются в ${voicesDir}`);
});
