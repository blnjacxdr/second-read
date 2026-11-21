// Paste your web app's config from the Firebase console:
// Project settings > General > Your apps > (web app) > SDK setup and configuration > Config.
//
// These values are not secrets (they identify the project; App Check is what
// protects it), so this file is committed. The App Check DEBUG token is a
// secret and is never stored in this repo.
export const firebaseConfig = {
  apiKey: 'AIzaSyBjuBGvtHMXZvEAtHD_lFuE546GYbxJoGc',
  authDomain: 'second-read-e022c.firebaseapp.com',
  projectId: 'second-read-e022c',
  storageBucket: 'second-read-e022c.firebasestorage.app',
  messagingSenderId: '476319821403',
  appId: '1:476319821403:web:9e041b3070c786962c197e',
};

// Fraud Defense (reCAPTCHA Enterprise) key ID, from Google Cloud console >
// Fraud Defense > second-read-web. Public by design; it is also registered in
// Firebase > Security > App Check > Apps.
export const recaptchaSiteKey = '6Let0CouAAAAAN9gGnBBKs8MbA6zDp4IcTxQT68Q';
