import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { isIOSSafari } from "./deviceDetect";

const firebaseConfig = {
  apiKey: "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE",
  authDomain: "stageverify-db.firebaseapp.com",
  projectId: "stageverify-db",
  storageBucket: "stageverify-db.firebasestorage.app",
  messagingSenderId: "784751243681",
  appId: "1:784751243681:web:31fa71762b94f878fd1be0",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/** iOS Safari often hangs on Firestore WebChannel — long polling is more reliable. */
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: isIOSSafari(),
});
export const functions = getFunctions(app, "us-central1");
