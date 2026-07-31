# Conectar L2 Raid Boss Timer a Firebase (base de datos compartida)

Esta app puede funcionar de dos formas:

1. **Modo local** (por defecto): cada persona que abre la página tiene sus
   propios bosses/timers guardados en el navegador (LocalStorage). Nadie
   comparte datos con nadie.
2. **Modo conectado**: todos los que entran a la misma página ven los mismos
   bosses y timers, actualizándose solos en tiempo real (ideal para un clan).

## Paso a paso

1. Andá a https://console.firebase.google.com y creá un proyecto nuevo
   (no hace falta activar Google Analytics).
2. En el menú lateral: **Compilación → Realtime Database → Crear base de datos**.
   - Elegí cualquier ubicación.
   - En "Reglas de seguridad" arrancá con **Modo de prueba** (después las
     cambiás por las de abajo, para que no quede abierta para siempre).
3. **Configuración del proyecto** (ícono de tuerca, arriba a la izquierda) →
   scrolleá hasta "Tus apps" → click en el ícono **`</>`** (Web) → registrá
   la app (el nombre da igual, no hace falta Firebase Hosting).
4. Te va a mostrar un objeto `firebaseConfig` con 7 campos
   (`apiKey`, `authDomain`, `databaseURL`, etc.) — copialos.
5. Abrí el archivo **`firebase-config.js`** de este proyecto y pegá esos
   valores reemplazando los que dicen `TU_API_KEY`, `TU_PROYECTO`, etc.
6. Subí de nuevo la carpeta a Vercel (o hacé `vercel --prod` si ya la tenías
   conectada por CLI/Git). Listo — al abrir la página vas a ver en la barra
   superior un punto verde "Sincronizado" en vez de "Modo local".

## Reglas de seguridad recomendadas (después del modo de prueba)

El modo de prueba deja leer y escribir a cualquiera durante 30 días y
después bloquea todo. Para dejarlo funcionando de forma permanente pero
sin abrir la base de datos a cualquiera de internet, en Firebase Console →
Realtime Database → pestaña **Reglas**, pegá esto:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Esto mantiene el mismo comportamiento del modo de prueba (cualquiera con el
link puede leer/escribir), útil si tu clan simplemente comparte la URL de
Vercel entre ustedes y no les preocupa que en teoría cualquiera con el link
exacto de Firebase podría escribir ahí directamente (no solo desde tu app).

### Si más adelante querés restringirlo con contraseña de clan

Se puede agregar autenticación simple (por ejemplo, un código de acceso
compartido) para que solo quien lo tenga pueda leer/escribir. Si querés
eso, avisame y lo agregamos — no lo incluí por defecto para no complicar
la puesta en marcha inicial.
