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
let isHost = false;

// Game State Realtime
let maxNumber = 50, secretNumber = 0, timeLeft = 120, timerInterval;
let localCorrect = 0, localWrong = 0;

const pages = {
    login: document.getElementById('login-page'),
    main: document.getElementById('main-page'),
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

// ================= LOGIKA MULTIPLAYER ROOM (CORE) =================

// 1. Buat Room Baru (Sebagai Host)
document.getElementById('menu-create-room-btn').addEventListener('click', async () => {
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code
    currentRoomCode = code;
    isHost = true;

    const roomData = {
        roomCode: code,
        hostId: currentUser.uid,
        hostName: userData.username,
        status: "waiting", // waiting, playing, finished
        maxNumber: 50,
        secretNumber: 0,
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
});

// 2. Gabung Room Menggunakan Kode
document.getElementById('menu-join-code-btn').addEventListener('click', () => {
    document.getElementById('join-code-modal').classList.remove('hidden');
});
document.getElementById('close-join-modal').addEventListener('click', () => {
    document.getElementById('join-code-modal').classList.add('hidden');
});

document.getElementById('submit-join-code-btn').addEventListener('click', () => {
    const code = document.getElementById('join-room-code-input').value.trim();
    if(code) joinRoomAction(code);
});

async function joinRoomAction(code) {
    const roomRef = doc(db, "rooms", code);
    try {
        await runTransaction(db, async (transaction) => {
            const roomSnap = await transaction.get(roomRef);
            if (!roomSnap.exists()) throw "Room tidak ditemukan!";
            
            const roomData = roomSnap.data();
            if (roomData.status !== "waiting") throw "Game sudah dimulai atau selesai!";
            
            const currentPlayersCount = Object.keys(roomData.players).length;
            if (currentPlayersCount >= 5) throw "Room sudah penuh (Maksimal 5 pemain)!";

            roomData.players[currentUser.uid] = {
                name: userData.username,
                avatar: userData.avatar,
                correct: 0,
                wrong: 0,
                isHost: false
            };

            transaction.update(roomRef, { players: roomData.players });
        });

        currentRoomCode = code;
        isHost = false;
        document.getElementById('join-code-modal').classList.add('hidden');
        listenToRoom(code);
        switchPage(pages.lobby);

    } catch (e) {
        alert(e);
    }
}

// 3. Sinkronisasi Data Realtime Dalam Lobby / Game
function listenToRoom(code) {
    if (roomListener) roomListener(); // Matikan listener lama jika ada

    roomListener = onSnapshot(doc(db, "rooms", code), (docSnap) => {
        if (!docSnap.exists()) {
            alert("Lobby telah dibubarkan oleh host atau kamu telah dikick.");
            exitRoomCleanup();
            return;
        }

        const roomData = docSnap.data();

        // Cek jika diri sendiri telah dikick oleh host
        if (!roomData.players[currentUser.uid]) {
            alert("Kamu telah dikeluarkan (kick) dari room ini.");
            exitRoomCleanup();
            return;
        }

        // Tampilkan Info Room
        document.getElementById('lobby-room-title').innerText = `Room milik ${roomData.hostName}`;
        document.getElementById('lobby-room-code').innerText = roomData.roomCode;
        
        const playersList = Object.keys(roomData.players);
        document.getElementById('lobby-room-slots').innerText = `${playersList.length}/5`;

        // Render List Pemain di Lobby
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

        // Event Listener untuk Tombol Kick
        if(isHost) {
            document.querySelectorAll('.btn-kick').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const targetKickId = e.target.getAttribute('data-id');
                    kickPlayer(targetKickId);
                });
            });
        }

        // Atur Kontrol Visibilitas Host vs Member
        if (isHost) {
            document.getElementById('host-controls').classList.remove('hidden');
            document.getElementById('player-wait-msg').classList.add('hidden');
            document.getElementById('mp-start-game-btn').disabled = playersList.length < 2; // Minimal 2 pemain
        } else {
            document.getElementById('host-controls').classList.add('hidden');
            document.getElementById('player-wait-msg').classList.remove('hidden');
        }

        // Deteksi Perpindahan Otomatis Jika Host Memulai Game
        if (roomData.status === "playing" && pages.game.classList.contains('hidden')) {
            maxNumber = roomData.maxNumber;
            secretNumber = roomData.secretNumber;
            startMultiplayerGameplay();
        }

        // Update Skor Real-time Pas Permainan Berjalan
        if (roomData.status === "playing") {
            renderInGameStatus(roomData.players);
        }

        // Deteksi Jika Game Selesai (Timer Habis)
        if (roomData.status === "finished") {
            renderFinalScoreboard(roomData.players);
            switchPage(pages.result);
        }
    });
}

