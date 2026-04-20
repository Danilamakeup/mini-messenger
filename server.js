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
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");

[publicDir, voicesDir, uploadsDir, avatarsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(publicDir));
app.use(express.json());

// загрузки
const uploadAudio = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => cb(null, Date.now() + ".mp3")
    }),
    limits: { fileSize: 15 * 1024 * 1024 }
});

const uploadMedia = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp3'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Неподдерживаемый формат'), false);
    }
});

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

// базы
const usersFile = path.join(__dirname, "users.json");
let usersDB = {};
if (fs.existsSync(usersFile)) usersDB = JSON.parse(fs.readFileSync(usersFile));
function saveUsers() { fs.writeFileSync(usersFile, JSON.stringify(usersDB, null, 2)); }

const bansFile = path.join(__dirname, "bans.json");
let bansDB = {};
if (fs.existsSync(bansFile)) bansDB = JSON.parse(fs.readFileSync(bansFile));
function saveBans() { fs.writeFileSync(bansFile, JSON.stringify(bansDB, null, 2)); }

const mutesFile = path.join(__dirname, "mutes.json");
let mutesDB = {};
if (fs.existsSync(mutesFile)) mutesDB = JSON.parse(fs.readFileSync(mutesFile));
function saveMutes() { fs.writeFileSync(mutesFile, JSON.stringify(mutesDB, null, 2)); }

const warnsFile = path.join(__dirname, "warns.json");
let warnsDB = {};
if (fs.existsSync(warnsFile)) warnsDB = JSON.parse(fs.readFileSync(warnsFile));
function saveWarns() { fs.writeFileSync(warnsFile, JSON.stringify(warnsDB, null, 2)); }

const coinsFile = path.join(__dirname, "coins.json");
let coinsDB = {};
if (fs.existsSync(coinsFile)) coinsDB = JSON.parse(fs.readFileSync(coinsFile));
function saveCoins() { fs.writeFileSync(coinsFile, JSON.stringify(coinsDB, null, 2)); }

// владелец
const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";

// комнаты
let rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
    "other-fuckin-shit": { messages: [], users: new Set() }
};

const voiceRooms = { "voice-chat": new Set() };
const activeSessions = {};
let userStatus = {};

function getUserByUsername(username) {
    for (let [socketId, session] of Object.entries(activeSessions)) {
        if (session.username === username) return { socketId, session };
    }
    return null;
}

function sendSystemMessage(room, text) {
    const msg = {
        id: Date.now() + "_" + Math.random(),
        type: "text",
        author: "🛡️ СИСТЕМА",
        role: "владелец",
        avatar: null,
        text,
        time: Date.now(),
        reactions: {}
    };
    rooms[room].messages.push(msg);
    io.to(room).emit("chat", msg);
}

// API
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (username === OWNER_USERNAME) return res.status(403).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (usersDB[username]) return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ, ПИЗДУЙ!" });
    
    usersDB[username] = { password, role: "новичок", createdAt: Date.now(), avatar: null };
    saveUsers();
    if (!coinsDB[username]) coinsDB[username] = 0;
    saveCoins();
    res.json({ success: true, role: "новичок" });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ, НЕ ПРИХОДИ!" });
    
    if (username === OWNER_USERNAME) {
        if (password === OWNER_PASSWORD) {
            if (!usersDB[OWNER_USERNAME]) {
                usersDB[OWNER_USERNAME] = { password: OWNER_PASSWORD, role: "владелец", createdAt: Date.now(), avatar: null };
                saveUsers();
            }
            if (!coinsDB[OWNER_USERNAME]) coinsDB[OWNER_USERNAME] = 1000000;
            saveCoins();
            return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_USERNAME]?.avatar || null });
        } else {
            return res.status(401).json({ error: "Неверный пароль владельца" });
        }
    }
    
    if (!usersDB[username]) return res.status(401).json({ error: "НИК НЕ НАЙДЕН, ЗАРЕГИСТРИРУЙСЯ!" });
    if (usersDB[username].password !== password) return res.status(401).json({ error: "НЕПРАВИЛЬНЫЙ ПАРОЛЬ, ПИЗДА!" });
    
    const user = usersDB[username];
    const days = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
    if (days >= 7 && user.role === "новичок") {
        user.role = "олд";
        saveUsers();
    }
    if (!coinsDB[username]) coinsDB[username] = 0;
    saveCoins();
    res.json({ success: true, role: user.role, avatar: user.avatar });
});

