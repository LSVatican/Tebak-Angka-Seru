import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// DOM Navigasi Halaman
const pages = {
    login: document.getElementById('login-page'),
    main: document.getElementById('main-page'),
    setup: document.getElementById('setup-page'),
    game: document.getElementById('game-page'),
    result: document.getElementById('result-page'),
    stats: document.getElementById('stats-page'),
    leaderboard: document.getElementById('leaderboard-page'),
};

// State Pengguna & Gameplay Global
let currentUser = null;
let userData = { username: "", avatar: "", totalCorrect: 0, totalWrong: 0 };
let maxNumber = 0, secretNumber = 0, timeLeft = 120, timerInterval;
let sessionCorrect = 0, sessionWrong = 0;

function switchPage(targetPage) {
    Object.values(pages).forEach(p => p.classList.add('hidden'));
    targetPage.classList.remove('hidden');
}

// ================= SYNC DATA USER DENGAN DATABASE =================
async function loadUserData(user) {
    currentUser = user;
    const docRef = doc(db, "players", user.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        userData = docSnap.data();
        updateUserUI();
        switchPage(pages.main);
    } else {
        // User baru, tampilkan modal registrasi avatar emoji & nama custom
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

// ================= EVENT LISTENER AUTENTIKASI GOOGLE =================
document.getElementById('google-login-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).then((res) => {
        loadUserData(res.user);
    }).catch(err => alert("Gagal login: " + err.message));
});

// Registrasi Pemain Baru
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

// Logout Akun dengan Konfirmasi
document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm("Apakah kamu yakin ingin keluar?")) {
        signOut(auth).then(() => {
            switchPage(pages.login);
            currentUser = null;
        });
    }
});

// Hapus Akun & Data (Mengulang dari awal) dengan Kode Acak
document.getElementById('delete-data-btn').addEventListener('click', async () => {
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const validationInput = prompt(`PERINGATAN! Tindakan ini akan menghapus semua statistik game kamu dari awal.\nKetik kode berikut untuk konfirmasi: ${randomCode}`);
    
    if (validationInput === String(randomCode)) {
        try {
            await deleteDoc(doc(db, "players", currentUser.uid));
            const user = auth.currentUser;
            await deleteUser(user);
            alert("Data berhasil dihapus seluruhnya.");
            document.getElementById('profile-modal').classList.add('hidden');
            switchPage(pages.login);
        } catch (error) {
            alert("Gagal menghapus data otomatis. Silakan lakukan relogin terlebih dahulu.");
        }
    } else {
        alert("Kode salah! Penghapusan data dibatalkan.");
    }
});

// ================= NAVIGASI MENU UTAMA =================
document.getElementById('menu-play-btn').addEventListener('click', () => switchPage(pages.setup));
document.getElementById('back-to-main-1').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-to-main-2').addEventListener('click', () => switchPage(pages.main));
document.getElementById('back-to-main-3').addEventListener('click', () => switchPage(pages.main));

// Pop Up Profil
document.getElementById('open-profile-btn').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.remove('hidden');
});
document.getElementById('close-profile-btn').addEventListener('click', () => {
    document.getElementById('profile-modal').classList.add('hidden');
});

// Simpan Edit Profil Pemain
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

// Pemicu Lihat Statistik Akumulasi
document.getElementById('menu-stats-btn').addEventListener('click', () => {
    document.getElementById('total-correct').innerText = userData.totalCorrect;
    document.getElementById('total-wrong').innerText = userData.totalWrong;
    switchPage(pages.stats);
});

// Pemicu Leaderboard Top 10 Global
document.getElementById('menu-leaderboard-btn').addEventListener('click', async () => {
    const listContainer = document.getElementById('leaderboard-list');
    listContainer.innerHTML = "<li>Memuat rangking...</li>";
    switchPage(pages.leaderboard);

    const q = query(collection(db, "players"), orderBy("totalCorrect", "desc"), limit(10));
    const querySnapshot = await getDocs(q);
    listContainer.innerHTML = "";

    querySnapshot.forEach((doc, index) => {
        const data = doc.data();
        listContainer.innerHTML += `<li><strong>#${index + 1}</strong> ${data.avatar} ${data.username} - ${data.totalCorrect} Benar</li>`;
    });
});

// ================= LOGIKA GAMEPLAY VALIDASI DAN TIMER =================
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

// Mulai Bermain
startBtn.addEventListener('click', () => {
    maxNumber = parseInt(maxNumberInput.value);
    document.getElementById('display-max').innerText = maxNumber;
    sessionCorrect = 0;
    sessionWrong = 0;
    secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    
    switchPage(pages.game);
    startTimer();
});

function startTimer() {
    timeLeft = 120;
    timerInterval = setInterval(async () => {
        let mins = Math.floor(timeLeft / 60);
        let secs = timeLeft % 60;
        document.getElementById('timer').innerText = `${mins < 10 ? '0'+mins : mins}:${secs < 10 ? '0'+secs : secs}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            
            // Perbarui Data Cloud Firestore
            userData.totalCorrect += sessionCorrect;
            userData.totalWrong += sessionWrong;
            await updateDoc(doc(db, "players", currentUser.uid), {
                totalCorrect: userData.totalCorrect,
                totalWrong: userData.totalWrong
            });

            // Tampilkan Sesi Statistik Halaman
            document.getElementById('stat-correct').innerText = sessionCorrect;
            document.getElementById('stat-wrong').innerText = sessionWrong;
            switchPage(pages.result);
        }
        timeLeft--;
    }, 1000);
}

document.getElementById('guess-btn').addEventListener('click', () => {
    const userGuess = parseInt(guessInput.value);
    const feedback = document.getElementById('feedback');

    if (isNaN(userGuess) || guessInput.value === "") {
        feedback.innerText = "Ketik angka dulu!";
        feedback.style.color = "#ff3333";
        return;
    }

    if (userGuess === secretNumber) {
        feedback.innerText = "🎉 Benar! Angka diacak kembali!";
        feedback.style.color = "#00ffcc";
        sessionCorrect++;
        secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    } else {
        feedback.innerText = userGuess < secretNumber ? "❌ Terlalu KECIL!" : "❌ Terlalu BESAR!";
        feedback.style.color = "#ff3366";
        sessionWrong++;
    }
    guessInput.value = "";
    guessInput.focus();
});

document.getElementById('restart-btn').addEventListener('click', () => {
    document.getElementById('feedback').innerText = "";
    maxNumberInput.value = "";
    startBtn.disabled = true;
    switchPage(pages.main);
});

// Auto Check Login saat aplikasi dibuka
auth.onAuthStateChanged(user => {
    if (user) loadUserData(user);
    else switchPage(pages.login);
});
