import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { firebaseConfig } from "./firebase-config.js";
import "./style.css";

const $ = (selector) => document.querySelector(selector);
const startButton = $("#start-button");
const stopButton = $("#stop-button");
const trackingBadge = $("#tracking-badge");
const mapStatus = $("#map-status");
const notice = $("#notice");
const noticeText = $("#notice-text");
const firebaseStatus = $("#firebase-status");
const recenterButton = $("#recenter-button");

const map = L.map("map", { zoomControl: false, attributionControl: false }).setView([20, 0], 2);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);
L.control.zoom({ position: "bottomright" }).addTo(map);

const personIcon = L.divIcon({
  className: "location-marker-wrap",
  html: '<span class="location-marker"><span></span></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});
const marker = L.marker([20, 0], { icon: personIcon, opacity: 0 }).addTo(map);
const trail = L.polyline([], { color: "#397b67", weight: 4, opacity: 0.76, lineCap: "round", lineJoin: "round" }).addTo(map);

let watchId = null;
let lastPosition = null;
let firebaseSession = null;
let firebaseSdk = null;
let lastFirebaseWriteAt = 0;
let writeInProgress = false;
let queuedPosition = null;
let firebaseWritePromise = Promise.resolve();
let isTracking = false;
let firebaseError = false;

function isFirebaseConfigured() {
  return ["apiKey", "authDomain", "projectId", "appId"].every((key) => Boolean(firebaseConfig[key]));
}

function setNotice(message, kind = "info") {
  noticeText.textContent = message;
  notice.classList.toggle("notice-error", kind === "error");
}

function formatCoordinate(value) {
  return value.toFixed(6);
}

function formatSpeed(metersPerSecond) {
  return metersPerSecond === null || !Number.isFinite(metersPerSecond)
    ? "—"
    : (metersPerSecond * 3.6).toFixed(1);
}

function renderPosition(position) {
  const { latitude, longitude, accuracy, speed } = position.coords;
  const point = [latitude, longitude];
  lastPosition = position;
  marker.setLatLng(point).setOpacity(1);
  trail.addLatLng(point);
  mapStatus.textContent = "Ubicación actualizada";

  $("#latitude").textContent = formatCoordinate(latitude);
  $("#longitude").textContent = formatCoordinate(longitude);
  $("#accuracy").textContent = `Precisión de ±${Math.round(accuracy)} m`;
  $("#speed").innerHTML = `${formatSpeed(speed)} <small>km/h</small>`;
  $("#updated-at").textContent = new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(position.timestamp));

  if (trail.getLatLngs().length === 1) {
    map.setView(point, 16);
  } else if (trackingBadge.classList.contains("is-active")) {
    map.panTo(point, { animate: true, duration: 0.5 });
  }
}

async function connectFirebase() {
  if (!isFirebaseConfigured()) {
    firebaseStatus.textContent = "Firebase no está configurado; la ubicación permanece en este dispositivo.";
    return;
  }

  try {
    const [appModule, authModule, firestoreModule] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("firebase/firestore"),
    ]);
    const app = appModule.initializeApp(firebaseConfig);
    const auth = authModule.getAuth(app);
    const db = firestoreModule.getFirestore(app);
    const credential = await authModule.signInAnonymously(auth);
    firebaseSdk = firestoreModule;
    firebaseSession = { db, uid: credential.user.uid };
    firebaseStatus.textContent = "Firebase listo. Solo tu sesión anónima puede acceder a tu ubicación.";
  } catch (error) {
    firebaseError = true;
    firebaseStatus.textContent = `No se pudo conectar con Firebase: ${error.message}`;
    setNotice("El mapa local sigue disponible, pero Firebase no pudo conectarse. Revisa la configuración y la conexión.", "error");
  }
}

