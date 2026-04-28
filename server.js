// ========== ИСПРАВЛЕННАЯ ФУНКЦИЯ openDM ==========
function openDM(username) {
    // Ищем друга в списке друзей
    let friend = friendsList.find(f => f.username === username);
    
    if (!friend) {
        // Если не нашли, пробуем загрузить свежий список
        fetch("/friends/" + currentUser).then(res => res.json()).then(data => {
            if(data.friends) friendsList = data.friends;
            friend = friendsList.find(f => f.username === username);
            if(friend) {
                actualOpenDM(username, friend);
            } else {
                alert("Этот пользователь не в друзьях!");
            }
        }).catch(() => alert("Ошибка загрузки списка друзей"));
        return;
    }
    
    actualOpenDM(username, friend);
}

function actualOpenDM(username, friend) {
    // Сохраняем текущего собеседника
    currentDMUser = username;
    currentRoom = "dm_" + username;
    
    // Отображаем имя и статус в шапке
    const displayName = friend.displayName || friend.username;
    const statusEmoji = friend.status === "online" ? "🟢" : "⚫";
    document.getElementById("currentRoomName").innerHTML = `${statusEmoji} ${displayName} <span style="font-size:11px; opacity:0.6;">@${username}</span>`;
    
    // Очищаем сообщения
    document.getElementById("messages").innerHTML = "";
    
    // Переподключаемся к комнате ЛС
    socket.emit("auth", { username: currentUser, room: currentRoom });
    
    // Для мобилки
    if(window.innerWidth <= 700) toggleSidebar();
}

