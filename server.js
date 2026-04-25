const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

const uploads = path.join(__dirname, "public/uploads");
if (!fs.existsSync(uploads)) fs.mkdirSync(uploads, { recursive: true });

/* ================= DATA ================= */
const rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() }
};

const sessions = {};

/* ================= UPLOAD ================= */
const upload = multer({
    storage: multer.diskStorage({
        destination: uploads,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    })
});

app.post("/upload-media", upload.single("file"), (req, res) => {
    const type = req.file.mimetype.startsWith("image")
        ? "image"
        : req.file.mimetype.startsWith("video")
        ? "video"
        : "audio";

    res.json({
        url: "/uploads/" + req.file.filename,
        type
    });
});

/* ================= SOCKET ================= */
io.on("connection", (socket) => {

    socket.on("auth", ({ username, room }) => {
        sessions[socket.id] = { username, room };

        socket.join(room);

        socket.emit("history", rooms[room].messages);

        io.emit("online", Object.keys(sessions).length);
    });

    socket.on("chat", (text) => {
        const s = sessions[socket.id];
        if (!s) return;

        const msg = {
            id: Date.now().toString(),
            author: s.username,
            text,
            time: Date.now(),
            reactions: {},
            replies: null,
            edited: false
        };

        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
    });

    socket.on("media", (url, type) => {
        const s = sessions[socket.id];
        if (!s) return;

        const msg = {
            id: Date.now().toString(),
            author: s.username,
            text: url,
            type,
            time: Date.now(),
            reactions: {},
            replies: null
        };

        rooms[s.room].messages.push(msg);
        io.to(s.room).emit("chat", msg);
    });

    /* ================= EDIT ================= */
    socket.on("edit", ({ id, newText }) => {
        const s = sessions[socket.id];
        if (!s) return;

        const msg = rooms[s.room].messages.find(m => m.id === id);
        if (!msg) return;

        msg.text = newText;
        msg.edited = true;

        io.to(s.room).emit("update", msg);
    });

    /* ================= DELETE ================= */
    socket.on("delete", (id) => {
        const s = sessions[socket.id];
        if (!s) return;

        rooms[s.room].messages = rooms[s.room].messages.filter(m => m.id !== id);

        io.to(s.room).emit("delete", id);
    });

    /* ================= REACTION ================= */
    socket.on("react", ({ id, emoji }) => {
        const s = sessions[socket.id];
        if (!s) return;

        const msg = rooms[s.room].messages.find(m => m.id === id);
        if (!msg) return;

        if (!msg.reactions[emoji]) msg.reactions[emoji] = 0;
        msg.reactions[emoji]++;

        io.to(s.room).emit("reaction", { id, reactions: msg.reactions });
    });

    /* ================= TYPING ================= */
    socket.on("typing", () => {
        const s = sessions[socket.id];
        if (!s) return;
        socket.to(s.room).emit("typing", s.username);
    });

    socket.on("stop-typing", () => {
        const s = sessions[socket.id];
        if (!s) return;
        socket.to(s.room).emit("stop-typing", s.username);
    });

    socket.on("disconnect", () => {
        delete sessions[socket.id];
        io.emit("online", Object.keys(sessions).length);
    });
});

server.listen(3000, () => console.log("http://localhost:3000"));
