const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*" },
    maxHttpBufferSize: 1e7
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
app.use(express.json({ limit: "10mb" }));

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

const whitelistFile = path.join(__dirname, "whitelist.json");
let whitelistDB = {};
if (fs.existsSync(whitelistFile)) whitelistDB = JSON.parse(fs.readFileSync(whitelistFile));
function saveWhitelist() { fs.writeFileSync(whitelistFile, JSON.stringify(whitelistDB, null, 2)); }

const friendsFile = path.join(__dirname, "friends.json");
let friendsDB = {};
if (fs.existsSync(friendsFile)) friendsDB = JSON.parse(fs.readFileSync(friendsFile));
function saveFriends() { fs.writeFileSync(friendsFile, JSON.stringify(friendsDB, null, 2)); }

// ========== ЗАЩИЩЁННЫЙ НИК ВЛАДЕЛЬЦА ==========
const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";

// ========== СТАТУСЫ ==========
let userStatus = {};
let userDisplayNames = {};
let userBios = {};
let activeSessions = {};

// ========== КОМНАТЫ ==========
let rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
    "other-fuckin-shit": { messages: [], users: new Set() }
};
const voiceRooms = { "voice-chat": new Set(), "gaming-voice": new Set(), "music-voice": new Set(), "afk": new Set() };
let dms = {};

const roomsFile = path.join(__dirname, "rooms.json");
if (fs.existsSync(roomsFile)) {
    try {
        const roomsData = JSON.parse(fs.readFileSync(roomsFile));
        for (let [name, data] of Object.entries(roomsData)) {
            if (rooms[name]) rooms[name].messages = data.messages;
            else rooms[name] = { messages: data.messages, users: new Set() };
        }
    } catch(e) {}
}

function saveRooms() {
    const roomsData = {};
    for (let [name, room] of Object.entries(rooms)) {
        roomsData[name] = { messages: room.messages.slice(-500) };
    }
    fs.writeFileSync(roomsFile, JSON.stringify(roomsData, null, 2));
}

const dmsFile = path.join(__dirname, "dms.json");
if (fs.existsSync(dmsFile)) {
    try {
        dms = JSON.parse(fs.readFileSync(dmsFile));
    } catch(e) {}
}
function saveDMs() { fs.writeFileSync(dmsFile, JSON.stringify(dms, null, 2)); }

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
        author: "system",
        displayName: "🛡️ СИСТЕМА",
        role: "владелец",
        avatar: null,
        text,
        time: Date.now(),
        reactions: {},
        pings: []
    };
    if (rooms[room]) {
        rooms[room].messages.push(msg);
        io.to(room).emit("chat", msg);
        saveRooms();
    }
}

// ========== API ==========
app.get("/users-list", (req, res) => {
    const users = Object.keys(usersDB).map(u => ({
        username: u,
        displayName: userDisplayNames[u] || u,
        bio: userBios[u] || "",
        avatar: usersDB[u]?.avatar,
        role: usersDB[u]?.role,
        status: userStatus[u] || "offline"
    }));
    res.json(users);
});

app.get("/friends/:username", (req, res) => {
    const username = req.params.username;
    const userFriends = friendsDB[username] || { friends: [], requests: [] };
    const friendsWithData = (userFriends.friends || []).map(f => ({
        username: f,
        displayName: userDisplayNames[f] || f,
        bio: userBios[f] || "",
        avatar: usersDB[f]?.avatar,
        status: userStatus[f] || "offline",
        role: usersDB[f]?.role
    }));
    const requestsWithData = (userFriends.requests || []).map(r => ({ from: r }));
    res.json({ friends: friendsWithData, requests: requestsWithData });
});

app.post("/friend-request", (req, res) => {
    const { from, to } = req.body;
    if (!from || !to) return res.status(400).json({ error: "Не указаны имена" });
    if (from === to) return res.status(400).json({ error: "Нельзя добавить себя" });
    if (!usersDB[to]) return res.status(404).json({ error: "Пользователь не найден" });
    
    if (!friendsDB[to]) friendsDB[to] = { friends: [], requests: [] };
    if (!friendsDB[from]) friendsDB[from] = { friends: [], requests: [] };
    
    if (friendsDB[to].friends?.includes(from)) return res.status(400).json({ error: "Уже в друзьях" });
    if (friendsDB[to].requests?.includes(from)) return res.status(400).json({ error: "Заявка уже отправлена" });
    
    friendsDB[to].requests = friendsDB[to].requests || [];
    friendsDB[to].requests.push(from);
    saveFriends();
    
    const target = getUserByUsername(to);
    if (target) {
        io.to(target.socketId).emit("friend-request", { from });
    }
    res.json({ success: true });
});

