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

function saveMessages() {
    fs.writeFileSync("messages.json", JSON.stringify(messages, null, 2));
}

function updateUsers() {
    io.emit("users list", Object.values(users));
}

io.on("connection", (socket) => {

    socket.emit("chat history", messages);

    socket.on("set nickname", (name) => {
        users[socket.id] = name;
        updateUsers();
    });

    // 💬 text
    socket.on("chat message", (text) => {
        const name = users[socket.id] || "Аноним";

        const msg = {
            type: "text",
            name,
            text
        };

        messages.push(msg);
        saveMessages();

        io.emit("chat message", msg);
    });

    // 🎤 voice file (10 sec)
    socket.on("voice message", (audioUrl) => {
        const name = users[socket.id] || "Аноним";

        const msg = {
            type: "voice",
            name,
            audio: audioUrl
        };

        messages.push(msg);
        saveMessages();

        io.emit("chat message", msg);
    });

    // 🔊 WEBRTC VOICE CHAT
    socket.on("join voice", () => {
        socket.broadcast.emit("user-joined-voice", socket.id);
    });

    socket.on("offer", (data) => {
        socket.to(data.to).emit("offer", {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on("answer", (data) => {
        socket.to(data.to).emit("answer", {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on("ice-candidate", (data) => {
        socket.to(data.to).emit("ice-candidate", {
            candidate: data.candidate,
            from: socket.id
        });
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
        updateUsers();
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log("Server started");
});
