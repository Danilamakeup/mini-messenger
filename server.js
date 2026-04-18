const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ========== ПАПКИ ==========
const publicDir = path.join(__dirname, "public");
const voicesDir = path.join(publicDir, "voices");
const uploadsDir = path.join(publicDir, "uploads");
const avatarsDir = path.join(publicDir, "avatars");

[publicDir, voicesDir, uploadsDir, avatarsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(express.static(publicDir));
app.use(express.json());

// ========== ЗАГРУЗКИ ==========
const uploadAudio = multer({
    storage: multer.diskStorage({
        destination: voicesDir,
        filename: (req, file, cb) => cb(null, Date.now() + ".mp3")
    }),
    limits: { fileSize: 15 * 1024 * 1024 }
});

const uploadMedia = multer({
    storage: multer.diskStorage({
        destination: uploadsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Неподдерживаемый формат'), false);
    }
});

const uploadAvatar = multer({
    storage: multer.diskStorage({
        destination: avatarsDir,
        filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Можно только PNG, JPG, GIF, WEBP!'), false);
    }
});

// ========== БАЗЫ ДАННЫХ ==========
const usersFile = path.join(__dirname, "users.json");
let usersDB = {};
if (fs.existsSync(usersFile)) usersDB = JSON.parse(fs.readFileSync(usersFile));
function saveUsers() { fs.writeFileSync(usersFile, JSON.stringify(usersDB, null, 2)); }

const bansFile = path.join(__dirname, "bans.json");
let bansDB = {};
if (fs.existsSync(bansFile)) bansDB = JSON.parse(fs.readFileSync(bansFile));
function saveBans() { fs.writeFileSync(bansFile, JSON.stringify(bansDB, null, 2)); }

const warnsFile = path.join(__dirname, "warns.json");
let warnsDB = {};
if (fs.existsSync(warnsFile)) warnsDB = JSON.parse(fs.readFileSync(warnsFile));
function saveWarns() { fs.writeFileSync(warnsFile, JSON.stringify(warnsDB, null, 2)); }

const mutesFile = path.join(__dirname, "mutes.json");
let mutesDB = {};
if (fs.existsSync(mutesFile)) mutesDB = JSON.parse(fs.readFileSync(mutesFile));
function saveMutes() { fs.writeFileSync(mutesFile, JSON.stringify(mutesDB, null, 2)); }

const coinsFile = path.join(__dirname, "coins.json");
let coinsDB = {};
if (fs.existsSync(coinsFile)) coinsDB = JSON.parse(fs.readFileSync(coinsFile));
function saveCoins() { fs.writeFileSync(coinsFile, JSON.stringify(coinsDB, null, 2)); }

// ========== ЗАЩИЩЁННЫЙ НИК ВЛАДЕЛЬЦА ==========
const OWNER_USERNAME = "bigheaven3569";
const OWNER_PASSWORD = "swill1337";

// ========== СТАТУСЫ ==========
let userStatus = {};

// ========== КОНКУРСЫ ==========
let activeContest = null;
let contestTimeout = null;

const contestQuestions = [
    { question: "Сколько будет 15 + 27?", answer: "42", type: "math" },
    { question: "Сколько будет 8 × 7?", answer: "56", type: "math" },
    { question: "Сколько будет 144 ÷ 12?", answer: "12", type: "math" },
    { question: "Сколько будет 9²?", answer: "81", type: "math" },
    { question: "Какой блок в Майнкрафте нужен для создания портала в Незер?", answer: "обсидиан", type: "minecraft" },
    { question: "Как называется алмазная броня в Майнкрафте?", answer: "алмазная", type: "minecraft" },
    { question: "Кто главный босс в Майнкрафте?", answer: "дракон края", type: "minecraft" },
    { question: "Какой инструмент нужен для добычи алмазов?", answer: "железная кирка", type: "minecraft" },
    { question: "Сколько будет 25 × 4?", answer: "100", type: "math" },
    { question: "Сколько будет 100 - 37?", answer: "63", type: "math" }
];

function startNewContest() {
    if (contestTimeout) clearTimeout(contestTimeout);
    const randomQuestion = contestQuestions[Math.floor(Math.random() * contestQuestions.length)];
    activeContest = {
        id: Date.now(),
        question: randomQuestion.question,
        answer: randomQuestion.answer.toLowerCase(),
        type: randomQuestion.type,
        winners: [],
        active: true
    };
    
    sendGlobalAnnouncement(`🎉 **КОНКУРС!** 🎉\n📝 Вопрос: ${activeContest.question}\n💰 Приз: 100 монет!\n✏️ Пиши ответ в чат первым!`);
    
    contestTimeout = setTimeout(() => {
        if (activeContest && activeContest.active) {
            sendGlobalAnnouncement(`⏰ Конкурс закончен! Правильный ответ: ${activeContest.answer}. Никто не выиграл :(`);
            activeContest = null;
        }
    }, 60000);
}

// Запуск конкурсов каждые 10 минут
setInterval(() => {
    if (!activeContest || !activeContest.active) {
        startNewContest();
    }
}, 10 * 60 * 1000);

// ========== КОМНАТЫ ==========
let rooms = {
    general: { messages: [], users: new Set() },
    gaming: { messages: [], users: new Set() },
    music: { messages: [], users: new Set() },
    "other-fuckin-shit": { messages: [], users: new Set() }
};

const voiceRooms = { "voice-chat": new Set() };
const activeSessions = {};

const roomsFile = path.join(__dirname, "rooms.json");
if (fs.existsSync(roomsFile)) {
    const roomsData = JSON.parse(fs.readFileSync(roomsFile));
    for (let [name, data] of Object.entries(roomsData)) {
        if (rooms[name]) rooms[name].messages = data.messages;
        else rooms[name] = { messages: data.messages, users: new Set() };
    }
}
function saveRooms() {
    const roomsData = {};
    for (let [name, room] of Object.entries(rooms)) {
        roomsData[name] = { messages: room.messages };
    }
    fs.writeFileSync(roomsFile, JSON.stringify(roomsData, null, 2));
}

function getUserByUsername(username) {
    for (let [socketId, session] of Object.entries(activeSessions)) {
        if (session.username === username) return { socketId, session };
    }
    return null;
}

function sendSystemMessage(room, text) {
    const msg = {
        id: Date.now() + "_" + Math.random(),
        type: "text",
        author: "🛡️ СИСТЕМА",
        role: "владелец",
        avatar: null,
        text,
        time: Date.now(),
        reactions: {}
    };
    rooms[room].messages.push(msg);
    io.to(room).emit("chat", msg);
}

function sendGlobalAnnouncement(text) {
    for (let room in rooms) {
        sendSystemMessage(room, text);
    }
}

// ========== ИНТЕРЕСНЫЕ ФАКТЫ (каждые 2 минуты) ==========
const funFacts = [
    "🧠 Интересный факт: мама нолана весит больше чем кто-либо",
    "💡 Совет: не меняй ник на владельца, лучше ищи баги",
    "😂 Прикол: 'окак' придуман еще в маша и медведь",
    "🐱 Факт: коты не умеют жевать еду",
    "🍕 Факт: самый дорогой пицца в мире стоит $12,000",
    "🎮 Факт: Minecraft был создан за одну неделю",
    "💀 Факт: Discord изначально создавался как игра",
    "🔥 Факт: ты сейчас читаешь этот факт в моём мессенджере",
    "🐶 Факт: собаки понимают до 250 слов и жестов",
    "🌍 Факт: интернет весит примерно 50 граммов",
    "🎵 Факт: самая длинная песня длится 639 лет",
    "📱 Факт: первый смартфон появился в 1992 году",
    "🍔 Факт: самый большой бургер весил 350 кг",
    "🚀 Факт: скорость интернета на МКС — 600 Мбит/с",
    "💻 Факт: первый компьютер весил 27 тонн",
    "🎮 Факт: Tetris создал советский программист",
    "🐧 Факт: пингвины предлагают камешки самкам",
    "🦷 Факт: улитки имеют около 25,000 зубов"
];

let factInterval = null;
function startFactTimer() {
    if (factInterval) clearInterval(factInterval);
    factInterval = setInterval(() => {
        const randomFact = funFacts[Math.floor(Math.random() * funFacts.length)];
        for (let room in rooms) {
            sendSystemMessage(room, randomFact);
        }
    }, 2 * 60 * 1000);
}

// ========== ОЧИСТКА МУТОВ ==========
setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (let [user, until] of Object.entries(mutesDB)) {
        if (until <= now) {
            delete mutesDB[user];
            changed = true;
        }
    }
    if (changed) saveMutes();
}, 60000);

// ========== API ==========
app.post("/register", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполните все поля" });
    if (username === OWNER_USERNAME) return res.status(403).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (usersDB[username]) return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ, ПИЗДУЙ!" });
    
    usersDB[username] = { password, role: "новичок", createdAt: Date.now(), avatar: null };
    saveUsers();
    if (!coinsDB[username]) coinsDB[username] = 0;
    saveCoins();
    res.json({ success: true, role: "новичок" });
});

