/**
 * bosses.js
 * Base de datos de Raid Bosses de Lineage II Interlude.
 *
 * Cada objeto representa un Raid Boss del juego. Este archivo es la
 * "fuente de la verdad" de bosses conocidos por la app: se carga una
 * sola vez y sirve como semilla para RB_DB (que sí es editable y se
 * persiste en LocalStorage vía el Panel de Administración).
 *
 * Campos:
 *   id              Identificador numérico único.
 *   name            Nombre del boss.
 *   level           Nivel del boss.
 *   location        Nombre de la zona / mapa donde aparece.
 *   x, y, z         Coordenadas de aparición en el mundo de Aden.
 *   image           Ruta local a la imagen del boss (retrato).
 *   map             Ruta local a la imagen del mapa de ubicación.
 *   respawnMinutes  Minutos que tarda en reaparecer luego del kill
 *                   (editable por boss desde el Panel de Admin).
 *
 * CALIBRADO PARA: L2Eirin.com — Interlude x300 (New Server), según su
 * wiki oficial (l2eirin.com/en/wiki-interlude-x300), consultada en vivo:
 *   - Regla del server: 'todos los bosses de nivel 60+ suben a nivel 75'.
 *   - Épicos re-nivelados: Queen Ant/Core/Orfen/Zaken/Baium/Antharas = 80,
 *     Frintezza/Valakas = 85 (en L2Eirin, no en Interlude vanilla).
 *   - respawnMinutes usa el PUNTO MEDIO del rango random real del server:
 *     Cabrio 6h+30m→375min · Golkonda/Horus/Brakki/Uruka 10h+1h→630min ·
 *     alianza Varka/Ketra 10h+2h→660min · resto de RB 75+ 12h+12h→1080min.
 *     Como hay variación random, el tiempo real puede desviarse; ajustable
 *     por boss desde el Panel de Admin si notás un patrón distinto.
 *   - IMPORTANTE: los 8 épicos (Queen Ant, Core, Orfen, Zaken, Frintezza,
 *     Baium, Antharas, Valakas) en este server NO respawnean por 'kill +
 *     tiempo fijo' sino por HORARIO SEMANAL FIJO (día/hora GMT+3). El motor
 *     de esta app (anuncio + minutos) no aplica bien a esos 8 — por eso se
 *     agregó una sección aparte 'Horario de Épicos' en la interfaz con el
 *     cronograma real, en vez de forzarlos al timer de kill.
 */

const RAID_BOSS_SEED = [];

Object.freeze(RAID_BOSS_SEED);
RAID_BOSS_SEED.forEach(b => Object.freeze(b));

/**
 * Horario fijo semanal de los Épicos en L2Eirin x300 — New Server.
 * Fuente: l2eirin.com/en/wiki-interlude-x300 (tabla 'New Server').
 * Todas las horas en GMT+3 (huso horario del server, NO el del navegador).
 */
const EPIC_SCHEDULE_EIRIN_NEW = [
  { name: 'Queen Ant', level: 80, days: 'Lunes a Jueves', hours: '20:30 – 21:00 GMT+3' },
  { name: 'Core', level: 80, days: 'Lunes, Miércoles', hours: '21:15 – 21:45 GMT+3' },
  { name: 'Orfen', level: 80, days: 'Martes, Jueves', hours: '21:15 – 21:45 GMT+3' },
  { name: 'Zaken', level: 80, days: 'Lunes, Miércoles', hours: '22:00 – 22:45 GMT+3' },
  { name: 'Frintezza', level: 85, days: 'Martes, Jueves', hours: '22:00 – 22:45 GMT+3' },
  { name: 'Baium', level: 80, days: 'Miércoles', hours: '23:00 – 23:45 GMT+3' },
  { name: 'Antharas', level: 80, days: 'Jueves', hours: '23:00 – 23:45 GMT+3' },
  { name: 'Valakas', level: 85, days: 'Cada 2 semanas, Viernes', hours: '23:00 – 23:45 GMT+3' },
];
Object.freeze(EPIC_SCHEDULE_EIRIN_NEW);

/**
 * Horario semanal de Eventos en L2Eirin x300 (TvT, CTF, Death Match, etc.)
 * Fuente: l2eirin.com/en/wiki-interlude-x300, sección "Events".
 * Todas las horas en GMT+3 (huso horario del server).
 * days: 'daily' o array de números 0-6 (0=Domingo, 1=Lunes, ..., 6=Sábado).
 * times: array de horas "HH:MM" en GMT+3, puede repetirse varias veces al día.
 */
const EVENT_SCHEDULE_EIRIN_NEW = [
  { name: 'Team vs Team (TvT)', icon: 'fa-people-group', days: 'daily', times: ['10:00', '15:00', '18:00', '22:00', '03:00'] },
  { name: 'Death Match', icon: 'fa-skull-crossbones', days: 'daily', times: ['11:00', '14:00', '23:00', '02:00'] },
  { name: 'Capture the Flag (CTF)', icon: 'fa-flag', days: 'daily', times: ['13:00', '19:00', '21:00', '01:00', '06:00'] },
  { name: 'Last Hero', icon: 'fa-crown', days: 'daily', times: ['05:00', '17:00'] },
  { name: 'Top PvP & PK', icon: 'fa-trophy', days: [0], times: ['21:00'] },
  { name: 'Eirin Boss', icon: 'fa-dragon', days: [1, 3, 5], times: ['21:30'] },
  { name: 'Sinner Boss', icon: 'fa-user-ninja', days: [2, 4, 6], times: ['21:30'] },
];
Object.freeze(EVENT_SCHEDULE_EIRIN_NEW);
