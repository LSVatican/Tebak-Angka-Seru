import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, getDocs, query, orderBy, limit, runTransaction } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// State System (Mendukung Pemulihan Refresh)
let currentUser = null;
let userData = { username: "", avatar: "", totalCorrect: 0, totalWrong: 0 };
let currentRoomCode = localStorage.getItem("currentRoomCode") || null;
let isMultiplayer = localStorage.getItem("isMultiplayer") === "true";
let isHost = localStorage.getItem("isHost") === "true";
let roomListener = null;

// Game Engine State
let maxNumber = parseInt(localStorage.getItem("maxNumber")) || 50;
let secretNumber = parseInt(localStorage.getItem("secretNumber")) || 0;
let timeLeft = parseInt(localStorage.getItem("timeLeft")) || 120;
let timerInterval;
let localCorrect = parseInt(localStorage.getItem("localCorrect")) || 0;
let localWrong = parseInt(localStorage.getItem("localWrong")) || 0;

const pages = {
    login: document.getElementById('login-page'),
    main: document.getElementById('main-page'),
    setup: document.getElementById('setup-page'),
    lobby: document.getElementById('lobby-page'),
    serverList: document.getElementById('server-list-page'),
    game: document.getElementById('game-page'),
    result: document.getElementById('result-page'),
    stats: document.getElementById('stats-page'),
    leaderboard: document.getElementById('leaderboard-page'),
};

function switchPage(targetPage) {
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    targetPage.classList.remove('hidden');
}

// Save Game State Ke LocalStorage agar tidak hilang saat Refresh
function saveStateToLocalStorage() {
    localStorage.setItem("currentRoomCode", currentRoomCode || "");
    localStorage.setItem("isMultiplayer", isMultiplayer);
    localStorage.setItem("isHost", isHost);
    localStorage.setItem("maxNumber", maxNumber);
    localStorage.setItem("secretNumber", secretNumber);
    localStorage.setItem("timeLeft", timeLeft);
    localStorage.setItem("localCorrect", localCorrect);
    localStorage.setItem("localWrong", localWrong);
}

// Clear State LocalStorage saat keluar game/selesai
function clearGameStateStorage() {
    localStorage.removeItem("currentRoomCode");
    localStorage.removeItem("isMultiplayer");
    localStorage.removeItem("isHost");
    localStorage.removeItem("maxNumber");
    localStorage.removeItem("secretNumber");
    localStorage.removeItem("timeLeft");
    localStorage.removeItem("localCorrect");
    localStorage.removeItem("localWrong");
    currentRoomCode = null; isMultiplayer = false; isHost = false;
    localCorrect = 0; localWrong = 0; timeLeft = 120;
}

// ================= SYNC AUTH & RESTORE AFTER REFRESH =================
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        loadUserData(user);
    } else {
        switchPage(pages.login);
    }
});

document.getElementById('google-login-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(err => alert("Gagal login: " + err.message));
});

async function loadUserData(user) {
    const docSnap = await getDoc(doc(db, "players", user.uid));
    if (docSnap.exists()) {
        userData = docSnap.data();
        updateUserUI();
        
        // CEK PEMULIHAN REFRESH BROWSER
        const savedPageState = localStorage.getItem("currentRoomCode");
        const wasInGame = parseInt(localStorage.getItem("timeLeft")) > 0 && parseInt(localStorage.getItem("timeLeft")) < 120;

        if (isMultiplayer && savedPageState) {
            // Jika sebelumnya di room lobby atau game multiplayer
            listenToRoom(currentRoomCode);
            if (wasInGame) {
                setupGameArenaUI(true);
                resumeTimer(true);
            } else {
                switchPage(pages.lobby);
            }
        } else if (!isMultiplayer && wasInGame) {
            // Jika sebelumnya sedang bermain singleplayer
            setupGameArenaUI(false);
            resumeTimer(false);
        } else {
            switchPage(pages.main);
        }
    } else {
        document.getElementById('register-modal').classList.remove('hidden');
    }
}

function updateUserUI() {
    document.getElementById('nav-username').innerText = userData.username;
    document.getElementById('nav-avatar').innerText = userData.avatar;
    document.getElementById('profile-name-view').innerText = userData.username;
    document.getElementById('profile-avatar-view').innerText = userData.avatar;
    document.getElementById('edit-username').value = userData.username;
    document.getElementById('edit-avatar').value = userData.avatar;
}

