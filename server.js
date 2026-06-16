const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    maxHttpBufferSize: 20 * 1024 * 1024,
    pingTimeout: 60000,
    pingInterval: 25000
});

// ========== ПАПКИ ==========
const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");

[publicDir, voicesDir, uploadsDir, avatarsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(publicDir));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ========== ЗАГРУЗКИ ==========
const uploadAudio = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + ".mp3")
    }),
    limits: { fileSize: 15 * 1024 * 1024 }
});

const uploadMedia = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname))
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
        cb(null, allowed.includes(file.mimetype));
    }
});

const uploadAvatar = multer({
    storage: multer.diskStorage({
        destination: avatarsDir,
        filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname))
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        cb(null, allowed.includes(file.mimetype));
    }
});

// ========== БАЗЫ ДАННЫХ ==========
const DB_FILES = ['users', 'bans', 'warns', 'mutes', 'whitelist', 'friends', 'rooms', 'dms'];
const DB = {};

DB_FILES.forEach(name => {
    const filePath = path.join(__dirname, name + '.json');
    if (fs.existsSync(filePath)) {
        try {
            DB[name] = JSON.parse(fs.readFileSync(filePath));
        } catch(e) { DB[name] = {}; }
    } else {
        DB[name] = {};
    }
});

function saveDB(name) {
    if (DB[name]) {
        fs.writeFileSync(path.join(__dirname, name + '.json'), JSON.stringify(DB[name], null, 2));
    }
}

// ========== ДАННЫЕ ==========
const USERS = DB.users || {};
const BANS = DB.bans || {};
const WARNS = DB.warns || {};
const MUTES = DB.mutes || {};
const WHITELIST = DB.whitelist || {};
const FRIENDS = DB.friends || {};
const ROOMS = DB.rooms || {};
const DMS = DB.dms || {};

const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";

let userStatus = {};
let userDisplayNames = {};
let userBios = {};
let activeSessions = {};
let voiceChannels = {};
let resetRequests = {}; // Храним запросы на сброс пароля
let messageIdCounter = 0;

// Инициализация комнат
const defaultRooms = ['general', 'gaming', 'music', 'other-fuckin-shit'];
defaultRooms.forEach(room => {
    if (!ROOMS[room]) ROOMS[room] = { messages: [], users: new Set() };
});

function getMessageId() {
    return ++messageIdCounter + '_' + Date.now().toString(36);
}

function getUserByUsername(username) {
    for (let [socketId, session] of Object.entries(activeSessions)) {
        if (session.username === username) return { socketId, session };
    }
    return null;
}

function sendSystemMessage(room, text) {
    const msg = {
        id: getMessageId(),
        type: "text",
        author: "system",
        displayName: "🛡️ СИСТЕМА",
        role: "владелец",
        avatar: null,
        text,
        time: Date.now(),
        reactions: {},
        pings: []
    };
    if (ROOMS[room]) {
        ROOMS[room].messages.push(msg);
        io.to(room).emit("chat", msg);
        saveDB('rooms');
    }
}

// ========== API ==========
app.get("/users-list", (req, res) => {
    const users = Object.keys(USERS).map(u => ({
        username: u,
        displayName: userDisplayNames[u] || u,
        bio: userBios[u] || "",
        avatar: USERS[u]?.avatar,
        role: USERS[u]?.role,
        status: userStatus[u] || "offline"
    }));
    res.json(users);
});

app.get("/friends/:username", (req, res) => {
    const username = req.params.username;
    const userFriends = FRIENDS[username] || { friends: [], requests: [] };
    const friendsWithData = (userFriends.friends || []).map(f => ({
        username: f,
        displayName: userDisplayNames[f] || f,
        bio: userBios[f] || "",
        avatar: USERS[f]?.avatar,
        status: userStatus[f] || "offline",
        role: USERS[f]?.role
    }));
    res.json({ friends: friendsWithData, requests: userFriends.requests || [] });
});

// ========== ВОССТАНОВЛЕНИЕ ПАРОЛЯ (БЕЗ ПОЧТЫ) ==========
app.post("/request-reset", (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Введите никнейм" });
    if (!USERS[username]) return res.status(404).json({ error: "Пользователь не найден" });
    if (BANS[username]) return res.status(403).json({ error: "Пользователь в бане" });
    
    // Создаем запрос на сброс
    resetRequests[username] = {
        timestamp: Date.now(),
        confirmed: false
    };
    
    res.json({ 
        success: true, 
        message: "Введите новый пароль" 
    });
});

