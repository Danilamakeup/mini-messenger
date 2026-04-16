const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// папки
const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir, { recursive: true });

app.use(express.static(publicDir));

const upload = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => cb(null, Date.now() + ".mp3")
    })
});

// Данные
const users = {}; // socket.id -> { name, room, joinedAt, role }
const rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() }
};
const voiceRooms = {};

// ЗАЩИЩЁННЫЙ НИК ВЛАДЕЛЬЦА
const OWNER_NAME = "bigheaven3569";

// Функция определения роли
function getUserRole(name, joinedAt) {
    if (name === OWNER_NAME) return "владелец";
    const days = Math.floor((Date.now() - joinedAt) / (1000 * 60 * 60 * 24));
    if (days >= 7) return "олд";
    return "новичок";
}

io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("join", ({ name, room }) => {
        // Защита: если кто-то пытается зайти с ником владельца, но это не владелец — меняем ник
        let finalName = name;
        if (name === OWNER_NAME) {
            const isOwnerAlreadyOnline = Object.values(users).some(u => u.name === OWNER_NAME && u.name !== finalName);
            if (isOwnerAlreadyOnline || (users[socket.id]?.name !== OWNER_NAME && !isOwnerAlreadyOnline && Object.keys(users).length > 0)) {
                finalName = name + "_" + Math.floor(Math.random() * 1000);
            }
        }

        const prev = users[socket.id]?.room;
        if (prev && rooms[prev]) {
            rooms[prev].users.delete(socket.id);
            socket.leave(prev);
        }

        let joinedAt = users[socket.id]?.joinedAt || Date.now();
        let role = getUserRole(finalName, joinedAt);

        users[socket.id] = { name: finalName, room, joinedAt, role };
        socket.join(room);
        rooms[room].users.add(socket.id);

        socket.emit("history", rooms[room].messages);
        socket.emit("user-role", { role, name: finalName });

        io.emit("online", Object.keys(users).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => users[id]?.name));
    });

    socket.on("chat", (text) => {
        const u = users[socket.id];
        if (!u) return;
        const msg = {
            id: Date.now() + "_" + Math.random(),
            type: "text",
            author: u.name,
            role: u.role,
            text,
            time: Date.now(),
            reactions: {}
        };
        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const u = users[socket.id];
        if (!u) return;
        const msg = {
            id: Date.now() + "_" + Math.random(),
            type: "voice",
            author: u.name,
            role: u.role,
            audio: url,
            time: Date.now(),
            reactions: {}
        };
        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("chat", msg);
    });

    // Удаление сообщения
    socket.on("delete-message", ({ room, msgId }) => {
        const u = users[socket.id];
        if (!u) return;
        const msgIndex = rooms[room].messages.findIndex(m => m.id == msgId);
        if (msgIndex !== -1) {
            const msg = rooms[room].messages[msgIndex];
            const canDelete = u.role === "владелец" || u.role === "админ" || u.role === "модер" || msg.author === u.name;
            if (canDelete) {
                rooms[room].messages.splice(msgIndex, 1);
                io.to(room).emit("message-deleted", { msgId });
            }
        }
    });

    // Реакции
    socket.on("add-reaction", ({ room, msgId, emoji }) => {
        const u = users[socket.id];
        if (!u) return;
        const msg = rooms[room].messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(u.name)) msg.reactions[emoji].push(u.name);
            io.to(room).emit("reaction-updated", { msgId, reactions: msg.reactions });
        }
    });

    // Голосовой чат
    socket.on("voice-join", (room) => {
        const vr = "voice:" + room;
        socket.join(vr);
        if (!voiceRooms[room]) voiceRooms[room] = new Set();
        voiceRooms[room].add(socket.id);
        voiceRooms[room].forEach(id => { if (id !== socket.id) socket.emit("voice-user", id); });
        socket.to(vr).emit("user-joined", socket.id);
        io.to(vr).emit("voice-count", voiceRooms[room].size);
    });

    socket.on("voice-leave", (room) => {
        if (voiceRooms[room]) {
            voiceRooms[room].delete(socket.id);
            io.to("voice:" + room).emit("voice-count", voiceRooms[room].size);
        }
    });

    socket.on("signal", ({ to, data }) => { io.to(to).emit("signal", { from: socket.id, data }); });

    socket.on("disconnect", () => {
        const u = users[socket.id];
        if (u) {
            const room = u.room;
            rooms[room]?.users.delete(socket.id);
            io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => users[id]?.name));
        }
        delete users[socket.id];
        for (let r in voiceRooms) voiceRooms[r].delete(socket.id);
        io.emit("online", Object.keys(users).length);
    });
});

app.post("/upload", upload.single("audio"), (req, res) => {
    res.json({ url: "/voices/" + req.file.filename });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SWILL сервер на ${PORT}`));
