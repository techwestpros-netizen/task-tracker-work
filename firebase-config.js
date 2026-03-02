// Firebase configuration (Updated)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyAYW9gEZOpNjhCGhyXaUbIGDIHThQY1tmo",
  authDomain: "task-list-80827.firebaseapp.com",
  projectId: "task-list-80827",
  storageBucket: "task-list-80827.firebasestorage.app",
  messagingSenderId: "576934957722",
  appId: "1:576934957722:web:c3818bf7a594d052740523"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