app.post("/reset-password", (req, res) => {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) return res.status(400).json({ error: "Заполните все поля" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Пароль должен быть не менее 6 символов" });
    
    const reset = resetRequests[username];
    if (!reset) return res.status(400).json({ error: "Сначала запросите сброс пароля" });
    if (Date.now() - reset.timestamp > 300000) { // 5 минут
        delete resetRequests[username];
        return res.status(400).json({ error: "Время истекло. Запросите сброс заново" });
    }
    
    USERS[username].password = newPassword;
    saveDB('users');
    delete resetRequests[username];
    
    res.json({ success: true, message: "Пароль успешно изменен!" });
});

// ========== РЕГИСТРАЦИЯ ==========
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (WHITELIST[username] === false) return res.status(403).json({ error: "Вы в бане!" });
    if (username === OWNER_USERNAME) return res.status(403).json({ error: "Ник занят" });
    if (USERS[username]) return res.status(400).json({ error: "Ник занят" });
    if (BANS[username]) return res.status(403).json({ error: "Вы в бане!" });
    if (password.length < 6) return res.status(400).json({ error: "Пароль должен быть не менее 6 символов" });
    
    USERS[username] = { 
        password, 
        role: "новичок", 
        createdAt: Date.now(), 
        avatar: null 
    };
    userDisplayNames[username] = username;
    userBios[username] = "";
    saveDB('users');
    res.json({ success: true, role: "новичок", displayName: username, bio: "" });
});

// ========== ЛОГИН ==========
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (BANS[username]) return res.status(403).json({ error: "Вы в бане!" });
    if (WHITELIST[username] === false) return res.status(403).json({ error: "Вы в бане!" });
    
    if (username === OWNER_USERNAME) {
        if (password === OWNER_PASSWORD) {
            if (!USERS[OWNER_USERNAME]) {
                USERS[OWNER_USERNAME] = { 
                    password: OWNER_PASSWORD, 
                    role: "владелец", 
                    createdAt: Date.now(), 
                    avatar: null 
                };
                userDisplayNames[OWNER_USERNAME] = OWNER_USERNAME;
                userBios[OWNER_USERNAME] = "Владелец сервера";
                saveDB('users');
            }
            return res.json({ 
                success: true, 
                role: "владелец", 
                avatar: USERS[OWNER_USERNAME]?.avatar || null, 
                displayName: userDisplayNames[OWNER_USERNAME] || OWNER_USERNAME, 
                bio: userBios[OWNER_USERNAME] || "" 
            });
        }
        return res.status(401).json({ error: "Неверный пароль" });
    }
    
    if (!USERS[username]) return res.status(401).json({ error: "Пользователь не найден" });
    if (USERS[username].password !== password) return res.status(401).json({ error: "Неверный пароль" });
    
    const user = USERS[username];
    const days = Math.floor((Date.now() - user.createdAt) / 86400000);
    if (days >= 7 && user.role === "новичок") {
        user.role = "олд";
        saveDB('users');
    }
    
    res.json({ 
        success: true, 
        role: user.role, 
        avatar: user.avatar,
        displayName: userDisplayNames[username] || username,
        bio: userBios[username] || ""
    });
});

// ========== ДРУЗЬЯ ==========
app.post("/friend-request", (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: "Не указаны имена" });
    if (from === to) return res.status(400).json({ error: "Нельзя добавить себя" });
    if (!USERS[to]) return res.status(404).json({ error: "Пользователь не найден" });
    
    if (!FRIENDS[to]) FRIENDS[to] = { friends: [], requests: [] };
    if (!FRIENDS[from]) FRIENDS[from] = { friends: [], requests: [] };
    
    if ((FRIENDS[to].friends || []).includes(from)) return res.status(400).json({ error: "Уже в друзьях" });
    if ((FRIENDS[to].requests || []).includes(from)) return res.status(400).json({ error: "Заявка уже отправлена" });
    
    if (!FRIENDS[to].requests) FRIENDS[to].requests = [];
    FRIENDS[to].requests.push(from);
    saveDB('friends');
    
    const target = getUserByUsername(to);
    if (target) {
        io.to(target.socketId).emit("friend-request", { from });
    }
    res.json({ success: true });
});