function savePosition(position) {
  if (!firebaseSession) return;
  queuedPosition = position;
  if (writeInProgress || Date.now() - lastFirebaseWriteAt < 5000) return;

  const currentPosition = queuedPosition;
  queuedPosition = null;
  writeInProgress = true;
  lastFirebaseWriteAt = Date.now();

  const write = (async () => {
    try {
      const locationRef = firebaseSdk.doc(firebaseSession.db, "users", firebaseSession.uid, "live", "current");
      await firebaseSdk.setDoc(locationRef, {
        latitude: currentPosition.coords.latitude,
        longitude: currentPosition.coords.longitude,
        accuracy: currentPosition.coords.accuracy,
        speed: currentPosition.coords.speed,
        updatedAt: firebaseSdk.serverTimestamp(),
      });
      firebaseError = false;
      firebaseStatus.textContent = "Firebase listo. Solo tu sesión anónima puede acceder a tu ubicación.";
    } catch (error) {
      firebaseError = true;
      firebaseStatus.textContent = `Error al guardar ubicación en Firebase: ${error.message}`;
      setNotice("La ubicación se ve en el mapa, pero no se pudo guardar en Firebase. Comprueba tus reglas de Firestore.", "error");
    } finally {
      writeInProgress = false;
    }
  })();
  firebaseWritePromise = write;
  return write;
}

function handlePosition(position) {
  if (!isTracking) return;
  renderPosition(position);
  savePosition(position);
  if (!firebaseError) {
    setNotice("Seguimiento activo. Tu recorrido se dibuja en el mapa mientras te mueves.", "info");
  }
}

function handleLocationError(error) {
  const messages = {
    1: "No hay permiso para acceder a la ubicación. Actívalo en los ajustes del navegador.",
    2: "No se pudo determinar tu ubicación. Comprueba que el GPS esté activado.",
    3: "La solicitud de ubicación tardó demasiado. Inténtalo de nuevo.",
  };
  setNotice(messages[error.code] || `No se pudo obtener la ubicación: ${error.message}`, "error");
  mapStatus.textContent = "Ubicación no disponible";
  if (error.code === 1) stopTracking(false);
}

function startTracking() {
  if (!("geolocation" in navigator)) {
    setNotice("Este navegador no ofrece geolocalización. Prueba con un navegador actualizado.", "error");
    return;
  }
  if (!window.isSecureContext) {
    setNotice("El seguimiento requiere una conexión segura (HTTPS). Abre la aplicación desde HTTPS.", "error");
    return;
  }

  trail.setLatLngs([]);
  isTracking = true;
  trackingBadge.classList.add("is-active");
  $(".map-panel").classList.add("is-active");
  trackingBadge.innerHTML = "<span></span> EN VIVO";
  startButton.disabled = true;
  stopButton.disabled = false;
  mapStatus.textContent = "Buscando ubicación";
  setNotice("Buscando señal GPS… Mantén esta página abierta para seguir viendo tu recorrido.");
  watchId = navigator.geolocation.watchPosition(handlePosition, handleLocationError, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 20000,
  });
}

async function stopTracking(clearLocation = true) {
  isTracking = false;
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  queuedPosition = null;
  trackingBadge.classList.remove("is-active");
  $(".map-panel").classList.remove("is-active");
  trackingBadge.innerHTML = "<span></span> DETENIDO";
  startButton.disabled = false;
  stopButton.disabled = true;
  mapStatus.textContent = lastPosition ? "Última ubicación" : "Esperando ubicación";

  if (clearLocation && firebaseSession) {
    try {
      await firebaseWritePromise;
      await firebaseSdk.deleteDoc(firebaseSdk.doc(firebaseSession.db, "users", firebaseSession.uid, "live", "current"));
      firebaseError = false;
      firebaseStatus.textContent = "Seguimiento detenido. Se eliminó la ubicación guardada en Firebase.";
    } catch (error) {
      firebaseError = true;
      firebaseStatus.textContent = `Seguimiento detenido, pero no se pudo borrar la ubicación de Firebase: ${error.message}`;
      setNotice("No se pudo borrar la última ubicación de Firebase. Revisa tus reglas de Firestore.", "error");
    }
  }
  if (!notice.classList.contains("notice-error")) {
    setNotice("Seguimiento detenido. La última posición permanece visible hasta que cierres o reinicies la página.");
  }
}

startButton.addEventListener("click", startTracking);
stopButton.addEventListener("click", () => stopTracking());
recenterButton.addEventListener("click", () => {
  if (lastPosition) {
    map.setView([lastPosition.coords.latitude, lastPosition.coords.longitude], 16, { animate: true });
  } else {
    setNotice("Aún no hay una ubicación para centrar. Inicia el seguimiento primero.");
  }
});

window.addEventListener("resize", () => map.invalidateSize());
connectFirebase();
