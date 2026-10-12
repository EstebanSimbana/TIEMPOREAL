# Mi ubicación en vivo

Aplicación web adaptable a celulares que muestra la posición del dispositivo en un mapa de OpenStreetMap. Usa la geolocalización del navegador mientras la página está abierta y dibuja el recorrido de la sesión.

## Requisitos

- Node.js 20.19+ o 22.12+
- Un proyecto de Firebase (opcional para ver la ubicación local; necesario para guardar la última posición en Firestore)
- Servir la aplicación por HTTPS para usar geolocalización en el celular. `localhost` es válido para desarrollo.

## Ejecutar

```sh
npm install
npm run dev
```

Para abrirla desde el celular durante el desarrollo, el teléfono y la computadora deben estar en la misma red. Usa un túnel HTTPS o publica el sitio en un hosting HTTPS: los navegadores normalmente no permiten GPS en una dirección HTTP de red local.
El seguimiento web funciona mientras mantengas la página abierta; el sistema operativo puede suspenderlo si bloqueas el celular o cambias de aplicación.

## Publicar en GitHub Pages

El proyecto ya incluye un workflow que compila y publica automáticamente el sitio cuando haces `push` a la rama `main`.

1. Sube este proyecto a un repositorio de GitHub y asegúrate de que la rama principal se llame `main`.
2. En GitHub, abre **Settings → Pages** y selecciona **GitHub Actions** como fuente de publicación.
3. Haz `push` a `main` o ejecuta manualmente el workflow **Deploy to GitHub Pages** desde **Actions**.
4. Cuando termine el workflow, abre la dirección indicada en **Settings → Pages** desde tu celular. GitHub Pages sirve el sitio por HTTPS, necesario para permitir el GPS.

Vite está configurado para usar rutas relativas, así que funciona tanto en la URL de un proyecto (`usuario.github.io/nombre-del-repositorio/`) como en un dominio propio. Configura Firebase antes de publicar si quieres guardar la última posición en Firestore; sin ello, el mapa muestra la ubicación solo mientras la página permanezca abierta en ese mismo dispositivo.

## Configurar Firebase

1. En la consola de Firebase, agrega una aplicación web y copia su configuración web (apiKey, authDomain, projectId y appId) en `src/firebase-config.js`.
2. Habilita **Authentication → Sign-in method → Anonymous**.
3. Crea una base de datos de **Cloud Firestore**.
4. Publica las reglas de `firestore.rules` en la pestaña **Rules** de Firestore.

La aplicación autentica el navegador con una cuenta anónima de Firebase y escribe la posición actual cada cinco segundos en `users/{uid}/live/current`. Al detener el seguimiento intenta borrar ese documento. Las reglas permiten que cada sesión anónima acceda solo a su documento. No se comparte la ubicación con otros usuarios ni se conserva un historial del recorrido.

La configuración web de Firebase no es la clave de administrador. **No pongas en esta aplicación el archivo `serviceAccountKey.json` ni credenciales de Firebase Admin**: son secretas y solo deben usarse en un servidor confiable. Si Firebase no está configurado, el mapa y el seguimiento local siguen funcionando; la interfaz indicará que no hay sincronización.

## Compilar

```sh
npm run build
```

Los mapas usan teselas de OpenStreetMap y requieren conexión a internet. No se necesita una API key de Google Maps.
