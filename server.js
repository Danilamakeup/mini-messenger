const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");
const serverIconsDir = path.join(publicDir, "server_icons");

[publicDir, voicesDir, uploadsDir, avatarsDir, serverIconsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(publicDir));
app.use(express.json());

const uploadAudio = multer({ storage: multer.diskStorage({ destination: voicesDir, filename: (req, file, cb) => cb(null, Date.now() + ".mp3") }), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadMedia = multer({ storage: multer.diskStorage({ destination: uploadsDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }), limits: { fileSize: 15 * 1024 * 1024 } });
const uploadAvatar = multer({ storage: multer.diskStorage({ destination: avatarsDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadServerIcon = multer({ storage: multer.diskStorage({ destination: serverIconsDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }), limits: { fileSize: 5 * 1024 * 1024 } });

// БАЗЫ
const usersFile = path.join(__dirname, "users.json");
let usersDB = {};
if (fs.existsSync(usersFile)) usersDB = JSON.parse(fs.readFileSync(usersFile));
function saveUsers() { fs.writeFileSync(usersFile, JSON.stringify(usersDB, null, 2)); }

const friendsFile = path.join(__dirname, "friends.json");
let friendsDB = {};
if (fs.existsSync(friendsFile)) friendsDB = JSON.parse(fs.readFileSync(friendsFile));
function saveFriends() { fs.writeFileSync(friendsFile, JSON.stringify(friendsDB, null, 2)); }

const privateMessagesFile = path.join(__dirname, "private_messages.json");
let privateMessagesDB = {};
if (fs.existsSync(privateMessagesFile)) privateMessagesDB = JSON.parse(fs.readFileSync(privateMessagesFile));
function savePrivateMessages() { fs.writeFileSync(privateMessagesFile, JSON.stringify(privateMessagesDB, null, 2)); }

const serversFile = path.join(__dirname, "servers.json");
let serversDB = {};
if (fs.existsSync(serversFile)) serversDB = JSON.parse(fs.readFileSync(serversFile));
function saveServers() { fs.writeFileSync(serversFile, JSON.stringify(serversDB, null, 2)); }

const OWNER = "bigheaven3569";
const OWNER_PASS = "swill1337";

let activeSessions = {};

function getUserByUsername(username) {
    for (let [id, s] of Object.entries(activeSessions)) if (s.username === username) return { socketId: id, session: s };
    return null;
}

function sendPrivateMessage(from, to, text, isSystem = false) {
    const chatId = [from, to].sort().join("_");
    if (!privateMessagesDB[chatId]) privateMessagesDB[chatId] = [];
    const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: isSystem ? "🛡️ СИСТЕМА" : from, text, time: Date.now(), read: false };
    privateMessagesDB[chatId].push(msg);
    savePrivateMessages();
    const target = getUserByUsername(to);
    if (target) io.to(target.socketId).emit("private-message", { from: isSystem ? "🛡️ СИСТЕМА" : from, msg });
}

// API
app.post("/register", (req, res) => {
    const { username, password, bio } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните поля" });
    if (usersDB[username]) return res.status(400).json({ error: "Ник занят" });
    usersDB[username] = { password, role: "новичок", createdAt: Date.now(), avatar: null, bio: bio || "" };
    saveUsers();
    if (!friendsDB[username]) friendsDB[username] = [];
    saveFriends();
    res.json({ success: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (username === OWNER && password === OWNER_PASS) {
        if (!usersDB[OWNER]) usersDB[OWNER] = { password: OWNER_PASS, role: "владелец", createdAt: Date.now(), avatar: null, bio: "Владелец" };
        saveUsers();
        return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER]?.avatar, bio: usersDB[OWNER]?.bio, createdAt: usersDB[OWNER]?.createdAt });
    }
    const user = usersDB[username];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверные данные" });
    res.json({ success: true, role: user.role, avatar: user.avatar, bio: user.bio, createdAt: user.createdAt });
});

app.post("/update-bio", (req, res) => {
    const { username, bio } = req.body;
    if (usersDB[username]) usersDB[username].bio = bio;
    saveUsers();
    res.json({ success: true });
});

app.post("/change-nick", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    const user = usersDB[oldUsername];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверный пароль" });
    if (usersDB[newUsername]) return res.status(400).json({ error: "Ник занят" });
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    friendsDB[newUsername] = friendsDB[oldUsername];
    delete friendsDB[oldUsername];
    saveUsers();
    saveFriends();
    res.json({ success: true, newUsername });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    const { username } = req.body;
    if (usersDB[username]) {
        usersDB[username].avatar = "/avatars/" + req.file.filename;
        saveUsers();
        res.json({ url: usersDB[username].avatar });
    } else res.status(404).json({ error: "Пользователь не найден" });
});

app.post("/create-server", uploadServerIcon.single("icon"), (req, res) => {
    const { username, serverName } = req.body;
    const user = usersDB[username];
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    if (user.role !== "владелец" && user.role !== "админ" && user.role !== "модер") return res.status(403).json({ error: "Нет прав" });
    const id = Date.now() + "_" + Math.random().toString(36).slice(4);
    serversDB[id] = { id, name: serverName, icon: req.file ? "/server_icons/" + req.file.filename : null, owner: username, rooms: { general: { messages: [] } }, members: [username] };
    saveServers();
    res.json({ success: true });
});

app.post("/send-friend-request", (req, res) => {
    const { from, to } = req.body;
    if (!friendsDB[from]) friendsDB[from] = [];
    if (friendsDB[from].includes(to)) return res.json({ error: "Уже друзья" });
    if (friendsDB[from].includes(`req_${to}`)) return res.json({ error: "Заявка уже отправлена" });
    friendsDB[from].push(`req_${to}`);
    saveFriends();
    sendPrivateMessage("🛡️ СИСТЕМА", to, `📨 ${from} хочет добавить тебя в друзья. Используй /accept ${from} или /reject ${from}`);
    res.json({ success: true });
});

app.post("/accept-friend", (req, res) => {
    const { username, friend } = req.body;
    if (friendsDB[username]) {
        const idx = friendsDB[username].indexOf(`req_${friend}`);
        if (idx !== -1) {
            friendsDB[username].splice(idx, 1);
            if (!friendsDB[username].includes(friend)) friendsDB[username].push(friend);
            if (!friendsDB[friend].includes(username)) friendsDB[friend].push(username);
            saveFriends();
            sendPrivateMessage("🛡️ СИСТЕМА", username, `✅ Ты принял заявку от ${friend}`);
            sendPrivateMessage("🛡️ СИСТЕМА", friend, `✅ ${username} принял твою заявку`);
        }
    }
    res.json({ success: true });
});

app.post("/reject-friend", (req, res) => {
    const { username, friend } = req.body;
    if (friendsDB[username]) {
        const idx = friendsDB[username].indexOf(`req_${friend}`);
        if (idx !== -1) friendsDB[username].splice(idx, 1);
        saveFriends();
        sendPrivateMessage("🛡️ СИСТЕМА", username, `❌ Ты отклонил заявку от ${friend}`);
    }
    res.json({ success: true });
});

// SOCKET
io.on("connection", (socket) => {
    socket.on("auth", ({ username, serverId, room }) => {
        const user = usersDB[username];
        if (!user) return socket.emit("auth-error", "Пользователь не найден");
        activeSessions[socket.id] = { username, serverId: serverId || "main", room: room || "general" };
        socket.join(`server:${serverId || "main"}:${room || "general"}`);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, friends: friendsDB[username] || [], bio: user.bio, createdAt: user.createdAt });
        socket.emit("servers-list", Object.entries(serversDB).map(([id, s]) => ({ id, name: s.name, icon: s.icon, owner: s.owner })));
        socket.emit("all-users", Object.keys(usersDB).map(u => ({ username: u, avatar: usersDB[u].avatar, role: usersDB[u].role })));
    });

    socket.on("chat", (text) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        if (text.startsWith("/accept ")) {
            const friend = text.split(" ")[1];
            if (friend) fetch(`http://localhost:${PORT}/accept-friend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: s.username, friend }) });
            return;
        }
        if (text.startsWith("/reject ")) {
            const friend = text.split(" ")[1];
            if (friend) fetch(`http://localhost:${PORT}/reject-friend`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: s.username, friend }) });
            return;
        }
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: s.username, text, time: Date.now() };
        const server = serversDB[s.serverId];
        if (server && server.rooms[s.room]) {
            server.rooms[s.room].messages.push(msg);
            io.to(`server:${s.serverId}:${s.room}`).emit("chat", msg);
        }
    });

    socket.on("private-chat", ({ to, text }) => {
        const s = activeSessions[socket.id];
        if (s) sendPrivateMessage(s.username, to, text);
    });

    socket.on("get-private-messages", ({ withUser }) => {
        const s = activeSessions[socket.id];
        if (s) {
            const chatId = [s.username, withUser].sort().join("_");
            socket.emit("private-messages-history", { withUser, messages: privateMessagesDB[chatId] || [] });
        }
    });

    socket.on("disconnect", () => { delete activeSessions[socket.id]; });
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => res.json({ url: "/voices/" + req.file.filename }));
app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    let type = "image";
    if (req.file.mimetype.startsWith("video")) type = "video";
    if (req.file.mimetype.startsWith("audio")) type = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType: type });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на ${PORT}`));
