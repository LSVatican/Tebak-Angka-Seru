import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, getDocs, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// ====== PASTE KONFIGURASI FIREBASE KAMU DI SINI ======
const firebaseConfig = {
  apiKey: "AIzaSyAFRcq7R25kUVRNX02NHch7HSE3UgaecqU",
  authDomain: "tebak-angka-478ff.firebaseapp.com",
  databaseURL: "https://tebak-angka-478ff-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tebak-angka-478ff",
  storageBucket: "tebak-angka-478ff.firebasestorage.app",
  messagingSenderId: "252023470469",
  appId: "1:252023470469:web:60b307f03b153a6b7b6cec",
  measurementId: "G-6WZ3MZQKEB"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// State System
let currentUser = null;
let userData = { username: "", avatar: "" };
let currentRoomCode = null;
let roomListener = null;
let isMultiplayer = false;
let isHost = false;

// Game State Global
let maxNumber = 50, secretNumber = 0, timeLeft = 120, timerInterval;
let localCorrect = 0, localWrong = 0;

const pages = {
    login: document.getElementById('login-page'),
    main: document.getElementById('main-page'),
    setup: document.getElementById('setup-page'),
    lobby: document.getElementById('lobby-page'),
    serverList: document.getElementById('server-list-page'),
    game: document.getElementById('game-page'),
    result: document.getElementById('result-page')
};

function switchPage(targetPage) {
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    targetPage.classList.remove('hidden');
}

// ================= AUTH MANAGEMENT =================
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        checkUserRegistration();
    } else {
        switchPage(pages.login);
    }
});

document.getElementById('google-login-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(err => alert("Gagal login: " + err.message));
});

async function checkUserRegistration() {
    const docSnap = await getDoc(doc(db, "players", currentUser.uid));
    if (docSnap.exists()) {
        userData = docSnap.data();
        document.getElementById('nav-username').innerText = userData.username;
        document.getElementById('nav-avatar').innerText = userData.avatar;
        switchPage(pages.main);
    } else {
        document.getElementById('register-modal').classList.remove('hidden');
    }
}

document.getElementById('save-reg-btn').addEventListener('click', async () => {
    const name = document.getElementById('reg-username').value.trim();
    const av = document.getElementById('reg-avatar').value.trim();
    if(!name || !av) return alert("Isi data terlebih dahulu!");
    userData = { username: name, avatar: av };
    await setDoc(doc(db, "players", currentUser.uid), userData);
    document.getElementById('register-modal').classList.add('hidden');
    checkUserRegistration();
});

document.getElementById('logout-btn').addEventListener('click', () => {
    if(confirm("Keluar dari akun?")) signOut(auth);
});


// ================= MODE NAVIGATION =================

// Pilih Mode Singleplayer
document.getElementById('menu-single-btn').addEventListener('click', () => {
    isMultiplayer = false;
    isHost = false;
    currentRoomCode = null;
    document.getElementById('setup-title').innerText = "Pengaturan Singleplayer";
    switchPage(pages.setup);
});

// Klik Buat Room Multiplayer (Diantar ke setup angka dulu sebelum buat room)
document.getElementById('menu-create-room-btn').addEventListener('click', () => {
    isMultiplayer = true;
    isHost = true;
    document.getElementById('setup-title').innerText = "Pengaturan Room Multiplayer";
    switchPage(pages.setup);
});


// ================= VALIDASI INPUT ANGKA =================
const maxNumberInput = document.getElementById('max-number');
const startBtn = document.getElementById('start-btn');
const setupWarning = document.getElementById('setup-warning');
const guessInput = document.getElementById('guess-input');
const gameWarning = document.getElementById('game-warning');

maxNumberInput.addEventListener('input', () => {
    let val = maxNumberInput.value;
    if (val === "") {
        setupWarning.innerText = "Input tidak boleh kosong!";
        startBtn.disabled = true;
        return;
    }
    let num = parseInt(val);
    if (num > 50) {
        setupWarning.innerText = "Maksimal angka adalah 50!";
        maxNumberInput.value = ""; 
        startBtn.disabled = true;
    } else if (num <= 0) {
        setupWarning.innerText = "Angka harus lebih dari 0!";
        startBtn.disabled = true;
    } else {
        setupWarning.innerText = "";
        startBtn.disabled = false;
    }
});

guessInput.addEventListener('input', () => {
    let val = guessInput.value;
    if (val === "") {
        gameWarning.innerText = "";
        return;
    }
    let num = parseInt(val);
    if (num > maxNumber) {
        gameWarning.innerText = `Melebihi batas maksimal (${maxNumber})!`;
        guessInput.value = ""; 
    } else {
        gameWarning.innerText = "";
    }
});


// ================= TOMBOL UTAMA START / ALUR IN-LOBBY =================