app.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (bansDB[username]) return res.status(403).json({ error: "ТЫ В БАНЕ, НЕ ПРИХОДИ!" });
    
    if (username === OWNER_USERNAME) {
        if (password === OWNER_PASSWORD) {
            if (!usersDB[OWNER_USERNAME]) {
                usersDB[OWNER_USERNAME] = { password: OWNER_PASSWORD, role: "владелец", createdAt: Date.now(), avatar: null };
                saveUsers();
            }
            if (!coinsDB[OWNER_USERNAME]) coinsDB[OWNER_USERNAME] = 1000000000000000000000000000;
            saveCoins();
            return res.json({ success: true, role: "владелец", avatar: usersDB[OWNER_USERNAME]?.avatar || null });
        } else {
            return res.status(401).json({ error: "Неверный пароль владельца" });
        }
    }
    
    if (!usersDB[username]) return res.status(401).json({ error: "НИК НЕ НАЙДЕН, ЗАРЕГИСТРИРУЙСЯ!" });
    if (usersDB[username].password !== password) return res.status(401).json({ error: "НЕПРАВИЛЬНЫЙ ПАРОЛЬ, ПИЗДА!" });
    
    const user = usersDB[username];
    const days = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
    if (days >= 7 && user.role === "новичок") {
        user.role = "олд";
        saveUsers();
    }
    if (!coinsDB[username]) coinsDB[username] = 0;
    saveCoins();
    res.json({ success: true, role: user.role, avatar: user.avatar });
});

