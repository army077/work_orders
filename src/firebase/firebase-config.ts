// Import the functions you need from the SDKs you need
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';


const firebaseConfig = {
  apiKey: "AIzaSyBGB6jHNXRKIif9vUSR6ogtDIcCJpnqCrU",
  authDomain: "ordentrabajoar.firebaseapp.com",
  projectId: "ordentrabajoar",
  storageBucket: "ordentrabajoar.appspot.com",
  messagingSenderId: "256484787693",
  appId: "1:256484787693:web:3a920d95ba0fd2886953e4"
};

// Use this to initialize the firebase App
// Inicializa Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;