startBtn.addEventListener('click', async () => {
    maxNumber = parseInt(maxNumberInput.value);
    
    if (!isMultiplayer) {
        // Alur Langsung Main Jika Mode Singleplayer
        startSingleplayerGame();
    } else {
        // Alur Pembuatan Room Firebase Jika Mode Multiplayer
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        currentRoomCode = code;

        const roomData = {
            roomCode: code,
            hostId: currentUser.uid,
            hostName: userData.username,
            status: "waiting",
            maxNumber: maxNumber,
            secretNumber: Math.floor(Math.random() * maxNumber) + 1,
            players: {
                [currentUser.uid]: {
                    name: userData.username,
                    avatar: userData.avatar,
                    correct: 0,
                    wrong: 0,
                    isHost: true
                }
            }
        };

        await setDoc(doc(db, "rooms", code), roomData);
        listenToRoom(code);
        switchPage(pages.lobby);
    }
});


// ================= LOGIKA MULTIPLAYER REALTIME =================

// Sinkronisasi Room
function listenToRoom(code) {
    if (roomListener) roomListener();

    roomListener = onSnapshot(doc(db, "rooms", code), (docSnap) => {
        if (!docSnap.exists()) {
            alert("Room telah dibubarkan karena kosong atau kamu telah dikick.");
            exitRoomCleanup();
            return;
        }

        const roomData = docSnap.data();

        // Di-kick protection
        if (!roomData.players[currentUser.uid]) {
            alert("Kamu telah dikeluarkan dari room.");
            exitRoomCleanup();
            return;
        }

        // Jika Host lama keluar, tunjuk Host Baru secara otomatis dari daftar pemain tersisa
        if (!roomData.players[roomData.hostId]) {
            reassignHost(roomData);
            return;
        }

        document.getElementById('lobby-room-title').innerText = `Room milik ${roomData.hostName}`;
        document.getElementById('lobby-room-code').innerText = roomData.roomCode;
        
        const playersList = Object.keys(roomData.players);
        document.getElementById('lobby-room-slots').innerText = `${playersList.length}/5`;

        // Render List Pemain
        const playerListUI = document.getElementById('lobby-player-list');
        playerListUI.innerHTML = "";
        
        playersList.forEach(pId => {
            const p = roomData.players[pId];
            let kickBtn = '';
            if (isHost && pId !== currentUser.uid) {
                kickBtn = `<button class="btn-kick" data-id="${pId}">Kick</button>`;
            }
            playerListUI.innerHTML += `<li><span>${p.avatar} ${p.name} ${p.isHost ? '(Host)':''}</span> ${kickBtn}</li>`;
        });

        // Event handler kick
        if(isHost) {
            document.querySelectorAll('.btn-kick').forEach(btn => {
                btn.addEventListener('click', (e) => kickPlayer(e.target.getAttribute('data-id')));
            });

            // Munculkan instruksi start otomatis jika pemain multiplayer sudah mencukupi (Min 2)
            const waitMsg = document.getElementById('player-wait-msg');
            if(playersList.length >= 2 && roomData.status === "waiting") {
                waitMsg.innerText = "Pemain sudah lengkap! Sistem mengalihkan otomatis ke arena permainan...";
                waitMsg.classList.remove('hidden');
                setTimeout(() => triggerStartMultiplayerGame(), 2000);
            } else if (playersList.length < 2) {
                waitMsg.innerText = "Menunggu pemain lain bergabung (Minimal 2 pemain)...";
                waitMsg.classList.remove('hidden');
            }
        } else {
            document.getElementById('player-wait-msg').classList.remove('hidden');
        }

        // Transisi Masuk Arena Game
        if (roomData.status === "playing" && pages.game.classList.contains('hidden')) {
            maxNumber = roomData.maxNumber;
            secretNumber = roomData.secretNumber;
            setupGameArenaUI(true);
            startTimer(true);
        }

        // Live update score card multiplayer
        if (roomData.status === "playing") {
            renderInGameStatus(roomData.players);
        }

        // Transisi ke Papan Skor Akhir
        if (roomData.status === "finished") {
            renderFinalScoreboard(roomData.players);
            document.getElementById('single-result-box').classList.add('hidden');
            document.getElementById('multi-result-box').classList.remove('hidden');
            switchPage(pages.result);
        }
    });
}

// Pemindahan Hak Akses Host Otomatis jika host lama kabur
async function reassignHost(roomData) {
    const remainingPlayers = Object.keys(roomData.players);
    const roomRef = doc(db, "rooms", currentRoomCode);
    
    if (remainingPlayers.length > 0) {
        const newHostId = remainingPlayers[0];
        roomData.hostId = newHostId;
        roomData.hostName = roomData.players[newHostId].name;
        roomData.players[newHostId].isHost = true;
        
        if (newHostId === currentUser.uid) isHost = true;
        await updateDoc(roomRef, { hostId: newHostId, hostName: roomData.hostName, players: roomData.players });
    }
}

