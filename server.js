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
    limits: { fileSize: 15 * 1024 * 1024 }
});

const uploadAvatar = multer({
    storage: multer.diskStorage({
        destination: avatarsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const uploadServerIcon = multer({
    storage: multer.diskStorage({
        destination: serverIconsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ---------- БАЗЫ ДАННЫХ ----------
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

const friendsFile = path.join(__dirname, "friends.json");
let friendsDB = {};
if (fs.existsSync(friendsFile)) friendsDB = JSON.parse(fs.readFileSync(friendsFile));
function saveFriends() { fs.writeFileSync(friendsFile, JSON.stringify(friendsDB, null, 2)); }

const privateMessagesFile = path.join(__dirname, "private_messages.json");
let privateMessagesDB = {};
if (fs.existsSync(privateMessagesFile)) privateMessagesDB = JSON.parse(fs.readFileSync(privateMessagesFile));
function savePrivateMessages() { fs.writeFileSync(privateMessagesFile, JSON.stringify(privateMessagesDB, null, 2)); }

// ---------- КОМНАТЫ (с сохранением) ----------
const roomsFile = path.join(__dirname, "rooms.json");
let rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
    "other-fuckin-shit": { messages: [], users: new Set() }
};

// Загружаем сохранённые комнаты
if (fs.existsSync(roomsFile)) {
    const savedRooms = JSON.parse(fs.readFileSync(roomsFile));
    for (let name in savedRooms) {
        rooms[name] = { messages: savedRooms[name].messages || [], users: new Set() };
    }
}

function saveRooms() {
    const toSave = {};
    for (let name in rooms) {
        toSave[name] = { messages: rooms[name].messages };
    }
    fs.writeFileSync(roomsFile, JSON.stringify(toSave, null, 2));
}

// ---------- СЕРВЕРА ----------
const serversFile = path.join(__dirname, "servers.json");
let serversDB = {};
if (fs.existsSync(serversFile)) serversDB = JSON.parse(fs.readFileSync(serversFile));
function saveServers() { fs.writeFileSync(serversFile, JSON.stringify(serversDB, null, 2)); }

// ---------- ВЛАДЕЛЕЦ ----------
const OWNER_NAME = "bigheaven3569";
const OWNER_PASS = "swill1337";

// ---------- СТАТУСЫ ----------
let userStatus = {};
let activeSessions = {};

function getUserByUsername(username) {
    for (let [id, s] of Object.entries(activeSessions)) {
        if (s.username === username) return { socketId: id, session: s };
    }
    return null;
}

function sendSystemMessage(room, text) {
    const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛡️ СИСТЕМА", role: "владелец", text, time: Date.now() };
    if (rooms[room]) {
        rooms[room].messages.push(msg);
        io.to(room).emit("chat", msg);
    }
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

// ---------- API ----------
app.post("/register", (req, res) => {
    const { username, password, bio } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните поля" });
    if (username === OWNER_NAME) return res.status(403).json({ error: "НИК ЗАНЯТ" });
    if (usersDB[username]) return res.status(400).json({ error: "НИК ЗАНЯТ" });
    usersDB[username] = { password, role: "новичок", createdAt: Date.now(), avatar: null, bio: bio || "" };
    saveUsers();
    if (!friendsDB[username]) friendsDB[username] = [];
    saveFriends();
    res.json({ success: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (username === OWNER_NAME && password === OWNER_PASS) {
        if (!usersDB[OWNER_NAME]) usersDB[OWNER_NAME] = { password: OWNER_PASS, role: "владелец", createdAt: Date.now(), avatar: null, bio: "Владелец" };
        saveUsers();
        return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_NAME]?.avatar });
    }
    const user = usersDB[username];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверные данные" });
    const days = Math.floor((Date.now() - user.createdAt) / 86400000);
    if (days >= 7 && user.role === "новичок") { user.role = "олд"; saveUsers(); }
    if (!coinsDB[username]) coinsDB[username] = 0;
    saveCoins();
    res.json({ success: true, role: user.role, avatar: user.avatar });
});

app.post("/change-nick", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    const user = usersDB[oldUsername];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверный пароль" });
    if (newUsername === OWNER_NAME) return res.status(403).json({ error: "ЭТО НИК ВЛАДЕЛЬЦА" });
    if (usersDB[newUsername]) return res.status(400).json({ error: "НИК ЗАНЯТ" });
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    friendsDB[newUsername] = friendsDB[oldUsername];
    delete friendsDB[oldUsername];
    saveUsers(); saveFriends();
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
    serversDB[id] = { id, name: serverName, icon: req.file ? "/server_icons/" + req.file.filename : null, owner: username, rooms: { general: { messages: [] } }, voiceRooms: { "voice-chat": new Set() }, members: [username] };
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
    sendPrivateMessage("🛡️ СИСТЕМА", to, `📨 ${from} хочет добавить тебя в друзья. Используй /accept ${from} или /reject ${from}`, true);
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
            sendPrivateMessage("🛡️ СИСТЕМА", username, `✅ Ты принял заявку от ${friend}`, true);
            sendPrivateMessage("🛡️ СИСТЕМА", friend, `✅ ${username} принял твою заявку`, true);
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
        sendPrivateMessage("🛡️ СИСТЕМА", username, `❌ Ты отклонил заявку от ${friend}`, true);
    }
    res.json({ success: true });
});

// ---------- SOCKET ----------
io.on("connection", (socket) => {
    socket.on("auth", ({ username, room }) => {
        if (bansDB[username]) return socket.emit("auth-error", "ТЫ В БАНЕ");
        const user = usersDB[username];
        if (!user) return socket.emit("auth-error", "Пользователь не найден");
        if (mutesDB[username] && mutesDB[username] > Date.now()) {
            const rem = Math.ceil((mutesDB[username] - Date.now()) / 60000);
            return socket.emit("auth-error", `Ты в муте ещё ${rem} минут`);
        }
        const prev = activeSessions[socket.id];
        if (prev && rooms[prev.room]) {
            rooms[prev.room].users.delete(socket.id);
            socket.leave(prev.room);
        }
        const finalRoom = rooms[room] ? room : "general";
        activeSessions[socket.id] = { username, room: finalRoom };
        socket.join(finalRoom);
        rooms[finalRoom].users.add(socket.id);
        userStatus[username] = "online";
        socket.emit("history", rooms[finalRoom].messages);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, friends: friendsDB[username] || [], coins: coinsDB[username] || 0 });
        const allUsers = [];
        for (let u of Object.keys(usersDB)) {
            const online = getUserByUsername(u) !== null;
            allUsers.push({ username: u, avatar: usersDB[u]?.avatar, role: usersDB[u]?.role, status: online ? "online" : "offline" });
        }
        io.emit("all-users", allUsers);
        io.emit("user-status-update", { username, status: "online" });
        io.to(finalRoom).emit("room-users", Array.from(rooms[finalRoom].users).map(id => activeSessions[id]?.username));
    });

    socket.on("chat", (text) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = usersDB[s.username];
        if (!user) return;
        if (text.startsWith("/clear") && user.role === "владелец") {
            const parts = text.split(" ");
            const count = parseInt(parts[1]);
            if (!isNaN(count) && count > 0) {
                rooms[s.room].messages = rooms[s.room].messages.slice(0, -count);
                io.to(s.room).emit("clear-chat");
                sendSystemMessage(s.room, `🧹 Очищено ${count} сообщений`);
                saveRooms();
            }
            return;
        }
        // 👇 НОВАЯ КОМАНДА ДЛЯ СОЗДАНИЯ КОМНАТЫ
        if (text.startsWith("/create-room") && user.role === "владелец") {
            const parts = text.split(" ");
            const newRoom = parts[1]?.replace("#", "").toLowerCase();
            if (newRoom && !rooms[newRoom]) {
                rooms[newRoom] = { messages: [], users: new Set() };
                io.emit("new-room", newRoom);
                sendSystemMessage(s.room, `📁 Создана комната #${newRoom}`);
                saveRooms();
            } else {
                sendSystemMessage(s.room, `❌ Комната ${newRoom} уже существует или имя не указано`);
            }
            return;
        }
        // 👇 НОВАЯ КОМАНДА ДЛЯ УДАЛЕНИЯ КОМНАТЫ
        if (text.startsWith("/delete-room") && user.role === "владелец") {
            const parts = text.split(" ");
            const delRoom = parts[1]?.replace("#", "").toLowerCase();
            if (delRoom && delRoom !== "general" && rooms[delRoom]) {
                delete rooms[delRoom];
                io.emit("delete-room", delRoom);
                sendSystemMessage(s.room, `🗑️ Удалена комната #${delRoom}`);
                saveRooms();
            } else {
                sendSystemMessage(s.room, `❌ Нельзя удалить general или несуществующую комнату`);
            }
            return;
        }
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: s.username, role: user.role, text, time: Date.now() };
        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
        saveRooms(); // сохраняем сообщение
    });

    socket.on("voice-msg", (url) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = usersDB[s.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: s.username, role: user.role, audio: url, time: Date.now() };
        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
        saveRooms();
    });

    socket.on("edit-message", ({ room, msgId, newText }) => {
        const s = activeSessions[socket.id];
        const idx = rooms[room]?.messages.findIndex(m => m.id == msgId);
        if (idx !== -1 && rooms[room].messages[idx].author === s.username) {
            rooms[room].messages[idx].text = newText;
            io.to(room).emit("message-edited", { msgId, newText });
            saveRooms();
        }
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const s = activeSessions[socket.id];
        const idx = rooms[room]?.messages.findIndex(m => m.id == msgId);
        if (idx !== -1 && rooms[room].messages[idx].author === s.username) {
            rooms[room].messages.splice(idx, 1);
            io.to(room).emit("message-deleted", { msgId });
            saveRooms();
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

    socket.on("media", (url, fileType) => {
        const s = activeSessions[socket.id];
        const user = usersDB[s.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "media", author: s.username, role: user.role, mediaUrl: url, mediaType: fileType, time: Date.now() };
        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
        saveRooms();
    });

    socket.on("join-voice", () => {
        const s = activeSessions[socket.id];
        if (!s) return;
        socket.join("voice");
        socket.to("voice").emit("user-joined", socket.id);
    });

    socket.on("leave-voice", () => {
        socket.leave("voice");
    });

    socket.on("signal", ({ to, data }) => { io.to(to).emit("signal", { from: socket.id, data }); });

    socket.on("disconnect", () => {
        const s = activeSessions[socket.id];
        if (s) {
            rooms[s.room]?.users.delete(socket.id);
            userStatus[s.username] = "offline";
            io.emit("user-status-update", { username: s.username, status: "offline" });
            io.to(s.room).emit("room-users", Array.from(rooms[s.room].users).map(id => activeSessions[id]?.username));
        }
        delete activeSessions[socket.id];
    });
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => { res.json({ url: "/voices/" + req.file.filename }); });
app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    let type = "image";
    if (req.file.mimetype.startsWith("video")) type = "video";
    if (req.file.mimetype.startsWith("audio")) type = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType: type });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на ${PORT}`));
