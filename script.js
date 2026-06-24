import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, deleteUser } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAFRcq7R25kUVRNX02NHch7HSE3UgaecqU",
  authDomain: "tebak-angka-478ff.firebaseapp.com",
  databaseURL: "https://tebak-angka-478ff-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tebak-angka-478ff",
  storageBucket: "tebak-angka-478ff.firebasestorage.app",
  messagingSenderId: "252023470469",
  appId: "1:252023470469:web:db10ed1b57f1b6e97b6cec",
  measurementId: "G-YLQ0LYCV23"
};

// Inisialisasi Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Penampung Data Elemen HTML
const pages = {
    login: document.getElementById('login-page'),
    menu: document.getElementById('main-menu-page'),
    setup: document.getElementById('setup-page'),
    game: document.getElementById('game-page'),
    result: document.getElementById('game-result-page'),
    stats: document.getElementById('stats-page'),
    leaderboard: document.getElementById('leaderboard-page'),
    profilePopup: document.getElementById('profile-popup')
};

// State Data Global Sesi Ini
let currentUser = null;
let userData = { name: "", emoji: "👤", totalCorrect: 0, totalWrong: 0 };
let maxNumber = 0;
let secretNumber = 0;
let timeLeft = 120;
let timerInterval;
let sessionCorrect = 0;
let sessionWrong = 0;

// Menangani Perubahan Status Autentikasi User (Login/Logout)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            userData = docSnap.data();
            updateMenuUI();
            switchPage('menu');
        } else {
            // User baru terdaftar, munculkan paksa pop-up konfigurasi profil kustom
            document.getElementById('popup-title').innerText = "Pengguna Baru!";
            document.getElementById('profile-name').value = user.displayName || "";
            document.getElementById('profile-emoji').value = "🎮";
            document.getElementById('close-profile-btn').classList.add('hidden');
            document.getElementById('delete-data-btn').classList.add('hidden');
            document.getElementById('danger-zone-hr').classList.add('hidden');
            switchPage('menu');
            pages.profilePopup.classList.remove('hidden');
        }
    } else {
        currentUser = null;
        switchPage('login');
    }
});

function switchPage(pageKey) {
    Object.keys(pages).forEach(key => {
        if (key === 'profilePopup') return;
        pages[key].classList.add('hidden');
    });
    pages[pageKey].classList.remove('hidden');
}

function updateMenuUI() {
    document.getElementById('menu-user-emoji').innerText = userData.emoji;
    document.getElementById('menu-user-name').innerText = userData.name;
}

// === FITUR LOGIN / LOGOUT ===
document.getElementById('login-google-btn').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(err => alert("Gagal Login: " + err.message));
});

document.getElementById('logout-btn').addEventListener('click', () => {
    if (confirm("Apakah anda yakin ingin keluar/logout?")) {
        signOut(auth);
    }
});

// === MANAJEMEN PROFIL POP UP ===
document.getElementById('open-profile-btn').addEventListener('click', () => {
    document.getElementById('popup-title').innerText = "Edit Profil";
    document.getElementById('profile-name').value = userData.name;
    document.getElementById('profile-emoji').value = userData.emoji;
    document.getElementById('close-profile-btn').classList.remove('hidden');
    document.getElementById('delete-data-btn').classList.remove('hidden');
    document.getElementById('danger-zone-hr').classList.remove('hidden');
    pages.profilePopup.classList.remove('hidden');
});

document.getElementById('close-profile-btn').addEventListener('click', () => {
    pages.profilePopup.classList.add('hidden');
});

// Regex deteksi pola Emoji tunggal secara universal
const emojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])$/;

document.getElementById('save-profile-btn').addEventListener('click', async () => {
    const inputName = document.getElementById('profile-name').value.trim();
    const inputEmoji = document.getElementById('profile-emoji').value.trim();
    const warning = document.getElementById('profile-warning');

    if (!inputName || !inputEmoji) {
        warning.innerText = "Semua input profil wajib diisi!";
        return;
    }
    if (!emojiRegex.test(inputEmoji)) {
        warning.innerText = "Kolom foto profil hanya boleh diisi 1 karakter emoji!";
        return;
    }

    warning.innerText = "";
    userData.name = inputName;
    userData.emoji = inputEmoji;

    // Simpan permanen ke Firestore Database Cloud
    await setDoc(doc(db, "users", currentUser.uid), userData, { merge: true });
    updateMenuUI();
    pages.profilePopup.classList.add('hidden');
});

// === SYSTEM HAPUS DATA & AKUN BERBASIS KODE ACAK ===
document.getElementById('delete-data-btn').addEventListener('click', async () => {
    const randomCode = Math.floor(1000 + Math.random() * 9000);
    const confirmInput = prompt(`PERINGATAN! Tindakan ini akan menghapus semua skor akumulasi Anda dari awal.\nKetik kode verifikasi ini untuk menyetujui: ${randomCode}`);

    if (confirmInput === String(randomCode)) {
        try {
            const userUid = currentUser.uid;
            await deleteDoc(doc(db, "users", userUid));
            pages.profilePopup.classList.add('hidden');
            await deleteUser(auth.currentUser);
            alert("Data akun Anda berhasil dihapus total dari database game.");
        } catch (error) {
            alert("Sistem membutuhkan re-autentikasi baru. Silakan logout lalu login kembali untuk menghapus akun.");
        }
    } else {
        alert("Kode salah! Penghapusan data dibatalkan.");
    }
});