app.post("/change-nick", (req, res) => {
    const { oldUsername, newUsername, password } = req.body;
    const user = usersDB[oldUsername];
    if (!user || user.password !== password) return res.status(401).json({ error: "Неверный пароль" });
    if (newUsername === OWNER_USERNAME) return res.status(403).json({ error: "ЭТО НИК ВЛАДЕЛЬЦА, НЕ ЛЕЗЬ!" });
    if (usersDB[newUsername] && newUsername !== oldUsername) return res.status(400).json({ error: "НИК ЗАНЯТ ИДИ НАХУЙ!!" });
    if (bansDB[newUsername]) return res.status(403).json({ error: "ЭТОТ НИК В БАНЕ!" });
    
    const coins = coinsDB[oldUsername] || 0;
    usersDB[newUsername] = { ...user };
    delete usersDB[oldUsername];
    coinsDB[newUsername] = coins;
    delete coinsDB[oldUsername];
    saveUsers();
    saveCoins();
    res.json({ success: true, newUsername });
});

app.post("/upload-avatar", uploadAvatar.single("avatar"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Можно только PNG, JPG, GIF, WEBP! Не больше 5 МБ" });
    const { username } = req.body;
    if (usersDB[username]) {
        usersDB[username].avatar = "/avatars/" + req.file.filename;
        saveUsers();
        res.json({ url: usersDB[username].avatar });
    } else {
        res.status(404).json({ error: "Пользователь не найден" });
    }
});

app.post("/buy-role", (req, res) => {
    const { username, role, price } = req.body;
    const userCoins = coinsDB[username] || 0;
    if (userCoins >= price) {
        coinsDB[username] -= price;
        usersDB[username].role = role;
        saveCoins();
        saveUsers();
        res.json({ success: true, newRole: role, newCoins: coinsDB[username] });
    } else {
        res.json({ success: false, error: "Недостаточно монет!" });
    }
});

