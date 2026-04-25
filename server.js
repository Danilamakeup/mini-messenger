const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, "public");
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");

[publicDir, uploadsDir, avatarsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

app.use(express.static(publicDir));
app.use(express.json());

// ---------------- USERS ----------------
const usersDB = {};
const bansDB = {};
const mutesDB = {};
const warnsDB = {};
const userStatus = {};
const activeSessions = {};

// ---------------- ROOMS ----------------
const rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
};

// ---------------- FILE UPLOAD ----------------
const uploadMedia = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    })
});

app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const type = req.file.mimetype.startsWith("image") ? "image"
        : req.file.mimetype.startsWith("video") ? "video"
        : "audio";

    res.json({
        url: "/uploads/" + req.file.filename,
        fileType: type
    });
});

// ---------------- AUTH ----------------
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (usersDB[username]) return res.status(400).json({ error: "exists" });

    usersDB[username] = {
        password,
        role: "user",
        avatar: null
    };

    res.json({ success: true });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;

    if (!usersDB[username]) return res.status(400).json({ error: "no user" });
    if (usersDB[username].password !== password)
        return res.status(400).json({ error: "wrong pass" });

    res.json({
        success: true,
        role: usersDB[username].role,
        avatar: usersDB[username].avatar
    });
});

// ---------------- SOCKET ----------------
io.on("connection", (socket) => {

    socket.on("auth", ({ username, room }) => {
        activeSessions[socket.id] = { username, room };

        socket.join(room);

        socket.emit("history", rooms[room].messages);

        io.emit("online", Object.keys(activeSessions).length);
    });

    socket.on("chat", (text) => {
        const session = activeSessions[socket.id];
        if (!session) return;

        const msg = {
            id: Date.now(),
            author: session.username,
            text,
            time: Date.now(),
            avatar: null
        };

        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("media", (url, type) => {
        const session = activeSessions[socket.id];
        if (!session) return;

        const msg = {
            id: Date.now(),
            author: session.username,
            type,
            text: url,
            time: Date.now()
        };

        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("disconnect", () => {
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
    });
});

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