app.post("/change-nick", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    const user = usersDB[oldUsername];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверный пароль" });
    if (newUsername === OWNER_USERNAME) return res.status(403).json({ error: "ЭТО НИК ВЛАДЕЛЬЦА, НЕ ЛЕЗЬ!" });
    if (usersDB[newUsername] && newUsername !== oldUsername) return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    
    const coins = coinsDB[oldUsername] || 0;
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    coinsDB[newUsername] = coins;
    delete coinsDB[oldUsername];
    saveUsers();
    saveCoins();
    res.json({ success: true, newUsername });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Можно только PNG, JPG, GIF, WEBP!" });
    const { username } = req.body;
    if (usersDB[username]) {
        usersDB[username].avatar = "/avatars/" + req.file.filename;
        saveUsers();
        res.json({ url: usersDB[username].avatar });
    } else {
        res.status(404).json({ error: "Пользователь не найден" });
    }
});

// SOCKET
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, room }) => {
        if (bansDB[username]) { socket.emit("auth-error", "ТЫ В БАНЕ, ПИЗДУЙ!"); return; }
        const user = usersDB[username];
        if (!user) { socket.emit("auth-error", "Пользователь не найден"); return; }
        if (mutesDB[username] && mutesDB[username] > Date.now()) {
            const remaining = Math.ceil((mutesDB[username] - Date.now()) / 1000 / 60);
            socket.emit("auth-error", `ТЫ В МУТЕ ЕЩЁ ${remaining} МИНУТ!`);
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
        
        if (!userStatus[username]) userStatus[username] = "online";

        socket.emit("history", rooms[room].messages);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, status: userStatus[username], coins: coinsDB[username] || 0 });
        io.emit("online", Object.keys(activeSessions).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => activeSessions[id]?.username));
        
        const allUsers = [];
        for (let u of Object.keys(usersDB)) {
            const isOnline = getUserByUsername(u) !== null;
            allUsers.push({
                username: u,
                avatar: usersDB[u]?.avatar,
                role: usersDB[u]?.role,
                status: isOnline ? (userStatus[u] || "online") : "offline"
            });
        }
        io.emit("all-users", allUsers);
    });
    
    socket.on("set-status", ({ status }) => {
        const session = activeSessions[socket.id];
        if (session) {
            userStatus[session.username] = status;
            io.emit("user-status-update", { username: session.username, status });
        }
    });

    socket.on("chat", (text) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) return;
        const user = usersDB[session.username];
        
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: session.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "media", author: session.username, role: user.role, avatar: user.avatar, mediaUrl: url, mediaType: fileType, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: session.username, role: user.role, avatar: user.avatar, audio: url, time: Date.now(), reactions: {} };
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

    socket.on("join-voice-channel", (channelName) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                socket.leave("voice:" + name);
            }
        }
        
        if (!voiceRooms[channelName]) voiceRooms[channelName] = new Set();
        voiceRooms[channelName].add(socket.id);
        socket.join("voice:" + channelName);
        
        const usersInChannel = Array.from(voiceRooms[channelName]).map(id => ({
            username: activeSessions[id]?.username,
            avatar: usersDB[activeSessions[id]?.username]?.avatar,
            status: userStatus[activeSessions[id]?.username] || "online"
        }));
        io.to("voice:" + channelName).emit("voice-users-update", usersInChannel);
        
        voiceRooms[channelName].forEach(id => {
            if (id !== socket.id) socket.emit("voice-user", id);
        });
        socket.to("voice:" + channelName).emit("user-joined", socket.id);
    });
    
    socket.on("leave-voice-channel", () => {
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                socket.leave("voice:" + name);
                break;
            }
        }
    });

    socket.on("signal", ({ to, data }) => { io.to(to).emit("signal", { from: socket.id, data }); });

    socket.on("disconnect", () => {
        const session = activeSessions[socket.id];
        if (session) {
            const room = session.room;
            rooms[room]?.users.delete(socket.id);
            userStatus[session.username] = "offline";
            io.emit("user-status-update", { username: session.username, status: "offline" });
        }
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
    });
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => { res.json({ url: "/voices/" + req.file.filename }); });
app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл больше 15 МБ" });
    let fileType = "image";
    if (req.file.mimetype.startsWith("video")) fileType = "video";
    if (req.file.mimetype.startsWith("audio")) fileType = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на ${PORT}`));
