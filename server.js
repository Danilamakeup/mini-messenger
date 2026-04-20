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

[publicDir, voicesDir, uploadsDir, avatarsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(publicDir));
app.use(express.json());

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

// ========== БАЗЫ ДАННЫХ ==========
const usersFile = path.join(__dirname, "users.json");
let usersDB = {};
if (fs.existsSync(usersFile)) usersDB = JSON.parse(fs.readFileSync(usersFile));
function saveUsers() { fs.writeFileSync(usersFile, JSON.stringify(usersDB, null, 2)); }

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

const coinsFile = path.join(__dirname, "coins.json");
let coinsDB = {};
if (fs.existsSync(coinsFile)) coinsDB = JSON.parse(fs.readFileSync(coinsFile));
function saveCoins() { fs.writeFileSync(coinsFile, JSON.stringify(coinsDB, null, 2)); }

// ========== ДРУЗЬЯ ==========
const friendsFile = path.join(__dirname, "friends.json");
let friendsDB = {};
if (fs.existsSync(friendsFile)) friendsDB = JSON.parse(fs.readFileSync(friendsFile));
function saveFriends() { fs.writeFileSync(friendsFile, JSON.stringify(friendsDB, null, 2)); }

// ========== СЕРВЕРА ==========
const serversFile = path.join(__dirname, "servers.json");
let serversDB = {
    main: {
        name: "Главный сервер",
        owner: "bigheaven3569",
        rooms: {
            general: { messages: [], users: new Set() },
            gaming: { messages: [], users: new Set() },
            music: { messages: [], users: new Set() },
            "other-fuckin-shit": { messages: [], users: new Set() }
        },
        voiceRooms: { "voice-chat": new Set() },
        members: new Set()
    }
};
if (fs.existsSync(serversFile)) {
    const data = JSON.parse(fs.readFileSync(serversFile));
    for (let [id, server] of Object.entries(data)) {
        serversDB[id] = server;
        if (!serversDB[id].rooms) serversDB[id].rooms = {};
        if (!serversDB[id].voiceRooms) serversDB[id].voiceRooms = {};
        if (!serversDB[id].members) serversDB[id].members = new Set();
        for (let room in serversDB[id].rooms) {
            if (!serversDB[id].rooms[room].messages) serversDB[id].rooms[room].messages = [];
            if (!serversDB[id].rooms[room].users) serversDB[id].rooms[room].users = new Set();
        }
    }
}
function saveServers() {
    const saveData = {};
    for (let [id, server] of Object.entries(serversDB)) {
        saveData[id] = { ...server, members: Array.from(server.members), rooms: {}, voiceRooms: server.voiceRooms };
        for (let [roomName, room] of Object.entries(server.rooms)) {
            saveData[id].rooms[roomName] = { messages: room.messages };
        }
    }
    fs.writeFileSync(serversFile, JSON.stringify(saveData, null, 2));
}

// ========== ЛИЧНЫЕ СООБЩЕНИЯ ==========
const privateMessagesFile = path.join(__dirname, "private_messages.json");
let privateMessagesDB = {};
if (fs.existsSync(privateMessagesFile)) privateMessagesDB = JSON.parse(fs.readFileSync(privateMessagesFile));
function savePrivateMessages() { fs.writeFileSync(privateMessagesFile, JSON.stringify(privateMessagesDB, null, 2)); }

// ========== ЗАЩИЩЁННЫЙ НИК ВЛАДЕЛЬЦА ==========
const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";

// ========== СТАТУСЫ ==========
let userStatus = {};

// ========== АКТИВНЫЕ СЕССИИ ==========
const activeSessions = {}; // socket.id -> { username, serverId, room }

// ========== КОНКУРСЫ ==========
let activeContest = null;
let contestTimeout = null;

const contestQuestions = [
    { question: "Сколько будет 15 + 27?", answer: "42", type: "math" },
    { question: "Сколько будет 8 × 7?", answer: "56", type: "math" },
    { question: "Какой блок в Майнкрафте нужен для портала в Незер?", answer: "обсидиан", type: "minecraft" },
    { question: "Как называется алмазная броня в Майнкрафте?", answer: "алмазная", type: "minecraft" },
    { question: "Кто главный босс в Майнкрафте?", answer: "дракон края", type: "minecraft" }
];