// ========== ИСПРАВЛЕННАЯ ФУНКЦИЯ updateFriendsUI ==========
function updateFriendsUI() {
    document.getElementById("friendsCount").innerText = friendsList.length;
    const dmsContainer = document.getElementById("dmsList");
    if(!dmsContainer) return;
    
    let html = '';
    
    // Заявки в друзья
    if(friendRequests.length > 0) {
        html += `<div style="padding:8px 12px; font-size:11px; opacity:0.7; margin-top:8px;">📨 ЗАЯВКИ (${friendRequests.length})</div>`;
        friendRequests.forEach(req => {
            html += `<div style="padding:12px; background:#1a1d26; border-radius:12px; margin:8px 0;">
                <strong>${escapeHtml(req.from)}</strong> хочет добавить вас в друзья
                <div style="display:flex; gap:8px; margin-top:8px;">
                    <button onclick="acceptFriend('${req.from}')" style="background:#23a55a; border:none; padding:6px 12px; border-radius:20px; color:white; cursor:pointer;">✔ Принять</button>
                    <button onclick="declineFriend('${req.from}')" style="background:#e03a3a; border:none; padding:6px 12px; border-radius:20px; color:white; cursor:pointer;">✖ Отклонить</button>
                </div>
            </div>`;
        });
    }
    
    // Список друзей
    if(friendsList.length > 0) {
        html += `<div style="padding:8px 12px; font-size:11px; opacity:0.7; margin-top:16px;">👥 ДРУЗЬЯ (${friendsList.length})</div>`;
        friendsList.forEach(friend => {
            const statusClass = friend.status === "online" ? "online" : "offline";
            const statusEmoji = friend.status === "online" ? "🟢" : "⚫";
            const displayName = friend.displayName || friend.username;
            html += `
                <div class="dm-item" data-username="${friend.username}" onclick="openDM('${friend.username}')" style="cursor:pointer; margin:4px 0;">
                    <div style="display:flex; gap:12px; align-items:center; padding:8px;">
                        <div style="position: relative;">
                            <img style="width:40px; height:40px; border-radius:50%; object-fit:cover;" src="${friend.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(friend.username)}&background=5865f2&color=fff&size=40`}">
                            <div style="position:absolute; bottom:0; right:0; width:10px; height:10px; border-radius:50%; background: ${friend.status === 'online' ? '#23a55a' : '#80848e'}; border:2px solid #111318;"></div>
                        </div>
                        <div style="flex:1;">
                            <div style="font-weight:600;">${escapeHtml(displayName)}</div>
                            <div style="font-size:11px; opacity:0.6;">@${escapeHtml(friend.username)}</div>
                            ${friend.bio ? `<div style="font-size:10px; opacity:0.5; font-style:italic; margin-top:2px;">${escapeHtml(friend.bio.substring(0, 40))}</div>` : ""}
                        </div>
                        <div>${statusEmoji}</div>
                    </div>
                </div>
            `;
        });
    }
    
    if(friendsList.length === 0 && friendRequests.length === 0) {
        html = `<div style="padding:16px; text-align:center; opacity:0.5;">У вас пока нет друзей<br>Нажмите ➕ чтобы добавить</div>`;
    }
    
    dmsContainer.innerHTML = html;
}

// ========== ИСПРАВЛЕННАЯ addMessageToUI (добавить проверку) ==========
function addMessageToUI(msg) {
    const container = document.getElementById("messages");
    if(!container) return;
    if(document.querySelector(`.message-group[data-msg-id="${msg.id}"]`)) return;
    
    const div = document.createElement("div");
    div.className = "message-group";
    if(msg.pings && (msg.pings.includes(currentUser) || msg.pings.includes("everyone"))) {
        div.classList.add("ping-highlight");
    }
    div.setAttribute("data-msg-id", msg.id);
    
    const avatarUrl = msg.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(msg.author)}&background=5865f2&color=fff&size=44`;
    let contentHtml = '';
    
    if(msg.type === 'text') {
        let processedText = escapeHtml(msg.text);
        let words = processedText.split(" ");
        let newWords = words.map(w => {
            if(w.startsWith("@") && w.length > 1) {
                let target = w.substring(1);
                if(target === "everyone" || target === "here" || usersDB[target]) {
                    return `<span class="ping" onclick="event.stopPropagation(); openDM('${target}')">${w}</span>`;
                }
            }
            return w;
        });
        processedText = newWords.join(" ");
        contentHtml = `<div class="message-text">${processedText}</div>`;
    } else if(msg.type === 'voice') {
        contentHtml = `<audio controls src="${msg.audio}"></audio>`;
    } else if(msg.type === 'media') {
        if(msg.mediaType === 'video') contentHtml = `<video controls style="max-width:300px; border-radius:16px;" src="${msg.mediaUrl}"></video>`;
        else if(msg.mediaType === 'audio') contentHtml = `<audio controls src="${msg.mediaUrl}"></audio>`;
        else contentHtml = `<img style="max-width:300px; max-height:200px; border-radius:16px; cursor:pointer;" src="${msg.mediaUrl}" onclick="window.open('${msg.mediaUrl}')">`;
    }
    
    let reactionsHtml = '';
    if(msg.reactions && Object.keys(msg.reactions).length > 0) {
        for(let [emoji, users] of Object.entries(msg.reactions)) {
            reactionsHtml += `<div class="reaction" onclick="event.stopPropagation(); addReaction('${msg.id}','${emoji}')">${emoji} <span>${users.length}</span></div>`;
        }
    }
    reactionsHtml += `<div class="reaction" onclick="event.stopPropagation(); showReactionPicker('${msg.id}')">➕</div>`;
    
    let displayName = msg.displayName || msg.author;
    
    div.innerHTML = `
        <img class="message-avatar" src="${avatarUrl}">
        <div class="message-content">
            <div class="message-header">
                <div class="message-displayname">${escapeHtml(displayName)}</div>
                <div class="message-username">@${escapeHtml(msg.author)}</div>
                <div class="message-time">${new Date(msg.time).toLocaleTimeString()}</div>
            </div>
            ${contentHtml}
            <div class="reactions" data-msg-id="${msg.id}">${reactionsHtml}</div>
        </div>
        <div class="message-menu"><button class="menu-btn" onclick="deleteMessage('${msg.id}','${msg.author}')">🗑️</button></div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ========== ДОБАВЬ ГЛОБАЛЬНУЮ ПЕРЕМЕННУЮ ==========
let currentDMUser = null;  // Добавить в начало скрипта, где остальные let

// ========== ОБНОВЛЕНИЕ СТАТУСА ДРУЗЕЙ В РЕАЛЬНОМ ВРЕМЕНИ ==========
// Добавить в initSocket():
socket.on("user-status-update", ({ username, status }) => {
    if(username === currentUser) updateStatusDot(status);
    // Обновляем статус в списке друзей
    const friend = friendsList.find(f => f.username === username);
    if(friend) {
        friend.status = status;
        updateFriendsUI();
    }
    // Обновляем шапку если это текущий диалог
    if(currentDMUser === username) {
        const statusEmoji = status === "online" ? "🟢" : "⚫";
        const displayName = friend?.displayName || username;
        document.getElementById("currentRoomName").innerHTML = `${statusEmoji} ${displayName} <span style="font-size:11px; opacity:0.6;">@${username}</span>`;
    }
    fetch("/users-list").then(r=>r.json()).then(users => updateOnlineUsers(users));
});
