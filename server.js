const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/* ================= STATE ================= */
const rooms = {
    general: { messages: [] },
    gaming: { messages: [] },
    music: { messages: [] }
};

const users = {};

/* ================= SOCKET ================= */
io.on("connection", (socket) => {

    socket.on("join", ({ username, room }) => {
        users[socket.id] = { username, room };

        socket.join(room);

        // 🔥 FIX: send history ONCE
        socket.emit("history", rooms[room].messages);

        io.emit("online", Object.keys(users).length);
    });

    socket.on("message", (text) => {
        const u = users[socket.id];
        if (!u) return;

        const msg = {
            id: Date.now().toString(),
            author: u.username,
            text,
            time: Date.now()
        };

        rooms[u.room].messages.push(msg);
        io.to(u.room).emit("message", msg);
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
        io.emit("online", Object.keys(users).length);
    });
});

server.listen(3000, () => console.log("http://localhost:3000"));
