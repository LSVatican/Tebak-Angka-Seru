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
let gameMode = "single"; // "single" atau "multi"

// Game State Realtime
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

// ================= AMBIL AKSI MENU UTAMA =================
// Mode Singleplayer
document.getElementById('menu-single-btn').addEventListener('click', () => {
    gameMode = "single";
    // Tampilkan setup page untuk singleplayer
    document.getElementById('host-controls').classList.add('hidden'); 
    switchPage(pages.setup); 
});

// Mode Multiplayer (Buat Room)
document.getElementById('menu-create-room-btn').addEventListener('click', async () => {
    gameMode = "multi";
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    currentRoomCode = code;
    isHost = true;

    const roomData = {
        roomCode: code,
        hostId: currentUser.uid,
        hostName: userData.username,
        status: "waiting",
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

// ================= LOGIKA MULTIPLAYER REALTIME =================
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
    gameMode = "multi";
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

function listenToRoom(code) {
    if (roomListener) roomListener();

    roomListener = onSnapshot(doc(db, "rooms", code), (docSnap) => {
        if (!docSnap.exists()) {
            alert("Room telah dibubarkan karena kosong atau kamu telah dikick.");
            exitRoomCleanup();
            return;
        }

        const roomData = docSnap.data();

        if (!roomData.players[currentUser.uid]) {
            alert("Kamu telah dikeluarkan (kick) dari room ini.");
            exitRoomCleanup();
            return;
        }

        document.getElementById('lobby-room-title').innerText = `Room milik ${roomData.hostName}`;
        document.getElementById('lobby-room-code').innerText = roomData.roomCode;
        
        const playersList = Object.keys(roomData.players);
        document.getElementById('lobby-room-slots').innerText = `${playersList.length}/5`;

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

        if(isHost) {
            document.querySelectorAll('.btn-kick').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    kickPlayer(e.target.getAttribute('data-id'));
                });
            });
        }

        if (isHost) {
            document.getElementById('host-controls').classList.remove('hidden');
            document.getElementById('player-wait-msg').classList.add('hidden');
            document.getElementById('mp-start-game-btn').disabled = playersList.length < 2;
        } else {
            document.getElementById('host-controls').classList.add('hidden');
            document.getElementById('player-wait-msg').classList.remove('hidden');
        }

        if (roomData.status === "playing" && pages.game.classList.contains('hidden')) {
            maxNumber = roomData.maxNumber;
            secretNumber = roomData.secretNumber;
            startGameplay();
        }

        if (roomData.status === "playing") {
            renderInGameStatus(roomData.players);
        }

        if (roomData.status === "finished") {
            renderFinalScoreboard(roomData.players);
            switchPage(pages.result);
        }
    });
}

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

// Fitur Keluar Room (Otomatis Hapus Room jika Orang Terakhir)
document.getElementById('leave-room-btn').addEventListener('click', () => {
    if (confirm("Apakah kamu yakin ingin meninggalkan room?")) {
        leaveRoomAction();
    }
});

async function leaveRoomAction() {
    if (!currentRoomCode) return;
    const roomRef = doc(db, "rooms", currentRoomCode);

    try {
        await runTransaction(db, async (transaction) => {
            const roomSnap = await transaction.get(roomRef);
            if (!roomSnap.exists()) return;

            const data = roomSnap.data();
            delete data.players[currentUser.uid];

            const sisaPemain = Object.keys(data.players);

            // KRITIKAL: Jika ditinggalkan semua orang (Sisa pemain = 0), OTOMATIS HAPUS ROOM
            if (sisaPemain.length === 0) {
                transaction.delete(roomRef);
            } else {
                // Jika host keluar tapi masih ada orang lain, oper status host ke pemain pertama yang tersisa
                if (isHost) {
                    const newHostId = sisaPemain[0];
                    data.hostId = newHostId;
                    data.hostName = data.players[newHostId].name;
                    data.players[newHostId].isHost = true;
                }
                transaction.update(roomRef, { players: data.players, hostId: data.hostId, hostName: data.hostName });
            }
        });
    } catch (e) {
        console.error("Gagal memproses keluar room: ", e);
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

// ================= LIST SERVER VIEW =================
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
            joinRoomAction(e.target.getAttribute('data-code'));
        });
    });
});
document.getElementById('back-from-server-btn').addEventListener('click', () => switchPage(pages.main));

// ================= VALIDASI INPUT SINGLEPLAYER =================
const maxNumberInput = document.getElementById('max-number');
const startBtn = document.getElementById('start-btn');
const setupWarning = document.getElementById('setup-warning');

maxNumberInput.addEventListener('input', () => {
    let val = maxNumberInput.value;
    if (val === "") { setupWarning.innerText = "Input tidak boleh kosong!"; startBtn.disabled = true; return; }
    let num = parseInt(val);
    if (num > 50) { setupWarning.innerText = "Maksimal angka adalah 50!"; maxNumberInput.value = ""; startBtn.disabled = true; }
    else if (num <= 0) { setupWarning.innerText = "Angka harus lebih dari 0!"; startBtn.disabled = true; }
    else { setupWarning.innerText = ""; startBtn.disabled = false; }
});