// Registrasi User Baru
document.getElementById('save-reg-btn').addEventListener('click', async () => {
    const name = document.getElementById('reg-username').value.trim();
    const av = document.getElementById('reg-avatar').value.trim();
    if(!name || !av) return alert("Semua kolom harus diisi!");

    userData = { username: name, avatar: av, totalCorrect: 0, totalWrong: 0 };
    await setDoc(doc(db, "players", currentUser.uid), userData);
    document.getElementById('register-modal').classList.add('hidden');
    updateUserUI();
    switchPage(pages.main);
});

// Pop Up Profil & Aksi Edit
document.getElementById('open-profile-btn').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.remove('hidden');
});
document.getElementById('close-profile-btn').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.add('hidden');
});

document.getElementById('save-edit-btn').addEventListener('click', async () => {
    const newName = document.getElementById('edit-username').value.trim();
    const newAv = document.getElementById('edit-avatar').value.trim();
    if (!newName || !newAv) return alert("Input tidak boleh kosong!");

    userData.username = newName;
    userData.avatar = newAv;
    await updateDoc(doc(db, "players", currentUser.uid), { username: newName, avatar: newAv });
    updateUserUI();
    alert("Profil diperbarui!");
    document.getElementById('profile-modal').classList.add('hidden');
});

// Hapus Akun Total
document.getElementById('delete-data-btn').addEventListener('click', async () => {
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const validationInput = prompt(`PERINGATAN! Tindakan ini akan menghapus seluruh data kamu.\nKetik kode berikut untuk konfirmasi: ${randomCode}`);
    
    if (validationInput === String(randomCode)) {
        try {
            await deleteDoc(doc(db, "players", currentUser.uid));
            await deleteUser(auth.currentUser);
            alert("Data berhasil dihapus seluruhnya.");
            document.getElementById('profile-modal').classList.add('hidden');
            switchPage(pages.login);
        } catch (error) {
            alert("Gagal menghapus otomatis. Silakan lakukan relogin terlebih dahulu.");
        }
    } else {
        alert("Kode salah! Penghapusan data dibatalkan.");
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm("Apakah kamu yakin ingin keluar?")) signOut(auth);
});


// ================= MODE BERMAIN SELECTION =================
document.getElementById('menu-single-btn').addEventListener('click', () => {
    isMultiplayer = false; isHost = false; currentRoomCode = null;
    saveStateToLocalStorage();
    document.getElementById('setup-title').innerText = "Pengaturan Singleplayer";
    document.getElementById('start-btn').innerText = "Mulai Permainan";
    switchPage(pages.setup);
});

document.getElementById('menu-create-room-btn').addEventListener('click', () => {
    isMultiplayer = true; isHost = true;
    saveStateToLocalStorage();
    document.getElementById('setup-title').innerText = "Pengaturan Room Multiplayer";
    document.getElementById('start-btn').innerText = "Buat & Masuk Lobby";
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
    if (val === "") { setupWarning.innerText = "Input tidak kosong!"; startBtn.disabled = true; return; }
    let num = parseInt(val);
    if (num > 50) { setupWarning.innerText = "Maksimal angka adalah 50!"; startBtn.disabled = true; }
    else if (num <= 0) { setupWarning.innerText = "Harus lebih dari 0!"; startBtn.disabled = true; }
    else { setupWarning.innerText = ""; startBtn.disabled = false; }
});

guessInput.addEventListener('input', () => {
    let val = guessInput.value; if (val === "") return;
    if (parseInt(val) > maxNumber) { gameWarning.innerText = `Maksimal (${maxNumber})!`; guessInput.value = ""; }
    else { gameWarning.innerText = ""; }
});


// ================= GAMEPLAY ENGINE START =================
startBtn.addEventListener('click', async () => {
    maxNumber = parseInt(maxNumberInput.value);
    
    if (!isMultiplayer) {
        startSingleplayerGame();
    } else {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        currentRoomCode = code;
        saveStateToLocalStorage();

        const roomData = {
            roomCode: code, hostId: currentUser.uid, hostName: userData.username, status: "waiting", maxNumber: maxNumber,
            secretNumber: Math.floor(Math.random() * maxNumber) + 1,
            players: { [currentUser.uid]: { name: userData.username, avatar: userData.avatar, correct: 0, wrong: 0, isHost: true } }
        };

        await setDoc(doc(db, "rooms", code), roomData);
        listenToRoom(code); switchPage(pages.lobby);
    }
});