app.post("/accept-friend", (req, res) => {
    const { currentUser, fromUser } = req.body;
    if (!FRIENDS[currentUser]) FRIENDS[currentUser] = { friends: [], requests: [] };
    if (!FRIENDS[fromUser]) FRIENDS[fromUser] = { friends: [], requests: [] };
    
    FRIENDS[currentUser].requests = (FRIENDS[currentUser].requests || []).filter(r => r !== fromUser);
    if (!(FRIENDS[currentUser].friends || []).includes(fromUser)) {
        if (!FRIENDS[currentUser].friends) FRIENDS[currentUser].friends = [];
        FRIENDS[currentUser].friends.push(fromUser);
    }
    if (!(FRIENDS[fromUser].friends || []).includes(currentUser)) {
        if (!FRIENDS[fromUser].friends) FRIENDS[fromUser].friends = [];
        FRIENDS[fromUser].friends.push(currentUser);
    }
    saveDB('friends');
    
    const fromSocket = getUserByUsername(fromUser);
    if (fromSocket) io.to(fromSocket.socketId).emit("friend-accepted", { fromUser: currentUser });
    
    res.json({ success: true });
});

app.post("/decline-friend", (req, res) => {
    const { currentUser, fromUser } = req.body;
    if (FRIENDS[currentUser]) {
        FRIENDS[currentUser].requests = (FRIENDS[currentUser].requests || []).filter(r => r !== fromUser);
        saveDB('friends');
    }
    res.json({ success: true });
});

app.post("/update-profile", (req, res) => {
    const { username, displayName, bio } = req.body;
    if (displayName) userDisplayNames[username] = displayName;
    if (bio !== undefined) userBios[username] = bio;
    res.json({ success: true });
});

app.post("/change-nick", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    const user = USERS[oldUsername];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверный пароль" });
    if (newUsername === OWNER_USERNAME) return res.status(403).json({ error: "Это ник владельца" });
    if (USERS[newUsername] && newUsername !== oldUsername) return res.status(400).json({ error: "Ник занят" });
    if (BANS[newUsername]) return res.status(403).json({ error: "Этот ник в бане!" });
    
    USERS[newUsername] = { ...user };
    delete USERS[oldUsername];
    if (userDisplayNames[oldUsername]) {
        userDisplayNames[newUsername] = userDisplayNames[oldUsername];
        delete userDisplayNames[oldUsername];
    }
    if (userBios[oldUsername]) {
        userBios[newUsername] = userBios[oldUsername];
        delete userBios[oldUsername];
    }
    saveDB('users');
    res.json({ success: true, newUsername });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    const { username } = req.body;
    if (USERS[username]) {
        USERS[username].avatar = "/avatars/" + req.file.filename;
        saveDB('users');
        res.json({ url: USERS[username].avatar });
    } else {
        res.status(404).json({ error: "Пользователь не найден" });
    }
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => {
    res.json({ url: "/voices/" + req.file.filename });
});

app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    let fileType = "image";
    if (req.file.mimetype.startsWith("video")) fileType = "video";
    if (req.file.mimetype.startsWith("audio")) fileType = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType });
});