// Fungsi Kick Pemain oleh Host
async function kickPlayer(playerId) {
    if(!isHost) return;
    const roomRef = doc(db, "rooms", currentRoomCode);
    const roomSnap = await getDoc(roomRef);
    if(roomSnap.exists()) {
        const data = roomSnap.data();
        delete data.players[playerId];
        await updateDoc(roomRef, { players: data.players });
    }
}

// 4. Keluar Room & Konfirmasi Keluar Room
document.getElementById('leave-room-btn').addEventListener('click', () => {
    if (confirm("Apakah kamu yakin ingin meninggalkan room?")) {
        leaveRoomAction();
    }
});

async function leaveRoomAction() {
    if (!currentRoomCode) return;
    const roomRef = doc(db, "rooms", currentRoomCode);

    if (isHost) {
        // Jika host keluar, hapus room seluruhnya (Bubar)
        await deleteDoc(roomRef);
    } else {
        // Jika member keluar, hapus data dirinya dari map players
        const roomSnap = await getDoc(roomRef);
        if (roomSnap.exists()) {
            const data = roomSnap.data();
            delete data.players[currentUser.uid];
            await updateDoc(roomRef, { players: data.players });
        }
    }
    exitRoomCleanup();
}

function exitRoomCleanup() {
    if (roomListener) roomListener();
    roomListener = null;
    currentRoomCode = null;
    isHost = false;
    clearInterval(timerInterval);
    switchPage(pages.main);
}

// ================= SERVER LIST VIEW =================
document.getElementById('menu-server-list-btn').addEventListener('click', async () => {
    switchPage(pages.serverList);
    const serverContainer = document.getElementById('server-container');
    serverContainer.innerHTML = "<p>Mencari room aktif...</p>";

    const querySnapshot = await getDocs(collection(db, "rooms"));
    serverContainer.innerHTML = "";

    if (querySnapshot.empty) {
        serverContainer.innerHTML = "<p style='color:#aaa;'>Tidak ada room aktif saat ini.</p>";
    }

    querySnapshot.forEach((doc) => {
        const room = doc.data();
        if (room.status === "waiting") {
            const count = Object.keys(room.players).length;
            serverContainer.innerHTML += `
                <div class="server-item">
                    <div>
                        <strong>Room milik ${room.hostName}</strong><br>
                        <small style="color:#00ffcc">Kode: ${room.roomCode}</small>
                    </div>
                    <div>
                        <span>${count}/5 Pemain</span>
                        <button class="btn-join-server" data-code="${room.roomCode}" style="width:auto; padding:6px 12px; margin-left:10px;" ${count >= 5 ? 'disabled':''}>Join</button>
                    </div>
                </div>`;
        }
    });

    document.querySelectorAll('.btn-join-server').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const code = e.target.getAttribute('data-code');
            joinRoomAction(code);
        });
    });
});

document.getElementById('back-from-server-btn').addEventListener('click', () => switchPage(pages.main));

// ================= GAMEPLAY LOGIC (MULTIPLAYER REALTIME) =================

// Host Menekan Mulai Game
document.getElementById('mp-start-game-btn').addEventListener('click', async () => {
    const inputMax = parseInt(document.getElementById('mp-max-number').value);
    if(isNaN(inputMax) || inputMax > 50 || inputMax <= 0) return alert("Maksimal angka harus antara 1 - 50!");
    
    const randomSecret = Math.floor(Math.random() * inputMax) + 1;

    await updateDoc(doc(db, "rooms", currentRoomCode), {
        status: "playing",
        maxNumber: inputMax,
        secretNumber: randomSecret
    });
});

