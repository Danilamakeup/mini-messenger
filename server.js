const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// папка для аудио
const upload = multer({ dest: "public/voices/" });

app.use(express.static("public"));

// чтобы папка была
if (!fs.existsSync("public/voices")) {
    fs.mkdirSync("public/voices", { recursive: true });
}

const users = {};
const rooms = {};

io.on("connection", (socket) => {

    socket.on("join", ({ name, room }) => {
        socket.join(room);
        users[socket.id] = { name, room };

        if (!rooms[room]) rooms[room] = [];

        socket.emit("room history", rooms[room]);

        io.to(room).emit("users",
            Object.values(users).filter(u => u.room === room)
        );
    });

    socket.on("chat", (text) => {
        const user = users[socket.id];
        if (!user) return;

        const msg = {
            type: "text",
            name: user.name,
            text
        };

        rooms[user.room].push(msg);
        io.to(user.room).emit("chat", msg);
    });

    socket.on("voice-file", (fileUrl) => {
        const user = users[socket.id];
        if (!user) return;

        const msg = {
            type: "voice",
            name: user.name,
            audio: fileUrl
        };

        rooms[user.room].push(msg);
        io.to(user.room).emit("chat", msg);
    });

    socket.on("disconnect", () => {
        delete users[socket.id];
    });
});

// загрузка файла
app.post("/upload", upload.single("audio"), (req, res) => {
    const fileUrl = "/voices/" + req.file.filename + ".webm";

    fs.renameSync(
        req.file.path,
        path.join("public/voices", req.file.filename + ".webm")
    );

    res.json({ url: fileUrl });
});

server.listen(process.env.PORT || 3000);