// ========== SOCKET.IO ==========
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, room }) => {
        try {
            if (BANS[username]) {
                socket.emit("auth-error", "ТЫ В БАНЕ!");
                socket.disconnect();
                return;
            }
            if (!USERS[username]) {
                socket.emit("auth-error", "Пользователь не найден");
                socket.disconnect();
                return;
            }
            
            if (activeSessions[socket.id]) {
                const prevRoom = activeSessions[socket.id].room;
                if (prevRoom && ROOMS[prevRoom]) {
                    ROOMS[prevRoom].users.delete(socket.id);
                    socket.leave(prevRoom);
                }
            }

            activeSessions[socket.id] = { username, room };
            socket.join(room);
            
            if (room && room.startsWith("dm_")) {
                if (!DMS[room]) DMS[room] = [];
                socket.emit("history", DMS[room].slice(-200));
            } else if (room && ROOMS[room]) {
                ROOMS[room].users.add(socket.id);
                socket.emit("history", ROOMS[room].messages.slice(-200));
            } else if (room) {
                ROOMS[room] = { messages: [], users: new Set() };
                ROOMS[room].users.add(socket.id);
                socket.emit("history", []);
            }

            if (!userStatus[username]) userStatus[username] = "online";
            userStatus[username] = "online";

            socket.emit("user-data", { 
                username, 
                role: USERS[username].role, 
                avatar: USERS[username].avatar,
                displayName: userDisplayNames[username] || username,
                bio: userBios[username] || "",
                status: userStatus[username] 
            });
            
            io.emit("online", Object.keys(activeSessions).length);
            
            const allUsers = Object.keys(USERS).map(u => ({
                username: u,
                displayName: userDisplayNames[u] || u,
                bio: userBios[u] || "",
                avatar: USERS[u]?.avatar,
                role: USERS[u]?.role,
                status: userStatus[u] || "offline"
            }));
            io.emit("all-users", allUsers);
            
            const userFriends = FRIENDS[username] || { friends: [], requests: [] };
            socket.emit("friends-list", { friends: userFriends.friends || [], requests: userFriends.requests || [] });
        } catch(err) {
            console.error("Auth error:", err);
            socket.emit("auth-error", "Ошибка авторизации");
        }
    });

    socket.on("set-status", ({ status }) => {
        const session = activeSessions[socket.id];
        if (session && session.username) {
            userStatus[session.username] = status;
            io.emit("user-status-update", { username: session.username, status });
            
            const allUsers = Object.keys(USERS).map(u => ({
                username: u,
                displayName: userDisplayNames[u] || u,
                bio: userBios[u] || "",
                avatar: USERS[u]?.avatar,
                role: USERS[u]?.role,
                status: userStatus[u] || "offline"
            }));
            io.emit("all-users", allUsers);
        }
    });

    socket.on("chat", (data) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        
        const user = USERS[session.username];
        if (!user) return;
        
        let text = typeof data === "string" ? data : (data.text || "");
        let pings = typeof data === "object" ? (data.pings || []) : [];
        
        const msg = {
            id: getMessageId(),
            type: "text",
            author: session.username,
            displayName: userDisplayNames[session.username] || session.username,
            bio: userBios[session.username] || "",
            role: user.role,
            avatar: user.avatar,
            text: text,
            time: Date.now(),
            reactions: {},
            pings: pings,
            room: session.room
        };
        
        try {
            if (session.room && session.room.startsWith("dm_")) {
                if (!DMS[session.room]) DMS[session.room] = [];
                DMS[session.room].push(msg);
                saveDB('dms');
                io.to(session.room).emit("chat", msg);
            } else if (session.room && ROOMS[session.room]) {
                ROOMS[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
                saveDB('rooms');
            }
        } catch(err) {
            console.error("Chat error:", err);
        }
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        const user = USERS[session.username];
        if (!user) return;
        
        const msg = {
            id: getMessageId(),
            type: "media",
            author: session.username,
            displayName: userDisplayNames[session.username] || session.username,
            role: user.role,
            avatar: user.avatar,
            mediaUrl: url,
            mediaType: fileType,
            time: Date.now(),
            reactions: {},
            pings: [],
            room: session.room
        };
        
        try {
            if (session.room && session.room.startsWith("dm_")) {
                if (!DMS[session.room]) DMS[session.room] = [];
                DMS[session.room].push(msg);
                saveDB('dms');
                io.to(session.room).emit("chat", msg);
            } else if (session.room && ROOMS[session.room]) {
                ROOMS[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
                saveDB('rooms');
            }
        } catch(err) {
            console.error("Media error:", err);
        }
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        const user = USERS[session.username];
        if (!user) return;
        
        const msg = {
            id: getMessageId(),
            type: "voice",
            author: session.username,
            displayName: userDisplayNames[session.username] || session.username,
            role: user.role,
            avatar: user.avatar,
            audio: url,
            time: Date.now(),
            reactions: {},
            pings: [],
            room: session.room
        };
        
        try {
            if (session.room && session.room.startsWith("dm_")) {
                if (!DMS[session.room]) DMS[session.room] = [];
                DMS[session.room].push(msg);
                saveDB('dms');
                io.to(session.room).emit("chat", msg);
            } else if (session.room && ROOMS[session.room]) {
                ROOMS[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
                saveDB('rooms');
            }
        } catch(err) {
            console.error("Voice error:", err);
        }
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        
        let messages;
        if (room && room.startsWith("dm_")) messages = DMS[room];
        else if (room && ROOMS[room]) messages = ROOMS[room].messages;
        
        if (!messages) return;
        
        const index = messages.findIndex(m => m.id == msgId);
        if (index !== -1) {
            const msg = messages[index];
            if (msg.author === session.username || USERS[session.username]?.role === "владелец") {
                messages.splice(index, 1);
                io.to(room).emit("message-deleted", { msgId });
                if (!room.startsWith("dm_")) saveDB('rooms');
                else saveDB('dms');
            }
        }
    });

    socket.on("add-reaction", ({ room, msgId, emoji }) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        
        let messages;
        if (room && room.startsWith("dm_")) messages = DMS[room];
        else if (room && ROOMS[room]) messages = ROOMS[room].messages;
        
        if (!messages) return;
        
        const msg = messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(session.username)) msg.reactions[emoji].push(session.username);
            io.to(room).emit("reaction-updated", { msgId, reactions: msg.reactions });
            if (!room.startsWith("dm_")) saveDB('rooms');
            else saveDB('dms');
        }
    });

    // ========== ГОЛОСОВЫЕ КАНАЛЫ ==========
    socket.on("join-voice-channel", (channelName) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        
        if (session.voiceChannel) {
            const prev = voiceChannels[session.voiceChannel];
            if (prev) {
                prev.users = prev.users.filter(id => id !== socket.id);
                io.to(session.voiceChannel).emit("voice-users-update", prev.users.map(id => {
                    const s = activeSessions[id];
                    if (!s) return null;
                    return {
                        username: s.username,
                        displayName: userDisplayNames[s.username] || s.username,
                        avatar: USERS[s.username]?.avatar,
                        status: userStatus[s.username] || "offline"
                    };
                }).filter(Boolean));
                io.to(session.voiceChannel).emit("voice-count", prev.users.length);
            }
        }
        
        if (!voiceChannels[channelName]) voiceChannels[channelName] = { users: [] };
        voiceChannels[channelName].users.push(socket.id);
        session.voiceChannel = channelName;
        socket.join(channelName);
        
        const users = voiceChannels[channelName].users.map(id => {
            const s = activeSessions[id];
            if (!s) return null;
            return {
                username: s.username,
                displayName: userDisplayNames[s.username] || s.username,
                avatar: USERS[s.username]?.avatar,
                status: userStatus[s.username] || "offline"
            };
        }).filter(Boolean);
        
        io.to(channelName).emit("voice-users-update", users);
        io.to(channelName).emit("voice-count", users.length);
        socket.to(channelName).emit("user-joined", socket.id);
    });

    socket.on("leave-voice-channel", () => {
        const session = activeSessions[socket.id];
        if (!session || !session.voiceChannel) return;
        
        const channel = session.voiceChannel;
        if (voiceChannels[channel]) {
            voiceChannels[channel].users = voiceChannels[channel].users.filter(id => id !== socket.id);
            const users = voiceChannels[channel].users.map(id => {
                const s = activeSessions[id];
                if (!s) return null;
                return {
                    username: s.username,
                    displayName: userDisplayNames[s.username] || s.username,
                    avatar: USERS[s.username]?.avatar,
                    status: userStatus[s.username] || "offline"
                };
            }).filter(Boolean);
            io.to(channel).emit("voice-users-update", users);
            io.to(channel).emit("voice-count", users.length);
            io.to(channel).emit("user-left", socket.id);
        }
        delete session.voiceChannel;
        socket.leave(channel);
    });

    socket.on("signal", ({ to, data }) => {
        const target = getUserByUsername(to);
        if (target) {
            io.to(target.socketId).emit("signal", { from: socket.id, data });
        }
    });

    // ========== МОДЕРАЦИЯ ==========
    socket.on("mod-action", ({ action, target, room, reason, duration }) => {
        const session = activeSessions[socket.id];
        if (!session || !session.username) return;
        const user = USERS[session.username];
        if (!user || (user.role !== "владелец" && user.role !== "админ")) return;
        
        switch(action) {
            case "kick": {
                const targetSession = getUserByUsername(target);
                if (targetSession) {
                    io.to(targetSession.socketId).emit("kick", `Вас выгнали из ${room}`);
                    targetSession.session.room = null;
                    targetSession.session.voiceChannel = null;
                    io.to(targetSession.socketId).emit("auth-error", "Вы были выгнаны");
                }
                sendSystemMessage(room, `${target} был выгнан`);
                break;
            }
            case "ban": {
                BANS[target] = true;
                saveDB('bans');
                const bannedUser = getUserByUsername(target);
                if (bannedUser) {
                    io.to(bannedUser.socketId).emit("ban", "Вы были забанены");
                    bannedUser.session.room = null;
                    bannedUser.session.voiceChannel = null;
                }
                sendSystemMessage(room, `${target} был забанен`);
                break;
            }
            case "unban": {
                delete BANS[target];
                saveDB('bans');
                sendSystemMessage(room, `${target} разбанен`);
                break;
            }
            case "mute": {
                if (!MUTES[target]) MUTES[target] = { rooms: {} };
                const muteTime = duration || 60000;
                MUTES[target].rooms[room] = Date.now() + muteTime;
                saveDB('mutes');
                sendSystemMessage(room, `${target} замучен на ${muteTime/1000} сек`);
                break;
            }
            case "unmute": {
                if (MUTES[target]) {
                    delete MUTES[target].rooms[room];
                    saveDB('mutes');
                    sendSystemMessage(room, `${target} размучен`);
                }
                break;
            }
            case "warn": {
                if (!WARNS[target]) WARNS[target] = [];
                WARNS[target].push({ time: Date.now(), reason: reason || "Нарушение", by: session.username });
                saveDB('warns');
                sendSystemMessage(room, `${target} получил предупреждение ${reason ? "("+reason+")" : ""}`);
                if (WARNS[target].length >= 3) {
                    BANS[target] = true;
                    saveDB('bans');
                    sendSystemMessage(room, `${target} забанен за 3 предупреждения`);
                }
                break;
            }
            case "clear": {
                if (ROOMS[room]) {
                    ROOMS[room].messages = [];
                    saveDB('rooms');
                    io.to(room).emit("clear-chat");
                }
                break;
            }
            case "create": {
                const newRoom = target;
                if (!ROOMS[newRoom]) {
                    ROOMS[newRoom] = { messages: [], users: new Set() };
                    saveDB('rooms');
                    io.emit("new-room", newRoom);
                    sendSystemMessage(newRoom, `Комната ${newRoom} создана`);
                }
                break;
            }
            case "delete": {
                if (ROOMS[target] && target !== "general") {
                    delete ROOMS[target];
                    saveDB('rooms');
                    io.emit("delete-room", target);
                }
                break;
            }
            case "whitelist": {
                if (WHITELIST[target] === undefined) {
                    WHITELIST[target] = true;
                    saveDB('whitelist');
                    sendSystemMessage(room, `${target} добавлен в вайтлист`);
                }
                break;
            }
            case "unwhitelist": {
                if (WHITELIST[target]) {
                    WHITELIST[target] = false;
                    saveDB('whitelist');
                    sendSystemMessage(room, `${target} исключен из вайтлиста`);
                }
                break;
            }
        }
    });

    socket.on("disconnect", () => {
        const session = activeSessions[socket.id];
        if (session && session.username) {
            userStatus[session.username] = "offline";
            io.emit("user-status-update", { username: session.username, status: "offline" });
            
            if (session.voiceChannel && voiceChannels[session.voiceChannel]) {
                voiceChannels[session.voiceChannel].users = voiceChannels[session.voiceChannel].users.filter(id => id !== socket.id);
                const users = voiceChannels[session.voiceChannel].users.map(id => {
                    const s = activeSessions[id];
                    if (!s) return null;
                    return {
                        username: s.username,
                        displayName: userDisplayNames[s.username] || s.username,
                        avatar: USERS[s.username]?.avatar,
                        status: userStatus[s.username] || "offline"
                    };
                }).filter(Boolean);
                io.to(session.voiceChannel).emit("voice-users-update", users);
                io.to(session.voiceChannel).emit("voice-count", users.length);
                io.to(session.voiceChannel).emit("user-left", socket.id);
            }
            
            const allUsers = Object.keys(USERS).map(u => ({
                username: u,
                displayName: userDisplayNames[u] || u,
                bio: userBios[u] || "",
                avatar: USERS[u]?.avatar,
                role: USERS[u]?.role,
                status: userStatus[u] || "offline"
            }));
            io.emit("all-users", allUsers);
        }
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 Auramap сервер запущен на порту ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}\n`);
});
