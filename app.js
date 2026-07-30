/**
 * app.js
 * L2 Raid Boss Timer — lógica principal de la aplicación.
 *
 * Arquitectura (todo en Vanilla JS ES6, sin frameworks):
 *   - Storage:   capa de persistencia sobre LocalStorage.
 *   - State:     estado en memoria (bosses + timers + filtros + UI).
 *   - Render:    funciones puras que dibujan el DOM a partir del estado.
 *   - Actions:   funciones que mutan el estado y disparan un re-render.
 *   - Events:    listeners que conectan la UI con las Actions.
 *
 * Todo el archivo se organiza en un único IIFE para no ensuciar el scope
 * global, salvo el objeto RAID_BOSS_SEED que llega desde bosses.js.
 */

(() => {
  'use strict';

  /* ============================================================
     1. CONSTANTES Y CLAVES DE STORAGE
     ============================================================ */
  const LS_KEYS = {
    // v2: se sube de versión para forzar un arranque limpio (sin las cards de
    // ejemplo de versiones anteriores que hayan quedado guardadas en el
    // navegador del usuario bajo las claves v1).
    DB: 'l2rbt_bosses_db_v2',        // base de datos de bosses (editable, 100% a cargo del usuario)
    TIMERS: 'l2rbt_timers_v2',       // timers activos por boss id
    FAVORITES: 'l2rbt_favorites_v2', // set de ids favoritos
    HISTORY: 'l2rbt_history_v2',     // historial de cambios por boss id
    SETTINGS: 'l2rbt_settings_v2',   // preferencias (sonido, notif, filtro/orden)
  };

  const FILTERS = { ALL: 'all', ACTIVE: 'active', AVAILABLE: 'available', UPCOMING: 'upcoming', FAVORITES: 'favorites' };
  const WARN_THRESHOLD_MIN = 15; // minutos: por debajo de esto -> amarillo
  const DANGER_THRESHOLD_MIN = 5; // minutos: por debajo de esto -> rojo
  const NOTIFY_BEFORE_MIN = 5;    // notificar cuando faltan 5 minutos

  /* ============================================================
     2. CAPA DE STORAGE (LocalStorage)
     ============================================================ */
  const Storage = {
    /** Lee y parsea JSON de una key, devolviendo fallback si no existe o falla. */
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.warn(`[Storage] Error leyendo ${key}:`, e);
        return fallback;
      }
    },
    /** Serializa y guarda un valor bajo una key. */
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.error(`[Storage] Error guardando ${key}:`, e);
        return false;
      }
    },
    remove(key) { localStorage.removeItem(key); },
  };

  /* ============================================================
     3. ESTADO GLOBAL EN MEMORIA
     ============================================================ */
  const state = {
    bosses: [],          // array completo de bosses (DB editable)
    timers: {},          // { [bossId]: { announceAt, spawnAt, respawnMinutes, updatedAt } }
    favorites: new Set(),// ids favoritos
    history: {},         // { [bossId]: [{announceAt, spawnAt, modifiedAt}, ...] }
    settings: {
      soundEnabled: true,
      notifyEnabled: true,
      filter: FILTERS.ALL,
      searchQuery: '',
    },
    ui: {
      selectedBossForRegister: null, // boss elegido en el modal de registro
      registerMode: 'now',           // 'now' | 'manual'
      editingBossId: null,           // boss cuya card se está editando (hora)
      adminEditingId: null,          // boss id en edición dentro del admin
    },
  };

  /* ============================================================
     4. UTILIDADES GENERALES
     ============================================================ */
  const Utils = {
    /** Slug simple para nombres de archivo / búsquedas normalizadas. */
    slugify(str) {
      return str
        .toString()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    },
    /** Normaliza texto para comparación de búsqueda (sin acentos, minúsculas). */
    normalize(str) {
      return str.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    },
    pad2(n) { return n.toString().padStart(2, '0'); },
    /** Devuelve "Lv85" o "Lv?" si el boss no tiene nivel definido (campo opcional). */
    levelLabel(level) {
      return (level === null || level === undefined || level === '' || isNaN(level)) ? 'Lv?' : `Lv${level}`;
    },
    /** Devuelve la ubicación o un texto genérico si el boss no la tiene definida (campo opcional). */
    locationLabel(location) {
      return (location && location.trim()) ? location : 'Ubicación no especificada';
    },
    /** Formatea un timestamp (ms) a HH:MM. */
    formatTime(ts) {
      const d = new Date(ts);
      return `${Utils.pad2(d.getHours())}:${Utils.pad2(d.getMinutes())}`;
    },
    /** Formatea un timestamp a HH:MM DD/MM. */
    formatTimeShort(ts) {
      const d = new Date(ts);
      return `${Utils.pad2(d.getHours())}:${Utils.pad2(d.getMinutes())} · ${Utils.pad2(d.getDate())}/${Utils.pad2(d.getMonth() + 1)}`;
    },
    /** Formatea milisegundos restantes a HH:MM:SS (o D.HH:MM:SS si pasa de 24h). */
    formatCountdown(ms) {
      if (ms <= 0) return '00:00:00';
      const totalSec = Math.floor(ms / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      const seconds = totalSec % 60;
      if (days > 0) {
        return `${days}d ${Utils.pad2(hours)}:${Utils.pad2(minutes)}:${Utils.pad2(seconds)}`;
      }
      return `${Utils.pad2(hours)}:${Utils.pad2(minutes)}:${Utils.pad2(seconds)}`;
    },
    /** Devuelve timestamp (ms) sumando minutos a una fecha base. */
    addMinutes(baseTs, minutes) { return baseTs + minutes * 60 * 1000; },
    /** Construye un timestamp de "hoy" con hora/minuto HH:MM dados; si ya pasó, asume que fue hoy igual (el usuario puede estar cargando un anuncio pasado). */
    todayAt(hh, mm) {
      const now = new Date();
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
      return d.getTime();
    },
    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str ?? '';
      return div.innerHTML;
    },
    uid() { return Date.now() + Math.floor(Math.random() * 1000); },
    clamp(n, min, max) { return Math.max(min, Math.min(max, n)); },
    debounce(fn, wait) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
    },
    downloadJSON(filename, dataObj) {
      const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };

  /* ============================================================
     5. MÓDULO CLOUD: sincronización en tiempo real vía Firebase
     ============================================================
     Si firebase-config.js tiene un config real (FIREBASE_CONFIGURED === true),
     esta capa reemplaza a LocalStorage como fuente de verdad compartida para
     bosses/timers/favoritos/historial: todo dispositivo conectado ve los
     mismos datos y se actualiza solo cuando alguien más hace un cambio.
     Si no está configurado, Cloud.enabled queda en false y toda la app sigue
     funcionando exactamente igual que antes (100% LocalStorage, por dispositivo).
     Las preferencias personales (sonido, notificaciones, filtro, búsqueda)
     NO se sincronizan a propósito: son de cada usuario, no del clan.
  */
  const Cloud = {
    enabled: false,
    db: null,
    refs: {},

    /** Intenta inicializar Firebase. Devuelve true/false según haya quedado activo. */
    init() {
      const configured = typeof FIREBASE_CONFIGURED !== 'undefined' && FIREBASE_CONFIGURED;
      if (!configured || typeof firebase === 'undefined') {
        Cloud.enabled = false;
        Cloud._setStatus('offline', 'Modo local (sin Firebase)');
        return false;
      }
      try {
        firebase.initializeApp(firebaseConfig);
        Cloud.db = firebase.database();
        Cloud.refs = {
          bosses: Cloud.db.ref('bosses'),
          timers: Cloud.db.ref('timers'),
          favorites: Cloud.db.ref('favorites'),
          history: Cloud.db.ref('history'),
        };
        Cloud.enabled = true;
        Cloud.db.ref('.info/connected').on('value', (snap) => {
          Cloud._setStatus(snap.val() === true ? 'online' : 'offline',
            snap.val() === true ? 'Sincronizado' : 'Sin conexión (reintentando…)');
        });
        return true;
      } catch (e) {
        console.error('[Cloud] Error inicializando Firebase:', e);
        Cloud.enabled = false;
        Cloud._setStatus('offline', 'Error de conexión a Firebase');
        return false;
      }
    },

    _setStatus(kind, text) {
      const txt = document.getElementById('syncStatusText');
      const pill = document.getElementById('syncStatusPill');
      if (!txt || !pill) return;
      txt.textContent = text;
      const icon = pill.querySelector('i');
      if (kind === 'online') icon.outerHTML = '<i class="fa-solid fa-circle" style="color:#4caf6b;font-size:0.55rem;"></i>';
      else if (kind === 'offline') icon.outerHTML = '<i class="fa-solid fa-circle" style="color:#d9483b;font-size:0.55rem;"></i>';
      else icon.outerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    },

    /** Se suscribe a los 4 nodos compartidos; onUpdate se llama cada vez que
     *  llega un cambio (propio o de otro dispositivo) y ya viene con el
     *  `state` global actualizado — sólo hay que re-renderizar. */
    subscribe(onUpdate) {
      if (!Cloud.enabled) return;
      Cloud.refs.bosses.on('value', (snap) => {
        const val = snap.val();
        state.bosses = val ? Object.values(val) : [];
        onUpdate();
      });
      Cloud.refs.timers.on('value', (snap) => {
        state.timers = snap.val() || {};
        onUpdate();
      });
      Cloud.refs.favorites.on('value', (snap) => {
        const val = snap.val() || {};
        state.favorites = new Set(Object.keys(val).filter(id => val[id]).map(Number));
        onUpdate();
      });
      Cloud.refs.history.on('value', (snap) => {
        state.history = snap.val() || {};
      });
    },

    // Escrituras: guardamos por id (objeto), no por índice de array, para
    // que borrar un elemento del medio no genere "huecos" en Firebase.
    pushBosses(arr) {
      if (!Cloud.enabled) return;
      const obj = {};
      arr.forEach(b => { obj[b.id] = b; });
      Cloud.refs.bosses.set(obj);
    },
    pushTimers(obj) { if (Cloud.enabled) Cloud.refs.timers.set(obj); },
    pushFavorites(set) {
      if (!Cloud.enabled) return;
      const obj = {};
      set.forEach(id => { obj[id] = true; });
      Cloud.refs.favorites.set(obj);
    },
    pushHistory(obj) { if (Cloud.enabled) Cloud.refs.history.set(obj); },
  };

  /* ============================================================
     6. CAPA DE DATOS: carga inicial y helpers de acceso
     ============================================================ */
  const Data = {
    /** Carga la DB de bosses: si ya existe en LocalStorage la usa (permite
     *  ediciones del admin persistidas); si no, la siembra desde bosses.js.
     *  Solo se usa cuando Cloud NO está habilitado (ver App.init). */
    loadBossDB() {
      const saved = Storage.get(LS_KEYS.DB, null);
      if (saved && Array.isArray(saved) && saved.length > 0) {
        state.bosses = saved;
      } else {
        state.bosses = RAID_BOSS_SEED.map(b => ({ ...b }));
        Storage.set(LS_KEYS.DB, state.bosses);
      }
    },
    saveBossDB() {
      Storage.set(LS_KEYS.DB, state.bosses);
      Cloud.pushBosses(state.bosses);
    },

    loadTimers() { state.timers = Storage.get(LS_KEYS.TIMERS, {}); },
    saveTimers() {
      Storage.set(LS_KEYS.TIMERS, state.timers);
      Cloud.pushTimers(state.timers);
    },

    loadFavorites() { state.favorites = new Set(Storage.get(LS_KEYS.FAVORITES, [])); },
    saveFavorites() {
      Storage.set(LS_KEYS.FAVORITES, Array.from(state.favorites));
      Cloud.pushFavorites(state.favorites);
    },

    loadHistory() { state.history = Storage.get(LS_KEYS.HISTORY, {}); },
    saveHistory() {
      Storage.set(LS_KEYS.HISTORY, state.history);
      Cloud.pushHistory(state.history);
    },

    loadSettings() {
      const saved = Storage.get(LS_KEYS.SETTINGS, null);
      if (saved) Object.assign(state.settings, saved);
    },
    saveSettings() { Storage.set(LS_KEYS.SETTINGS, state.settings); },

    getBossById(id) { return state.bosses.find(b => b.id === Number(id)); },

    /** Agrega una entrada al historial de un boss (se mantienen últimas 20). */
    pushHistory(bossId, entry) {
      if (!state.history[bossId]) state.history[bossId] = [];
      state.history[bossId].unshift({ ...entry, modifiedAt: Date.now() });
      state.history[bossId] = state.history[bossId].slice(0, 20);
      Data.saveHistory();
    },
  };

  /* ============================================================
     6. MÓDULO DE TIMERS: registrar, calcular estado, resetear
     ============================================================ */
  const Timer = {
    /** Registra un timer usando la hora actual + minutos de respawn. */
    registerNow(bossId, respawnMinutes) {
      const announceAt = Date.now();
      Timer._save(bossId, announceAt, respawnMinutes);
    },
    /** Registra un timer usando una hora manual (HH:MM) + minutos de respawn. */
    registerManual(bossId, hh, mm, respawnMinutes) {
      const announceAt = Utils.todayAt(hh, mm);
      Timer._save(bossId, announceAt, respawnMinutes);
    },
    _save(bossId, announceAt, respawnMinutes) {
      const spawnAt = Utils.addMinutes(announceAt, respawnMinutes);
      state.timers[bossId] = {
        announceAt, spawnAt, respawnMinutes,
        updatedAt: Date.now(),
        notified5: false, notifiedUp: false,
      };
      Data.saveTimers();
      Data.pushHistory(bossId, { announceAt, spawnAt });
    },
    /** Elimina el timer de un boss (vuelve a "sin registrar"). */
    clear(bossId) {
      delete state.timers[bossId];
      Data.saveTimers();
    },
    /** Elimina TODOS los timers activos. */
    clearAll() {
      state.timers = {};
      Data.saveTimers();
    },
    get(bossId) { return state.timers[bossId] || null; },

    /** Calcula el estado visual/temporal de un boss en este instante. */
    computeStatus(bossId) {
      const timer = Timer.get(bossId);
      if (!timer) return { registered: false, state: 'unregistered', remainingMs: null };
      const remainingMs = timer.spawnAt - Date.now();
      let s;
      if (remainingMs <= 0) s = 'up';
      else if (remainingMs <= DANGER_THRESHOLD_MIN * 60 * 1000) s = 'danger';
      else if (remainingMs <= WARN_THRESHOLD_MIN * 60 * 1000) s = 'warn';
      else s = 'safe';
      return { registered: true, state: s, remainingMs, timer };
    },
  };

  /* ============================================================
     7. MÓDULO DE NOTIFICACIONES (navegador + sonido)
     ============================================================ */
  const Notify = {
    permissionRequested: false,

    async requestPermission() {
      if (!('Notification' in window)) return 'unsupported';
      if (Notification.permission === 'granted' || Notification.permission === 'denied') {
        return Notification.permission;
      }
      const perm = await Notification.requestPermission();
      return perm;
    },

    show(title, body, icon) {
      if (!state.settings.notifyEnabled) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        new Notification(title, { body, icon: icon || 'img/bosses/golkonda.svg', silent: false });
      } catch (e) { console.warn('[Notify] No se pudo mostrar la notificación:', e); }
    },

    /** Reproduce la alarma sonora (si está habilitada). */
    playAlarm() {
      if (!state.settings.soundEnabled) return;
      const audio = document.getElementById('alarmAudio');
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => { /* autoplay bloqueado hasta primera interacción del usuario */ });
      }
    },

    /** Revisa todos los timers activos y dispara notificaciones/alarma cuando corresponde. */
    tick() {
      Object.keys(state.timers).forEach(bossIdStr => {
        const bossId = Number(bossIdStr);
        const timer = state.timers[bossId];
        const boss = Data.getBossById(bossId);
        if (!timer || !boss) return;
        const remainingMs = timer.spawnAt - Date.now();

        // Notificación a los 5 minutos.
        if (!timer.notified5 && remainingMs <= NOTIFY_BEFORE_MIN * 60 * 1000 && remainingMs > 0) {
          timer.notified5 = true;
          Notify.show('⏳ Raid Boss por aparecer', `${boss.name} aparece en ${NOTIFY_BEFORE_MIN} minutos.`, boss.image);
          Data.saveTimers();
        }
        // Notificación + alarma al llegar a cero.
        if (!timer.notifiedUp && remainingMs <= 0) {
          timer.notifiedUp = true;
          Notify.show('💀 ¡Raid Boss disponible!', `${boss.name} ¡¡DISPONIBLE!!`, boss.image);
          Notify.playAlarm();
          Data.saveTimers();
        }
      });
    },
  };

  /* ============================================================
     8. MÓDULO DE BÚSQUEDA, FILTROS Y ORDEN
     ============================================================ */
  const Query = {
    /** Devuelve bosses que matchean el texto de búsqueda (por nombre o ubicación). */
    search(bosses, query) {
      const q = Utils.normalize(query || '');
      if (!q) return bosses;
      return bosses.filter(b =>
        Utils.normalize(b.name).includes(q) || Utils.normalize(b.location).includes(q)
      );
    },

    /** Aplica el filtro activo (Todos/Activos/Disponibles/Próximos/Favoritos). */
    filter(bosses, filterKey) {
      switch (filterKey) {
        case FILTERS.ACTIVE:
          return bosses.filter(b => Timer.computeStatus(b.id).registered && Timer.computeStatus(b.id).state !== 'up');
        case FILTERS.AVAILABLE:
          return bosses.filter(b => Timer.computeStatus(b.id).state === 'up');
        case FILTERS.UPCOMING:
          return bosses.filter(b => {
            const st = Timer.computeStatus(b.id);
            return st.registered && (st.state === 'warn' || st.state === 'danger');
          });
        case FILTERS.FAVORITES:
          return bosses.filter(b => state.favorites.has(b.id));
        case FILTERS.ALL:
        default:
          return bosses;
      }
    },

    /** Ordena: primero los que aparecerán antes (registrados), luego disponibles arriba de todo, luego sin registrar al final por nombre. */
    sort(bosses) {
      return [...bosses].sort((a, b) => {
        const sa = Timer.computeStatus(a.id);
        const sb = Timer.computeStatus(b.id);
        const rank = (s) => (s.state === 'up' ? 0 : s.registered ? 1 : 2);
        const ra = rank(sa), rb = rank(sb);
        if (ra !== rb) return ra - rb;
        if (ra === 1) return sa.remainingMs - sb.remainingMs; // antes de aparecer: el más próximo primero
        return a.name.localeCompare(b.name);
      });
    },

    /** Pipeline completo: buscar -> filtrar -> ordenar. */
    run() {
      let list = state.bosses;
      list = Query.search(list, state.settings.searchQuery);
      list = Query.filter(list, state.settings.filter);
      list = Query.sort(list);
      return list;
    },

    counts() {
      return {
        all: state.bosses.length,
        active: state.bosses.filter(b => { const s = Timer.computeStatus(b.id); return s.registered && s.state !== 'up'; }).length,
        available: state.bosses.filter(b => Timer.computeStatus(b.id).state === 'up').length,
        upcoming: state.bosses.filter(b => { const s = Timer.computeStatus(b.id); return s.registered && (s.state === 'warn' || s.state === 'danger'); }).length,
        favorites: state.bosses.filter(b => state.favorites.has(b.id)).length,
      };
    },
  };

  /* ============================================================
     9. MÓDULO DE RENDERIZADO
     ============================================================ */
  const Render = {
    /** Dibuja el reloj de la barra superior. */
    clock() {
      const el = document.getElementById('liveClock');
      if (el) el.textContent = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },

    /** Actualiza el pill de "bosses activos" en la topbar. */
    statPill() {
      const el = document.getElementById('activeCountPill');
      if (!el) return;
      const c = Query.counts();
      el.innerHTML = `<strong>${c.active}</strong> activos &nbsp;·&nbsp; <strong>${c.available}</strong> disponibles`;
    },

    /** Actualiza los botones de filtro con sus contadores. */
    filters() {
      const c = Query.counts();
      const map = {
        [FILTERS.ALL]: c.all, [FILTERS.ACTIVE]: c.active, [FILTERS.AVAILABLE]: c.available,
        [FILTERS.UPCOMING]: c.upcoming, [FILTERS.FAVORITES]: c.favorites,
      };
      document.querySelectorAll('.l2-filter-btn').forEach(btn => {
        const key = btn.dataset.filter;
        btn.classList.toggle('active', key === state.settings.filter);
        const badge = btn.querySelector('.badge-count');
        if (badge) badge.textContent = map[key] ?? 0;
      });
    },

    /** Construye el HTML de una sola card de boss. */
    cardHTML(boss) {
      const status = Timer.computeStatus(boss.id);
      const isFav = state.favorites.has(boss.id);
      const stateClass = status.registered ? `state-${status.state}` : 'state-unregistered';

      let timesBlock, countdownBlock, progressPct = 0, actionsExtra = '';

      if (status.registered) {
        const timer = status.timer;
        const totalMs = timer.spawnAt - timer.announceAt;
        const elapsedMs = Date.now() - timer.announceAt;
        progressPct = Utils.clamp(100 - (status.remainingMs / totalMs) * 100, 0, 100);
        // La barra representa "cuánto falta": llena al announce, vacía al spawn.
        const remainingPct = Utils.clamp((status.remainingMs / totalMs) * 100, 0, 100);

        timesBlock = `
          <div class="boss-card__times">
            <div class="boss-card__time-box">
              <div class="boss-card__time-label">Hora anuncio</div>
              <div class="boss-card__time-value">${Utils.formatTime(timer.announceAt)}</div>
            </div>
            <div class="boss-card__time-box">
              <div class="boss-card__time-label">Hora aparición</div>
              <div class="boss-card__time-value">${Utils.formatTime(timer.spawnAt)}</div>
            </div>
          </div>`;

        countdownBlock = `
          <div class="boss-card__up-banner"><i class="fa-solid fa-skull-crossbones me-1"></i> ¡¡DISPONIBLE!!</div>
          <div class="boss-card__countdown">
            <div class="boss-card__countdown-value">${status.state === 'up' ? '¡¡DISPONIBLE!!' : Utils.formatCountdown(status.remainingMs)}</div>
          </div>
          <div class="boss-card__progress">
            <div class="boss-card__progress-bar" style="width:${status.state === 'up' ? 100 : remainingPct}%"></div>
          </div>`;

        actionsExtra = `
          <button class="btn-icon-l2" data-action="edit" data-id="${boss.id}" data-bs-toggle="tooltip" title="Editar hora">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon-l2" data-action="reset" data-id="${boss.id}" data-bs-toggle="tooltip" title="Reiniciar con hora actual">
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <button class="btn-icon-l2 btn-l2-danger" data-action="delete" data-id="${boss.id}" data-bs-toggle="tooltip" title="Eliminar timer">
            <i class="fa-solid fa-trash"></i>
          </button>`;
      } else {
        timesBlock = `
          <div class="boss-card__times">
            <div class="boss-card__time-box"><div class="boss-card__time-label">Hora anuncio</div><div class="boss-card__time-value">—:—</div></div>
            <div class="boss-card__time-box"><div class="boss-card__time-label">Hora aparición</div><div class="boss-card__time-value">—:—</div></div>
          </div>`;
        countdownBlock = `
          <div class="boss-card__countdown">
            <div class="boss-card__countdown-value">Sin registrar</div>
          </div>
          <div class="boss-card__progress"><div class="boss-card__progress-bar" style="width:0%"></div></div>`;
        actionsExtra = `
          <button class="btn-icon-l2 btn-l2-danger" data-action="delete" data-id="${boss.id}" data-bs-toggle="tooltip" title="Quitar de la lista (no aplica)" disabled style="visibility:hidden;">
            <i class="fa-solid fa-trash"></i>
          </button>`;
      }

      return `
        <div class="boss-card ${stateClass}" data-boss-id="${boss.id}" data-name="${Utils.escapeHtml(Utils.normalize(boss.name))}">
          <div class="boss-card__media">
            <img src="${boss.image}" alt="${Utils.escapeHtml(boss.name)}" loading="lazy"
                 onerror="this.onerror=null;this.src='img/bosses/placeholder.svg';">
            <span class="boss-card__level">${Utils.levelLabel(boss.level)}</span>
            <button class="boss-card__fav ${isFav ? 'is-fav' : ''}" data-action="fav" data-id="${boss.id}"
                    data-bs-toggle="tooltip" title="${isFav ? 'Quitar de favoritos' : 'Marcar favorito'}">
              <i class="fa-${isFav ? 'solid' : 'regular'} fa-star"></i>
            </button>
            <div class="boss-card__name-overlay">${Utils.escapeHtml(boss.name)}</div>
          </div>
          <div class="boss-card__body">
            <div class="boss-card__loc"><i class="fa-solid fa-location-dot"></i> ${Utils.escapeHtml(Utils.locationLabel(boss.location))}</div>
            ${timesBlock}
            ${countdownBlock}
            ${status.registered ? '' : `
            <div class="boss-card__register">
              <button class="btn-l2 flex-fill" data-action="register-now" data-id="${boss.id}">
                <i class="fa-solid fa-clock"></i> Registrar ahora
              </button>
              <button class="btn-l2 flex-fill" data-action="register-manual" data-id="${boss.id}">
                <i class="fa-solid fa-pen-clock"></i> Elegir hora
              </button>
            </div>`}
            <div class="boss-card__actions">
              ${actionsExtra}
              <button class="btn-icon-l2" data-action="map" data-id="${boss.id}" data-bs-toggle="tooltip" title="Ver mapa">
                <i class="fa-solid fa-map-location-dot"></i>
              </button>
            </div>
          </div>
        </div>`;
    },

    /** Redibuja el grid completo de bosses según búsqueda/filtro/orden actuales. */
    grid() {
      const grid = document.getElementById('bossGrid');
      const list = Query.run();
      if (list.length === 0) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1;">
            <i class="fa-solid fa-ghost"></i>
            <h4>Ningún Raid Boss encontrado</h4>
            <p>Probá con otro término de búsqueda o cambiá el filtro activo.</p>
          </div>`;
      } else {
        grid.innerHTML = list.map(Render.cardHTML).join('');
      }
      Render.initTooltips();
    },

    /** Actualiza SOLO los números que cambian cada segundo (countdown/progreso/colores), sin re-renderizar todo el grid (evita perder foco/scroll). */
    tickCountdowns() {
      document.querySelectorAll('.boss-card').forEach(card => {
        const id = Number(card.dataset.bossId);
        const status = Timer.computeStatus(id);
        const valueEl = card.querySelector('.boss-card__countdown-value');
        const barEl = card.querySelector('.boss-card__progress-bar');
        if (!status.registered) return;

        const newStateClass = `state-${status.state}`;
        if (!card.classList.contains(newStateClass)) {
          // Cambió de estado (ej: safe -> warn, o warn -> up): re-render completo de esa card para
          // actualizar botones/badges correctamente.
          card.outerHTML = Render.cardHTML(Data.getBossById(id));
          return;
        }
        if (status.state === 'up') {
          if (valueEl) valueEl.textContent = '¡¡DISPONIBLE!!';
          if (barEl) barEl.style.width = '100%';
        } else {
          const timer = status.timer;
          const totalMs = timer.spawnAt - timer.announceAt;
          const remainingPct = Utils.clamp((status.remainingMs / totalMs) * 100, 0, 100);
          if (valueEl) valueEl.textContent = Utils.formatCountdown(status.remainingMs);
          if (barEl) barEl.style.width = `${remainingPct}%`;
        }
      });
      Render.statPill();
      Render.filters();
    },

    initTooltips() {
      document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => {
        const existing = bootstrap.Tooltip.getInstance(el);
        if (existing) existing.dispose();
        new bootstrap.Tooltip(el);
      });
    },

    /** Re-renderiza todo lo dependiente del estado (grid + topbar + filtros). */
    all() {
      Render.grid();
      Render.statPill();
      Render.filters();
    },
  };

  /* ============================================================
     10. MÓDULO DE MODALES
     ============================================================ */
  let registerModal, mapModal, editModal, adminModal, confirmModal, epicScheduleModal;

  const Modals = {
    init() {
      registerModal = new bootstrap.Modal('#registerModal');
      mapModal = new bootstrap.Modal('#mapModal');
      editModal = new bootstrap.Modal('#editModal');
      adminModal = new bootstrap.Modal('#adminModal');
      confirmModal = new bootstrap.Modal('#confirmModal');
      epicScheduleModal = new bootstrap.Modal('#epicScheduleModal');
    },

    /** Dibuja y abre el modal de horario fijo de épicos (server-specific, no usa Timer). */
    openEpicSchedule() {
      const tbody = document.getElementById('epicScheduleTableBody');
      tbody.innerHTML = EPIC_SCHEDULE_EIRIN_NEW.map(e => `
        <tr>
          <td>${Utils.escapeHtml(e.name)}</td>
          <td>Lv${e.level}</td>
          <td>${Utils.escapeHtml(e.days)}</td>
          <td style="font-family:'Courier New',monospace;">${Utils.escapeHtml(e.hours)}</td>
        </tr>`).join('');
      epicScheduleModal.show();
    },

    /** Abre el modal de registro de tiempo para un boss. Muestra su imagen real. */
    openRegister(bossId) {
      const boss = Data.getBossById(bossId);
      if (!boss) return;
      state.ui.selectedBossForRegister = boss;
      state.ui.registerMode = 'now';

      document.getElementById('registerBossName').textContent = boss.name;
      document.getElementById('registerBossLevel').textContent = Utils.levelLabel(boss.level);
      document.getElementById('registerBossLocation').textContent = Utils.locationLabel(boss.location);
      document.getElementById('registerBossImage').src = boss.image;
      document.getElementById('registerRespawnMinutes').value = boss.respawnMinutes;

      // Hora manual por defecto: ahora.
      const now = new Date();
      document.getElementById('manualTimeInput').value = `${Utils.pad2(now.getHours())}:${Utils.pad2(now.getMinutes())}`;

      Modals._selectRegisterMode('now');
      Modals._updateRegisterPreview();
      registerModal.show();
    },

    _selectRegisterMode(mode) {
      state.ui.registerMode = mode;
      document.getElementById('choiceNow').classList.toggle('selected', mode === 'now');
      document.getElementById('choiceManual').classList.toggle('selected', mode === 'manual');
      document.getElementById('radioNow').checked = mode === 'now';
      document.getElementById('radioManual').checked = mode === 'manual';
      document.getElementById('manualTimeInput').disabled = mode !== 'manual';
      Modals._updateRegisterPreview();
    },

    /** Recalcula y muestra en vivo "hora anuncio + respawn = hora aparición" dentro del modal. */
    _updateRegisterPreview() {
      const respawnMinutes = Number(document.getElementById('registerRespawnMinutes').value) || 30;
      let announceAt;
      if (state.ui.registerMode === 'now') {
        announceAt = Date.now();
      } else {
        const [hh, mm] = (document.getElementById('manualTimeInput').value || '00:00').split(':').map(Number);
        announceAt = Utils.todayAt(hh || 0, mm || 0);
      }
      const spawnAt = Utils.addMinutes(announceAt, respawnMinutes);
      document.getElementById('previewAnnounce').textContent = Utils.formatTime(announceAt);
      document.getElementById('previewSpawn').textContent = Utils.formatTime(spawnAt);
    },

    confirmRegister() {
      const boss = state.ui.selectedBossForRegister;
      if (!boss) return;
      const respawnMinutes = Utils.clamp(Number(document.getElementById('registerRespawnMinutes').value) || 30, 1, 100000);

      if (state.ui.registerMode === 'now') {
        Timer.registerNow(boss.id, respawnMinutes);
      } else {
        const [hh, mm] = (document.getElementById('manualTimeInput').value || '00:00').split(':').map(Number);
        Timer.registerManual(boss.id, hh || 0, mm || 0, respawnMinutes);
      }
      // Persistimos el respawnMinutes elegido como default del boss también.
      boss.respawnMinutes = respawnMinutes;
      Data.saveBossDB();

      registerModal.hide();
      Render.all();
      App.toast(`Timer registrado para ${boss.name}`, 'success');
    },

    /** Abre el modal de mapa para un boss (muestra imagen del mapa local). */
    openMap(bossId) {
      const boss = Data.getBossById(bossId);
      if (!boss) return;
      document.getElementById('mapModalTitle').textContent = `Mapa — ${boss.name}`;
      document.getElementById('mapModalImg').src = boss.map;
      document.getElementById('mapModalCoords').textContent = `X: ${boss.x}  Y: ${boss.y}  Z: ${boss.z}`;
      document.getElementById('mapModalLoc').textContent = Utils.locationLabel(boss.location);
      mapModal.show();
    },

    /** Abre el modal para editar la hora de anuncio de un timer ya registrado. */
    openEdit(bossId) {
      const boss = Data.getBossById(bossId);
      const timer = Timer.get(bossId);
      if (!boss || !timer) return;
      state.ui.editingBossId = bossId;
      document.getElementById('editBossName').textContent = boss.name;
      document.getElementById('editBossImage').src = boss.image;
      const d = new Date(timer.announceAt);
      document.getElementById('editTimeInput').value = `${Utils.pad2(d.getHours())}:${Utils.pad2(d.getMinutes())}`;
      document.getElementById('editRespawnMinutes').value = timer.respawnMinutes;
      Modals._updateEditPreview();
      editModal.show();
    },

    _updateEditPreview() {
      const [hh, mm] = (document.getElementById('editTimeInput').value || '00:00').split(':').map(Number);
      const respawnMinutes = Number(document.getElementById('editRespawnMinutes').value) || 30;
      const announceAt = Utils.todayAt(hh || 0, mm || 0);
      const spawnAt = Utils.addMinutes(announceAt, respawnMinutes);
      document.getElementById('editPreviewAnnounce').textContent = Utils.formatTime(announceAt);
      document.getElementById('editPreviewSpawn').textContent = Utils.formatTime(spawnAt);
    },

    confirmEdit() {
      const bossId = state.ui.editingBossId;
      const boss = Data.getBossById(bossId);
      if (!boss) return;
      const [hh, mm] = (document.getElementById('editTimeInput').value || '00:00').split(':').map(Number);
      const respawnMinutes = Utils.clamp(Number(document.getElementById('editRespawnMinutes').value) || 30, 1, 100000);
      Timer.registerManual(bossId, hh || 0, mm || 0, respawnMinutes);
      boss.respawnMinutes = respawnMinutes;
      Data.saveBossDB();
      editModal.hide();
      Render.all();
      App.toast(`Hora actualizada para ${boss.name}`, 'success');
    },

    /** Modal de confirmación genérico (para eliminar timer / limpiar todo / eliminar boss del admin). */
    confirm(message, onConfirm) {
      document.getElementById('confirmMessage').textContent = message;
      const btn = document.getElementById('confirmActionBtn');
      const newBtn = btn.cloneNode(true); // limpia listeners previos
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener('click', () => { onConfirm(); confirmModal.hide(); });
      confirmModal.show();
    },
  };

  /* ============================================================
     11. MÓDULO DE AUTOCOMPLETADO DE BÚSQUEDA (dropdown con miniatura)
     ============================================================ */
  const SearchDropdown = {
    activeIndex: -1,

    render(query) {
      const dropdown = document.getElementById('searchDropdown');
      const q = Utils.normalize(query);
      if (!q) { dropdown.classList.add('d-none'); dropdown.innerHTML = ''; return; }

      const matches = state.bosses.filter(b =>
        Utils.normalize(b.name).includes(q) || Utils.normalize(b.location).includes(q)
      ).slice(0, 8);

      if (matches.length === 0) {
        dropdown.innerHTML = `<div class="p-2 text-muted-l2 small">Sin coincidencias para "${Utils.escapeHtml(query)}"</div>`;
        dropdown.classList.remove('d-none');
        return;
      }

      dropdown.innerHTML = matches.map((b, i) => `
        <div class="search-result-item" data-id="${b.id}" data-index="${i}">
          <img src="${b.image}" alt="${Utils.escapeHtml(b.name)}" onerror="this.onerror=null;this.src='img/bosses/placeholder.svg';">
          <div class="flex-fill">
            <div>${Utils.escapeHtml(b.name)}</div>
            <div class="text-muted-l2" style="font-size:0.72rem;">${Utils.escapeHtml(Utils.locationLabel(b.location))}</div>
          </div>
          <span class="lvl-badge">${Utils.levelLabel(b.level)}</span>
        </div>`).join('');
      dropdown.classList.remove('d-none');
      SearchDropdown.activeIndex = -1;
    },

    hide() {
      document.getElementById('searchDropdown').classList.add('d-none');
    },
  };

  /* ============================================================
     12. MÓDULO DE ADMINISTRACIÓN (CRUD, import/export, backup)
     ============================================================ */
  const Admin = {
    open() {
      Admin.renderTable();
      Admin.resetForm();
      adminModal.show();
    },

    renderTable() {
      const tbody = document.getElementById('adminTableBody');
      const rows = [...state.bosses].sort((a, b) => a.name.localeCompare(b.name)).map(b => `
        <tr>
          <td><img src="${b.image}" onerror="this.onerror=null;this.src='img/bosses/placeholder.svg';" alt=""></td>
          <td>${Utils.escapeHtml(b.name)}</td>
          <td>${Utils.levelLabel(b.level)}</td>
          <td>${Utils.escapeHtml(Utils.locationLabel(b.location))}</td>
          <td>${b.respawnMinutes} min</td>
          <td class="text-end">
            <button class="btn-icon-l2" data-admin-action="edit" data-id="${b.id}" title="Editar" data-bs-toggle="tooltip"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon-l2 btn-l2-danger" data-admin-action="delete" data-id="${b.id}" title="Eliminar" data-bs-toggle="tooltip"><i class="fa-solid fa-trash"></i></button>
          </td>
        </tr>`).join('');
      tbody.innerHTML = rows || `<tr><td colspan="6" class="text-center text-muted-l2 py-4">No hay bosses cargados.</td></tr>`;
      Render.initTooltips();
    },

    resetForm() {
      state.ui.adminEditingId = null;
      document.getElementById('adminForm').reset();
      document.getElementById('adminFormTitle').textContent = 'Agregar nuevo Raid Boss';
      document.getElementById('adminBossId').value = '';
      document.getElementById('adminImagePreview').src = 'img/bosses/placeholder.svg';
      document.getElementById('adminMapPreview').src = 'img/bosses/placeholder.svg';
      document.getElementById('adminRespawnHours').value = '';
      document.getElementById('adminRespawnMinutes').value = '30';
      document.getElementById('adminAppearTime').value = '';
      document.getElementById('adminAppearTime').classList.add('d-none');
      Admin.updateAppearPreview();
      document.getElementById('adminSubmitBtn').innerHTML = '<i class="fa-solid fa-plus me-1"></i> Agregar Boss';
    },

    editBoss(id) {
      const boss = Data.getBossById(id);
      if (!boss) return;
      state.ui.adminEditingId = id;
      document.getElementById('adminFormTitle').textContent = `Editando: ${boss.name}`;
      document.getElementById('adminBossId').value = boss.id;
      document.getElementById('adminName').value = boss.name;
      document.getElementById('adminLevel').value = boss.level ?? '';
      document.getElementById('adminLocation').value = boss.location || '';
      document.getElementById('adminX').value = boss.x;
      document.getElementById('adminY').value = boss.y;
      document.getElementById('adminZ').value = boss.z;
      document.getElementById('adminRespawnHours').value = Math.floor((boss.respawnMinutes || 30) / 60) || '';
      // El select de minutos solo tiene 0/15/30/45 — redondeamos al más cercano
      // por si el boss tenía un valor "raro" (ej. importado de otro lado).
      const remainder = (boss.respawnMinutes || 30) % 60;
      const closestOptions = [0, 15, 30, 45];
      const closest = closestOptions.reduce((a, b) => Math.abs(b - remainder) < Math.abs(a - remainder) ? b : a);
      document.getElementById('adminRespawnMinutes').value = String(closest);
      document.getElementById('adminImagePreview').src = boss.image;
      document.getElementById('adminMapPreview').src = boss.map;
      document.getElementById('adminImagePreview').dataset.value = boss.image;
      document.getElementById('adminMapPreview').dataset.value = boss.map;
      // Si el boss ya tiene un timer activo, precargamos su hora de anuncio
      // para que se pueda corregir desde acá mismo.
      const existingTimer = Timer.get(id);
      const appearInput = document.getElementById('adminAppearTime');
      if (existingTimer) {
        appearInput.value = `${Utils.pad2(new Date(existingTimer.announceAt).getHours())}:${Utils.pad2(new Date(existingTimer.announceAt).getMinutes())}`;
        appearInput.classList.remove('d-none');
      } else {
        appearInput.value = '';
        appearInput.classList.add('d-none');
      }
      Admin.updateAppearPreview();
      document.getElementById('adminSubmitBtn').innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i> Guardar cambios';
      document.getElementById('adminFormPane').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },

    deleteBoss(id) {
      const boss = Data.getBossById(id);
      if (!boss) return;
      Modals.confirm(`¿Eliminar "${boss.name}" definitivamente? También se borrará su timer activo.`, () => {
        state.bosses = state.bosses.filter(b => b.id !== id);
        Timer.clear(id);
        state.favorites.delete(id);
        Data.saveBossDB(); Data.saveTimers(); Data.saveFavorites();
        Admin.renderTable();
        Render.all();
        App.toast(`"${boss.name}" eliminado`, 'danger');
      });
    },

    /** Convierte un <input type=file> de imagen a DataURL y lo mete en el preview correspondiente. */
    handleImageFile(inputEl, previewId) {
      const file = inputEl.files && inputEl.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById(previewId);
        img.src = e.target.result;
        img.dataset.value = e.target.result;
      };
      reader.readAsDataURL(file);
    },

    /** Actualiza el texto de ayuda bajo el campo de hora con la hora de
     *  aparición calculada en vivo (anuncio + respawn), o el texto genérico
     *  si todavía no se cargó una hora de anuncio. */
    updateAppearPreview() {
      const preview = document.getElementById('adminAppearPreview');
      const appearInput = document.getElementById('adminAppearTime');
      const appearTimeStr = appearInput.value;
      if (!appearTimeStr) {
        preview.textContent = 'Poné cuándo se anunció/mató el boss — la card calcula sola la hora de aparición sumando el respawn de arriba. "Kill ahora" usa la hora actual; "Elegir hora" te deja poner una hora manual.';
        return;
      }
      const [hh, mm] = appearTimeStr.split(':').map(Number);
      const respawnMinutes = Admin.getRespawnMinutesFromForm();
      const announceAt = Utils.todayAt(hh || 0, mm || 0);
      const spawnAt = Utils.addMinutes(announceAt, respawnMinutes);
      const h = Math.floor(respawnMinutes / 60), m = respawnMinutes % 60;
      preview.innerHTML = `Anuncio <strong class="text-gold">${appearTimeStr}</strong> + ${h}h ${m}min de respawn →
        aparece <strong class="text-gold">${Utils.formatTime(spawnAt)}</strong>.`;
    },

    /** Calcula los minutos totales de respawn a partir de los inputs de horas + minutos.
     *  Si ambos quedan vacíos, aplica el default de 30 minutos. */
    getRespawnMinutesFromForm() {
      const hours = Number(document.getElementById('adminRespawnHours').value) || 0;
      const minutes = Number(document.getElementById('adminRespawnMinutes').value) || 0;
      const total = hours * 60 + minutes;
      return Utils.clamp(total || 30, 1, 100000);
    },

    submitForm(e) {
      e.preventDefault();
      const name = document.getElementById('adminName').value.trim();
      const levelRaw = document.getElementById('adminLevel').value;
      const level = levelRaw === '' ? null : Number(levelRaw);
      const location = document.getElementById('adminLocation').value.trim();
      const x = Number(document.getElementById('adminX').value) || 0;
      const y = Number(document.getElementById('adminY').value) || 0;
      const z = Number(document.getElementById('adminZ').value) || 0;
      const respawnMinutes = Admin.getRespawnMinutesFromForm();
      const image = document.getElementById('adminImagePreview').dataset.value || 'img/bosses/placeholder.svg';
      const map = document.getElementById('adminMapPreview').dataset.value || 'img/bosses/placeholder.svg';

      if (!name) { App.toast('El nombre del boss es obligatorio', 'danger'); return; }

      let bossId;
      if (state.ui.adminEditingId) {
        const boss = Data.getBossById(state.ui.adminEditingId);
        Object.assign(boss, { name, level, location, x, y, z, respawnMinutes, image, map });
        bossId = boss.id;
        App.toast(`"${name}" actualizado`, 'success');
      } else {
        const newId = state.bosses.length ? Math.max(...state.bosses.map(b => b.id)) + 1 : 1;
        state.bosses.push({ id: newId, name, level, location, x, y, z, respawnMinutes, image, map });
        bossId = newId;
        App.toast(`"${name}" agregado a la base de datos`, 'success');
      }
      Data.saveBossDB();

      // Si se cargó una "hora de anuncio", registramos el timer automáticamente:
      // la card va a mostrar sola la cuenta regresiva hasta la hora de aparición
      // (hora de anuncio + respawnMinutes), sin pasos adicionales.
      const appearTimeStr = document.getElementById('adminAppearTime').value;
      if (appearTimeStr) {
        const [hh, mm] = appearTimeStr.split(':').map(Number);
        Timer.registerManual(bossId, hh || 0, mm || 0, respawnMinutes);
        App.toast(`Cuenta regresiva calculada para "${name}"`, 'success');
      }

      Admin.renderTable();
      Admin.resetForm();
      Render.all();
    },

    exportJSON() {
      Utils.downloadJSON(`l2-raidboss-db-${Date.now()}.json`, state.bosses);
      App.toast('Base de datos exportada', 'success');
    },

    importJSON(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          if (!Array.isArray(parsed)) throw new Error('El archivo no contiene un array de bosses.');
          const valid = parsed.every(b => b && typeof b.name === 'string' && typeof b.level === 'number');
          if (!valid) throw new Error('Formato inválido: cada boss necesita al menos name y level.');
          state.bosses = parsed.map((b, i) => ({
            id: b.id ?? i + 1, name: b.name, level: b.level, location: b.location || 'Desconocida',
            x: b.x || 0, y: b.y || 0, z: b.z || 0,
            image: b.image || 'img/bosses/placeholder.svg', map: b.map || 'img/bosses/placeholder.svg',
            respawnMinutes: b.respawnMinutes || 30,
          }));
          Data.saveBossDB();
          Admin.renderTable();
          Render.all();
          App.toast(`Importados ${state.bosses.length} bosses correctamente`, 'success');
        } catch (err) {
          App.toast(`Error al importar: ${err.message}`, 'danger');
        }
      };
      reader.readAsText(file);
    },

    /** Backup completo: bosses + timers + favoritos + historial + settings. */
    backupAll() {
      const payload = {
        version: 1, exportedAt: new Date().toISOString(),
        bosses: state.bosses, timers: state.timers,
        favorites: Array.from(state.favorites), history: state.history, settings: state.settings,
      };
      Utils.downloadJSON(`l2-raidboss-backup-${Date.now()}.json`, payload);
      App.toast('Respaldo completo generado', 'success');
    },

    restoreAll(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const payload = JSON.parse(e.target.result);
          if (!payload.bosses) throw new Error('El archivo de respaldo no es válido.');
          state.bosses = payload.bosses;
          state.timers = payload.timers || {};
          state.favorites = new Set(payload.favorites || []);
          state.history = payload.history || {};
          if (payload.settings) Object.assign(state.settings, payload.settings);
          Data.saveBossDB(); Data.saveTimers(); Data.saveFavorites(); Data.saveHistory(); Data.saveSettings();
          Admin.renderTable();
          Render.all();
          App.toast('Respaldo restaurado correctamente', 'success');
        } catch (err) {
          App.toast(`Error al restaurar: ${err.message}`, 'danger');
        }
      };
      reader.readAsText(file);
    },
  };

  /* ============================================================
     13. APP: toasts, eventos e inicialización
     ============================================================ */
  const App = {
    toast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const icons = { success: 'fa-circle-check', danger: 'fa-circle-exclamation', info: 'fa-circle-info' };
      const id = `toast-${Utils.uid()}`;
      const el = document.createElement('div');
      el.className = 'toast l2-toast';
      el.id = id;
      el.setAttribute('role', 'status');
      el.innerHTML = `
        <div class="toast-header">
          <i class="fa-solid ${icons[type] || icons.info} me-2"></i>
          <strong class="me-auto">L2 Raid Boss Timer</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
        </div>
        <div class="toast-body">${Utils.escapeHtml(message)}</div>`;
      container.appendChild(el);
      const t = new bootstrap.Toast(el, { delay: 3800 });
      t.show();
      el.addEventListener('hidden.bs.toast', () => el.remove());
    },

    /** Delegación de eventos de las cards (registrar / editar / eliminar / mapa / favorito). */
    bindGridEvents() {
      document.getElementById('bossGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;
        switch (action) {
          case 'register-now':
            Modals.openRegister(id);
            break;
          case 'register-manual':
            Modals.openRegister(id);
            setTimeout(() => Modals._selectRegisterMode('manual'), 50);
            break;
          case 'edit': Modals.openEdit(id); break;
          case 'reset':
            Timer.registerNow(id, Data.getBossById(id).respawnMinutes);
            Render.all();
            App.toast(`${Data.getBossById(id).name} reiniciado con hora actual`, 'success');
            break;
          case 'delete':
            Modals.confirm(`¿Eliminar el timer de "${Data.getBossById(id).name}"?`, () => {
              Timer.clear(id);
              Render.all();
              App.toast('Timer eliminado', 'danger');
            });
            break;
          case 'map': Modals.openMap(id); break;
          case 'fav':
            if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
            Data.saveFavorites();
            Render.all();
            break;
        }
      });
    },

    bindTopbarEvents() {
      const searchInput = document.getElementById('searchInput');
      searchInput.addEventListener('input', Utils.debounce((e) => {
        state.settings.searchQuery = e.target.value;
        Data.saveSettings();
        Render.grid();
        SearchDropdown.render(e.target.value);
      }, 180));
      searchInput.addEventListener('focus', () => SearchDropdown.render(searchInput.value));
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.l2-search-wrap')) SearchDropdown.hide();
      });
      document.getElementById('searchDropdown').addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (!item) return;
        const boss = Data.getBossById(Number(item.dataset.id));
        searchInput.value = boss.name;
        state.settings.searchQuery = boss.name;
        Data.saveSettings();
        Render.grid();
        SearchDropdown.hide();
        // Scroll directo a la card + apertura del registro si no tiene timer.
        setTimeout(() => {
          const card = document.querySelector(`.boss-card[data-boss-id="${boss.id}"]`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
      });

      document.querySelectorAll('.l2-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.settings.filter = btn.dataset.filter;
          Data.saveSettings();
          Render.all();
        });
      });

      document.getElementById('clearAllBtn').addEventListener('click', () => {
        Modals.confirm('¿Eliminar TODOS los timers activos? Los bosses seguirán en la base de datos.', () => {
          Timer.clearAll();
          Render.all();
          App.toast('Todos los timers fueron eliminados', 'danger');
        });
      });

      document.getElementById('openAdminBtn').addEventListener('click', Admin.open);
      document.getElementById('openEpicScheduleBtn').addEventListener('click', Modals.openEpicSchedule);

      document.getElementById('soundToggleBtn').addEventListener('click', (e) => {
        state.settings.soundEnabled = !state.settings.soundEnabled;
        Data.saveSettings();
        e.currentTarget.classList.toggle('active', state.settings.soundEnabled);
        e.currentTarget.querySelector('i').className = state.settings.soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
      });

      document.getElementById('notifyToggleBtn').addEventListener('click', async (e) => {
        if (!state.settings.notifyEnabled) {
          const perm = await Notify.requestPermission();
          if (perm !== 'granted') { App.toast('Permiso de notificaciones no concedido por el navegador', 'info'); return; }
        }
        state.settings.notifyEnabled = !state.settings.notifyEnabled;
        Data.saveSettings();
        e.currentTarget.classList.toggle('active', state.settings.notifyEnabled);
      });
    },

    bindRegisterModalEvents() {
      document.getElementById('choiceNow').addEventListener('click', () => Modals._selectRegisterMode('now'));
      document.getElementById('choiceManual').addEventListener('click', () => Modals._selectRegisterMode('manual'));
      document.getElementById('manualTimeInput').addEventListener('input', () => Modals._updateRegisterPreview());
      document.getElementById('registerRespawnMinutes').addEventListener('input', () => Modals._updateRegisterPreview());
      document.getElementById('confirmRegisterBtn').addEventListener('click', () => Modals.confirmRegister());
    },

    bindEditModalEvents() {
      document.getElementById('editTimeInput').addEventListener('input', () => Modals._updateEditPreview());
      document.getElementById('editRespawnMinutes').addEventListener('input', () => Modals._updateEditPreview());
      document.getElementById('confirmEditBtn').addEventListener('click', () => Modals.confirmEdit());
    },

    bindAdminEvents() {
      document.getElementById('adminForm').addEventListener('submit', Admin.submitForm);
      document.getElementById('adminCancelEditBtn').addEventListener('click', Admin.resetForm);
      document.getElementById('adminImageInput').addEventListener('change', (e) => Admin.handleImageFile(e.target, 'adminImagePreview'));
      document.getElementById('adminMapInput').addEventListener('change', (e) => Admin.handleImageFile(e.target, 'adminMapPreview'));
      document.getElementById('adminExportBtn').addEventListener('click', Admin.exportJSON);

      // Botón "Kill ahora": marca la hora de anuncio como la hora actual (un click, sin escribir nada).
      document.getElementById('adminKillNowBtn').addEventListener('click', () => {
        const now = new Date();
        const appearInput = document.getElementById('adminAppearTime');
        appearInput.value = `${Utils.pad2(now.getHours())}:${Utils.pad2(now.getMinutes())}`;
        appearInput.classList.remove('d-none');
        Admin.updateAppearPreview();
      });
      // Botón "Elegir hora": muestra el input de hora manual y lo enfoca para escribir.
      document.getElementById('adminChooseTimeBtn').addEventListener('click', () => {
        const appearInput = document.getElementById('adminAppearTime');
        appearInput.classList.remove('d-none');
        appearInput.focus();
        Admin.updateAppearPreview();
      });
      // Preview en vivo cada vez que cambia la hora o el respawn.
      document.getElementById('adminAppearTime').addEventListener('input', Admin.updateAppearPreview);
      document.getElementById('adminRespawnHours').addEventListener('input', Admin.updateAppearPreview);
      document.getElementById('adminRespawnMinutes').addEventListener('change', Admin.updateAppearPreview);

      document.getElementById('adminImportInput').addEventListener('change', (e) => {
        if (e.target.files[0]) Admin.importJSON(e.target.files[0]);
        e.target.value = '';
      });
      document.getElementById('adminBackupBtn').addEventListener('click', Admin.backupAll);
      document.getElementById('adminRestoreInput').addEventListener('change', (e) => {
        if (e.target.files[0]) Admin.restoreAll(e.target.files[0]);
        e.target.value = '';
      });
      document.getElementById('adminTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-admin-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.adminAction === 'edit') Admin.editBoss(id);
        if (btn.dataset.adminAction === 'delete') Admin.deleteBoss(id);
      });
    },

    /** Loop principal: reloj cada segundo, countdowns cada segundo, chequeo de notificaciones cada segundo,
     *  y cada 20s un re-render completo del grid para que el orden ("quién aparece primero") se mantenga
     *  siempre correcto incluso si el usuario no interactúa con filtros. */
    startClock() {
      let ticks = 0;
      Render.clock();
      Render.tickCountdowns();
      Notify.tick();
      setInterval(() => {
        Render.clock();
        Notify.tick();
        ticks++;
        if (ticks % 20 === 0 && !SearchDropdown_isOpen()) {
          Render.grid(); // re-render completo: reordena por proximidad de aparición
          Render.statPill();
          Render.filters();
        } else {
          Render.tickCountdowns();
        }
      }, 1000);

      function SearchDropdown_isOpen() {
        const dd = document.getElementById('searchDropdown');
        return dd && !dd.classList.contains('d-none');
      }
    },

    async init() {
      // Intentamos activar Firebase (ver firebase-config.js). Si no está
      // configurado, Cloud.enabled queda en false y no cambia nada del
      // comportamiento anterior (100% LocalStorage por dispositivo).
      const cloudOn = Cloud.init();

      // Las preferencias personales (sonido, notificaciones, filtro, búsqueda)
      // son siempre locales al dispositivo, se sincronicen o no los datos del clan.
      Data.loadSettings();
      document.getElementById('searchInput').value = state.settings.searchQuery || '';
      document.getElementById('soundToggleBtn').classList.toggle('active', state.settings.soundEnabled);
      document.getElementById('soundToggleBtn').querySelector('i').className = state.settings.soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
      document.getElementById('notifyToggleBtn').classList.toggle('active', state.settings.notifyEnabled);

      Modals.init();
      App.bindGridEvents();
      App.bindTopbarEvents();
      App.bindRegisterModalEvents();
      App.bindEditModalEvents();
      App.bindAdminEvents();

      if (cloudOn) {
        // Los datos compartidos (bosses/timers/favoritos) llegan async desde
        // Firebase; cada actualización (propia o de otro dispositivo) dispara
        // un re-render. También refrescamos la tabla del Admin si está abierta.
        Cloud.subscribe(() => {
          Render.all();
          const adminEl = document.getElementById('adminModal');
          if (adminEl.classList.contains('show')) Admin.renderTable();
        });
      } else {
        Data.loadBossDB();
        Data.loadTimers();
        Data.loadFavorites();
        Data.loadHistory();
        Render.all();
      }

      App.startClock();

      // Pedimos permiso de notificaciones al primer click del usuario (los navegadores
      // bloquean el prompt si se pide antes de una interacción).
      document.body.addEventListener('click', async function onFirstClick() {
        if (state.settings.notifyEnabled) await Notify.requestPermission();
        document.body.removeEventListener('click', onFirstClick);
      }, { once: true });
    },
  };

  document.addEventListener('DOMContentLoaded', App.init);

})();