function startSingleplayerGame() {
    timeLeft = 120;
    secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    setupGameArenaUI(false);
    resumeTimer(false);
}

function setupGameArenaUI(multiMode) {
    document.getElementById('display-max').innerText = maxNumber;
    document.getElementById('feedback').innerText = ""; guessInput.value = "";

    if(multiMode) {
        document.getElementById('ingame-players-status').classList.remove('hidden');
        document.getElementById('ingame-hr').classList.remove('hidden');
    } else {
        document.getElementById('ingame-players-status').classList.add('hidden');
        document.getElementById('ingame-hr').classList.add('hidden');
    }
    switchPage(pages.game);
}

// Timer yang aman dan melanjutkan sisa detik saat refresh browser
function resumeTimer(multiMode) {
    clearInterval(timerInterval);
    timerInterval = setInterval(async () => {
        timeLeft--;
        saveStateToLocalStorage();
        
        let mins = Math.floor(timeLeft / 60), secs = timeLeft % 60;
        document.getElementById('timer').innerText = `${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (!multiMode) {
                userData.totalCorrect += localCorrect;
                userData.totalWrong += localWrong;
                await updateDoc(doc(db, "players", currentUser.uid), { totalCorrect: userData.totalCorrect, totalWrong: userData.totalWrong });

                document.getElementById('stat-correct').innerText = localCorrect;
                document.getElementById('stat-wrong').innerText = localWrong;
                document.getElementById('single-result-box').classList.remove('hidden');
                document.getElementById('multi-result-box').classList.add('hidden');
                clearGameStateStorage();
                switchPage(pages.result);
            } else if (multiMode && isHost) {
                await updateDoc(doc(db, "rooms", currentRoomCode), { status: "finished" });
            }
        }
    }, 1000);
}


// ================= MULTIPLAYER LOBBY SYSTEM & REALTIME SYNC =================
function listenToRoom(code) {
    if (roomListener) roomListener();

    roomListener = onSnapshot(doc(db, "rooms", code), async (docSnap) => {
        if (!docSnap.exists()) { 
            // Jika room sudah dihapus/bubar saat ditinggalkan
            if(!pages.main.classList.contains('hidden')) return;
            alert("Room telah dibubarkan."); 
            exitRoomCleanup(); 
            return; 
        }
        const roomData = docSnap.data();

        if (!roomData.players[currentUser.uid]) { alert("Kamu telah dikick."); exitRoomCleanup(); return; }

        document.getElementById('lobby-room-title').innerText = `Room milik ${roomData.hostName}`;
        document.getElementById('lobby-room-code').innerText = roomData.roomCode;
        
        const playersList = Object.keys(roomData.players);
        document.getElementById('lobby-room-slots').innerText = `${playersList.length}/5`;

        // Render List Lobby Pemain
        const playerListUI = document.getElementById('lobby-player-list'); playerListUI.innerHTML = "";
        playersList.forEach(pId => {
            const p = roomData.players[pId];
            let kickBtn = (isHost && pId !== currentUser.uid) ? `<button class="btn-kick" data-id="${pId}">Kick</button>` : '';
            playerListUI.innerHTML += `<li><span>${p.avatar} ${p.name}</span> ${kickBtn}</li>`;
        });

        const waitMsg = document.getElementById('player-wait-msg');
        
        if(isHost) {
            // Pasang event listener untuk tombol kick milik host
            document.querySelectorAll('.btn-kick').forEach(btn => {
                btn.addEventListener('click', (e) => kickPlayer(e.target.getAttribute('data-id')));
            });

            // TOMBOL MULAI MANUAL BAGI HOST JIKA PEMAIN MINIMAL 2
            if(playersList.length >= 2 && roomData.status === "waiting") {
                waitMsg.innerHTML = `<button id="host-trigger-start-btn" class="btn-primary" style="background:#00ffcc; color:#000;">Mulai Permainan Multiplayer Sekarang</button>`;
                waitMsg.classList.remove('hidden');
                
                // SISTEM KONFIRMASI SEBELUM MULAI MULTIPLAYER
                document.getElementById('host-trigger-start-btn').onclick = async () => {
                    if(confirm("Apakah Anda yakin ingin memulai permainan multiplayer sekarang?")) {
                        await updateDoc(doc(db, "rooms", currentRoomCode), { status: "playing" });
                    }
                };
            } else if (playersList.length < 2) {
                waitMsg.innerText = "Menunggu pemain lain bergabung (Minimal 2 pemain agar Host dapat memulai)...";
                waitMsg.classList.remove('hidden');
            }
        } else {
            if(roomData.status === "waiting") {
                waitMsg.innerText = "Menunggu Host memulai permainan...";
                waitMsg.classList.remove('hidden');
            }
        }

        // Transisi masuk arena game
        if (roomData.status === "playing" && pages.game.classList.contains('hidden')) {
            maxNumber = roomData.maxNumber; secretNumber = roomData.secretNumber;
            saveStateToLocalStorage();
            setupGameArenaUI(true); resumeTimer(true);
        }

        if (roomData.status === "playing") renderInGameStatus(roomData.players);

        if (roomData.status === "finished") {
            const myFinalScore = roomData.players[currentUser.uid];
            userData.totalCorrect += myFinalScore.correct;
            userData.totalWrong += myFinalScore.wrong;
            await updateDoc(doc(db, "players", currentUser.uid), { totalCorrect: userData.totalCorrect, totalWrong: userData.totalWrong });

            renderFinalScoreboard(roomData.players);
            document.getElementById('single-result-box').classList.add('hidden');
            document.getElementById('multi-result-box').classList.remove('hidden');
            clearGameStateStorage();
            switchPage(pages.result);
        }
    });
}

async function kickPlayer(playerId) {
    const roomRef = doc(db, "rooms", currentRoomCode);
    const roomSnap = await getDoc(roomRef);
    if(roomSnap.exists()) {
        const data = roomSnap.data(); delete data.players[playerId];
        await updateDoc(roomRef, { players: data.players });
    }
}

document.getElementById('leave-room-btn').addEventListener('click', () => { if(confirm("Keluar dari room?")) leaveRoomAction(); });

async function leaveRoomAction() {
    if (!currentRoomCode) return; const roomRef = doc(db, "rooms", currentRoomCode);
    try {
        await runTransaction(db, async (transaction) => {
            const roomSnap = await transaction.get(roomRef); if (!roomSnap.exists()) return;
            const roomData = roomSnap.data(); delete roomData.players[currentUser.uid];
            if (Object.keys(roomData.players).length === 0) { transaction.delete(roomRef); } 
            else { transaction.update(roomRef, { players: roomData.players }); }
        });
    } catch (e) { console.error(e); }
    exitRoomCleanup();
}

function exitRoomCleanup() {
    if (roomListener) roomListener(); roomListener = null; 
    clearInterval(timerInterval); 
    clearGameStateStorage();
    switchPage(pages.main);
}


// ================= ACTIONS GUESS ENGINE =================
document.getElementById('guess-btn').addEventListener('click', async () => {
    const inputEl = document.getElementById('guess-input'); const userGuess = parseInt(inputEl.value);
    const feedback = document.getElementById('feedback'); if (isNaN(userGuess) || inputEl.value === "") return;

    if (userGuess === secretNumber) {
        localCorrect++; feedback.innerText = "🎉 Benar! Angka diacak kembali!"; feedback.style.color = "#00ffcc";
        saveStateToLocalStorage();
        if (!isMultiplayer) { secretNumber = Math.floor(Math.random() * maxNumber) + 1; saveStateToLocalStorage(); } 
        else {
            const newSecret = Math.floor(Math.random() * maxNumber) + 1;
            const payload = { [`players.${currentUser.uid}.correct`]: localCorrect };
            if(isHost) payload.secretNumber = newSecret;
            await updateDoc(doc(db, "rooms", currentRoomCode), payload);
        }
    } else {
        localWrong++; feedback.innerText = userGuess < secretNumber ? "❌ Terlalu KECIL!" : "❌ Terlalu BESAR!";
        feedback.style.color = "#ff3366";
        saveStateToLocalStorage();
        if(isMultiplayer) await updateDoc(doc(db, "rooms", currentRoomCode), { [`players.${currentUser.uid}.wrong`]: localWrong });
    }
    inputEl.value = ""; inputEl.focus();
});

onSnapshot(doc(db, "rooms", currentRoomCode || "dummy"), (snap) => {
    if(isMultiplayer && snap.exists()){
        const data = snap.data();
        if(data.status === "playing" && data.secretNumber !== secretNumber) {
            secretNumber = data.secretNumber; saveStateToLocalStorage();
            document.getElementById('feedback').innerText = "🔄 Angka diacak ulang oleh host!";
            document.getElementById('feedback').style.color = "#00f0ff";
        }
    }
});


// ================= TOMBOL BERHENTI BERMAIN (DI SEMUA MODE) =================
document.getElementById('stop-game-btn').addEventListener('click', async () => {
    // SISTEM KONFIRMASI BERHENTI BERMAIN
    if (confirm("Apakah Anda yakin ingin berhenti bermain? Skor sesi ini tidak akan diakumulasikan.")) {
        if (isMultiplayer) {
            await leaveRoomAction();
        } else {
            exitRoomCleanup();
        }
    }
});


// ================= STATISTIK AKUMULASI & GLOBAL LEADERBOARD =================
document.getElementById('menu-stats-btn').addEventListener('click', () => {
    document.getElementById('total-correct').innerText = userData.totalCorrect;
    document.getElementById('total-wrong').innerText = userData.totalWrong;
    switchPage(pages.stats);
});

document.getElementById('menu-leaderboard-btn').addEventListener('click', async () => {
    const listContainer = document.getElementById('leaderboard-list');
    listContainer.innerHTML = "<li>Memuat rangking...</li>"; switchPage(pages.leaderboard);

    const q = query(collection(db, "players"), orderBy("totalCorrect", "desc"), limit(10));
    const querySnapshot = await getDocs(q); listContainer.innerHTML = "";

    querySnapshot.forEach((doc, index) => {
        const data = doc.data();
        listContainer.innerHTML += `<li><strong>#${index + 1}</strong> ${data.avatar} ${data.username} - ${data.totalCorrect} Benar</li>`;
    });
});