async function kickPlayer(playerId) {
    const roomRef = doc(db, "rooms", currentRoomCode);
    const roomSnap = await getDoc(roomRef);
    if(roomSnap.exists()) {
        const data = roomSnap.data();
        delete data.players[playerId];
        await updateDoc(roomRef, { players: data.players });
    }
}

async function triggerStartMultiplayerGame() {
    if(!isHost || !currentRoomCode) return;
    await updateDoc(doc(db, "rooms", currentRoomCode), { status: "playing" });
}

// LOGIKA KELUAR ROOM + SISTEM OTOMATIS HAPUS ROOM KOSONG
document.getElementById('leave-room-btn').addEventListener('click', () => {
    if(confirm("Keluar dari lobby room saat ini?")) leaveRoomAction();
});

async function leaveRoomAction() {
    if (!currentRoomCode) return;
    const roomRef = doc(db, "rooms", currentRoomCode);

    try {
        await runTransaction(db, async (transaction) => {
            const roomSnap = await transaction.get(roomRef);
            if (!roomSnap.exists()) return;

            const roomData = roomSnap.data();
            delete roomData.players[currentUser.uid];

            const remainingCount = Object.keys(roomData.players).length;

            if (remainingCount === 0) {
                // Skenario Otomatis Terhapus dari database jika ditinggalkan semua orang (0 Pemain)
                transaction.delete(roomRef);
            } else {
                // Masih ada pemain lain, cukup update map players saja
                transaction.update(roomRef, { players: roomData.players });
            }
        });
    } catch (e) { console.error("Gagal memproses keluar room:", e); }

    exitRoomCleanup();
}

function exitRoomCleanup() {
    if (roomListener) roomListener();
    roomListener = null;
    currentRoomCode = null;
    isHost = false;
    isMultiplayer = false;
    clearInterval(timerInterval);
    switchPage(pages.main);
}


// ================= LOGIKA GAMEPLAY ENGINE (SINGLE + MULTI) =================

function startSingleplayerGame() {
    setupGameArenaUI(false);
    secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    startTimer(false);
}

function setupGameArenaUI(multiMode) {
    localCorrect = 0;
    localWrong = 0;
    document.getElementById('display-max').innerText = maxNumber;
    document.getElementById('feedback').innerText = "";
    document.getElementById('guess-input').value = "";

    if(multiMode) {
        document.getElementById('ingame-players-status').classList.remove('hidden');
        document.getElementById('ingame-hr').classList.remove('hidden');
    } else {
        document.getElementById('ingame-players-status').classList.add('hidden');
        document.getElementById('ingame-hr').classList.add('hidden');
    }
    switchPage(pages.game);
}

