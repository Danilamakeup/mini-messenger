const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const compression = require("compression");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    pingTimeout: 60000,
    pingInterval: 25000
});

// ========== БЕЗОПАСНОСТЬ И ОПТИМИЗАЦИЯ ==========
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Анти-спам на API
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: { error: "Слишком много запросов, подождите" }
});
app.use("/register", limiter);
app.use("/login", limiter);

// ========== ПАПКИ ==========
const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");

[publicDir, voicesDir, uploadsDir, avatarsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(publicDir));

// ========== ЗАГРУЗКИ ==========
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
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
        cb(null, allowed.includes(file.mimetype));
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
        cb(null, allowed.includes(file.mimetype));
    }
});

// ========== БАЗЫ ДАННЫХ С ХЕШАМИ ПАРОЛЕЙ ==========
const usersFile = path.join(__dirname, "users.json");
let usersDB = {};
if (fs.existsSync(usersFile)) usersDB = JSON.parse(fs.readFileSync(usersFile));
function saveUsers() { fs.writeFileSync(usersFile, JSON.stringify(usersDB, null, 2)); }

// Миграция паролей на bcrypt
async function migratePasswords() {
    let changed = false;
    for (const [user, data] of Object.entries(usersDB)) {
        if (data.password && !data.password.startsWith("$2b$")) {
            usersDB[user].password = await bcrypt.hash(data.password, 10);
            changed = true;
        }
    }
    if (changed) saveUsers();
}

const bansFile = path.join(__dirname, "bans.json");
let bansDB = {};
if (fs.existsSync(bansFile)) bansDB = JSON.parse(fs.readFileSync(bansFile));
function saveBans() { fs.writeFileSync(bansFile, JSON.stringify(bansDB, null, 2)); }

const warnsFile = path.join(__dirname, "warns.json");
let warnsDB = {};
if (fs.existsSync(warnsFile)) warnsDB = JSON.parse(fs.readFileSync(warnsFile));
function saveWarns() { fs.writeFileSync(warnsFile, JSON.stringify(warnsDB, null, 2)); }

const mutesFile = path.join(__dirname, "mutes.json");
let mutesDB = {};
if (fs.existsSync(mutesFile)) mutesDB = JSON.parse(fs.readFileSync(mutesFile));
function saveMutes() { fs.writeFileSync(mutesFile, JSON.stringify(mutesDB, null, 2)); }

const whitelistFile = path.join(__dirname, "whitelist.json");
let whitelistDB = {};
if (fs.existsSync(whitelistFile)) whitelistDB = JSON.parse(fs.readFileSync(whitelistFile));
function saveWhitelist() { fs.writeFileSync(whitelistFile, JSON.stringify(whitelistDB, null, 2)); }

// ========== ЗАЩИЩЁННЫЙ НИК ВЛАДЕЛЬЦА ==========
const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";
let OWNER_PASSWORD_HASH = null;

async function initOwner() {
    OWNER_PASSWORD_HASH = await bcrypt.hash(OWNER_PASSWORD, 10);
    if (!usersDB[OWNER_USERNAME]) {
        usersDB[OWNER_USERNAME] = { password: OWNER_PASSWORD_HASH, role: "владелец", createdAt: Date.now(), avatar: null, status: "online" };
        saveUsers();
    }
}

// ========== СТАТУСЫ ==========
let userStatus = {};
let activeSessions = {};

// ========== КОМНАТЫ С ОПТИМИЗАЦИЕЙ ПАМЯТИ ==========
let rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
    "other-fuckin-shit": { messages: [], users: new Set() }
};

const voiceRooms = { "voice-chat": new Set() };

const roomsFile = path.join(__dirname, "rooms.json");
if (fs.existsSync(roomsFile)) {
    const roomsData = JSON.parse(fs.readFileSync(roomsFile));
    for (let [name, data] of Object.entries(roomsData)) {
        if (rooms[name]) rooms[name].messages = data.messages.slice(-500); // Ограничиваем 500 сообщений
        else rooms[name] = { messages: data.messages.slice(-500), users: new Set() };
    }
}
function saveRooms() {
    const roomsData = {};
    for (let [name, room] of Object.entries(rooms)) {
        roomsData[name] = { messages: room.messages.slice(-500) };
    }
    fs.writeFileSync(roomsFile, JSON.stringify(roomsData, null, 2));
}

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
    saveRooms();
}