app.post("/accept-friend", (req, res) => {
    const { currentUser, fromUser } = req.body;
    if (!friendsDB[currentUser]) friendsDB[currentUser] = { friends: [], requests: [] };
    if (!friendsDB[fromUser]) friendsDB[fromUser] = { friends: [], requests: [] };
    
    friendsDB[currentUser].requests = (friendsDB[currentUser].requests || []).filter(r => r !== fromUser);
    if (!friendsDB[currentUser].friends?.includes(fromUser)) friendsDB[currentUser].friends.push(fromUser);
    if (!friendsDB[fromUser].friends?.includes(currentUser)) friendsDB[fromUser].friends.push(currentUser);
    saveFriends();
    
    const fromSocket = getUserByUsername(fromUser);
    if (fromSocket) io.to(fromSocket.socketId).emit("friend-accepted", { fromUser: currentUser });
    
    res.json({ success: true });
});

app.post("/decline-friend", (req, res) => {
    const { currentUser, fromUser } = req.body;
    if (friendsDB[currentUser]) {
        friendsDB[currentUser].requests = (friendsDB[currentUser].requests || []).filter(r => r !== fromUser);
        saveFriends();
    }
    res.json({ success: true });
});

app.post("/update-profile", (req, res) => {
    const { username, displayName, bio } = req.body;
    if (displayName) userDisplayNames[username] = displayName;
    if (bio !== undefined) userBios[username] = bio;
    res.json({ success: true });
});

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (whitelistDB[username] === false) return res.status(403).json({ error: "ТЫ В БАНЕ!" });
    if (username === OWNER_USERNAME) return res.status(403).json({ error: "НИК ЗАНЯТ" });
    if (usersDB[username]) return res.status(400).json({ error: "НИК ЗАНЯТ" });
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ!" });
    
    usersDB[username] = { password, role: "новичок", createdAt: Date.now(), avatar: null };
    userDisplayNames[username] = username;
    userBios[username] = "";
    saveUsers();
    res.json({ success: true, role: "новичок", displayName: username, bio: "" });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ!" });
    if (whitelistDB[username] === false) return res.status(403).json({ error: "ТЫ В БАНЕ!" });
    
    if (username === OWNER_USERNAME) {
        if (password === OWNER_PASSWORD) {
            if (!usersDB[OWNER_USERNAME]) {
                usersDB[OWNER_USERNAME] = { password: OWNER_PASSWORD, role: "владелец", createdAt: Date.now(), avatar: null };
                userDisplayNames[OWNER_USERNAME] = OWNER_USERNAME;
                userBios[OWNER_USERNAME] = "Владелец сервера";
                saveUsers();
            }
            return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_USERNAME]?.avatar || null, displayName: userDisplayNames[OWNER_USERNAME] || OWNER_USERNAME, bio: userBios[OWNER_USERNAME] || "" });
        }
        return res.status(401).json({ error: "Неверный пароль" });
    }
    
    if (!usersDB[username]) return res.status(401).json({ error: "НИК НЕ НАЙДЕН" });
    if (usersDB[username].password !== password) return res.status(401).json({ error: "НЕПРАВИЛЬНЫЙ ПАРОЛЬ" });
    
    const user = usersDB[username];
    const days = Math.floor((Date.now() - user.createdAt) / 86400000);
    if (days >= 7 && user.role === "новичок") {
        user.role = "олд";
        saveUsers();
    }
    
    res.json({ 
        success: true, 
        role: user.role, 
        avatar: user.avatar,
        displayName: userDisplayNames[username] || username,
        bio: userBios[username] || ""
    });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
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
    if (!req.file) return res.status(400).json({ error: "Файл больше 15 МБ" });
    let fileType = "image";
    if (req.file.mimetype.startsWith("video")) fileType = "video";
    if (req.file.mimetype.startsWith("audio")) fileType = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType });
});

