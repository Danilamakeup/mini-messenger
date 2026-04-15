const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// 🔥 норм сохранение файлов
const upload = multer({
    storage: multer.diskStorage({
        destination: "public/voices",
        filename: (req, file, cb) => {
            cb(null, Date.now() + ".webm");
        }
    })
});

const users = {};
const rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() }
};

const voiceRooms = {};

io.on("connection", (socket) => {

    socket.on("join", ({ name, room }) => {

        const prev = users[socket.id]?.room;

        if (prev && rooms[prev]) {
            rooms[prev].users.delete(socket.id);
            socket.leave(prev);
        }

        socket.join(room);

        users[socket.id] = { name, room };
        rooms[room].users.add(socket.id);

        socket.emit("history", rooms[room].messages);

        io.emit("online", Object.keys(users).length);
    });

    socket.on("chat", (text) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = { type: "text", name: u.name, text };

        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = { type: "voice", name: u.name, audio: url };

        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("chat", msg);
    });

    // 🎧 VOICE ROOMS
    socket.on("voice-join", (room) => {

        const vr = "voice:" + room;
        socket.join(vr);

        if (!voiceRooms[room]) voiceRooms[room] = new Set();
        voiceRooms[room].add(socket.id);

        voiceRooms[room].forEach(id => {
            if (id !== socket.id) {
                socket.emit("voice-user", id);
            }
        });

        socket.to(vr).emit("user-joined", socket.id);
        io.to(vr).emit("voice-count", voiceRooms[room].size);
    });

    socket.on("signal", ({ to, data }) => {
        io.to(to).emit("signal", { from: socket.id, data });
    });

    socket.on("disconnect", () => {

        for (let r in voiceRooms) {
            if (voiceRooms[r].has(socket.id)) {
                voiceRooms[r].delete(socket.id);
                io.to("voice:" + r).emit("voice-count", voiceRooms[r].size);
            }
        }

        delete users[socket.id];
        io.emit("online", Object.keys(users).length);
    });
});

// upload
app.post("/upload", upload.single("audio"), (req, res) => {
    res.json({ url: "/voices/" + req.file.filename });
});

server.listen(3000, () => console.log("🔥 WORKING"));
