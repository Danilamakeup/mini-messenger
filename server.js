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
    general: [],
    gaming: [],
    music: []
};

// ---------------- SOCKET ----------------
io.on("connection", (socket) => {

    socket.on("join", ({ name, room }) => {

        const prev = users[socket.id]?.room;

        if (prev) socket.leave(prev);

        socket.join(room);

        users[socket.id] = { name, room };

        socket.emit("room history", rooms[room] || []);

        io.emit("room stats", getStats());
        io.emit("online", Object.keys(users).length);
    });

    socket.on("chat", (text) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = {
            type: "text",
            name: u.name,
            text
        };

        rooms[u.room].push(msg);

        io.to(u.room).emit("chat", msg);
    });

    socket.on("voice", (url) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = {
            type: "voice",
            name: u.name,
            audio: url
        };

        rooms[u.room].push(msg);

        io.to(u.room).emit("chat", msg);
    });

    // WebRTC signaling
    socket.on("voice-join", (room) => {
        socket.join("voice:" + room);
        socket.to("voice:" + room).emit("user-joined", socket.id);
    });

    socket.on("signal", ({ to, data }) => {
        io.to(to).emit("signal", {
            from: socket.id,
            data
        });
    });

    socket.on("disconnect", () => {
        delete users[socket.id];

        io.emit("online", Object.keys(users).length);
        io.emit("room stats", getStats());
    });
});

function getStats() {
    const stats = {};
    for (let r in rooms) {
        stats[r] = rooms[r].length;
    }
    return stats;
}

// voice upload
app.post("/upload", upload.single("audio"), (req, res) => {
    const file = "/voices/" + req.file.filename + ".webm";

    fs.renameSync(req.file.path, "public" + file);

    res.json({ url: file });
});

server.listen(3000, () => console.log("Server started"));
