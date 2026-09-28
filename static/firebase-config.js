// Firebase Configuration and Initialization
const firebaseConfig = {
  apiKey: "AIzaSyA5FuIT0NoUGLnJb0BI2C6z1UG590dHttM",
  authDomain: "entreprenuership-software.firebaseapp.com",
  projectId: "entreprenuership-software",
  storageBucket: "entreprenuership-software.firebasestorage.app",
  messagingSenderId: "103772890432",
  appId: "1:103772890432:web:30cbb3092724788ec986a5",
  measurementId: "G-9MWFE413N2"
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Export to window for global access
window.firebaseAuth = auth;
window.firestoreDb = db;
