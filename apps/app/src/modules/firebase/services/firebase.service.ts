import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyBSbL7P-NWThEMI2xXf0UXhWFoDzv7eX3g',
  authDomain: 'wallex-fde93.firebaseapp.com',
  projectId: 'wallex-fde93',
  storageBucket: 'wallex-fde93.appspot.com',
  messagingSenderId: '183744805969',
  appId: '1:183744805969:web:efef93c5220c169c478c70',
  measurementId: 'G-B8PFR53CKJ',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

googleProvider.addScope('https://www.googleapis.com/auth/gmail.readonly');

export default { auth, googleProvider, signInWithPopup };