function startNewContest() {
    if (contestTimeout) clearTimeout(contestTimeout);
    const randomQuestion = contestQuestions[Math.floor(Math.random() * contestQuestions.length)];
    activeContest = {
        id: Date.now(),
        question: randomQuestion.question,
        answer: randomQuestion.answer.toLowerCase(),
        type: randomQuestion.type,
        winners: [],
        active: true
    };
    
    for (let serverId in serversDB) {
        for (let room in serversDB[serverId].rooms) {
            sendSystemMessage(serverId, room, `🎉 **КОНКУРС!** 🎉\n📝 Вопрос: ${activeContest.question}\n💰 Приз: 100 монет!\n✏️ Пиши ответ в чат первым!`);
        }
    }
    
    contestTimeout = setTimeout(() => {
        if (activeContest && activeContest.active) {
            for (let serverId in serversDB) {
                for (let room in serversDB[serverId].rooms) {
                    sendSystemMessage(serverId, room, `⏰ Конкурс закончен! Правильный ответ: ${activeContest.answer}.`);
                }
            }
            activeContest = null;
        }
    }, 65000);
}

setInterval(() => {
    if (!activeContest || !activeContest.active) startNewContest();
}, 10 * 60 * 1000);

// ========== ФУНКЦИИ ==========
function getUserByUsername(username) {
    for (let [socketId, session] of Object.entries(activeSessions)) {
        if (session.username === username) return { socketId, session };
    }
    return null;
}

function sendSystemMessage(serverId, room, text) {
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
    serversDB[serverId].rooms[room].messages.push(msg);
    io.to(`server:${serverId}:${room}`).emit("chat", msg);
}

function sendPrivateMessage(from, to, text) {
    const chatId = [from, to].sort().join("_");
    if (!privateMessagesDB[chatId]) privateMessagesDB[chatId] = [];
    const msg = {
        id: Date.now() + "_" + Math.random(),
        type: "text",
        author: from,
        text,
        time: Date.now(),
        read: false
    };
    privateMessagesDB[chatId].push(msg);
    savePrivateMessages();
    
    const target = getUserByUsername(to);
    if (target) {
        io.to(target.socketId).emit("private-message", { from, msg });
    }
}

// ========== API ==========
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
    if (!friendsDB[username]) friendsDB[username] = [];
    saveFriends();
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
            if (!coinsDB[OWNER_USERNAME]) coinsDB[OWNER_USERNAME] = 1000000000000000000000000000;
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
    if (bansDB[newUsername]) return res.status(403).json({ error: "ЭТОТ НИК В БАНЕ!" });
    
    const coins = coinsDB[oldUsername] || 0;
    const friends = friendsDB[oldUsername] || [];
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    coinsDB[newUsername] = coins;
    delete coinsDB[oldUsername];
    friendsDB[newUsername] = friends;
    delete friendsDB[oldUsername];
    saveUsers();
    saveCoins();
    saveFriends();
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

app.post("/create-server", (req, res) => {
    const { username, serverName } = req.body;
    const user = usersDB[username];
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    if (user.role !== "владелец" && user.role !== "админ" && user.role !== "модер") {
        return res.status(403).json({ error: "Только модераторы и выше могут создавать сервера!" });
    }
    
    const serverId = Date.now() + "_" + Math.random().toString(36).slice(4);
    serversDB[serverId] = {
        name: serverName,
        owner: username,
        rooms: {
            general: { messages: [], users: new Set() },
        },
        voiceRooms: { "voice-chat": new Set() },
        members: new Set([username])
    };
    saveServers();
    res.json({ success: true, serverId, serverName });
});

app.post("/send-friend-request", (req, res) => {
    const { from, to } = req.body;
    if (!friendsDB[from]) friendsDB[from] = [];
    if (!friendsDB[to]) friendsDB[to] = [];
    if (friendsDB[from].includes(to)) return res.json({ error: "Уже в друзьях" });
    if (!friendsDB[from].includes(`request_${to}`)) {
        friendsDB[from].push(`request_${to}`);
        saveFriends();
    }
    const target = getUserByUsername(to);
    if (target) {
        io.to(target.socketId).emit("friend-request", { from });
    }
    res.json({ success: true });
});

