// ЗАМЕНИ ВЕСЬ БЛОК initSocket() и socket.on("chat") на ЭТО:

function initSocket() {
    socket = io();
    
    socket.on("connect", () => {
        console.log("Socket connected, авторизация...");
        socket.emit("auth", { username: currentUser, room: currentRoom });
    });
    
    socket.on("auth-error", (msg) => { alert(msg); if(msg.includes("БАН")) location.reload(); });
    socket.on("kick", (msg) => { alert(msg); location.reload(); });
    socket.on("ban", (msg) => { alert(msg); localStorage.removeItem("nexus_session"); location.reload(); });
    socket.on("mute", (msg) => alert(msg));
    
    socket.on("history", (msgs) => {
        const container = document.getElementById("messages");
        if(container) { 
            container.innerHTML = ""; 
            if(msgs && msgs.length) msgs.forEach(m => addMessageToUI(m));
        }
    });
    
    // ========== ГЛАВНЫЙ ФИКС - ОБРАБОТКА СООБЩЕНИЙ ==========
    socket.on("chat", (msg) => {
        console.log("Получено сообщение:", msg);
        addMessageToUI(msg);
        
        // Звук при пинге
        if(msg.pings && (msg.pings.includes(currentUser) || msg.pings.includes("everyone") || msg.pings.includes(currentRole))) {
            playPingSound();
            const msgDiv = document.querySelector(`.message-group[data-msg-id="${msg.id}"]`);
            if(msgDiv) msgDiv.classList.add("ping-highlight");
        }
        
        if(msg.author !== currentUser && msg.author !== "🛡️ СИСТЕМА") {
            playMessageSound();
        }
        
        // Уведомление если не в текущей комнате
        if(msg.author !== currentUser && msg.room !== currentRoom && !currentRoom.startsWith("dm_")) {
            const roomEl = document.querySelector(`.room[data-room="${msg.room}"]`);
            if(roomEl) roomEl.classList.add("notification");
        }
    });
    
    socket.on("message-deleted", ({ msgId }) => {
        document.querySelector(`.message-group[data-msg-id="${msgId}"]`)?.remove();
    });
    
    socket.on("reaction-updated", ({ msgId, reactions }) => {
        updateReactionsUI(msgId, reactions);
    });
    
    socket.on("online", (n) => {
        document.getElementById("online").innerText = n;
    });
    
    socket.on("clear-chat", () => {
        document.getElementById("messages").innerHTML = "";
    });
    
    socket.on("new-room", (roomName) => {
        const roomsList = document.getElementById("roomsList");
        const newRoom = document.createElement("div");
        newRoom.className = "room";
        newRoom.setAttribute("data-room", roomName);
        newRoom.setAttribute("onclick", `joinRoom('${roomName}')`);
        newRoom.innerHTML = `# ${roomName}`;
        const voiceChannel = roomsList.querySelector(".voice-channel");
        roomsList.insertBefore(newRoom, voiceChannel);
    });
    
    socket.on("delete-room", (roomName) => {
        document.querySelector(`.room[data-room="${roomName}"]`)?.remove();
        if(currentRoom === roomName) joinRoom("general");
    });
    
    socket.on("all-users", (users) => {
        usersDB = {};
        users.forEach(u => { usersDB[u.username] = u; });
        updateOnlineUsers(users);
    });
    
    socket.on("user-status-update", ({ username, status }) => {
        if(username === currentUser) updateStatusDot(status);
        updateOnlineUsers(Object.values(usersDB));
    });
    
    socket.on("friends-list", (data) => { 
        friendsList = data.friends || []; 
        friendRequests = data.requests || []; 
        updateFriendsUI(); 
    });
    
    socket.on("friend-request", (req) => { 
        friendRequests.push(req); 
        updateFriendsUI(); 
        playMessageSound(); 
    });
    
    socket.on("friend-accepted", ({ fromUser }) => { 
        loadFriends(); 
        alert(`${fromUser} принял заявку!`); 
    });
    
    socket.on("ping-notification", ({ from, room, message }) => {
        playPingSound();
        if(Notification.permission === "granted") {
            new Notification(`@${from} упомянул вас в #${room}`, { body: message.substring(0, 100) });
        }
    });
    
    // ========== ГОЛОСОВОЙ ЧАТ ==========
    socket.on("voice-user", (userId) => { 
        if(voiceStream) createVoicePeer(userId, true); 
    });
    
    socket.on("user-joined", (userId) => { 
        if(voiceStream) createVoicePeer(userId, false); 
        playJoinSound(); 
    });
    
    socket.on("voice-users-update", (users) => {
        const container = document.getElementById("voiceUsersList");
        if(container) {
            container.innerHTML = users.map(user => `
                <div class="voice-user">
                    <div style="position: relative;">
                        <img class="voice-user-avatar" src="${user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.username)}&background=5865f2&color=fff&size=28`}">
                        <div class="status-dot ${user.status === 'online' ? 'status-online' : user.status === 'idle' ? 'status-idle' : user.status === 'dnd' ? 'status-dnd' : 'status-offline'}" style="width: 7px; height: 7px;"></div>
                    </div>
                    <span class="voice-user-name">${escapeHtml(user.displayName || user.username)}</span>
                </div>
            `).join("");
        }
        document.getElementById("voiceOnline").innerText = users.length;
    });
    
    socket.on("voice-count", (count) => { 
        document.getElementById("voiceOnline").innerText = count; 
    });
    
    socket.on("signal", ({ from, data }) => {
        if(!voicePeers[from]) createVoicePeer(from, false);
        voicePeers[from]?.signal(data);
    });
    
    loadFriends();
    requestNotificationPermission();
}

// ========== ФУНКЦИЯ ОТПРАВКИ СООБЩЕНИЙ (ФИКС) ==========
function sendText() {
    let input = document.getElementById("input");
    let text = input.value.trim();
    if(!text) return;
    
    // Проверяем пинги
    let words = text.split(" ");
    let pings = [];
    
    for(let w of words) {
        if(w.startsWith("@")) {
            let target = w.substring(1);
            if(target === "everyone" || target === "here") {
                if(currentRole !== "владелец" && currentRole !== "админ") {
                    alert("@everyone и @here только для владельца и админа!");
                    return;
                }
                pings.push(target);
            } else if(usersDB[target]) {
                pings.push(target);
            } else if(target === "новичок" || target === "олд" || target === "владелец") {
                pings.push(target);
            }
        }
    }
    
    console.log("Отправка сообщения:", { text, pings, room: currentRoom });
    
    // Отправляем как объект, а не строку!
    socket.emit("chat", { text: text, pings: pings });
    input.value = "";
    document.getElementById("pingSuggestions").style.display = "none";
}

// ========== ДОБАВЬ ГОЛОСОВЫЕ КАНАЛЫ В HTML ==========
// Вставь ЭТО в .rooms-list перед закрывающим </div>
/*
<div class="voice-channel">
    <div class="voice-channel-title">🔊 ГОЛОСОВЫЕ КАНАЛЫ</div>
    <div class="room voice-room" onclick="joinVoiceChannel('voice-chat')">🎤 Голосовой чат</div>
    <div class="room voice-room" onclick="joinVoiceChannel('gaming-voice')">🎮 Геймерская беседа</div>
    <div class="room voice-room" onclick="joinVoiceChannel('music-voice')">🎵 Музыкальный стрим</div>
    <div class="room voice-room" onclick="joinVoiceChannel('afk')">😴 AFK комната</div>
    <div id="voiceUsersList" class="voice-users-list" style="margin-top: 8px;"></div>
</div>
*/