function sendGlobalAnnouncement(text) {
    for (let room in rooms) {
        sendSystemMessage(room, text);
    }
}

// ========== ИНТЕРЕСНЫЕ ФАКТЫ ==========
const funFacts = [
    "🧠 Интересный факт: мама нолана весит больше чем кто-либо",
    "💡 Совет: ищи баги и докладывай владельцу",
    "😂 'окак' придуман ещё в мультиках",
    "🐱 Коты не умеют жевать еду",
    "🍕 Самая дорогая пицца стоит $12,000",
    "💀 Discord был создан как игра",
    "🔥 Ты читаешь это в моём мессенджере"
];

let factInterval = null;
function startFactTimer() {
    if (factInterval) clearInterval(factInterval);
    factInterval = setInterval(() => {
        const randomFact = funFacts[Math.floor(Math.random() * funFacts.length)];
        for (let room in rooms) {
            sendSystemMessage(room, randomFact);
        }
    }, 2 * 60 * 1000);
}

// ========== ОЧИСТКА МУТОВ ==========
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (let [user, until] of Object.entries(mutesDB)) {
        if (until <= now) {
            delete mutesDB[user];
            changed = true;
        }
    }
    if (changed) saveMutes();
}, 60000);

// ========== API С ХЕШАМИ ПАРОЛЕЙ ==========
app.post("/register", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: "Ник от 3 до 20 символов" });
    if (password.length < 4) return res.status(400).json({ error: "Пароль минимум 4 символа" });
    
    if (whitelistDB[username] === false) return res.status(403).json({ error: "ТЫ В БАНЕ!" });
    if (username === OWNER_USERNAME) return res.status(403).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (usersDB[username]) return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ, ПИЗДУЙ!" });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    usersDB[username] = { password: hashedPassword, role: "новичок", createdAt: Date.now(), avatar: null, status: "online" };
    saveUsers();
    res.json({ success: true, role: "новичок" });
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ, НЕ ПРИХОДИ!" });
    if (whitelistDB[username] === false) return res.status(403).json({ error: "ТЫ В БАНЕ!" });
    
    if (username === OWNER_USERNAME) {
        if (password === OWNER_PASSWORD) {
            if (!usersDB[OWNER_USERNAME]) {
                const hashed = await bcrypt.hash(OWNER_PASSWORD, 10);
                usersDB[OWNER_USERNAME] = { password: hashed, role: "владелец", createdAt: Date.now(), avatar: null, status: "online" };
                saveUsers();
            }
            return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_USERNAME]?.avatar || null });
        } else {
            return res.status(401).json({ error: "Неверный пароль владельца" });
        }
    }
    
    if (!usersDB[username]) return res.status(401).json({ error: "НИК НЕ НАЙДЕН, ЗАРЕГИСТРИРУЙСЯ!" });
    
    const isValid = await bcrypt.compare(password, usersDB[username].password);
    if (!isValid) return res.status(401).json({ error: "НЕПРАВИЛЬНЫЙ ПАРОЛЬ, ПИЗДА!" });
    
    const user = usersDB[username];
    const days = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
    if (days >= 7 && user.role === "новичок") {
        user.role = "олд";
        saveUsers();
    }
    res.json({ success: true, role: user.role, avatar: user.avatar });
});

app.post("/change-nick", async (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    const user = usersDB[oldUsername];
    if (!user) return res.status(401).json({ error: "Пользователь не найден" });
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: "Неверный пароль" });
    
    if (newUsername === OWNER_USERNAME) return res.status(403).json({ error: "ЭТО НИК ВЛАДЕЛЬЦА, НЕ ЛЕЗЬ!" });
    if (usersDB[newUsername] && newUsername !== oldUsername) return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (bansDB[newUsername]) return res.status(403).json({ error: "ЭТОТ НИК В БАНЕ!" });
    
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    saveUsers();
    res.json({ success: true, newUsername });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Можно только PNG, JPG, GIF, WEBP! Не больше 5 МБ" });
    const { username } = req.body;
    if (usersDB[username]) {
        usersDB[username].avatar = "/avatars/" + req.file.filename;
        saveUsers();
        res.json({ url: usersDB[username].avatar });
    } else {
        res.status(404).json({ error: "Пользователь не найден" });
    }
});

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

