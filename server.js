const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const users = {};
const rooms = {}; // комнаты

io.on("connection", (socket) => {

    socket.on("join", ({name, room}) => {
        socket.join(room);

        users[socket.id] = { name, room };

        if (!rooms[room]) rooms[room] = [];

        io.to(room).emit("users", Object.values(users).filter(u=>u.room===room));
    });

    socket.on("chat", (msg) => {
        const user = users[socket.id];
        if (!user) return;

        const data = {
            type: "text",
            name: user.name,
            text: msg
        };

        rooms[user.room].push(data);
        io.to(user.room).emit("chat", data);
    });

    socket.on("voice", (audio) => {
        const user = users[socket.id];
        if (!user) return;

        const data = {
            type: "voice",
            name: user.name,
            audio
        };

        io.to(user.room).emit("chat", data);
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
    });
});

server.listen(process.env.PORT || 3000);
