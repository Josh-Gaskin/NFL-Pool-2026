// ---------------------------------------------------------------
// Fill this in with YOUR Firebase project's config.
// Firebase console -> Project settings -> General -> Your apps -> SDK setup and config
// This is safe to make public (it's not a secret key) — access is controlled
// by Firestore Security Rules and Firebase Auth, not by hiding this object.
// ---------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBc9RvkloSCBNMkBysYv9sQqOItSO8rN3k",
  authDomain: "nfl-pool-2026.firebaseapp.com",
  projectId: "nfl-pool-2026",
  storageBucket: "nfl-pool-2026.firebasestorage.app",
  messagingSenderId: "266523790016",
  appId: "1:266523790016:web:05e13c2db53b4645e87b25",
  measurementId: "G-007L7CFEEP"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// The season this pool covers. Update each year.
const SEASON_YEAR = 2026;

// ---------------------------------------------------------------
// Admin login. The Admin tab only ever shows a 4-digit PIN box — but under
// the hood it signs in to a fixed Firebase account so Firestore's Security
// Rules can enforce write access. This constant email is never shown in
// the UI; it just needs to match the rule in your Firestore Rules tab.
// Pick any address you like (it doesn't need to be real/receive mail),
// just keep it identical here and in your Firestore rule.
// ---------------------------------------------------------------
const ADMIN_EMAIL = "commissioner@nflpool.local";

// Turns a 4-digit PIN into a Firebase-valid password (min 6 characters).
// This is obscurity, not real secrecy — the real protection is that only
// someone who knows the PIN can sign in as ADMIN_EMAIL, and Firestore
// Rules only grant write access to that exact signed-in account.
function pinToPassword(pin) {
  return `pool-pin-${pin}`;
}