// ========== SOCKET.IO ==========
io.on("connection", (socket) => {
    console.log("✅ Подключился:", socket.id);

    socket.on("auth", ({ username, room }) => {
        if (bansDB[username]) { socket.emit("auth-error", "ТЫ В БАНЕ, ПИЗДУЙ!"); return; }
        const user = usersDB[username];
        if (!user) { socket.emit("auth-error", "Пользователь не найден"); return; }
        if (mutesDB[username] && mutesDB[username] > Date.now()) {
            const remaining = Math.ceil((mutesDB[username] - Date.now()) / 1000 / 60);
            socket.emit("auth-error", `ТЫ В МУТЕ ЕЩЁ ${remaining} МИНУТ!`);
            return;
        } else if (mutesDB[username]) { delete mutesDB[username]; saveMutes(); }

        const prev = activeSessions[socket.id]?.room;
        if (prev && rooms[prev]) {
            rooms[prev].users.delete(socket.id);
            socket.leave(prev);
        }

        activeSessions[socket.id] = { username, room };
        socket.join(room);
        rooms[room].users.add(socket.id);
        
        if (!userStatus[username]) userStatus[username] = "online";
        userStatus[username] = "online";

        socket.emit("history", rooms[room].messages);
        socket.emit("user-data", { username, role: user.role, avatar: user.avatar, status: userStatus[username], coins: coinsDB[username] || 0 });
        io.emit("online", Object.keys(activeSessions).length);
        io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => ({
            username: activeSessions[id]?.username,
            avatar: usersDB[activeSessions[id]?.username]?.avatar,
            status: userStatus[activeSessions[id]?.username] || "online"
        })));
        
        const allUsers = [];
        for (let u of Object.keys(usersDB)) {
            const isOnline = getUserByUsername(u) !== null;
            allUsers.push({
                username: u,
                avatar: usersDB[u]?.avatar,
                role: usersDB[u]?.role,
                status: isOnline ? (userStatus[u] || "online") : "offline"
            });
        }
        io.emit("all-users", allUsers);
        
        if (!factInterval) startFactTimer();
    });
    
    socket.on("set-status", ({ status }) => {
        const session = activeSessions[socket.id];
        if (session) {
            userStatus[session.username] = status;
            io.emit("user-status-update", { username: session.username, status });
            
            const allUsers = [];
            for (let u of Object.keys(usersDB)) {
                const isOnline = getUserByUsername(u) !== null;
                allUsers.push({
                    username: u,
                    avatar: usersDB[u]?.avatar,
                    role: usersDB[u]?.role,
                    status: isOnline ? (userStatus[u] || "online") : "offline"
                });
            }
            io.emit("all-users", allUsers);
        }
    });

    socket.on("chat", (text) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) {
            socket.emit("auth-error", "ТЫ В МУТЕ, ПИШИ ПОТОМ!");
            return;
        }
        const user = usersDB[session.username];
        
        // Проверка конкурса
        if (activeContest && activeContest.active && !activeContest.winners.includes(session.username)) {
            if (text.toLowerCase().trim() === activeContest.answer) {
                activeContest.winners.push(session.username);
                coinsDB[session.username] = (coinsDB[session.username] || 0) + 100;
                saveCoins();
                sendGlobalAnnouncement(`🎉 **ПОБЕДИТЕЛЬ!** 🎉\n👑 ${session.username} правильно ответил на вопрос и получил 100 монет!`);
                socket.emit("user-data", { username: session.username, role: user.role, avatar: user.avatar, status: userStatus[session.username], coins: coinsDB[session.username] });
                activeContest.active = false;
                if (contestTimeout) clearTimeout(contestTimeout);
                setTimeout(() => {
                    if (!activeContest || !activeContest.active) startNewContest();
                }, 5000);
            }
        }
        
        // Команда магазина
        if (text === "/магазин") {
            const shopText = `🛒 **МАГАЗИН РОЛЕЙ** 🛒\n👑 Владелец — ${coinsDB[session.username] >= 1000000000000000000000000000 ? "✅" : "❌"} 1,000,000,000,000,000,000,000,000,000 монет\n⭐ Олд — ${coinsDB[session.username] >= 5000 ? "✅" : "❌"} 5,000 монет\n🛡️ Модератор — ${coinsDB[session.username] >= 10000 ? "✅" : "❌"} 10,000 монет\n\nЧтобы купить роль, напиши: /купить [роль]`;
            const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛒 МАГАЗИН", role: "система", avatar: null, text: shopText, time: Date.now(), reactions: {} };
            rooms[session.room].messages.push(msg);
            io.to(session.room).emit("chat", msg);
            return;
        }
        
        if (text.startsWith("/купить")) {
            const parts = text.split(" ");
            const roleName = parts[1]?.toLowerCase();
            let price = 0;
            let roleToBuy = "";
            if (roleName === "олд") { price = 5000; roleToBuy = "олд"; }
            else if (roleName === "модератор") { price = 10000; roleToBuy = "модер"; }
            else if (roleName === "владелец") { price = 1000000000000000000000000000; roleToBuy = "владелец"; }
            else {
                const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛒 МАГАЗИН", role: "система", avatar: null, text: "❌ Доступные роли: олд (5000), модератор (10000), владелец (1,000,000,000,000,000,000,000,000,000)", time: Date.now(), reactions: {} };
                rooms[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
                return;
            }
            
            if ((coinsDB[session.username] || 0) >= price) {
                coinsDB[session.username] -= price;
                usersDB[session.username].role = roleToBuy;
                saveCoins();
                saveUsers();
                const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛒 МАГАЗИН", role: "система", avatar: null, text: `✅ Ты купил роль "${roleToBuy}" за ${price} монет! Осталось монет: ${coinsDB[session.username]}`, time: Date.now(), reactions: {} };
                rooms[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
                socket.emit("user-data", { username: session.username, role: roleToBuy, avatar: user.avatar, status: userStatus[session.username], coins: coinsDB[session.username] });
            } else {
                const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: "🛒 МАГАЗИН", role: "система", avatar: null, text: `❌ Недостаточно монет! Нужно: ${price}, у тебя: ${coinsDB[session.username] || 0}`, time: Date.now(), reactions: {} };
                rooms[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
            }
            return;
        }
        
        // Команды владельца
        if (text.startsWith("/") && user.role === "владелец") {
            const parts = text.split(" ");
            const cmd = parts[0].toLowerCase();
            
            if (cmd === "/givecoins" && parts[1] && parts[2]) {
                const targetUser = parts[1].replace("@", "");
                const amount = parseInt(parts[2]);
                if (!isNaN(amount) && amount > 0) {
                    coinsDB[targetUser] = (coinsDB[targetUser] || 0) + amount;
                    saveCoins();
                    sendSystemMessage(session.room, `💰 ${targetUser} получил ${amount} монет!`);
                    const target = getUserByUsername(targetUser);
                    if (target) io.to(target.socketId).emit("user-data", { username: targetUser, role: usersDB[targetUser].role, avatar: usersDB[targetUser].avatar, status: userStatus[targetUser], coins: coinsDB[targetUser] });
                }
            }
            else if (cmd === "/resetcoins" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                coinsDB[targetUser] = 0;
                saveCoins();
                sendSystemMessage(session.room, `💰 Монеты ${targetUser} сброшены до 0!`);
                const target = getUserByUsername(targetUser);
                if (target) io.to(target.socketId).emit("user-data", { username: targetUser, role: usersDB[targetUser].role, avatar: usersDB[targetUser].avatar, status: userStatus[targetUser], coins: coinsDB[targetUser] });
            }
            else if (cmd === "/contest") {
                startNewContest();
                sendSystemMessage(session.room, "🎲 Новый конкурс запущен!");
            }
            else if (cmd === "/пароли" || cmd === "/passwords") {
                let passwordsList = "📋 СПИСОК ПОЛЬЗОВАТЕЛЕЙ И ПАРОЛЕЙ:\n";
                for (const [u, data] of Object.entries(usersDB)) {
                    passwordsList += `👤 ${u} → 🔑 ${data.password}\n`;
                }
                sendSystemMessage(session.room, passwordsList);
            }
            else if (cmd === "/функции" || cmd === "/фун" || cmd === "/help") {
                const helpText = `📖 КОМАНДЫ:\n/give @user роль — выдать роль\n/givecoins @user сумма — выдать монеты\n/resetcoins @user — сбросить монеты\n/kick @user — кикнуть\n/ban @user — забанить\n/unban @user — разбанить\n/clear N — очистить\n/mute @user минут — замутить\n/warn @user — варн\n/whois @user — инфо\n/stats — статистика\n/nuke — аннигиляция\n/create-room #название\n/delete-room #название\n/resetpass @user — сброс пароля\n/contest — запустить конкурс\n/пароли — посмотреть пароли`;
                sendSystemMessage(session.room, helpText);
            }
            else if (cmd === "/clearall") {
                for (let r in rooms) {
                    rooms[r].messages = [];
                    io.to(r).emit("clear-chat");
                }
                sendSystemMessage(session.room, "🧹 ВСЕ КОМНАТЫ ОЧИЩЕНЫ!");
            }
            else if (cmd === "/announce" && parts[1]) {
                const announcement = text.slice(9);
                sendGlobalAnnouncement(`📢 ОБЪЯВЛЕНИЕ ОТ ВЛАДЕЛЬЦА: ${announcement}`);
            }
            else if (cmd === "/serverinfo") {
                const totalUsers = Object.keys(usersDB).length;
                const onlineNow = Object.keys(activeSessions).length;
                const totalMessages = Object.values(rooms).reduce((acc, r) => acc + r.messages.length, 0);
                const totalRooms = Object.keys(rooms).length;
                sendSystemMessage(session.room, `📊 **ИНФО О СЕРВЕРЕ**\n👥 Всего: ${totalUsers}\n🟢 Онлайн: ${onlineNow}\n💬 Сообщений: ${totalMessages}\n📁 Комнат: ${totalRooms}\n👑 Владелец: ${OWNER_USERNAME}`);
            }
            else if (cmd === "/userinfo" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                const userInfo = usersDB[targetUser];
                if (!userInfo) { sendSystemMessage(session.room, `❌ Пользователь ${targetUser} не найден`); return; }
                const isOnline = getUserByUsername(targetUser) !== null;
                const warns = warnsDB[targetUser] || 0;
                const createdAt = new Date(userInfo.createdAt).toLocaleDateString();
                const muteUntil = mutesDB[targetUser];
                const isMuted = muteUntil && muteUntil > Date.now();
                const muteRemaining = isMuted ? Math.ceil((muteUntil - Date.now()) / 1000 / 60) : 0;
                const status = isOnline ? (userStatus[targetUser] || "online") : "offline";
                const statusEmoji = status === "online" ? "🟢" : status === "idle" ? "🟡" : status === "dnd" ? "🔴" : status === "loading" ? "🟠" : "⚫";
                sendSystemMessage(session.room, `📋 **ИНФО О ПОЛЬЗОВАТЕЛЕ ${targetUser}**\n${statusEmoji} Статус: ${status}\n👤 Роль: ${userInfo.role}\n💰 Монет: ${coinsDB[targetUser] || 0}\n📅 Зарегистрирован: ${createdAt}\n⚠️ Варны: ${warns}/3\n${isMuted ? `🔇 В муте: ещё ${muteRemaining} мин` : "🔊 Не в муте"}`);
            }
            else if ((cmd === "/create-room" || cmd === "/create") && parts[1]) {
                let newRoom = parts[1].replace("#", "").toLowerCase();
                if (!rooms[newRoom]) {
                    rooms[newRoom] = { messages: [], users: new Set() };
                    io.emit("new-room", newRoom);
                    sendSystemMessage(session.room, `📁 Создана комната #${newRoom}`);
                    saveRooms();
                } else { sendSystemMessage(session.room, `❌ Комната #${newRoom} уже существует`); }
            }
            else if ((cmd === "/delete-room" || cmd === "/delete") && parts[1]) {
                let delRoom = parts[1].replace("#", "").toLowerCase();
                if (delRoom !== "general" && rooms[delRoom]) {
                    delete rooms[delRoom];
                    io.emit("delete-room", delRoom);
                    sendSystemMessage(session.room, `🗑️ Удалена комната #${delRoom}`);
                    saveRooms();
                } else { sendSystemMessage(session.room, `❌ Нельзя удалить general`); }
            }
            else if (cmd === "/give" && parts[1] && parts[2]) {
                const targetUser = parts[1].replace("@", "");
                const role = parts[2].toLowerCase();
                if (usersDB[targetUser]) {
                    usersDB[targetUser].role = role;
                    saveUsers();
                    sendSystemMessage(session.room, `✅ ${targetUser} теперь ${role}!`);
                    const target = getUserByUsername(targetUser);
                    if (target) io.to(target.socketId).emit("user-data", { username: targetUser, role, avatar: usersDB[targetUser].avatar, status: userStatus[targetUser], coins: coinsDB[targetUser] });
                } else { sendSystemMessage(session.room, `❌ Не могу дать роль ${targetUser}`); }
            }
            else if (cmd === "/kick" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                const target = getUserByUsername(targetUser);
                if (target) {
                    io.to(target.socketId).emit("kick", "Тебя кикнули!");
                    target.session.socket.disconnect();
                    sendSystemMessage(session.room, `👢 ${targetUser} был кикнут!`);
                } else { sendSystemMessage(session.room, `❌ ${targetUser} не найден`); }
            }
            else if (cmd === "/ban" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                if (targetUser === OWNER_USERNAME) { sendSystemMessage(session.room, `❌ НЕЛЬЗЯ ЗАБАНИТЬ ВЛАДЕЛЬЦА!`); }
                else if (targetUser === session.username) { sendSystemMessage(session.room, `❌ СЕБЯ НЕЛЬЗЯ ЗАБАНИТЬ!`); }
                else {
                    bansDB[targetUser] = true;
                    saveBans();
                    const target = getUserByUsername(targetUser);
                    if (target) { io.to(target.socketId).emit("ban", "ТЫ В БАНЕ, ПИЗДУЙ!"); target.session.socket.disconnect(); }
                    sendSystemMessage(session.room, `🔨 ${targetUser} ЗАБАНЕН НАВСЕГДА!`);
                }
            }
            else if (cmd === "/unban" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                if (bansDB[targetUser]) {
                    delete bansDB[targetUser];
                    saveBans();
                    sendSystemMessage(session.room, `✅ ${targetUser} РАЗБАНЕН!`);
                } else { sendSystemMessage(session.room, `❌ ${targetUser} НЕ В БАНЕ.`); }
            }
            else if (cmd === "/clear" && parts[1]) {
                const count = parseInt(parts[1]);
                if (!isNaN(count) && count > 0) {
                    rooms[session.room].messages = rooms[session.room].messages.slice(0, -count);
                    io.to(session.room).emit("clear-chat");
                    sendSystemMessage(session.room, `🧹 Очищено ${count} сообщений!`);
                }
            }
            else if (cmd === "/mute" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                let minutes = 5;
                if (parts[2]) minutes = parseInt(parts[2]);
                if (!isNaN(minutes) && minutes > 0) {
                    mutesDB[targetUser] = Date.now() + (minutes * 60 * 1000);
                    saveMutes();
                    sendSystemMessage(session.room, `🤐 ${targetUser} замучен на ${minutes} минут!`);
                    const target = getUserByUsername(targetUser);
                    if (target) io.to(target.socketId).emit("mute", `Ты в муте ${minutes} минут!`);
                }
            }
            else if (cmd === "/warn" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                if (!warnsDB[targetUser]) warnsDB[targetUser] = 0;
                warnsDB[targetUser]++;
                saveWarns();
                sendSystemMessage(session.room, `⚠️ ${targetUser} получил предупреждение (${warnsDB[targetUser]}/3)`);
                if (warnsDB[targetUser] >= 3) {
                    bansDB[targetUser] = true;
                    saveBans();
                    const target = getUserByUsername(targetUser);
                    if (target) { io.to(target.socketId).emit("ban", "3 варна = БАН!"); target.session.socket.disconnect(); }
                }
            }
            else if (cmd === "/whois" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                const userInfo = usersDB[targetUser];
                if (!userInfo) { sendSystemMessage(session.room, `❌ Пользователь ${targetUser} не найден`); return; }
                const isOnline = getUserByUsername(targetUser) !== null;
                const warns = warnsDB[targetUser] || 0;
                const createdAt = new Date(userInfo.createdAt).toLocaleDateString();
                const muteUntil = mutesDB[targetUser];
                const isMuted = muteUntil && muteUntil > Date.now();
                const muteRemaining = isMuted ? Math.ceil((muteUntil - Date.now()) / 1000 / 60) : 0;
                sendSystemMessage(session.room, `📋 **ИНФО О ПОЛЬЗОВАТЕЛЕ ${targetUser}**\n👤 Роль: ${userInfo.role}\n💰 Монет: ${coinsDB[targetUser] || 0}\n📅 Зарегистрирован: ${createdAt}\n🟢 Статус: ${isOnline ? "В сети" : "Не в сети"}\n⚠️ Варны: ${warns}/3\n${isMuted ? `🔇 В муте: ещё ${muteRemaining} мин` : "🔊 Не в муте"}`);
            }
            else if (cmd === "/stats") {
                const totalUsers = Object.keys(usersDB).length;
                const onlineNow = Object.keys(activeSessions).length;
                const totalMessages = Object.values(rooms).reduce((acc, r) => acc + r.messages.length, 0);
                sendSystemMessage(session.room, `📊 Всего юзеров: ${totalUsers}, Онлайн: ${onlineNow}, Сообщений: ${totalMessages}`);
            }
            else if (cmd === "/nuke") {
                for (let r in rooms) rooms[r].messages = [];
                for (let r in rooms) io.to(r).emit("clear-chat");
                sendSystemMessage(session.room, "💀 ПОЛНАЯ АННИГИЛЯЦИЯ! 💀");
            }
            else if (cmd === "/resetpass" && parts[1]) {
                const targetUser = parts[1].replace("@", "");
                if (usersDB[targetUser]) {
                    const newPass = Math.random().toString(36).slice(-8);
                    usersDB[targetUser].password = newPass;
                    saveUsers();
                    sendSystemMessage(session.room, `🔑 Новый пароль для ${targetUser}: ${newPass}`);
                } else { sendSystemMessage(session.room, `❌ ${targetUser} не найден`); }
            }
            else {
                const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: session.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
                rooms[session.room].messages.push(msg);
                io.to(session.room).emit("chat", msg);
            }
            return;
        }
        
        const msg = { id: Date.now() + "_" + Math.random(), type: "text", author: session.username, role: user.role, avatar: user.avatar, text, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("media", (url, fileType) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) return;
        const user = usersDB[session.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "media", author: session.username, role: user.role, avatar: user.avatar, mediaUrl: url, mediaType: fileType, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("voice-msg", (url) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        if (mutesDB[session.username] && mutesDB[session.username] > Date.now()) return;
        const user = usersDB[session.username];
        const msg = { id: Date.now() + "_" + Math.random(), type: "voice", author: session.username, role: user.role, avatar: user.avatar, audio: url, time: Date.now(), reactions: {} };
        rooms[session.room].messages.push(msg);
        io.to(session.room).emit("chat", msg);
    });

    socket.on("delete-message", ({ room, msgId }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const user = usersDB[session.username];
        const msgIndex = rooms[room].messages.findIndex(m => m.id == msgId);
        if (msgIndex !== -1) {
            const msg = rooms[room].messages[msgIndex];
            const canDelete = user.role === "владелец" || user.role === "админ" || user.role === "модер" || msg.author === session.username;
            if (canDelete) { rooms[room].messages.splice(msgIndex, 1); io.to(room).emit("message-deleted", { msgId }); }
        }
    });

    socket.on("add-reaction", ({ room, msgId, emoji }) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        const msg = rooms[room].messages.find(m => m.id == msgId);
        if (msg) {
            if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
            if (!msg.reactions[emoji].includes(session.username)) msg.reactions[emoji].push(session.username);
            io.to(room).emit("reaction-updated", { msgId, reactions: msg.reactions });
        }
    });

    // ========== ГОЛОСОВОЙ ЧАТ (FIX - ПЕРЕПИСАНО) ==========
    socket.on("join-voice-channel", (channelName) => {
        const session = activeSessions[socket.id];
        if (!session) return;
        
        // Выход из всех предыдущих каналов
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                io.to("voice:" + name).emit("voice-count", users.size);
                socket.leave("voice:" + name);
            }
        }
        
        if (!voiceRooms[channelName]) voiceRooms[channelName] = new Set();
        voiceRooms[channelName].add(socket.id);
        socket.join("voice:" + channelName);
        
        // Отправляем обновлённый список
        const usersInChannel = Array.from(voiceRooms[channelName]).map(id => ({
            username: activeSessions[id]?.username,
            avatar: usersDB[activeSessions[id]?.username]?.avatar,
            status: userStatus[activeSessions[id]?.username] || "online"
        }));
        io.to("voice:" + channelName).emit("voice-users-update", usersInChannel);
        io.to("voice:" + channelName).emit("voice-count", voiceRooms[channelName].size);
        
        // Отправляем каждому участнику сигналы о других
        voiceRooms[channelName].forEach(id => {
            if (id !== socket.id) {
                socket.emit("voice-user", id);
            }
        });
        socket.to("voice:" + channelName).emit("user-joined", socket.id);
        
        console.log(`🎤 ${session.username} вошёл в голосовой канал ${channelName}, участников: ${voiceRooms[channelName].size}`);
    });
    
    socket.on("leave-voice-channel", () => {
        const session = activeSessions[socket.id];
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                io.to("voice:" + name).emit("voice-count", users.size);
                socket.leave("voice:" + name);
                if (session) console.log(`🎤 ${session.username} вышел из голосового канала ${name}`);
                break;
            }
        }
    });

    socket.on("signal", ({ to, data }) => { 
        io.to(to).emit("signal", { from: socket.id, data }); 
    });

    socket.on("disconnect", () => {
        const session = activeSessions[socket.id];
        if (session) {
            const room = session.room;
            rooms[room]?.users.delete(socket.id);
            io.to(room).emit("room-users", Array.from(rooms[room].users).map(id => ({
                username: activeSessions[id]?.username,
                avatar: usersDB[activeSessions[id]?.username]?.avatar,
                status: userStatus[activeSessions[id]?.username] || "online"
            })));
            userStatus[session.username] = "offline";
            io.emit("user-status-update", { username: session.username, status: "offline" });
            
            const allUsers = [];
            for (let u of Object.keys(usersDB)) {
                const isOnline = getUserByUsername(u) !== null;
                allUsers.push({
                    username: u,
                    avatar: usersDB[u]?.avatar,
                    role: usersDB[u]?.role,
                    status: isOnline ? (userStatus[u] || "online") : "offline"
                });
            }
            io.emit("all-users", allUsers);
        }
        delete activeSessions[socket.id];
        io.emit("online", Object.keys(activeSessions).length);
        
        for (let [name, users] of Object.entries(voiceRooms)) {
            if (users.has(socket.id)) {
                users.delete(socket.id);
                io.to("voice:" + name).emit("voice-users-update", Array.from(users).map(id => ({
                    username: activeSessions[id]?.username,
                    avatar: usersDB[activeSessions[id]?.username]?.avatar,
                    status: userStatus[activeSessions[id]?.username] || "online"
                })));
                io.to("voice:" + name).emit("voice-count", users.size);
                break;
            }
        }
    });
});

app.post("/upload-audio", uploadAudio.single("audio"), (req, res) => { res.json({ url: "/voices/" + req.file.filename }); });
app.post("/upload-media", uploadMedia.single("file"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Файл больше 15 МБ или неподдерживаемый формат" });
    let fileType = "image";
    if (req.file.mimetype.startsWith("video")) fileType = "video";
    if (req.file.mimetype.startsWith("audio")) fileType = "audio";
    res.json({ url: "/uploads/" + req.file.filename, fileType });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 SWILL сервер на ${PORT}`));