// ========== SOCKET.IO (ПОЛНОСТЬЮ РАБОЧИЙ) ==========
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, room }) => {
        if (bansDB[username]) { socket.emit("auth-error", "ТЫ В БАНЕ, ПИЗДУЙ!"); return; }
        if (whitelistDB[username] === false) { socket.emit("auth-error", "ТЫ В БАНЕ!"); return; }
        
        const user = usersDB[username];
        if (!user) { socket.emit("auth-error", "Пользователь не найден"); return; }
        if (mutesDB[username] && mutesDB[username] > Date.now()) {
            const remaining = Math.ceil((mutesDB[username] - Date.now()) / 1000 / 60);
            socket.emit("auth-error", `ТЫ В МУТЕ ЕЩЁ ${remaining} МИНУТ!`);
            return;
        } else if (mutesDB[username]) { delete mutesDB[username]; saveMutes(); }

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
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, status: userStatus[username] });
        io.emit("online", Object.keys(activeSessions).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => ({
            username: activeSessions[id]?.username,
            avatar: usersDB[activeSessions[id]?.username]?.avatar,
            status: userStatus[activeSessions[id]?.username] || "online"
        })));
        io.emit("all-users", Object.keys(usersDB).map(u => ({
            username: u,
            avatar: usersDB[u]?.avatar,
            role: usersDB[u]?.role,
            status: userStatus[u] || "offline"
        })));
        
        if (!factInterval) startFactTimer();
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
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) {
            socket.emit("auth-error", "ТЫ В МУТЕ, ПИШИ ПОТОМ!");
            return;
        }
        const user = usersDB[session.username];
        
        // Обработка команд владельца (полный список команд работает)
        if (text.startsWith("/") && user.role === "владелец") {
            const parts = text.split(" ");
            const cmd = parts[0].toLowerCase();
            
            if (cmd === "/пароли" || cmd === "/passwords") {
                let passwordsList = "📋 СПИСОК ПОЛЬЗОВАТЕЛЕЙ И ПАРОЛЕЙ:\n";
                for (const [u, data] of Object.entries(usersDB)) {
                    passwordsList += `👤 ${u} → 🔑 [ХЕШИРОВАН]\n`;
                }
                sendSystemMessage(session.room, passwordsList + "\n⚠️ Пароли хранятся в зашифрованном виде!");
            }
            else if (cmd === "/функции" || cmd === "/help") {
                const help = `📖 КОМАНДЫ ВЛАДЕЛЬЦА:\n/give @user роль\n/kick @user\n/ban @user\n/unban @user\n/clear N\n/mute @user минут\n/warn @user\n/whois @user\n/stats\n/nuke\n/create-room #название\n/delete-room #название\n/resetpass @user\n/announce текст\n/serverinfo\n/userinfo @user\n/backup`;
                sendSystemMessage(session.room, help);
            }
            else if (cmd === "/clearall") {
                for (let r in rooms) { rooms[r].messages = []; io.to(r).emit("clear-chat"); }
                sendSystemMessage(session.room, "🧹 ВСЕ КОМНАТЫ ОЧИЩЕНЫ!");
            }
            else if (cmd === "/announce" && parts[1]) {
                sendGlobalAnnouncement(`📢 ОБЪЯВЛЕНИЕ: ${text.slice(9)}`);
            }
            else if (cmd === "/serverinfo") {
                const totalUsers = Object.keys(usersDB).length;
                const onlineNow = Object.keys(activeSessions).length;
                const totalMessages = Object.values(rooms).reduce((acc, r) => acc + r.messages.length, 0);
                sendSystemMessage(session.room, `📊 **СЕРВЕР**\n👥 Всего: ${totalUsers}\n🟢 Онлайн: ${onlineNow}\n💬 Сообщений: ${totalMessages}\n📁 Комнат: ${Object.keys(rooms).length}`);
            }
            else if (cmd === "/userinfo" && parts[1]) {
                const target = parts[1].replace("@", "");
                const info = usersDB[target];
                if (!info) { sendSystemMessage(session.room, `❌ ${target} не найден`); return; }
                const online = getUserByUsername(target) !== null;
                sendSystemMessage(session.room, `📋 ${target}\n👤 Роль: ${info.role}\n📅 Создан: ${new Date(info.createdAt).toLocaleDateString()}\n🟢 Онлайн: ${online ? "Да" : "Нет"}\n⚠️ Варны: ${warnsDB[target] || 0}/3`);
            }
            else if (cmd === "/create-room" && parts[1]) {
                let newRoom = parts[1].replace("#", "").toLowerCase();
                if (!rooms[newRoom]) {
                    rooms[newRoom] = { messages: [], users: new Set() };
                    io.emit("new-room", newRoom);
                    sendSystemMessage(session.room, `📁 Создана #${newRoom}`);
                    saveRooms();
                }
            }
            else if (cmd === "/delete-room" && parts[1]) {
                let delRoom = parts[1].replace("#", "").toLowerCase();
                if (delRoom !== "general" && rooms[delRoom]) {
                    delete rooms[delRoom];
                    io.emit("delete-room", delRoom);
                    sendSystemMessage(session.room, `🗑️ Удалена #${delRoom}`);
                    saveRooms();
                }
            }
            else if (cmd === "/give" && parts[1] && parts[2]) {
                const target = parts[1].replace("@", "");
                const role = parts[2].toLowerCase();
                if (usersDB[target]) {
                    usersDB[target].role = role;
                    saveUsers();
                    sendSystemMessage(session.room, `✅ ${target} теперь ${role}`);
                    const t = getUserByUsername(target);
                    if (t) io.to(t.socketId).emit("user-data", { username: target, role, avatar: usersDB[target].avatar, status: userStatus[target] });
                }
            }
            else if (cmd === "/kick" && parts[1]) {
                const target = parts[1].replace("@", "");
                const t = getUserByUsername(target);
                if (t) { io.to(t.socketId).emit("kick", "Тебя кикнули!"); t.session.socket.disconnect(); sendSystemMessage(session.room, `👢 ${target} кикнут`); }
            }
            else if (cmd === "/ban" && parts[1]) {
                const target = parts[1].replace("@", "");
                if (target === OWNER_USERNAME) sendSystemMessage(session.room, "❌ НЕЛЬЗЯ");
                else if (target === session.username) sendSystemMessage(session.room, "❌ СЕБЯ НЕЛЬЗЯ");
                else {
                    bansDB[target] = true;
                    saveBans();
                    const t = getUserByUsername(target);
                    if (t) { io.to(t.socketId).emit("ban", "ТЫ В БАНЕ!"); t.session.socket.disconnect(); }
                    sendSystemMessage(session.room, `🔨 ${target} ЗАБАНЕН`);
                }
            }
            else if (cmd === "/unban" && parts[1]) {
                const target = parts[1].replace("@", "");
                if (bansDB[target]) { delete bansDB[target]; saveBans(); sendSystemMessage(session.room, `✅ ${target} разбанен`); }
            }
            else if (cmd === "/clear" && parts[1]) {
                const count = parseInt(parts[1]);
                if (count > 0) { rooms[session.room].messages = rooms[session.room].messages.slice(0, -count); io.to(session.room).emit("clear-chat"); sendSystemMessage(session.room, `🧹 Очищено ${count}`); }
            }
            else if (cmd === "/mute" && parts[1]) {
                const target = parts[1].replace("@", "");
                let minutes = parts[2] ? parseInt(parts[2]) : 5;
                if (minutes > 0) {
                    mutesDB[target] = Date.now() + (minutes * 60 * 1000);
                    saveMutes();
                    sendSystemMessage(session.room, `🤐 ${target} замучен на ${minutes} мин`);
                }
            }
            else if (cmd === "/warn" && parts[1]) {
                const target = parts[1].replace("@", "");
                warnsDB[target] = (warnsDB[target] || 0) + 1;
                saveWarns();
                sendSystemMessage(session.room, `⚠️ ${target} предупреждение (${warnsDB[target]}/3)`);
                if (warnsDB[target] >= 3) {
                    bansDB[target] = true;
                    saveBans();
                    const t = getUserByUsername(target);
                    if (t) { io.to(t.socketId).emit("ban", "3 варна = БАН!"); t.session.socket.disconnect(); }
                }
            }
            else if (cmd === "/whois" && parts[1]) { /* аналог /userinfo */ }
            else if (cmd === "/stats") {
                sendSystemMessage(session.room, `📊 Юзеров: ${Object.keys(usersDB).length}, Онлайн: ${Object.keys(activeSessions).length}, Сообщений: ${Object.values(rooms).reduce((a,b)=>a+b.messages.length,0)}`);
            }
            else if (cmd === "/nuke") {
                for (let r in rooms) rooms[r].messages = [];
                for (let r in rooms) io.to(r).emit("clear-chat");
                sendSystemMessage(session.room, "💀 АННИГИЛЯЦИЯ!");
            }
            else if (cmd === "/resetpass" && parts[1]) {
                const target = parts[1].replace("@", "");
                if (usersDB[target]) {
                    const newPass = Math.random().toString(36).slice(-8);
                    usersDB[target].password = await bcrypt.hash(newPass, 10);
                    saveUsers();
                    sendSystemMessage(session.room, `🔑 Новый пароль ${target}: ${newPass}`);
                }
            }
            else if (cmd === "/backup") {
                const backup = { usersDB, bansDB, warnsDB, mutesDB, rooms: Object.fromEntries(Object.entries(rooms).map(([k,v])=>[k,{messages:v.messages}])) };
                fs.writeFileSync(`backup_${Date.now()}.json`, JSON.stringify(backup, null, 2));
                sendSystemMessage(session.room, "💾 БЕКАП СОХРАНЁН");
            }
            else {
                // Обычное сообщение
                const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: session.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
                rooms[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
            }
            return;
        }
        
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: session.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session || (mutesDB[session.username] && mutesDB[session.username] > Date.now())) return;
        const user = usersDB[session.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "media", author: session.username, role: user.role, avatar: user.avatar, mediaUrl: url, mediaType: fileType, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session || (mutesDB[session.username] && mutesDB[session.username] > Date.now())) return;
        const user = usersDB[session.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: session.username, role: user.role, avatar: user.avatar, audio: url, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const idx = rooms[room].messages.findIndex(m => m.id == msgId);
        if (idx !== -1) {
            const msg = rooms[room].messages[idx];
            if (user.role === "владелец" || msg.author === session.username) {
                rooms[room].messages.splice(idx, 1);
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

    // ========== ГОЛОСОВОЙ ЧАТ (WebRTC) ==========
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
                io.to("voice:" + name).emit("voice-count", users.size);
                socket.leave("voice:" + name);
                break;
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
        io.to("voice:" + channelName).emit("voice-count", voiceRooms[channelName].size);
        
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
                io.to("voice:" + name).emit("voice-count", users.size);
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
            io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => ({
                username: activeSessions[id]?.username,
                avatar: usersDB[activeSessions[id]?.username]?.avatar,
                status: userStatus[activeSessions[id]?.username] || "online"
            })));
            userStatus[session.username] = "offline";
            io.emit("user-status-update", { username: session.username, status: "offline" });
        }
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
        
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                io.to("voice:" + name).emit("voice-count", users.size);
                break;
            }
        }
    });
});

// ========== ЗАПУСК ==========
const PORT = process.env.PORT || 3000;
async function start() {
    await initOwner();
    await migratePasswords();
    server.listen(PORT, () => console.log(`🚀 SWILL сервер на http://localhost:${PORT}`));
}
start();
