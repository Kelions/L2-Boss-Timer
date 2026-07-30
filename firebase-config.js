/**
 * firebase-config.js
 *
 * PASO A SEGUIR:
 * 1. Creá un proyecto en https://console.firebase.google.com
 * 2. Activá "Realtime Database" (Compilación → Realtime Database → Crear base de datos)
 * 3. Registrá una app Web (ícono </>) y copiá el objeto de configuración que te dan.
 * 4. Reemplazá los valores de acá abajo por los tuyos (los 7 campos).
 *
 * Si dejás los valores de ejemplo tal cual están, la app sigue funcionando
 * igual que antes (solo LocalStorage, sin sincronizar entre dispositivos) —
 * no se rompe nada, simplemente no hay backend conectado todavía.
 */

const firebaseConfig = {
  apiKey: "AIzaSyDYallZpMlOixGnpURR67K6XAxxBzegTAk",
  authDomain: "lineage-2-boss-timer.firebaseapp.com",
  databaseURL: "https://lineage-2-boss-timer-default-rtdb.firebaseio.com",
  projectId: "lineage-2-boss-timer",
  storageBucket: "lineage-2-boss-timer.firebasestorage.app",
  messagingSenderId: "532481374171",
  appId: "1:532481374171:web:7be1b554f0f83052d559fe",
};

// No editar debajo de esta línea: detecta si el config de arriba sigue
// siendo el de ejemplo, para que el resto de la app sepa si debe (o no)
// intentar conectarse a Firebase.
const FIREBASE_CONFIGURED = firebaseConfig.apiKey !== "TU_API_KEY" && !!firebaseConfig.databaseURL;