app.post("/accept-friend", (req, res) => {
    const { username, friend } = req.body;
    if (friendsDB[username]) {
        const index = friendsDB[username].indexOf(`request_${friend}`);
        if (index !== -1) {
            friendsDB[username].splice(index, 1);
            if (!friendsDB[username].includes(friend)) friendsDB[username].push(friend);
            if (!friendsDB[friend].includes(username)) friendsDB[friend].push(username);
            saveFriends();
        }
    }
    res.json({ success: true });
});

app.post("/reject-friend", (req, res) => {
    const { username, friend } = req.body;
    if (friendsDB[username]) {
        const index = friendsDB[username].indexOf(`request_${friend}`);
        if (index !== -1) friendsDB[username].splice(index, 1);
        saveFriends();
    }
    res.json({ success: true });
});

// ========== SOCKET.IO ==========
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, serverId, room }) => {
        if (bansDB[username]) { socket.emit("auth-error", "ТЫ В БАНЕ, ПИЗДУЙ!"); return; }
        const user = usersDB[username];
        if (!user) { socket.emit("auth-error", "Пользователь не найден"); return; }
        if (mutesDB[username] && mutesDB[username] > Date.now()) {
            const remaining = Math.ceil((mutesDB[username] - Date.now()) / 1000 / 60);
            socket.emit("auth-error", `ТЫ В МУТЕ ЕЩЁ ${remaining} МИНУТ!`);
            return;
        } else if (mutesDB[username]) { delete mutesDB[username]; saveMutes(); }

        const prev = activeSessions[socket.id];
        if (prev) {
            const oldServer = serversDB[prev.serverId];
            if (oldServer && oldServer.rooms[prev.room]) {
                oldServer.rooms[prev.room].users.delete(socket.id);
            }
            socket.leave(`server:${prev.serverId}:${prev.room}`);
        }

        if (!serversDB[serverId]) serverId = "main";
        if (!serversDB[serverId].rooms[room]) room = "general";

        activeSessions[socket.id] = { username, serverId, room };
        socket.join(`server:${serverId}:${room}`);
        serversDB[serverId].rooms[room].users.add(socket.id);
        
        if (!userStatus[username]) userStatus[username] = "online";
        userStatus[username] = "online";

        socket.emit("history", serversDB[serverId].rooms[room].messages);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, status: userStatus[username], coins: coinsDB[username] || 0, friends: friendsDB[username] || [] });
        
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
        
        const serversList = [];
        for (let [id, srv] of Object.entries(serversDB)) {
            serversList.push({ id, name: srv.name, owner: srv.owner, memberCount: srv.members.size });
        }
        socket.emit("servers-list", serversList);
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
        const server = serversDB[session.serverId];
        
        if (activeContest && activeContest.active && !activeContest.winners.includes(session.username)) {
            if (text.toLowerCase().trim() === activeContest.answer) {
                activeContest.winners.push(session.username);
                coinsDB[session.username] = (coinsDB[session.username] || 0) + 100;
                saveCoins();
                for (let room in server.rooms) {
                    sendSystemMessage(session.serverId, room, `🎉 **ПОБЕДИТЕЛЬ!** 🎉\n👑 ${session.username} получил 100 монет!`);
                }
                socket.emit("user-data", { username: session.username, role: user.role, avatar: user.avatar, status: userStatus[session.username], coins: coinsDB[session.username], friends: friendsDB[session.username] || [] });
                activeContest.active = false;
                if (contestTimeout) clearTimeout(contestTimeout);
                setTimeout(() => startNewContest(), 5000);
            }
        }
        
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: session.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
        server.rooms[session.room].messages.push(msg);
        io.to(`server:${session.serverId}:${session.room}`).emit("chat", msg);
    });

    socket.on("private-chat", ({ to, text }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        sendPrivateMessage(session.username, to, text);
    });

    socket.on("get-private-messages", ({ withUser }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const chatId = [session.username, withUser].sort().join("_");
        const messages = privateMessagesDB[chatId] || [];
        socket.emit("private-messages-history", { withUser, messages });
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) return;
        const user = usersDB[session.username];
        const server = serversDB[session.serverId];
        const msg = { id: Date.now() + "_" + Math.random(), type: "media", author: session.username, role: user.role, avatar: user.avatar, mediaUrl: url, mediaType: fileType, time: Date.now(), reactions: {} };
        server.rooms[session.room].messages.push(msg);
        io.to(`server:${session.serverId}:${session.room}`).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) return;
        const user = usersDB[session.username];
        const server = serversDB[session.serverId];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: session.username, role: user.role, avatar: user.avatar, audio: url, time: Date.now(), reactions: {} };
        server.rooms[session.room].messages.push(msg);
        io.to(`server:${session.serverId}:${session.room}`).emit("chat", msg);
    });

    socket.on("delete-message", ({ serverId, room, msgId }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const server = serversDB[serverId];
        const msgIndex = server.rooms[room].messages.findIndex(m => m.id == msgId);
        if (msgIndex !== -1) {
            const msg = server.rooms[room].messages[msgIndex];
            const canDelete = user.role === "владелец" || user.role === "админ" || user.role === "модер" || msg.author === session.username;
            if (canDelete) { server.rooms[room].messages.splice(msgIndex, 1); io.to(`server:${serverId}:${room}`).emit("message-deleted", { msgId }); }
        }
    });

    socket.on("add-reaction", ({ serverId, room, msgId, emoji }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const server = serversDB[serverId];
        const msg = server.rooms[room].messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(session.username)) msg.reactions[emoji].push(session.username);
            io.to(`server:${serverId}:${room}`).emit("reaction-updated", { msgId, reactions: msg.reactions });
        }
    });

    socket.on("join-voice-channel", ({ serverId, channelName }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const server = serversDB[serverId];
        
        for (let [name, users] of Object.entries(server.voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to(`voice:${serverId}:${name}`).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                socket.leave(`voice:${serverId}:${name}`);
            }
        }
        
        if (!server.voiceRooms[channelName]) server.voiceRooms[channelName] = new Set();
        server.voiceRooms[channelName].add(socket.id);
        socket.join(`voice:${serverId}:${channelName}`);
        
        const usersInChannel = Array.from(server.voiceRooms[channelName]).map(id => ({
            username: activeSessions[id]?.username,
            avatar: usersDB[activeSessions[id]?.username]?.avatar,
            status: userStatus[activeSessions[id]?.username] || "online"
        }));
        io.to(`voice:${serverId}:${channelName}`).emit("voice-users-update", usersInChannel);
        
        server.voiceRooms[channelName].forEach(id => {
            if (id !== socket.id) socket.emit("voice-user", id);
        });
        socket.to(`voice:${serverId}:${channelName}`).emit("user-joined", socket.id);
    });
    
    socket.on("leave-voice-channel", ({ serverId }) => {
        const session = activeSessions[socket.id];
        const server = serversDB[serverId];
        for (let [name, users] of Object.entries(server.voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to(`voice:${serverId}:${name}`).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                socket.leave(`voice:${serverId}:${name}`);
                break;
            }
        }
    });

    socket.on("signal", ({ serverId, to, data }) => { 
        io.to(to).emit("signal", { from: socket.id, data }); 
    });

    socket.on("disconnect", () => {
        const session = activeSessions[socket.id];
        if (session) {
            const server = serversDB[session.serverId];
            if (server && server.rooms[session.room]) {
                server.rooms[session.room].users.delete(socket.id);
            }
            userStatus[session.username] = "offline";
            io.emit("user-status-update", { username: session.username, status: "offline" });
        }
        delete activeSessions[socket.id];
        
        for (let serverId in serversDB) {
            const server = serversDB[serverId];
            for (let [name, users] of Object.entries(server.voiceRooms)) {
                if (users.has(socket.id)) {
                    users.delete(socket.id);
                    io.to(`voice:${serverId}:${name}`).emit("voice-users-update", Array.from(users).map(id => ({
                        username: activeSessions[id]?.username,
                        avatar: usersDB[activeSessions[id]?.username]?.avatar,
                        status: userStatus[activeSessions[id]?.username] || "online"
                    })));
                    break;
                }
            }
        }
    });
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => { res.json({ url: "/voices/" + req.file.filename }); });
app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл больше 15 МБ или неподдерживаемый формат" });
    let fileType = "image";
    if (req.file.mimetype.startsWith("video")) fileType = "video";
    if (req.file.mimetype.startsWith("audio")) fileType = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SWILL сервер на ${PORT}`));