function startTimer(multiMode) {
    timeLeft = 120;
    timerInterval = setInterval(async () => {
        timeLeft--;
        let mins = Math.floor(timeLeft / 60);
        let secs = timeLeft % 60;
        document.getElementById('timer').innerText = `${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (!multiMode) {
                // Tampilan Selesai Singleplayer
                document.getElementById('stat-correct').innerText = localCorrect;
                document.getElementById('stat-wrong').innerText = localWrong;
                document.getElementById('single-result-box').classList.remove('hidden');
                document.getElementById('multi-result-box').classList.add('hidden');
                switchPage(pages.result);
            } else if (multiMode && isHost) {
                // Host mengakhiri sesi multiplayer secara berkala di database
                await updateDoc(doc(db, "rooms", currentRoomCode), { status: "finished" });
            }
        }
    }, 1000);
}

// Aksi Tebak Angka
document.getElementById('guess-btn').addEventListener('click', async () => {
    const inputEl = document.getElementById('guess-input');
    const userGuess = parseInt(inputEl.value);
    const feedback = document.getElementById('feedback');

    if (isNaN(userGuess) || inputEl.value === "") return;

    if (userGuess === secretNumber) {
        localCorrect++;
        feedback.innerText = "🎉 Benar! Angka diacak kembali!";
        feedback.style.color = "#00ffcc";
        
        if (!isMultiplayer) {
            secretNumber = Math.floor(Math.random() * maxNumber) + 1;
        } else {
            // Sinkronisasi multiplayer jika tebakan benar
            const newSecret = Math.floor(Math.random() * maxNumber) + 1;
            const updatePayload = { [`players.${currentUser.uid}.correct`]: localCorrect };
            if(isHost) updatePayload.secretNumber = newSecret;
            await updateDoc(doc(db, "rooms", currentRoomCode), updatePayload);
        }
    } else {
        localWrong++;
        feedback.innerText = userGuess < secretNumber ? "❌ Terlalu KECIL!" : "❌ Terlalu BESAR!";
        feedback.style.color = "#ff3366";

        if(isMultiplayer) {
            await updateDoc(doc(db, "rooms", currentRoomCode), { [`players.${currentUser.uid}.wrong`]: localWrong });
        }
    }
    inputEl.value = "";
    inputEl.focus();
});

// Listener pendeteksi angka acak baru dari host saat multiplayer
onSnapshot(doc(db, "rooms", currentRoomCode || "dummy"), (snap) => {
    if(isMultiplayer && snap.exists()){
        const data = snap.data();
        if(data.status === "playing" && data.secretNumber !== secretNumber) {
            secretNumber = data.secretNumber;
            document.getElementById('feedback').innerText = "🔄 Angka diacak ulang oleh server!";
            document.getElementById('feedback').style.color = "#00f0ff";
        }
    }
});


// ================= SERVER LIST & SCOREBOARD MANAGEMENT =================

document.getElementById('menu-server-list-btn').addEventListener('click', async () => {
    isMultiplayer = true;
    switchPage(pages.serverList);
    const container = document.getElementById('server-container');
    container.innerHTML = "<p>Mencari room...</p>";

    const querySnapshot = await getDocs(collection(db, "rooms"));
    container.innerHTML = "";

    querySnapshot.forEach((doc) => {
        const room = doc.data();
        if (room.status === "waiting") {
            const count = Object.keys(room.players).length;
            container.innerHTML += `
                <div class="server-item">
                    <div><strong>Room milik ${room.hostName}</strong><br><small style="color:#00ffcc">Kode: ${room.roomCode}</small></div>
                    <div><span>${count}/5 Pemain</span><button class="btn-join-server" data-code="${room.roomCode}" style="width:auto; padding:6px 12px; margin-left:10px;" ${count >= 5 ? 'disabled':''}>Join</button></div>
                </div>`;
        }
    });

    document.querySelectorAll('.btn-join-server').forEach(btn => {
        btn.addEventListener('click', (e) => joinRoomAction(e.target.getAttribute('data-code')));
    });
});

async function joinRoomAction(code) {
    const roomRef = doc(db, "rooms", code);
    try {
        await runTransaction(db, async (transaction) => {
            const roomSnap = await transaction.get(roomRef);
            if (!roomSnap.exists()) throw "Room tidak ditemukan!";
            const roomData = roomSnap.data();
            if (roomData.status !== "waiting") throw "Game sudah berjalan!";
            if (Object.keys(roomData.players).length >= 5) throw "Room Penuh!";

            roomData.players[currentUser.uid] = { name: userData.username, avatar: userData.avatar, correct: 0, wrong: 0, isHost: false };
            transaction.update(roomRef, { players: roomData.players });
        });
        currentRoomCode = code; isMultiplayer = true; isHost = false;
        document.getElementById('join-code-modal').classList.add('hidden');
        listenToRoom(code); switchPage(pages.lobby);
    } catch (e) { alert(e); }
}

document.getElementById('menu-join-code-btn').addEventListener('click', () => document.getElementById('join-code-modal').classList.remove('hidden'));
document.getElementById('close-join-modal').addEventListener('click', () => document.getElementById('join-code-modal').classList.add('hidden'));
document.getElementById('submit-join-code-btn').addEventListener('click', () => {
    const code = document.getElementById('join-room-code-input').value.trim();
    if(code) joinRoomAction(code);
});

function renderInGameStatus(playersData) {
    const container = document.getElementById('ingame-players-status');
    container.innerHTML = "";
    Object.keys(playersData).forEach(pId => {
        const p = playersData[pId];
        container.innerHTML += `
            <div class="player-status-card" style="${pId === currentUser.uid ? 'border-color:#00ffcc;':''}">
                <span class="avatar">${p.avatar}</span>
                <small>${p.name}</small>
                <div class="score"><span class="correct">${p.correct}</span> / <span class="wrong">${p.wrong}</span></div>
            </div>`;
    });
}

function renderFinalScoreboard(playersData) {
    const container = document.getElementById('final-scoreboard');
    container.innerHTML = "";
    const sorted = Object.values(playersData).sort((a,b) => b.correct - a.correct);
    sorted.forEach((p, idx) => {
        container.innerHTML += `
            <div class="score-row">
                <span><strong>#${idx+1}</strong> ${p.avatar} ${p.name}</span>
                <span>Benar: <b class="correct">${p.correct}</b> | Salah: <b class="wrong">${p.wrong}</b></span>
            </div>`;
    });
}

document.getElementById('back-to-main-1').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-from-server-btn').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-to-menu-after-game-btn').addEventListener('click', () => exitRoomCleanup());