// ================= SERVER LIST & DATA JOIN =================
document.getElementById('menu-server-list-btn').addEventListener('click', async () => {
    isMultiplayer = true; switchPage(pages.serverList);
    const container = document.getElementById('server-container'); container.innerHTML = "<p>Mencari room...</p>";
    const querySnapshot = await getDocs(collection(db, "rooms")); container.innerHTML = "";

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
            const roomSnap = await transaction.get(roomRef); if (!roomSnap.exists()) throw "Room tidak ditemukan!";
            const roomData = roomSnap.data(); if (roomData.status !== "waiting") throw "Game sudah berjalan!";
            if (Object.keys(roomData.players).length >= 5) throw "Room Penuh!";
            roomData.players[currentUser.uid] = { name: userData.username, avatar: userData.avatar, correct: 0, wrong: 0, isHost: false };
            transaction.update(roomRef, { players: roomData.players });
        });
        currentRoomCode = code; isMultiplayer = true; isHost = false;
        saveStateToLocalStorage();
        document.getElementById('join-code-modal').classList.add('hidden'); listenToRoom(code); switchPage(pages.lobby);
    } catch (e) { alert(e); }
}

document.getElementById('menu-join-code-btn').addEventListener('click', () => document.getElementById('join-code-modal').classList.remove('hidden'));
document.getElementById('close-join-modal').addEventListener('click', () => document.getElementById('join-code-modal').classList.add('hidden'));
document.getElementById('submit-join-code-btn').addEventListener('click', () => {
    const code = document.getElementById('join-room-code-input').value.trim(); if(code) joinRoomAction(code);
});

function renderInGameStatus(playersData) {
    const container = document.getElementById('ingame-players-status'); container.innerHTML = "";
    Object.keys(playersData).forEach(pId => {
        const p = playersData[pId];
        container.innerHTML += `<div class="player-status-card" style="${pId === currentUser.uid ? 'border-color:#00ffcc;':''}"><span class="avatar">${p.avatar}</span><small>${p.name}</small><div class="score"><span class="correct">${p.correct}</span> / <span class="wrong">${p.wrong}</span></div></div>`;
    });
}

function renderFinalScoreboard(playersData) {
    const container = document.getElementById('final-scoreboard'); container.innerHTML = "";
    const sorted = Object.values(playersData).sort((a,b) => b.correct - a.correct);
    sorted.forEach((p, idx) => {
        container.innerHTML += `<div class="score-row"><span><strong>#${idx+1}</strong> ${p.avatar} ${p.name}</span><span>Benar: <b class="correct">${p.correct}</b> | Salah: <b class="wrong">${p.wrong}</b></span></div>`;
    });
}

document.getElementById('back-to-main-1').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-to-main-2').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-to-main-3').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-from-server-btn').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-to-menu-after-game-btn').addEventListener('click', () => exitRoomCleanup());
