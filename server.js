const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ========== ПАПКИ ==========
const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

app.use(express.static(publicDir));
app.use(express.json());

// ========== ЗАГРУЗКА АУДИО (ГОЛОСОВЫЕ) ==========
const uploadAudio = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => cb(null, Date.now() + ".mp3")
    }),
    limits: { fileSize: 15 * 1024 * 1024 }
});

// ========== ЗАГРУЗКА МЕДИА (КАРТИНКИ/ВИДЕО/АУДИО) ==========
const uploadMedia = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname);
            cb(null, Date.now() + ext);
        }
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'video/mp4', 'video/webm', 'video/quicktime',
            'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Неподдерживаемый формат'), false);
    }
});

// ========== ЗАГРУЗКА АВАТАРКИ (ТОЛЬКО КАРТИНКИ) ==========
const uploadAvatar = multer({
    storage: multer.diskStorage({
        destination: avatarsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Можно только PNG, JPG, GIF, WEBP!'), false);
    }
});

// ========== БАЗА ПОЛЬЗОВАТЕЛЕЙ ==========
const usersFile = path.join(__dirname, "users.json");
let usersDB = {};

if (fs.existsSync(usersFile)) {
    usersDB = JSON.parse(fs.readFileSync(usersFile));
}

function saveUsers() {
    fs.writeFileSync(usersFile, JSON.stringify(usersDB, null, 2));
}

// ========== ВЛАДЕЛЕЦ ==========
const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";

// ========== ДАННЫЕ КОМНАТ ==========
const rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() }
};
const voiceRooms = {};
const activeSessions = {};

// ========== API РЕГИСТРАЦИИ ==========
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    
    if (username === OWNER_USERNAME) {
        return res.status(403).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    }
    
    if (usersDB[username]) {
        return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    }
    
    usersDB[username] = {
        password,
        role: "новичок",
        createdAt: Date.now(),
        avatar: null
    };
    saveUsers();
    res.json({ success: true, role: "новичок" });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    
    if (username === OWNER_USERNAME) {
        if (password === OWNER_PASSWORD) {
            if (!usersDB[OWNER_USERNAME]) {
                usersDB[OWNER_USERNAME] = {
                    password: OWNER_PASSWORD,
                    role: "владелец",
                    createdAt: Date.now(),
                    avatar: null
                };
                saveUsers();
            }
            return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_USERNAME]?.avatar || null });
        } else {
            return res.status(401).json({ error: "Неверный пароль владельца" });
        }
    }
    
    if (!usersDB[username]) {
        return res.status(401).json({ error: "НИК НЕ НАЙДЕН, ЗАРЕГИСТРИРУЙСЯ!" });
    }
    
    if (usersDB[username].password !== password) {
        return res.status(401).json({ error: "НЕПРАВИЛЬНЫЙ ПАРОЛЬ, ПИЗДА!" });
    }
    
    const user = usersDB[username];
    const days = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
    if (days >= 7 && user.role === "новичок") {
        user.role = "олд";
        saveUsers();
    }
    
    res.json({ success: true, role: user.role, avatar: user.avatar });
});

app.post("/change-nick", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    
    const user = usersDB[oldUsername];
    if (!user || user.password !== password) {
        return res.status(401).json({ error: "Неверный пароль" });
    }
    
    if (newUsername === OWNER_USERNAME) {
        return res.status(403).json({ error: "ЭТО НИК ВЛАДЕЛЬЦА, НЕ ЛЕЗЬ!" });
    }
    
    if (usersDB[newUsername] && newUsername !== oldUsername) {
        return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    }
    
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    saveUsers();
    
    res.json({ success: true, newUsername });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Можно только PNG, JPG, GIF, WEBP! Не больше 5 МБ" });
    }
    const { username } = req.body;
    if (usersDB[username]) {
        usersDB[username].avatar = "/avatars/" + req.file.filename;
        saveUsers();
        res.json({ url: usersDB[username].avatar });
    } else {
        res.status(404).json({ error: "Пользователь не найден" });
    }
});

// ========== SOCKET.IO ==========
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, room }) => {
        const user = usersDB[username];
        if (!user) {
            socket.emit("auth-error", "Пользователь не найден");
            return;
        }

        const prev = activeSessions[socket.id]?.room;
        if (prev && rooms[prev]) {
            rooms[prev].users.delete(socket.id);
            socket.leave(prev);
        }

        activeSessions[socket.id] = { username, room };
        socket.join(room);
        rooms[room].users.add(socket.id);

        socket.emit("history", rooms[room].messages);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar });

        io.emit("online", Object.keys(activeSessions).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => activeSessions[id]?.username));
    });

    socket.on("chat", (text) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = {
            id: Date.now() + "_" + Math.random(),
            type: "text",
            author: session.username,
            role: user.role,
            avatar: user.avatar,
            text,
            time: Date.now(),
            reactions: {}
        };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = {
            id: Date.now() + "_" + Math.random(),
            type: "media",
            author: session.username,
            role: user.role,
            avatar: user.avatar,
            mediaUrl: url,
            mediaType: fileType,
            time: Date.now(),
            reactions: {}
        };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = {
            id: Date.now() + "_" + Math.random(),
            type: "voice",
            author: session.username,
            role: user.role,
            avatar: user.avatar,
            audio: url,
            time: Date.now(),
            reactions: {}
        };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msgIndex = rooms[room].messages.findIndex(m => m.id == msgId);
        if (msgIndex !== -1) {
            const msg = rooms[room].messages[msgIndex];
            const canDelete = user.role === "владелец" || user.role === "админ" || user.role === "модер" || msg.author === session.username;
            if (canDelete) {
                rooms[room].messages.splice(msgIndex, 1);
                io.to(room).emit("message-deleted", { msgId });
            }
        }
    });

    socket.on("add-reaction", ({ room, msgId, emoji }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const msg = rooms[room].messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(session.username)) msg.reactions[emoji].push(session.username);
            io.to(room).emit("reaction-updated", { msgId, reactions: msg.reactions });
        }
    });

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
        const session = activeSessions[socket.id];
        if (session) {
            const room = session.room;
            rooms[room]?.users.delete(socket.id);
            io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => activeSessions[id]?.username));
        }
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
    });
});

// ========== ЭНДПОИНТЫ ==========
app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => {
    res.json({ url: "/voices/" + req.file.filename });
});

app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл больше 15 МБ или неподдерживаемый формат" });
    let fileType = "image";
    if (req.file.mimetype.startsWith("video")) fileType = "video";
    if (req.file.mimetype.startsWith("audio")) fileType = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SWILL сервер на ${PORT}`));
