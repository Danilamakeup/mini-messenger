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
    storage: multer.diskStorage({ destination: voicesDir, filename: (req, file, cb) => cb(null, Date.now() + ".mp3") }),
    limits: { fileSize: 15 * 1024 * 1024 }
});
const uploadMedia = multer({
    storage: multer.diskStorage({ destination: uploadsDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }),
    limits: { fileSize: 15 * 1024 * 1024 }
});
const uploadAvatar = multer({
    storage: multer.diskStorage({ destination: avatarsDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }),
    limits: { fileSize: 5 * 1024 * 1024 }
});
const uploadServerIcon = multer({
    storage: multer.diskStorage({ destination: serverIconsDir, filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)) }),
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
    for (let [id, s] of Object.entries(activeSessions)) if (s.username === username) return { socketId: id, session: s };
    return null;
}

function sendSystemMessage(serverId, room, text) {
    const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛡️ СИСТЕМА", role: "владелец", text, time: Date.now(), reactions: {} };
    if (serversDB[serverId]?.rooms[room]) {
        serversDB[serverId].rooms[room].messages.push(msg);
        io.to(`server:${serverId}:${room}`).emit("chat", msg);
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
    if (username === OWNER_NAME) return res.status(403).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
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
        return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_NAME]?.avatar, bio: usersDB[OWNER_NAME]?.bio, createdAt: usersDB[OWNER_NAME]?.createdAt });
    }
    const user = usersDB[username];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверные данные" });
    const days = Math.floor((Date.now() - user.createdAt) / (86400000));
    if (days >= 7 && user.role === "новичок") { user.role = "олд"; saveUsers(); }
    res.json({ success: true, role: user.role, avatar: user.avatar, bio: user.bio, createdAt: user.createdAt });
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
    socket.on("auth", ({ username, serverId, room }) => {
        const user = usersDB[username];
        if (!user) return socket.emit("auth-error", "Пользователь не найден");
        if (mutesDB[username] && mutesDB[username] > Date.now()) {
            const rem = Math.ceil((mutesDB[username] - Date.now()) / 60000);
            return socket.emit("auth-error", `Ты в муте ещё ${rem} минут`);
        }
        const prev = activeSessions[socket.id];
        if (prev) {
            const oldServer = serversDB[prev.serverId];
            if (oldServer && oldServer.rooms[prev.room]) oldServer.rooms[prev.room].users?.delete(socket.id);
            socket.leave(`server:${prev.serverId}:${prev.room}`);
        }
        const finalServerId = serversDB[serverId] ? serverId : "main";
        const finalRoom = serversDB[finalServerId]?.rooms[room] ? room : "general";
        activeSessions[socket.id] = { username, serverId: finalServerId, room: finalRoom };
        socket.join(`server:${finalServerId}:${finalRoom}`);
        if (serversDB[finalServerId]?.rooms[finalRoom]) {
            if (!serversDB[finalServerId].rooms[finalRoom].users) serversDB[finalServerId].rooms[finalRoom].users = new Set();
            serversDB[finalServerId].rooms[finalRoom].users.add(socket.id);
            socket.emit("history", serversDB[finalServerId].rooms[finalRoom].messages);
        }
        userStatus[username] = userStatus[username] || "online";
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, friends: friendsDB[username] || [], bio: user.bio, createdAt: user.createdAt });
        socket.emit("servers-list", Object.entries(serversDB).map(([id, s]) => ({ id, name: s.name, icon: s.icon, owner: s.owner })));
        socket.emit("all-users", Object.keys(usersDB).map(u => ({ username: u, avatar: usersDB[u].avatar, role: usersDB[u].role, status: userStatus[u] || "offline" })));
    });

    socket.on("chat", (text) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = usersDB[s.username];
        if (!user) return;
        if (mutesDB[s.username] && mutesDB[s.username] > Date.now()) return socket.emit("auth-error", "Ты в муте");
        
        // Обработка команд владельца
        if (text.startsWith("/") && user.role === "владелец") {
            const parts = text.split(" ");
            const cmd = parts[0].toLowerCase();
            const server = serversDB[s.serverId];
            const room = s.room;
            
            if (cmd === "/функции" || cmd === "/help") {
                const help = `📋 КОМАНДЫ ВЛАДЕЛЬЦА:
/give @user роль — выдать роль
/kick @user — кикнуть
/ban @user — забанить
/unban @user — разбанить
/clear N — очистить N сообщений
/mute @user минут — замутить
/warn @user — выдать варн
/whois @user — инфо о пользователе
/stats — статистика сервера
/nuke — очистить все комнаты
/create-room #название — создать комнату
/delete-room #название — удалить комнату
/resetpass @user — сброс пароля
/пароли — список паролей`;
                sendSystemMessage(s.serverId, s.room, help);
                return;
            }
            if (cmd === "/пароли") {
                let list = "📋 ПАРОЛИ ПОЛЬЗОВАТЕЛЕЙ:\n";
                for (let [u, d] of Object.entries(usersDB)) list += `${u} → ${d.password}\n`;
                sendSystemMessage(s.serverId, s.room, list);
                return;
            }
            if (cmd === "/give" && parts[2]) {
                const target = parts[1].replace("@", "");
                const role = parts[2].toLowerCase();
                if (usersDB[target]) {
                    usersDB[target].role = role;
                    saveUsers();
                    sendSystemMessage(s.serverId, s.room, `✅ ${target} теперь ${role}`);
                    const t = getUserByUsername(target);
                    if (t) io.to(t.socketId).emit("user-data", { username: target, role, avatar: usersDB[target].avatar, friends: friendsDB[target] });
                } else sendSystemMessage(s.serverId, s.room, `❌ ${target} не найден`);
                return;
            }
            if (cmd === "/kick" && parts[1]) {
                const target = parts[1].replace("@", "");
                const t = getUserByUsername(target);
                if (t) {
                    io.to(t.socketId).emit("kick", "Тебя кикнули");
                    t.session.socket.disconnect();
                    sendSystemMessage(s.serverId, s.room, `👢 ${target} кикнут`);
                } else sendSystemMessage(s.serverId, s.room, `❌ ${target} не найден`);
                return;
            }
            if (cmd === "/ban" && parts[1]) {
                const target = parts[1].replace("@", "");
                if (target === OWNER_NAME) { sendSystemMessage(s.serverId, s.room, "❌ Нельзя забанить владельца"); return; }
                bansDB[target] = true;
                saveBans();
                const t = getUserByUsername(target);
                if (t) { io.to(t.socketId).emit("ban", "Ты в бане"); t.session.socket.disconnect(); }
                sendSystemMessage(s.serverId, s.room, `🔨 ${target} забанен`);
                return;
            }
            if (cmd === "/unban" && parts[1]) {
                const target = parts[1].replace("@", "");
                if (bansDB[target]) {
                    delete bansDB[target];
                    saveBans();
                    sendSystemMessage(s.serverId, s.room, `✅ ${target} разбанен`);
                } else sendSystemMessage(s.serverId, s.room, `❌ ${target} не в бане`);
                return;
            }
            if (cmd === "/clear" && parts[1]) {
                const count = parseInt(parts[1]);
                if (!isNaN(count) && count > 0) {
                    server.rooms[room].messages = server.rooms[room].messages.slice(0, -count);
                    io.to(`server:${s.serverId}:${room}`).emit("clear-chat");
                    sendSystemMessage(s.serverId, s.room, `🧹 Очищено ${count} сообщений`);
                }
                return;
            }
            if (cmd === "/mute" && parts[1]) {
                const target = parts[1].replace("@", "");
                let minutes = 5;
                if (parts[2]) minutes = parseInt(parts[2]);
                if (!isNaN(minutes) && minutes > 0) {
                    mutesDB[target] = Date.now() + minutes * 60000;
                    saveMutes();
                    sendSystemMessage(s.serverId, s.room, `🤐 ${target} замучен на ${minutes} минут`);
                    const t = getUserByUsername(target);
                    if (t) io.to(t.socketId).emit("mute", `Ты в муте ${minutes} минут`);
                }
                return;
            }
            if (cmd === "/warn" && parts[1]) {
                const target = parts[1].replace("@", "");
                warnsDB[target] = (warnsDB[target] || 0) + 1;
                saveWarns();
                sendSystemMessage(s.serverId, s.room, `⚠️ ${target} получил предупреждение (${warnsDB[target]}/3)`);
                if (warnsDB[target] >= 3) {
                    bansDB[target] = true;
                    saveBans();
                    const t = getUserByUsername(target);
                    if (t) { io.to(t.socketId).emit("ban", "3 варна = бан"); t.session.socket.disconnect(); }
                    sendSystemMessage(s.serverId, s.room, `🔨 ${target} забанен (3 варна)`);
                }
                return;
            }
            if (cmd === "/whois" && parts[1]) {
                const target = parts[1].replace("@", "");
                const u = usersDB[target];
                if (!u) { sendSystemMessage(s.serverId, s.room, `❌ ${target} не найден`); return; }
                const isOnline = !!getUserByUsername(target);
                const warns = warnsDB[target] || 0;
                const muted = mutesDB[target] && mutesDB[target] > Date.now();
                sendSystemMessage(s.serverId, s.room, `📋 ${target}: роль ${u.role}, рег: ${new Date(u.createdAt).toLocaleDateString()}, онлайн: ${isOnline ? "да" : "нет"}, варны: ${warns}/3, мут: ${muted ? "да" : "нет"}`);
                return;
            }
            if (cmd === "/stats") {
                const totalUsers = Object.keys(usersDB).length;
                const onlineNow = Object.keys(activeSessions).length;
                const totalMessages = Object.values(serversDB).reduce((acc, srv) => acc + Object.values(srv.rooms).reduce((a, r) => a + r.messages.length, 0), 0);
                sendSystemMessage(s.serverId, s.room, `📊 Статистика: юзеров ${totalUsers}, онлайн ${onlineNow}, сообщений ${totalMessages}`);
                return;
            }
            if (cmd === "/nuke") {
                for (let id in serversDB) {
                    for (let r in serversDB[id].rooms) {
                        serversDB[id].rooms[r].messages = [];
                        io.to(`server:${id}:${r}`).emit("clear-chat");
                    }
                }
                sendSystemMessage(s.serverId, s.room, "💀 ВСЕ ЧАТЫ ОЧИЩЕНЫ");
                return;
            }
            if ((cmd === "/create-room" || cmd === "/create") && parts[1]) {
                const newRoom = parts[1].replace("#", "").toLowerCase();
                if (!server.rooms[newRoom]) {
                    server.rooms[newRoom] = { messages: [], users: new Set() };
                    io.emit("new-room", newRoom);
                    sendSystemMessage(s.serverId, s.room, `📁 Создана комната #${newRoom}`);
                    saveServers();
                } else sendSystemMessage(s.serverId, s.room, `❌ Комната ${newRoom} уже есть`);
                return;
            }
            if ((cmd === "/delete-room" || cmd === "/delete") && parts[1]) {
                const delRoom = parts[1].replace("#", "").toLowerCase();
                if (delRoom !== "general" && server.rooms[delRoom]) {
                    delete server.rooms[delRoom];
                    io.emit("delete-room", delRoom);
                    sendSystemMessage(s.serverId, s.room, `🗑️ Удалена комната #${delRoom}`);
                    saveServers();
                } else sendSystemMessage(s.serverId, s.room, `❌ Нельзя удалить general`);
                return;
            }
            if (cmd === "/resetpass" && parts[1]) {
                const target = parts[1].replace("@", "");
                if (usersDB[target]) {
                    const newPass = Math.random().toString(36).slice(-8);
                    usersDB[target].password = newPass;
                    saveUsers();
                    sendSystemMessage(s.serverId, s.room, `🔑 Новый пароль ${target}: ${newPass}`);
                } else sendSystemMessage(s.serverId, s.room, `❌ ${target} не найден`);
                return;
            }
            // если команда не распознана — отправляем как обычное сообщение
        }
        
        // обычный текст (не команда или не владелец)
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: s.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
        if (serversDB[s.serverId]?.rooms[s.room]) {
            serversDB[s.serverId].rooms[s.room].messages.push(msg);
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
    socket.on("edit-message", ({ serverId, room, msgId, newText }) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const server = serversDB[serverId];
        const msg = server?.rooms[room]?.messages.find(m => m.id == msgId);
        if (msg && (msg.author === s.username || usersDB[s.username]?.role === "владелец")) {
            msg.text = newText;
            io.to(`server:${serverId}:${room}`).emit("message-edited", { msgId, newText });
        }
    });
    socket.on("delete-message", ({ serverId, room, msgId }) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const server = serversDB[serverId];
        const idx = server?.rooms[room]?.messages.findIndex(m => m.id == msgId);
        if (idx !== -1 && idx !== undefined) {
            const msg = server.rooms[room].messages[idx];
            if (msg.author === s.username || usersDB[s.username]?.role === "владелец" || usersDB[s.username]?.role === "админ") {
                server.rooms[room].messages.splice(idx, 1);
                io.to(`server:${serverId}:${room}`).emit("message-deleted", { msgId });
            }
        }
    });
    socket.on("media", (url, fileType) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = usersDB[s.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "media", author: s.username, role: user.role, avatar: user.avatar, mediaUrl: url, mediaType: fileType, time: Date.now(), reactions: {} };
        if (serversDB[s.serverId]?.rooms[s.room]) {
            serversDB[s.serverId].rooms[s.room].messages.push(msg);
            io.to(`server:${s.serverId}:${s.room}`).emit("chat", msg);
        }
    });
    socket.on("voice-msg", (url) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = usersDB[s.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: s.username, role: user.role, avatar: user.avatar, audio: url, time: Date.now(), reactions: {} };
        if (serversDB[s.serverId]?.rooms[s.room]) {
            serversDB[s.serverId].rooms[s.room].messages.push(msg);
            io.to(`server:${s.serverId}:${s.room}`).emit("chat", msg);
        }
    });
    socket.on("add-reaction", ({ serverId, room, msgId, emoji }) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const msg = serversDB[serverId]?.rooms[room]?.messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(s.username)) msg.reactions[emoji].push(s.username);
            io.to(`server:${serverId}:${room}`).emit("reaction-updated", { msgId, reactions: msg.reactions });
        }
    });
    socket.on("join-voice-channel", ({ serverId, channelName }) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const server = serversDB[serverId];
        if (!server) return;
        for (let [name, users] of Object.entries(server.voiceRooms || {})) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to(`voice:${serverId}:${name}`).emit("voice-users-update", Array.from(users).map(id => ({ username: activeSessions[id]?.username, avatar: usersDB[activeSessions[id]?.username]?.avatar })));
                socket.leave(`voice:${serverId}:${name}`);
            }
        }
        if (!server.voiceRooms[channelName]) server.voiceRooms[channelName] = new Set();
        server.voiceRooms[channelName].add(socket.id);
        socket.join(`voice:${serverId}:${channelName}`);
        const usersIn = Array.from(server.voiceRooms[channelName]).map(id => ({ username: activeSessions[id]?.username, avatar: usersDB[activeSessions[id]?.username]?.avatar }));
        io.to(`voice:${serverId}:${channelName}`).emit("voice-users-update", usersIn);
        server.voiceRooms[channelName].forEach(id => { if (id !== socket.id) socket.emit("voice-user", id); });
        socket.to(`voice:${serverId}:${channelName}`).emit("user-joined", socket.id);
    });
    socket.on("leave-voice-channel", ({ serverId }) => {
        const server = serversDB[serverId];
        for (let [name, users] of Object.entries(server?.voiceRooms || {})) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to(`voice:${serverId}:${name}`).emit("voice-users-update", Array.from(users).map(id => ({ username: activeSessions[id]?.username, avatar: usersDB[activeSessions[id]?.username]?.avatar })));
                socket.leave(`voice:${serverId}:${name}`);
                break;
            }
        }
    });
    socket.on("signal", ({ to, data }) => { io.to(to).emit("signal", { from: socket.id, data }); });
    socket.on("set-status", ({ status }) => {
        const s = activeSessions[socket.id];
        if (s) { userStatus[s.username] = status; io.emit("user-status-update", { username: s.username, status }); }
    });
    socket.on("disconnect", () => {
        const s = activeSessions[socket.id];
        if (s) {
            const server = serversDB[s.serverId];
            if (server && server.rooms[s.room]) server.rooms[s.room].users?.delete(socket.id);
            userStatus[s.username] = "offline";
            io.emit("user-status-update", { username: s.username, status: "offline" });
        }
        delete activeSessions[socket.id];
    });
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => { res.json({ url: "/voices/" + req.file.filename }); });
app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл больше 15 МБ" });
    let type = "image";
    if (req.file.mimetype.startsWith("video")) type = "video";
    if (req.file.mimetype.startsWith("audio")) type = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType: type });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на ${PORT}`));