// === FLOW NAVIGASI UTAMA ===
document.getElementById('menu-start-btn').addEventListener('click', () => {
    document.getElementById('max-number').value = "";
    document.getElementById('setup-warning').innerText = "";
    document.getElementById('start-game-btn').disabled = true;
    switchPage('setup');
});

document.getElementById('menu-stats-btn').addEventListener('click', () => {
    document.getElementById('total-correct').innerText = userData.totalCorrect || 0;
    document.getElementById('total-wrong').innerText = userData.totalWrong || 0;
    switchPage('stats');
});

document.getElementById('menu-leaderboard-btn').addEventListener('click', async () => {
    const listContainer = document.getElementById('leaderboard-list');
    listContainer.innerHTML = "<li>Memuat papan peringkat...</li>";
    switchPage('leaderboard');

    // Query 10 user terbaik dengan total jawaban benar terbanyak
    const q = query(collection(db, "users"), orderBy("totalCorrect", "desc"), limit(10));
    const querySnapshot = await getDocs(q);
    listContainer.innerHTML = "";

    let rank = 1;
    querySnapshot.forEach((doc) => {
        const data = doc.data();
        const item = document.createElement('li');
        item.innerHTML = `<b>#${rank}</b> ${data.emoji} ${data.name} — <span class="correct">${data.totalCorrect || 0} Benar</span>`;
        listContainer.appendChild(item);
        rank++;
    });
});

document.getElementById('back-to-menu-1').addEventListener('click', () => switchPage('menu'));
document.getElementById('back-to-menu-2').addEventListener('click', () => switchPage('menu'));
document.getElementById('back-to-menu-3').addEventListener('click', () => switchPage('menu'));

// === LOGIKA SETUP ANGKA PERMAINAN ===
const maxNumInput = document.getElementById('max-number');
const startGameBtn = document.getElementById('start-game-btn');
const setupWarning = document.getElementById('setup-warning');

maxNumInput.addEventListener('input', () => {
    let val = maxNumInput.value;
    if (val === "") {
        setupWarning.innerText = "Input maksimal angka tidak boleh kosong!";
        startGameBtn.disabled = true;
        return;
    }
    let num = parseInt(val);
    if (num > 50) {
        setupWarning.innerText = "Maksimal angka yang diperbolehkan adalah 50!";
        maxNumInput.value = "";
        startGameBtn.disabled = true;
    } else if (num <= 0) {
        setupWarning.innerText = "Batas minimal angka adalah 1!";
        startGameBtn.disabled = true;
    } else {
        setupWarning.innerText = "";
        startGameBtn.disabled = false;
    }
});

// === LOGIKA GAMEPLAY & VALIDASI INPUT ===
const guessInput = document.getElementById('guess-input');
const gameWarning = document.getElementById('game-warning');
const feedback = document.getElementById('feedback');

startGameBtn.addEventListener('click', () => {
    maxNumber = parseInt(maxNumInput.value);
    document.getElementById('display-max').innerText = maxNumber;
    
    sessionCorrect = 0;
    sessionWrong = 0;
    guessInput.value = "";
    feedback.innerText = "";
    gameWarning.innerText = "";
    
    secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    switchPage('game');
    startTimer();
});

guessInput.addEventListener('input', () => {
    let val = guessInput.value;
    if (val === "") return;
    
    let num = parseInt(val);
    if (num > maxNumber) {
        gameWarning.innerText = `Angka melebihi batas maksimal (${maxNumber})!`;
        guessInput.value = "";
    } else {
        gameWarning.innerText = "";
    }
});

function startTimer() {
    timeLeft = 120; // 2 Menit mundur
    timerInterval = setInterval(() => {
        let min = Math.floor(timeLeft / 60);
        let sec = timeLeft % 60;
        document.getElementById('timer').innerText = `${min < 10 ? '0'+min : min}:${sec < 10 ? '0'+sec : sec}`;

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            finishGameSess();
        }
        timeLeft--;
    }, 1000);
}

document.getElementById('guess-btn').addEventListener('click', () => {
    const userGuess = parseInt(guessInput.value);
    if (isNaN(userGuess) || guessInput.value === "") {
        feedback.innerText = "Masukkan angka terlebih dahulu!";
        feedback.style.color = "#ff3333";
        return;
    }

    if (userGuess === secretNumber) {
        feedback.innerText = "🎉 Benar! Angka rahasia di-acak kembali.";
        feedback.style.color = "#00ffcc";
        sessionCorrect++;
        secretNumber = Math.floor(Math.random() * maxNumber) + 1;
    } else if (userGuess < secretNumber) {
        feedback.innerText = "❌ Tebakan terlalu KECIL!";
        feedback.style.color = "#ff3366";
        sessionWrong++;
    } else {
        feedback.innerText = "❌ Tebakan terlalu BESAR!";
        feedback.style.color = "#ff3366";
        sessionWrong++;
    }
    guessInput.value = "";
    guessInput.focus();
});

// Sesi Game Berakhir & Akumulasi Data Ke Cloud Firestore
async function finishGameSess() {
    switchPage('result');
    document.getElementById('session-correct').innerText = sessionCorrect;
    document.getElementById('session-wrong').innerText = sessionWrong;

    // Kalkulasi nilai total akumulasi
    userData.totalCorrect = (userData.totalCorrect || 0) + sessionCorrect;
    userData.totalWrong = (userData.totalWrong || 0) + sessionWrong;

    // Kirim data ter-update ke server
    await updateDoc(doc(db, "users", currentUser.uid), {
        totalCorrect: userData.totalCorrect,
        totalWrong: userData.totalWrong
    });
}

document.getElementById('finish-game-btn').addEventListener('click', () => {
    switchPage('menu');
});
