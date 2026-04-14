const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const users = {};
let messages = [];

if (fs.existsSync("messages.json")) {
    messages = JSON.parse(fs.readFileSync("messages.json"));
}

function save() {
    fs.writeFileSync("messages.json", JSON.stringify(messages, null, 2));
}

function updateUsers() {
    io.emit("users", users);
}

io.on("connection", (socket) => {

    socket.emit("history", messages);

    socket.on("set name", (name) => {
        users[socket.id] = {
            name,
            online: true
        };
        updateUsers();
    });

    socket.on("chat", (text) => {
        const user = users[socket.id];

        const msg = {
            type: "text",
            name: user?.name || "Аноним",
            text
        };

        messages.push(msg);
        save();
        io.emit("chat", msg);
    });

    // 🎤 ГОЛОС (FIX: base64)
    socket.on("voice", (audioBase64) => {
        const user = users[socket.id];

        const msg = {
            type: "voice",
            name: user?.name || "Аноним",
            audio: audioBase64
        };

        messages.push(msg);
        save();
        io.emit("chat", msg);
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
        updateUsers();
    });
});

server.listen(process.env.PORT || 3000);