function startMultiplayerGameplay() {
    localCorrect = 0;
    localWrong = 0;
    document.getElementById('display-max').innerText = maxNumber;
    document.getElementById('feedback').innerText = "";
    document.getElementById('guess-input').value = "";
    
    switchPage(pages.game);

    if (isHost) {
        // Hanya host yang menjalankan timer master dan melakukan update detik secara berkala
        startMasterTimer();
    } else {
        // Member hanya menerima hitung mundur lokal (bisa disinkronisasikan)
        startClientTimer();
    }
}

// Master Timer Diisi oleh Host
function startMasterTimer() {
    timeLeft = 120;
    timerInterval = setInterval(async () => {
        timeLeft--;
        updateTimerUI(timeLeft);

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            await updateDoc(doc(db, "rooms", currentRoomCode), { status: "finished" });
        }
    }, 1000);
}

function startClientTimer() {
    timeLeft = 120;
    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerUI(timeLeft);
        if (timeLeft <= 0) clearInterval(timerInterval);
    }, 1000);
}

function updateTimerUI(time) {
    let mins = Math.floor(time / 60);
    let secs = time % 60;
    document.getElementById('timer').innerText = `${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}`;
}

// Render Status Pemain & Foto Profil Saat Live Main
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

// Aksi Input Tebakan Pemain
document.getElementById('guess-btn').addEventListener('click', async () => {
    const inputEl = document.getElementById('guess-input');
    const userGuess = parseInt(inputEl.value);
    const feedback = document.getElementById('feedback');

    if (isNaN(userGuess) || inputEl.value === "") return;

    if (userGuess === secretNumber) {
        feedback.innerText = "🎉 Benar! Menunggu Host mengacak angka baru...";
        feedback.style.color = "#00ffcc";
        localCorrect++;
        
        // Update database realtime dan acak angka baru secara global jika benar
        if (isHost) {
            const newSecret = Math.floor(Math.random() * maxNumber) + 1;
            secretNumber = newSecret;
            await updateDoc(doc(db, "rooms", currentRoomCode), {
                secretNumber: newSecret,
                [`players.${currentUser.uid}.correct`]: localCorrect
            });
        } else {
            // Member hanya update skor pribadinya
            await updateDoc(doc(db, "rooms", currentRoomCode), {
                [`players.${currentUser.uid}.correct`]: localCorrect
            });
        }
    } else {
        feedback.innerText = userGuess < secretNumber ? "❌ Terlalu KECIL!" : "❌ Terlalu BESAR!";
        feedback.style.color = "#ff3366";
        localWrong++;

        await updateDoc(doc(db, "rooms", currentRoomCode), {
            [`players.${currentUser.uid}.wrong`]: localWrong
        });
    }

    inputEl.value = "";
    inputEl.focus();
});

// Realtime sinkronisasi angka baru yang diacak host
onSnapshot(doc(db, "rooms", currentRoomCode || "dummy"), (snap) => {
    if(snap.exists()){
        const data = snap.data();
        if(data.status === "playing" && data.secretNumber !== secretNumber) {
            secretNumber = data.secretNumber;
            document.getElementById('feedback').innerText = "🔄 Angka telah diacak ulang oleh server! Silakan tebak kembali.";
            document.getElementById('feedback').style.color = "#00f0ff";
        }
    }
});

// ================= LEADERBOARD SESI MULTIPLAYER (AKHIR GAME) =================
function renderFinalScoreboard(playersData) {
    const container = document.getElementById('final-scoreboard');
    container.innerHTML = "";
    
    // Sort urutan pemenang berdasarkan jumlah jawaban benar terbanyak
    const sortedPlayers = Object.values(playersData).sort((a,b) => b.correct - a.correct);
    
    sortedPlayers.forEach((p, idx) => {
        container.innerHTML += `
            <div class="score-row">
                <span><strong>#${idx+1}</strong> ${p.avatar} ${p.name}</span>
                <span>Benar: <b class="correct">${p.correct}</b> | Salah: <b class="wrong">${p.wrong}</b></span>
            </div>`;
    });
}

document.getElementById('back-to-menu-after-game-btn').addEventListener('click', () => {
    exitRoomCleanup();
});
