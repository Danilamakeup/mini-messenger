const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

if (!fs.existsSync("public/voices")) {
    fs.mkdirSync("public/voices", { recursive: true });
}

const upload = multer({ dest: "public/voices/" });

const users = {};
const rooms = {
    general: { messages: [], users: [] },
    gaming: { messages: [], users: [] },
    music: { messages: [], users: [] }
};

const voiceRooms = {}; // голосовые комнаты

function updateRooms() {
    const stats = {};

    for (let r in rooms) {
        stats[r] = rooms[r].users.length;
    }

    io.emit("room stats", stats);
}

function updateGlobalOnline() {
    io.emit("online count", Object.keys(users).length);
}

io.on("connection", (socket) => {

    socket.on("join", ({ name, room }) => {

        const prev = users[socket.id]?.room;
        if (prev) {
            socket.leave(prev);

            rooms[prev].users =
                rooms[prev].users.filter(u => u.id !== socket.id);
        }

        socket.join(room);

        users[socket.id] = { name, room };

        if (!rooms[room]) rooms[room] = { messages: [], users: [] };

        rooms[room].users.push({ id: socket.id, name });

        socket.emit("room history", rooms[room].messages);

        io.to(room).emit("users in room", rooms[room].users);

        updateRooms();
        updateGlobalOnline();
    });

    socket.on("chat", (text) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = {
            type: "text",
            name: u.name,
            text
        };

        rooms[u.room].messages.push(msg);

        io.to(u.room).emit("chat", msg);
    });

    // 🎤 voice file FIX
    app.post("/upload", upload.single("audio"), (req, res) => {

        const file = "/voices/" + req.file.filename + ".webm";

        fs.renameSync(
            req.file.path,
            "public" + file
        );

        res.json({ url: file });
    });

    socket.on("voice", (url) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = {
            type: "voice",
            name: u.name,
            audio: url
        };

        rooms[u.room].messages.push(msg);

        io.to(u.room).emit("chat", msg);
    });

    // 🔊 VOICE ROOMS (discord style)
    socket.on("join voice room", (room) => {
        socket.join("voice-" + room);
        if (!voiceRooms[room]) voiceRooms[room] = [];

        voiceRooms[room].push(socket.id);
    });

    socket.on("disconnect", () => {

        const u = users[socket.id];

        if (u) {
            rooms[u.room].users =
                rooms[u.room].users.filter(x => x.id !== socket.id);
        }

        delete users[socket.id];

        updateRooms();
        updateGlobalOnline();
    });
});

server.listen(process.env.PORT || 3000);