// ========== SOCKET.IO ==========
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, room }) => {
        if (bansDB[username]) {
            socket.emit("auth-error", "ТЫ В БАНЕ!");
            socket.disconnect();
            return;
        }
        if (!usersDB[username]) {
            socket.emit("auth-error", "Пользователь не найден");
            socket.disconnect();
            return;
        }
        
        if (activeSessions[socket.id]) {
            const prevRoom = activeSessions[socket.id].room;
            if (prevRoom && rooms[prevRoom]) {
                rooms[prevRoom].users.delete(socket.id);
                socket.leave(prevRoom);
            }
        }

        activeSessions[socket.id] = { username, room };
        socket.join(room);
        
        if (room.startsWith("dm_")) {
            if (!dms[room]) dms[room] = [];
            socket.emit("history", dms[room].slice(-200));
        } else {
            if (!rooms[room]) rooms[room] = { messages: [], users: new Set() };
            rooms[room].users.add(socket.id);
            socket.emit("history", rooms[room].messages.slice(-200));
        }

        if (!userStatus[username]) userStatus[username] = "online";
        userStatus[username] = "online";

        socket.emit("user-data", { 
            username, 
            role: usersDB[username].role, 
            avatar: usersDB[username].avatar,
            displayName: userDisplayNames[username] || username,
            bio: userBios[username] || "",
            status: userStatus[username] 
        });
        
        io.emit("online", Object.keys(activeSessions).length);
        
        const allUsers = Object.keys(usersDB).map(u => ({
            username: u,
            displayName: userDisplayNames[u] || u,
            bio: userBios[u] || "",
            avatar: usersDB[u]?.avatar,
            role: usersDB[u]?.role,
            status: userStatus[u] || "offline"
        }));
        io.emit("all-users", allUsers);
        
        const userFriends = friendsDB[username] || { friends: [], requests: [] };
        socket.emit("friends-list", { friends: userFriends.friends || [], requests: userFriends.requests || [] });
    });

    socket.on("set-status", ({ status }) => {
        const session = activeSessions[socket.id];
        if (session) {
            userStatus[session.username] = status;
            io.emit("user-status-update", { username: session.username, status });
            
            const allUsers = Object.keys(usersDB).map(u => ({
                username: u,
                displayName: userDisplayNames[u] || u,
                bio: userBios[u] || "",
                avatar: usersDB[u]?.avatar,
                role: usersDB[u]?.role,
                status: userStatus[u] || "offline"
            }));
            io.emit("all-users", allUsers);
        }
    });

    socket.on("chat", (data) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        
        const user = usersDB[session.username];
        let text = typeof data === "string" ? data : data.text;
        let pings = typeof data === "object" ? (data.pings || []) : [];
        
        const msg = {
            id: Date.now() + "_" + Math.random(),
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
        
        if (session.room.startsWith("dm_")) {
            if (!dms[session.room]) dms[session.room] = [];
            dms[session.room].push(msg);
            saveDMs();
            io.to(session.room).emit("chat", msg);
        } else {
            rooms[session.room].messages.push(msg);
            io.to(session.room).emit("chat", msg);
            saveRooms();
        }
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = {
            id: Date.now() + "_" + Math.random(),
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
        
        if (session.room.startsWith("dm_")) {
            if (!dms[session.room]) dms[session.room] = [];
            dms[session.room].push(msg);
            saveDMs();
            io.to(session.room).emit("chat", msg);
        } else {
            rooms[session.room].messages.push(msg);
            io.to(session.room).emit("chat", msg);
            saveRooms();
        }
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msg = {
            id: Date.now() + "_" + Math.random(),
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
        
        if (session.room.startsWith("dm_")) {
            if (!dms[session.room]) dms[session.room] = [];
            dms[session.room].push(msg);
            saveDMs();
            io.to(session.room).emit("chat", msg);
        } else {
            rooms[session.room].messages.push(msg);
            io.to(session.room).emit("chat", msg);
            saveRooms();
        }
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        
        let messages;
        if (room.startsWith("dm_")) messages = dms[room];
        else messages = rooms[room]?.messages;
        
        if (!messages) return;
        
        const index = messages.findIndex(m => m.id == msgId);
        if (index !== -1) {
            messages.splice(index, 1);
            io.to(room).emit("message-deleted", { msgId });
            if (!room.startsWith("dm_")) saveRooms();
            else saveDMs();
        }
    });

    socket.on("add-reaction", ({ room, msgId, emoji }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        
        let messages;
        if (room.startsWith("dm_")) messages = dms[room];
        else messages = rooms[room]?.messages;
        
        if (!messages) return;
        
        const msg = messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(session.username)) msg.reactions[emoji].push(session.username);
            io.to(room).emit("reaction-updated", { msgId, reactions: msg.reactions });
            if (!room.startsWith("dm_")) saveRooms();
            else saveDMs();
        }
    });

    // Голосовой чат
    socket.on("join-voice-channel", (channelName) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    displayName: userDisplayNames[activeSessions[id]?.username] || activeSessions[id]?.username,
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
            displayName: userDisplayNames[activeSessions[id]?.username] || activeSessions[id]?.username,
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
                    displayName: userDisplayNames[activeSessions[id]?.username] || activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                io.to("voice:" + name).emit("voice-count", users.size);
                socket.leave("voice:" + name);
                break;
            }
        }
    });

    socket.on("signal", ({ to, data }) => {
        io.to(to).emit("signal", { from: socket.id, data });
    });

    socket.on("disconnect", () => {
        const session = activeSessions[socket.id];
        if (session) {
            userStatus[session.username] = "offline";
            io.emit("user-status-update", { username: session.username, status: "offline" });
            
            const allUsers = Object.keys(usersDB).map(u => ({
                username: u,
                displayName: userDisplayNames[u] || u,
                bio: userBios[u] || "",
                avatar: usersDB[u]?.avatar,
                role: usersDB[u]?.role,
                status: userStatus[u] || "offline"
            }));
            io.emit("all-users", allUsers);
        }
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
        
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    displayName: userDisplayNames[activeSessions[id]?.username] || activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                io.to("voice:" + name).emit("voice-count", users.size);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 NEXUS сервер на ${PORT}`));