// Mulai Game (Deteksi Single atau Multi)
startBtn.addEventListener('click', () => {
    maxNumber = parseInt(maxNumberInput.value);
    secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    startGameplay();
});

document.getElementById('mp-start-game-btn').addEventListener('click', async () => {
    const inputMax = parseInt(document.getElementById('mp-max-number').value);
    if(isNaN(inputMax) || inputMax > 50 || inputMax <= 0) return alert("Maksimal angka 1 - 50!");
    const randomSecret = Math.floor(Math.random() * inputMax) + 1;

    await updateDoc(doc(db, "rooms", currentRoomCode), {
        status: "playing",
        maxNumber: inputMax,
        secretNumber: randomSecret
    });
});

// ================= CORE GAMEPLAY & RENDERING =================
function startGameplay() {
    localCorrect = 0;
    localWrong = 0;
    document.getElementById('display-max').innerText = maxNumber;
    document.getElementById('feedback').innerText = "";
    document.getElementById('guess-input').value = "";
    
    switchPage(pages.game);

    // Render komponen khusus Singleplayer atau Multiplayer di interface game
    if(gameMode === "single") {
        document.getElementById('ingame-players-status').innerHTML = `
            <div class="player-status-card" style="border-color:#00ffcc;">
                <span class="avatar">${userData.avatar}</span>
                <small>${userData.username} (Solo)</small>
                <div class="score"><span class="correct" id="lbl-solo-c">0</span> / <span class="wrong" id="lbl-solo-w">0</span></div>
            </div>`;
        startTimerMaster(false);
    } else {
        startTimerMaster(isHost);
    }
}

function startTimerMaster(shouldUpdateStatus) {
    timeLeft = 120;
    clearInterval(timerInterval);
    timerInterval = setInterval(async () => {
        timeLeft--;
        let mins = Math.floor(timeLeft / 60);
        let secs = timeLeft % 60;
        document.getElementById('timer').innerText = `${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            if (gameMode === "single") {
                // Tampilkan hasil akhir singleplayer
                document.getElementById('final-scoreboard').innerHTML = `
                    <div class="score-row">
                        <span>${userData.avatar} ${userData.username}</span>
                        <span>Benar: <b class="correct">${localCorrect}</b> | Salah: <b class="wrong">${localWrong}</b></span>
                    </div>`;
                switchPage(pages.result);
            } else if (gameMode === "multi" && shouldUpdateStatus) {
                await updateDoc(doc(db, "rooms", currentRoomCode), { status: "finished" });
            }
        }
    }, 1000);
}

// Aksi Pengiriman Tebakan
document.getElementById('guess-btn').addEventListener('click', async () => {
    const inputEl = document.getElementById('guess-input');
    const userGuess = parseInt(inputEl.value);
    const feedback = document.getElementById('feedback');

    if (isNaN(userGuess) || inputEl.value === "") return;

    if (userGuess === secretNumber) {
        localCorrect++;
        if(gameMode === "single") {
            feedback.innerText = "🎉 Benar! Angka baru telah diacak.";
            feedback.style.color = "#00ffcc";
            document.getElementById('lbl-solo-c').innerText = localCorrect;
            secretNumber = Math.floor(Math.random() * maxNumber) + 1;
        } else {
            feedback.innerText = "🎉 Benar! Menunggu sinkronisasi room...";
            if (isHost) {
                const newSecret = Math.floor(Math.random() * maxNumber) + 1;
                await updateDoc(doc(db, "rooms", currentRoomCode), {
                    secretNumber: newSecret,
                    [`players.${currentUser.uid}.correct`]: localCorrect
                });
            } else {
                await updateDoc(doc(db, "rooms", currentRoomCode), {
                    [`players.${currentUser.uid}.correct`]: localCorrect
                });
            }
        }
    } else {
        localWrong++;
        feedback.innerText = userGuess < secretNumber ? "❌ Terlalu KECIL!" : "❌ Terlalu BESAR!";
        feedback.style.color = "#ff3366";

        if(gameMode === "single") {
            document.getElementById('lbl-solo-w').innerText = localWrong;
        } else {
            await updateDoc(doc(db, "rooms", currentRoomCode), {
                [`players.${currentUser.uid}.wrong`]: localWrong
            });
        }
    }
    inputEl.value = "";
    inputEl.focus();
});

// Sinkronisasi Angka Baru Multiplayer Secara Realtime
onSnapshot(doc(db, "rooms", currentRoomCode || "dummy"), (snap) => {
    if(gameMode === "multi" && snap.exists()){
        const data = snap.data();
        if(data.status === "playing" && data.secretNumber !== secretNumber) {
            secretNumber = data.secretNumber;
            document.getElementById('feedback').innerText = "🔄 Angka telah diacak ulang oleh server!";
            document.getElementById('feedback').style.color = "#00f0ff";
        }
    }
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
    if(gameMode === "multi") leaveRoomAction();
    else switchPage(pages.main);
});

document.getElementById('back-to-main-1').addEventListener('click', () => switchPage(pages.main));
