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

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(voicesDir)) fs.mkdirSync(voicesDir);

app.use(express.static(publicDir));
app.use(express.json());

const upload = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => cb(null, Date.now() + ".mp3")
    }),
    limits: { fileSize: 15 * 1024 * 1024 }
});

const usersFile = path.join(__dirname, "users.json");
let users = {};
if (fs.existsSync(usersFile)) users = JSON.parse(fs.readFileSync(usersFile));
function saveUsers() { fs.writeFileSync(usersFile, JSON.stringify(users, null, 2)); }

const bansFile = path.join(__dirname, "bans.json");
let bans = {};
if (fs.existsSync(bansFile)) bans = JSON.parse(fs.readFileSync(bansFile));
function saveBans() { fs.writeFileSync(bansFile, JSON.stringify(bans, null, 2)); }

const mutesFile = path.join(__dirname, "mutes.json");
let mutes = {};
if (fs.existsSync(mutesFile)) mutes = JSON.parse(fs.readFileSync(mutesFile));
function saveMutes() { fs.writeFileSync(mutesFile, JSON.stringify(mutes, null, 2)); }

const warnsFile = path.join(__dirname, "warns.json");
let warns = {};
if (fs.existsSync(warnsFile)) warns = JSON.parse(fs.readFileSync(warnsFile));
function saveWarns() { fs.writeFileSync(warnsFile, JSON.stringify(warns, null, 2)); }

const OWNER = "bigheaven3569";
const OWNER_PASS = "swill1337";

let rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
    "other-fuckin-shit": { messages: [], users: new Set() }
};
const voiceRoom = new Set();
let activeSessions = {};
let userStatus = {};

function getUserByUsername(username) {
    for (let [id, s] of Object.entries(activeSessions)) {
        if (s.username === username) return { socketId: id, session: s };
    }
    return null;
}

function sendSystemMessage(room, text) {
    const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛡️ СИСТЕМА", role: "владелец", text, time: Date.now() };
    rooms[room].messages.push(msg);
    io.to(room).emit("chat", msg);
}

app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните поля" });
    if (username === OWNER) return res.status(403).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (users[username]) return res.status(400).json({ error: "НИК ЗАНЯТ" });
    users[username] = { password, role: "новичок", createdAt: Date.now(), avatar: null };
    saveUsers();
    res.json({ success: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (username === OWNER && password === OWNER_PASS) {
        if (!users[OWNER]) users[OWNER] = { password: OWNER_PASS, role: "владелец", createdAt: Date.now(), avatar: null };
        saveUsers();
        return res.json({ success: true, role: "владелец", avatar: null });
    }
    const user = users[username];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверные данные" });
    const days = Math.floor((Date.now() - user.createdAt) / 86400000);
    if (days >= 7 && user.role === "новичок") { user.role = "олд"; saveUsers(); }
    res.json({ success: true, role: user.role, avatar: user.avatar });
});

io.on("connection", (socket) => {
    socket.on("auth", ({ username, room }) => {
        if (bans[username]) return socket.emit("auth-error", "ТЫ В БАНЕ");
        const user = users[username];
        if (!user) return socket.emit("auth-error", "Пользователь не найден");
        if (mutes[username] && mutes[username] > Date.now()) {
            const rem = Math.ceil((mutes[username] - Date.now()) / 60000);
            return socket.emit("auth-error", `Ты в муте ещё ${rem} минут`);
        }

        const prev = activeSessions[socket.id];
        if (prev && rooms[prev.room]) {
            rooms[prev.room].users.delete(socket.id);
            socket.leave(prev.room);
        }

        activeSessions[socket.id] = { username, room };
        socket.join(room);
        rooms[room].users.add(socket.id);
        userStatus[username] = "online";

        socket.emit("history", rooms[room].messages);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar });
        io.emit("online", Object.keys(activeSessions).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => activeSessions[id]?.username));

        const allUsers = [];
        for (let u of Object.keys(users)) {
            const online = getUserByUsername(u) !== null;
            allUsers.push({ username: u, avatar: users[u].avatar, role: users[u].role, status: online ? "online" : "offline" });
        }
        socket.emit("all-users", allUsers);
        io.emit("user-status-update", { username, status: "online" });
    });

    socket.on("chat", (text) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = users[s.username];
        if (!user) return;
        if (text.startsWith("/clear") && user.role === "владелец") {
            const parts = text.split(" ");
            const count = parseInt(parts[1]);
            if (!isNaN(count) && count > 0) {
                rooms[s.room].messages = rooms[s.room].messages.slice(0, -count);
                io.to(s.room).emit("clear-chat");
                sendSystemMessage(s.room, `🧹 Очищено ${count} сообщений`);
            }
            return;
        }
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: s.username, role: user.role, text, time: Date.now() };
        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const user = users[s.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: s.username, role: user.role, audio: url, time: Date.now() };
        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
    });

    socket.on("edit-message", ({ room, msgId, newText }) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const idx = rooms[room].messages.findIndex(m => m.id == msgId);
        if (idx !== -1 && rooms[room].messages[idx].author === s.username) {
            rooms[room].messages[idx].text = newText;
            io.to(room).emit("message-edited", { msgId, newText });
        }
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const s = activeSessions[socket.id];
        if (!s) return;
        const idx = rooms[room].messages.findIndex(m => m.id == msgId);
        if (idx !== -1 && rooms[room].messages[idx].author === s.username) {
            rooms[room].messages.splice(idx, 1);
            io.to(room).emit("message-deleted", { msgId });
        }
    });

    socket.on("join-voice", () => {
        const s = activeSessions[socket.id];
        if (!s) return;
        voiceRoom.add(socket.id);
        socket.join("voice");
        const usersInVoice = Array.from(voiceRoom).map(id => ({ username: activeSessions[id]?.username, avatar: users[activeSessions[id]?.username]?.avatar }));
        io.to("voice").emit("voice-users", usersInVoice);
        socket.to("voice").emit("user-joined", socket.id);
    });

    socket.on("leave-voice", () => {
        voiceRoom.delete(socket.id);
        socket.leave("voice");
        const usersInVoice = Array.from(voiceRoom).map(id => ({ username: activeSessions[id]?.username, avatar: users[activeSessions[id]?.username]?.avatar }));
        io.to("voice").emit("voice-users", usersInVoice);
    });

    socket.on("signal", ({ to, data }) => { io.to(to).emit("signal", { from: socket.id, data }); });

    socket.on("disconnect", () => {
        const s = activeSessions[socket.id];
        if (s) {
            rooms[s.room]?.users.delete(socket.id);
            userStatus[s.username] = "offline";
            io.emit("user-status-update", { username: s.username, status: "offline" });
        }
        delete activeSessions[socket.id];
        voiceRoom.delete(socket.id);
        io.emit("online", Object.keys(activeSessions).length);
    });
});

app.post("/upload-audio", upload.single("audio"), (req, res) => { res.json({ url: "/voices/" + req.file.filename }); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер на ${PORT}`));
