# CLAUDE.md. Gestor de tareas personal (Tareas)

Instrucciones de trabajo para Claude Code. Léelo entero antes de tocar código. Debajo de la línea va el diseño funcional completo, que es la especificación vinculante.

## 1. Qué es esto

App web personal de gestión de tareas para iPhone (PWA instalada en pantalla de inicio), con aspecto y comportamiento de app nativa de iOS. Un solo usuario de momento (Enric). Más adelante, versión de escritorio y uso compartido por espacios.

## 2. Estado actual (2 de noviembre de 2026)

- Versión publicada: **v0.20.1**. El repositorio `tareas` está en GitHub y se publica con GitHub Pages desde la rama `main`. Enric la usa instalada en el iPhone (pantalla de inicio) y en el navegador del ordenador.
- Sigue sin build ni dependencias de interfaz: HTML, CSS y JavaScript que se publican tal cual. El antiguo `index.html` de un solo archivo está repartido en `css/app.css` y en scripts clásicos dentro de `js/`, con el mismo comportamiento y el mismo aspecto.
- Hecho: bloques 1 a 7 (v0.1), roadmap R1 a R20 (v0.15.0), escritorio a partir de 900 px con barra lateral, inspector, Semana, Día, Mes y vista por horas (v0.13.0 y v0.15.0), sincronización con Supabase e inicio de sesión con Google (bloque 8, v0.16.0), recordatorios con Web Push y la función `send-reminders` (bloque 9, v0.17.0), fotos y audios adjuntos en Supabase Storage (v0.19.0) y el lote de v0.20.0 (puntos 31 a 36 de la sección 8).
- Datos: `localStorage` del dispositivo (clave `tareas-v1`) como verdad para la interfaz; copias diarias y archivos adjuntos en IndexedDB; Supabase sincroniza cuando hay sesión.
- Pruebas de regresión en el repositorio (`tests/`), que GitHub Actions ejecuta antes de cada publicación (sección 7 bis).

## 3. Primer encargo (hecho)

Cerrado. Repositorio en GitHub con GitHub Pages, la app en `index.html` en la raíz, `manifest.webmanifest` (nombre "Tareas", `display: standalone`, iconos 192 y 512, `background_color` #F2F2F7, `theme_color` #F9F9F9) y `sw.js` con caché de la app y aviso de nueva versión. Comprobado en el iPhone instalado: arranque, gestos, dictado, Compartir e insignia. Después se hicieron los bloques 8 y 9.

Decisión sobre la migración a Vite y React que menciona el diseño: **no es obligatoria**. Si la app crece y los archivos se vuelven difíciles de mantener, migrar en un bloque propio, manteniendo el CSS y los gestos actuales. Mientras tanto, seguir en HTML, CSS y JavaScript sin build, repartido en archivos por tema, es aceptable y más rápido de desplegar.

## 4. Estructura del repositorio

```
tareas/
├── index.html                 esqueleto de la página: cabecera, contenedores fijos y la carga de css y js
├── css/app.css                todo el estilo: tokens claro y oscuro, iPhone y escritorio
├── js/                        la app, en scripts clásicos que index.html carga en este orden
│   ├── core.js                APP_VERSION, registro, utilidades, datos, estado de la interfaz y acciones
│   ├── render.js              dibujo de pantallas y repintado parcial
│   ├── events.js              eventos comunes, búsqueda, navegación, gestos de fila y hojas
│   ├── menus.js               menús anclados del iPhone y menús de Mac del escritorio
│   ├── sheets.js              hojas y recorridos: alta, selección, cierre del día, fechas, copias, exportar
│   ├── attachments.js         fotos y audios adjuntos
│   ├── sync.js                sincronización con Supabase (bloque 8)
│   ├── push.js                notificaciones (bloque 9)
│   ├── lifecycle.js           vida de la app: teclado, insignia, cambio de día, recarga entre ventanas
│   ├── desktop.js             escritorio: vistas, selección, teclado, barra lateral y columna
│   ├── desktop-calendar.js    escritorio: Día, Semana, Mes, horas y mini mes
│   ├── desktop-render.js      escritorio: inspector y renderDesktop
│   ├── desktop-add.js         escritorio: selector de hora, alta ampliada y eventos
│   └── boot.js                arranque: primera pantalla, sincronización, service worker
├── config.js                  URL y clave pública de Supabase; lo escribe la publicación y git lo ignora
├── manifest.webmanifest
├── sw.js                      service worker: caché de la app (SHELL), aviso de actualización y notificaciones
├── icons/                     192, 512 y apple-touch-icon
├── vendor/                    supabase-js 2.117.3 (UMD), servida y cacheada con la app
├── supabase/                  migraciones SQL (0001 a 0003) y la función send-reminders
├── tests/                     pruebas de regresión con Playwright (sección 7 bis)
├── package.json               solo para las pruebas; la app no tiene build
├── .github/workflows/pages.yml   pruebas y publicación
├── CLAUDE.md                  este archivo
└── CHANGELOG.md               lo entregado en cada versión
```

Reglas de la división en archivos:

- Son scripts clásicos (sin módulos ni build) y comparten sus nombres globales; el orden de `index.html` es el orden de carga.
- Al cargar, cada archivo solo declara funciones, constantes y escuchas. Lo que arranca la app (primera pantalla, `?task` y `?add`, sincronización, notificaciones, service worker) está en `boot.js`, el último, porque necesita el código de todos los demás.
- Un archivo nuevo en `js/` o `css/` se añade en su sitio en `index.html` y en `SHELL` de `sw.js`; si falta en `SHELL`, la app instalada no arranca sin conexión. Una carpeta nueva se añade además al paso «Assemble the site» de la publicación.

## 5. Reglas fijas

1. Interfaz en español. Código, nombres y comentarios en inglés.
2. Sin librerías de componentes. El aspecto iOS se hace con CSS propio. Sin dependencias que no funcionen en Safari iOS.
3. Toda animación con `transform` y `opacity`. El cuerpo no hace scroll; cada lista hace el suyo. Área segura respetada. Nunca `100vh`.
4. Las claves de Supabase van en variables de entorno o en un `config.js` excluido del repositorio con `.gitignore`. Nunca en commits.
5. Cada bloque se cierra probando en el iPhone instalado en pantalla de inicio, y se anota en `CHANGELOG.md`.
6. Cualquier función no descrita en el diseño, cualquier cambio en el modelo de datos y cualquier opción de configuración nueva se pregunta antes de implementar.
7. Los datos locales son la verdad para la interfaz. Supabase sincroniza; nunca bloquea la pantalla.
8. Cada versión publicada sube `APP_VERSION` en `js/core.js` y la constante `CACHE` en `sw.js`; sin ese cambio los iPhone instalados no reciben el aviso de nueva versión.

## 6. Plan de construcción (resumen)

| Bloque | Contenido | Estado |
| --- | --- | --- |
| 1 a 7 | Esqueleto, datos locales, resumen del día, detalle y gestos, proyectos, notas de voz, compartir | Hecho en v0.1 |
| 0 bis | Repositorio, GitHub Pages, manifest, service worker | Hecho y probado en el iPhone instalado |
| 8 | Supabase: tablas, RLS por espacio, Google, sincronización con cola y tiempo real | Hecho en v0.16.0 y probado por Enric en iPhone y ordenador (2 de noviembre) |
| 9 | Recordatorios con Web Push, Edge Function con pg_cron, insignia | Hecho en v0.17.0 y probado por Enric en el iPhone: prueba y aviso con la app cerrada (2 de noviembre) |
| 10 | Ajustes: cuenta, notificaciones, exportar, archivados | Hecho: Cuenta (iniciar y cerrar sesión, estado de la sincronización), Notificaciones (activar, dispositivos, prueba y baja), exportar e importar JSON y CSV, proyectos archivados y versión con aviso de actualización |

## 7. Mapa del código

Los datos: `DB` es un objeto único en `localStorage` bajo la clave `tareas-v1` con `spaces`, `projects`, `tasks`, `voiceNotes`, `attachments` y `settings`. En Supabase cada entidad conserva sus campos y añade `owner_id`; `spaceId`, `projectId` y `taskId` pasan a `space_id`, `project_id` y `task_id`.

- `index.html`: cabecera (manifest, iconos, `css/app.css`), los contenedores fijos (`#app`, `#scrim`, `#sheet`, `#asheet`, `#pmenu`, `#toast`) y la carga de `config.js` y de `js/` en orden.
- `css/app.css`: tokens en `:root` (claro) con variantes oscuras por `prefers-color-scheme` y `data-theme`; iPhone primero y escritorio bajo `.app.desktop`.
- `js/core.js`: `APP_VERSION`; registro (`log`, clave `tareas-log`); fechas y alta escrita (`parseQuickDate`, `parseQuick`, `quickTask`); enlaces (`extractLinks`, `linkify`); datos (`load`, `save`, `batch`, `saveEdit`, `flushEdits`, `orderTasks`, `pendingFor`); estado `UI` y `AX`; `toast` con Deshacer; acciones (`addTask`, `updTask`, `dayPatch`, `rollOver`, `completeTask`, `toggleHold`, `flushHeld`, `deleteTask`, `addSpace`, `deleteSpace`, `addProject`).
- `js/render.js`: `render`, `renderNow` y `renderPushed`; animaciones `renderAnimated` (FLIP); repintado parcial (`morphInto`, `lazyRows`, `fillRows`); `switchTab` y deslizamiento entre pestañas; filas (`rowHTML`, `deskRowHTML`, `tagVars`); resumen (`summaryHTML`); listas agrupadas (`listHTML`, `dayGroupsHTML`, `projectGroupsHTML`); pantallas (`viewTareas`, `viewProyectos`, `viewProject`, `viewAjustes`, `viewDetail`, `inspectorHTML`, `bindDetail`).
- `js/events.js`: `onClick` y `bindCommon`; búsqueda (`bindSearch`); pila de pantallas (`push`, `pop`, `openDetail`, `detailTaskId`, `bindBackSwipe`); gestos de fila (`bindRowGestures`, `bindVnGestures`, `shutOpen`, `bindLongPress`); hojas (`openSheet`, `closeSheet`, `requestCloseSheet`, `actionSheet`, `confirmSheet`, `macAlert`).
- `js/menus.js`: menús anclados del iPhone (`popMenu`, `closeMenu`); menús de Mac (`macMenu`, `pickerPanel`, `deskTaskMenu`); cambios desde menú (`setPriority`, `moveToProject`, `moveToSpace`, `setTaskDate`, `dateMenu`, `postponeMenu`, `duplicateTask`, `confirmDelete`, `detailMenu`).
- `js/sheets.js`: selección múltiple (`startSelect`, `bulkComplete`, `bulkMove`, `rescheduleMany`); cerrar el día y repasos (`closeDaySheet`, `reviewStart`, `reviewStep`); opciones de vista (`viewMenu`, `spaceMenu`, `rowMenu`, `dayHeadMenu`); proyectos (`reorderProject`, `projectSheet`); alta (`addSheet`, `addMany`); espacios (`spaceSheet`, `confirmDeleteSpace`); calendario y fechas (`calendarHTML`, `dateSheet`, `setManualDate`, `reminderSheet`); planificar (`planStart`, `planStep`); notas de voz (`voiceSheet`); compartir (`shareText`, `shareTask`); copias locales (`BK`, `dailyBackup`, `restoreBackup`, `deleteBackup`); exportar e importar (`exportJSON`, `exportCSV`, `importData`, `importSheet`); datos de prueba (`generateDemo`).
- `js/attachments.js`: archivos del dispositivo (`FS`, `FILE_CAP`); fotos (`processPhoto`, `addPhotos`); cola de subida (`attFlush`); descarga (`attDownload`); grupo Adjuntos (`attGroupHTML`); reproductor (`AP`); grabación (`recordSheet`); visor (`openViewer`); fotos arrastradas en escritorio (`attBindDrop`).
- `js/sync.js`: adaptador `supabaseRemote` (sustituible en pruebas con `SY.remote`); `syncMerge`, `syncPull`, `syncPush`, `syncRun`, `syncRealtime`; arranque `syncBoot`; sesión (`syncSignIn`, `syncSignOutSheet`); sección Cuenta (`syncAccountHTML`).
- `js/push.js`: estado `PS` (clave `tareas-push`); `pushEnable`, `pushSubscribe`, `pushCheck`, `pushRevokeSheet`, `pushTest`, `pushSignOut`; sección Notificaciones (`pushSectionHTML`, `pushDevicesHTML`); apertura desde un aviso (`openTaskFromPush`).
- `js/lifecycle.js`: tirar para sincronizar (`bindPullRefresh`); agitar para deshacer (`armShake`); teclado (`kbFallback`); insignia (`badge`); cambio de día (`checkDay`, envoltura de `render`); `tipsSheet`; vuelta a Hoy (`returnHome`); varias ventanas (`reloadFromStorage`, `reloadIfChanged`).
- `js/desktop.js`: vistas (`setDeskView`, `applyWide`); fila seleccionada y teclado (`paintSel`, `deskRowClick`, `moveSel`, `deskShortcut`, `startRowEdit`); selección múltiple (`multiPaneHTML`, `bulkDateMenu`); soltar en grupos (`dropToDay`, `dropToProject`, `dropMany`); barra lateral y columna (`deskSide`, `deskMain`, `addBarHTML`).
- `js/desktop-calendar.js`: semana laboral (`workWeekOn`); navegación (`calNav`, `calDays`); vistas `weekListHTML`, `hoursHTML`, `monthHTML`, `weekHTML`, `miniMonthHTML`, `agendaHTML`; bandeja Sin fecha (`trayHTML`).
- `js/desktop-render.js`: `renderDesktop`; panel (`deskPaneHTML`, `putPane`, `paneWidth`); ventana de Semana (`placeWeekPop`); búsqueda (`deskResults`); barra de alta (`bindAddBar`).
- `js/desktop-add.js`: selector de hora (`timePickHTML`, `bindTimePick`, `parseHM`); alta ampliada (`axOpen`, `axSubmit`, `axVoice`, `axBind`); tarjetas soltadas (`dropTask`); eventos del escritorio (`bindDeskEvents`) y atajos de teclado.
- `js/boot.js`: arranque (registro de inicio, filtro Hoy, `rollOver` y primera pantalla, copia diaria, entradas `?task` y `?add`, consejos), `syncBoot`, `pushCheck` y el service worker con `applyUpdate`.
- `sw.js`: `CACHE` y `SHELL` (todos los archivos de la app), `config.js` primero por red, navegación siempre a `index.html` en caché, `push` y `notificationclick`.
- `supabase/`: `migrations/0001_init.sql` (tablas y reglas), `0002_push.sql` (suscripciones, claves y `pg_cron`), `0003_attachments.sql` (adjuntos y purga) y `functions/send-reminders/index.ts`.

## 7 bis. Cómo probar

- Una vez: `npm ci` y `npx playwright install chromium`. Para `rm-P` y `rm-AT` hace falta Deno: `deno` en el PATH o la variable `DENO` con su ruta.
- `npm test` ejecuta la batería completa (`tests/run.sh`), una prueba detrás de otra; `bash tests/run.sh smoke rm-S` ejecuta solo las indicadas. Si falta `config.js`, lo crea con valores nulos, como la publicación sin secretos.
- Cada prueba levanta su propio servidor en un puerto fijo, abre Chromium con Playwright y deja capturas, descargas y su salida completa en `tests/out/` (ignorada por git). Pasa si termina sin error y todas sus listas `errors` y `fails` están vacías. Una prueba que falla se repite una vez y el resumen dice cuáles pasaron al repetir.
- `settings` lanza a propósito un «Error de prueba» para comprobar el registro: es su resultado esperado y el resumen lo da por bueno.
- `rm-P` y `rm-AT` prueban también las migraciones SQL con PGlite y la función `send-reminders` con Deno, contra un servidor simulado.
- En GitHub, cada envío a `main` (y el lanzamiento a mano) pasa primero por el trabajo `test` (Node 22, Chromium, Deno 2.9.6, límite de 45 minutos). Si falla, no se publica y la salida queda como artefacto `test-output`. El trabajo `deploy` copia a `_site` solo la app (`index.html`, `manifest.webmanifest`, `sw.js`, `config.js`, `icons`, `vendor`, `css` y `js`) y publica esa carpeta.
- Una prueba nueva va en `tests/<nombre>.js` con un puerto propio, imprime un JSON con su lista `errors`, termina con código distinto de cero si falla, y se añade a la lista de `tests/run.sh`.


## 8. Decisiones tomadas tras la v0.1

Cambios acordados con Enric sobre el diseño de abajo. Mandan sobre el texto del diseño donde difieran.

1. **Notas de voz (v0.2.1).** La Web Speech API no transcribe en Safari con la app instalada. El dictado del teclado de iOS es la vía principal: la hoja abre con el área de texto enfocada. El micrófono propio solo se ofrece en una pestaña normal de Safari.
2. **Navegación entre pestañas (v0.3.0).** Además de tocar la tab bar, se cambia de pestaña deslizando lateralmente con seguimiento del dedo. Las filas de tareas conservan sus gestos y no participan en el deslizamiento de pestaña.
3. **Cabeceras (v0.3.2).** Sin título grande de 34 px. Una sola fila de 44 puntos con el título a 22 px a la izquierda en las pestañas; en las pantallas apiladas, Atrás y título centrado a 17 px.
4. **Resumen del día (v0.3.3).** Tres cifras y, debajo, "Lo primero" solo con las tareas de prioridad alta de hoy (hasta tres). Sin prioritarias, la sección no se muestra.
5. **Vencidas (v0.3.4).** No existen tareas vencidas: al abrir la app, las pendientes con fecha pasada pasan a hoy con la marca `carried` (campo nuevo en Tarea, booleano; en Supabase, `carried`). La marca se quita al cambiar la fecha a mano. El resumen muestra "para hoy", "aplazadas" y "prioritarias".
6. **Deslizar fila a la izquierda (v0.3.4).** Se detiene en los botones Mañana y Eliminar; no hay deslizamiento largo que ejecute una acción. A la derecha se mantiene: deslizamiento largo completa.
7. **Espacios editables (v0.4.0).** Trabajo y Personal son solo los iniciales: se pueden renombrar y crear más (Ajustes, sección Espacios, y "Nuevo espacio" en el selector del título). Un espacio se elimina solo si está vacío y no es el único. Sustituye a "no se crean más en fase 1" del modelo de datos.
8. **Herramientas en Ajustes (v0.5.0).** Exportar a archivo e importar desde archivo (JSON, fusión por id con "gana el más reciente"), generación y borrado de datos de prueba (ids con prefijo `demo-`) y un registro de errores y eventos (`log()`, clave `tareas-log`, 400 entradas) que Enric copia al chat para depurar. Registrar en el log cualquier operación nueva relevante (sincronización, notificaciones).
9. **Lote de estética y usabilidad (v0.6.0).** Todas agrupada por tramos de fecha; contadores en el segmento; cifras del resumen como filtros; alta en serie con Enter; fechas escritas al final del título (`parseQuickDate`); menú de pulsación larga completo; Subir y Bajar en proyectos; búsqueda con Cancelar y recuento; títulos a dos líneas; notas que crecen; confirmación al eliminar desde la fila; animación FLIP al completar, aplazar y eliminar (`renderAnimated`); iconos rellenos en la pestaña activa; separadores con sangría; prioridad "!!!" y "!!"; píldora de contador; la pantalla se encoge bajo las hojas; tamaños en `rem` sobre `-apple-system-body` (Dynamic Type). Pendiente y descartada por ahora: barra de estado integrada.
10. **Lotes 3 y 4 (v0.7.0).** Detalle con celdas agrupadas (título y notas; Proyecto, Fecha, Recordatorio, Prioridad; notas de voz) y acciones en la barra; círculo de completar con color de proyecto; resumen sin cajas; materiales translúcidos; etiqueta de proyecto en cápsula; Hoy en bloques Aplazadas y Hoy; resumen plegado automáticamente con más de 20 tareas (`summaryState`); búsqueda sin acentos; botón Aplazar con opciones (`postponeSheet`); chips Viernes y Próxima semana; vuelta a Hoy tras dos horas fuera (`returnHome`). Pendiente: calendario propio para Fecha y Recordatorio (E11), a enseñar con maqueta.
11. **Lote 5 (v0.8.0).** Icono nuevo; proyectos con icono de color; nombres de día completos; indicadores de notas y voz en la fila; háptico por interruptor nativo (`#hap`); mover a otro espacio (`moveToSpaceSheet`); enlaces y teléfonos tocables en notas (`extractLinks`, `linkify`); duplicar (`duplicateTask`); Añadir y abrir; búsqueda con completadas bajo demanda (`UI.searchDone`); resumen abierto la primera vez del día (`summaryDay`); Deshacer en prioridad y proyecto (`setPriority`, `moveToProject`).
12. **Lote 6 (v0.9.0).** Copias locales diarias en IndexedDB (`BK`, base `tareas-backups`, siete copias, restaurar desde Ajustes); título del detalle en `textarea` que crece; atajos de hora en Recordatorio; "N hoy" en Completadas y "Todo hecho por hoy"; vista previa "Mañana: N tareas"; hoja de bienvenida (`tipsSeen`); entrada `?add=texto` para el Atajo de iOS (limitación comprobada: el Atajo abre Safari, cuyo almacenamiento es distinto del de la app instalada, así que en el iPhone la tarea no llega a la app; ver decisiones pendientes); agitar para deshacer (`shakeUndo`, DeviceMotion con permiso).
13. **v0.11.0.** Calendario propio (`calendarHTML`) en Fecha y Recordatorio; Completadas con enlace y agrupadas por día; selección múltiple (`UI.select`, `startSelect`, barra `#selbar` con `bulkComplete`, `bulkPostponeSheet`, `bulkMoveSheet`, `bulkDelete`); Todas agrupada por fecha o por proyecto (`allGroup`).
14. **v0.12.0.** Filtro por proyecto en la lista (`UI.projFilter`, chips `.pchips`); "Pasar lo pendiente a mañana" desde las 19:00 (`closeDaySheet`, `rescheduleMany`); planificar las sin fecha una a una (`planStart`, `planStep`); exportar CSV para Excel (`csvText`, `exportCSV`, separador `;`, BOM).
15. **Escritorio (v0.13.0).** Decidido con Enric: en el iPhone se mantiene la tab bar (hasta cinco pestañas y "Más" si hiciera falta; nada de cajón lateral); a partir de 900 px (`wideMQ`, `UI.wide`) la app pasa a barra lateral, columna central con barra de alta (`addBarHTML`), panel de detalle (`UI.deskDetail`) y vista Semana (`weekHTML`, arrastrar para cambiar fecha). Código en `renderDesktop`, `deskSide`, `deskMain`, `bindDeskEvents`. Sin tablet. Los datos son locales por navegador hasta el bloque 8.
16. **Backlog añadido por Enric (31 de octubre, tarde).** Pendiente de diseño detallado; no implementar sin acordar modelo y orden. Decidido el 1 de noviembre: fotos y notas de voz grabadas esperan a la sincronización con Supabase (bloque 8, con Supabase Storage); no se hace el paso previo solo en IndexedDB.
    - **Fotos en notas.** Hacer una foto con el móvil (o elegirla) y adjuntarla a una tarea; verla en el detalle y en escritorio. Necesita almacenamiento de archivos (Supabase Storage) para que viaje entre dispositivos; en local cabría en IndexedDB como paso previo. Nueva entidad `attachment` (id, task_id, kind foto|audio, path, mime, size, created). Se borra con la tarea.
    - **Notas de voz grabadas.** Además del dictado, grabar el audio (MediaRecorder, en iOS sale m4a/aac) y guardarlo como adjunto reproducible en móvil y escritorio; se borra con la tarea. Misma entidad `attachment`. Adelanta el punto 1 del backlog de fase 3.
    - **Responsables y recordatorios a personas.** Dentro de un proyecto, asignar tareas a personas (jefe, equipo); enviar un recordatorio desde una tarea o desde un grupo de tareas: si la persona usa la app, que le aparezca priorizado en su escritorio; si no, por Teams o WhatsApp. Necesita cuentas y espacios compartidos (fase 2, campo `assignees` ya reservado) y notificaciones (bloque 9). Paso previo posible sin cuentas: campo "Responsable" de texto libre y "Enviar recordatorio" por la hoja de compartir con el texto de una o varias tareas.
17. **Revisión de 1 de noviembre (v0.14.0).** Comportamientos fijados al corregir errores: la app abre siempre en Hoy; modo escritorio con al menos 900 px de ancho y 500 de alto (`wideMQ`), para que un iPhone grande en horizontal siga en móvil; varias pestañas o ventanas se sincronizan con el evento `storage` sin cerrar hojas ni perder lo escrito (`reloadFromStorage`); con la app abierta, el cambio de día ejecuta `rollOver`, redibuja y hace la copia diaria (`checkDay`); `rollOver` no toca `modified`; escribir en título y notas guarda con 400 ms de espera (`saveEdit`, `flushEdits`); acciones en bloque con un solo guardado (`batch`); listas de más de 200 filas con filas diferidas (`lazyRows`, `armRows`, `fillRows`); el detalle usa `detailTaskId()` en móvil y escritorio; el service worker solo borra cachés `tareas-*`; no se pueden elegir fechas ni recordatorios pasados. Detalle completo en el CHANGELOG. En v0.14.1 y v0.14.2: una hoja recién abierta ignora durante 450 ms los toques en el fondo, en el calendario o en el menú (`sheetFresh`), y si iOS no informa del teclado al enfocar un campo de una hoja, esta pasa a la parte superior de la pantalla (`kbFallback`, clase `.sheet.top`).
18. **Foco en hojas.** Los campos de las hojas se enfocan de forma síncrona dentro del toque; con `setTimeout` iOS no abre el teclado. Las hojas con campo de texto llevan las acciones en la cabecera (`sheadHTML`), porque en iOS 26 la barra flotante del teclado tapa el pie de la hoja (v0.14.3).
19. **Notas de voz editables (v0.14.4).** En el detalle, deslizar una nota a la izquierda muestra Eliminar (con Deshacer, sin confirmación); a la derecha, Editar, y el deslizamiento largo la abre. La hoja de edición permite corregir el texto o «Volver a dictar». Nota de voz gana el campo `modified` (en Supabase, `modified`), que se rellena solo al editar. En escritorio, clic en la nota abre Editar y Eliminar. Código: `vnHTML`, `bindVnGestures`, `editVoiceNote`, `deleteVoiceNote`, `voiceSheet(id, editId)`. En la rama del roadmap, el deslizamiento atrás desde cualquier punto del detalle (R4) debe excluir las notas de voz.
20. **Ritmo de las animaciones (v0.14.5).** Enric las veía demasiado rápidas. Hojas, entrar y volver: 0,5 s; menús inferiores y oscurecido: 0,45 s; deslizamiento de pestaña, filas y reordenación: 0,4 s; todo con `cubic-bezier(.32,.72,0,1)`. Sustituye a los 350 ms del diseño. Los temporizadores que esperan al final de una animación (`navLock`, `pop`, `closeSheet`, `closeAction`, cambio de pestaña) van ajustados a estas duraciones.
21. **Roadmap aplicado (v0.15.0).** R1 a R20 según la sección 10. Preferencias de vista nuevas en `settings`: `hoyGroup`, `paneWidth`, `weekMode`, `weekTray`, `calMode`. Piezas principales: retención al completar (`toggleHold`, `flushHeld`), alta con barra (`addSheet`, `parseQuick`), menús anclados (`popMenu`), menús de Mac (`macMenu`, `pickerPanel`, `inspectorHTML`), calendario (`weekListHTML`, `monthHTML`, `hoursHTML`, `miniMonthHTML`, `dropTask`), selección de escritorio (`UI.dsel`, `deskShortcut`, `dropMany`) y repintado parcial (`morphInto`). Preguntas abiertas de la revisión final en la sección 9.
22. **Filas de escritorio (v0.15.1).** Pedido por Enric: la etiqueta del proyecto va en una columna fija a la izquierda (`.pcol`, 132 px y 100 px con el panel abierto), y el título ocupa el resto. Fecha, recordatorio e indicadores solo ocupan columna si alguna fila de la lista los usa (`:has`). Con el panel abierto, la fecha va a 70 px y el recordatorio queda en la campana, con la hora en el aviso del ratón.
23. **Bloque 8, modelo de Supabase (aprobado el 2 de noviembre).** Proyecto Supabase propio `tareas` (Frankfurt), separado del de ajedrez; acceso con Google mediante un cliente OAuth propio en el proyecto de Google Cloud existente. La URL y la clave pública van como secretos del repositorio (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) y la publicación genera `config.js` al desplegar; nunca en commits. Tablas `spaces`, `projects`, `tasks` y `voice_notes` con `owner_id`, `created`, `modified` y `deleted`; reglas de acceso por propietario (en fase 2, por espacio). `attachments` se crea con su función y `push_subscriptions` en el bloque 9. Decisiones: (1) marca de eliminado sincronizada, lo borrado no se muestra; (2) en la primera conexión, los espacios `trabajo` y `personal` reciben un identificador único y se actualizan sus referencias; (3) los datos de prueba (`demo-`) no se suben; (4) los ajustes son de cada dispositivo y no se sincronizan; (5) primera conexión: se suben los datos locales, se fusiona con lo que haya y gana el modificado más reciente, con copia local de seguridad antes. Implementado en v0.16.0: librería `vendor/supabase-js-2.117.3.umd.js` cacheada por el service worker; bloque `SYNC` con adaptador `SY.remote` (sustituible en pruebas); clave local `tareas-sync` con la firma de lo que tiene el servidor, cursores y borrados; orden de cada pasada: bajar, fusionar y subir; borrados enviados como `deleted`; un registro borrado que vuelve (Deshacer) se envía con `modified` nuevo para ganar. Con sesión iniciada, restaurar una copia local se aplica en todos los dispositivos con aviso, y lo restaurado recibe `modified` nuevo (decidido con Enric). Prueba `rm-S` con servidor simulado y dos dispositivos.
24. **«Lo primero» en escritorio (v0.16.3).** Solo con más de 8 tareas para hoy, en un bloque gris con título; con menos, la lista ya las muestra todas y se evitaba la sensación de tareas duplicadas. En el iPhone no cambia.
25. **Recordatorio al aplazar (decidido el 2 de noviembre).** Cuando una tarea con recordatorio cambia de día por `rollOver`, Aplazar, «Pasar lo pendiente a mañana», el repaso de aplazadas, la planificación o al arrastrarla a otro día, el recordatorio que estaba en el día antiguo pasa al nuevo día con la misma hora, y Deshacer lo devuelve. Si la hora resultante ya ha pasado (por ejemplo al pasar a hoy las de ayer), el recordatorio se conserva pero no avisa. Implementado en v0.17.0 con `dayPatch`, `daySnap` y `undoDay`; la hoja Fecha manual también lo mueve (confirmado por Enric el 2 de noviembre).
26. **Bloque 9, notificaciones (v0.17.0).** Campo nuevo en Tarea `reminderSent` (en Supabase `reminder_sent`): se rellena al enviar y se vacía cuando el recordatorio cambia a una hora futura. Tabla `push_subscriptions` (un registro por dispositivo, con baja lógica al revocar), tabla privada `push_keys` con las claves VAPID que la función genera sola, tarea `pg_cron` cada minuto y función `send-reminders` (sin verificación JWT; modo de prueba solo con la sesión del usuario y a sus propios dispositivos). Un recordatorio con más de 60 minutos de retraso se marca sin avisar. Cerrar sesión da de baja este dispositivo. Clave local `tareas-push` solo del dispositivo. Código en el bloque PUSH de `index.html` y en `sw.js` (`push`, `notificationclick`); apertura de una tarea con `?task=id`. Migración `supabase/migrations/0002_push.sql` y función `supabase/functions/send-reminders/index.ts`. La función debe llamarse exactamente `send-reminders` (el editor de Supabase propone un nombre automático) y llevar Verify JWT desactivado.
27. **Decisiones rápidas (2 de noviembre).** (a) Cambiar la fecha a mano en la fila Fecha también mueve el recordatorio al nuevo día con la misma hora, con Deshacer (regla del punto 25). (b) Con Hoy a la vista, el + y «Añadir tarea» del iPhone proponen la fecha de hoy y el proyecto del filtro activo, que se pueden quitar. (c) Con los botones de una fila a la vista, el primer toque en cualquier otro sitio solo cierra la fila. (d) La línea gris de la fila del iPhone separa sus datos con espacio, sin punto medio.
28. **Decisiones menores (2 de noviembre).** (a) Eliminar un espacio borra en cascada sus proyectos (también archivados), tareas (también completadas antiguas) y notas de voz, tras una confirmación que dice cuánto se borra, con copia local antes y Deshacer; sigue sin poder eliminarse el único espacio. (b) Cerrar la hoja de nota de voz, o la de Nueva tarea, con texto sin guardar pide confirmación: «Descartar» o «Seguir editando». (c) En escritorio, las confirmaciones de borrado son una alerta de Mac centrada con icono, Cancelar y Eliminar; Intro elimina y Esc cancela. (d) En la vista por horas, la franja «Todo el día» muestra hasta tres tareas por día y «N más», que abre la vista Día.
29. **Fotos y notas de audio (aprobado el 2 de noviembre).** Tabla `attachments` (id, task_id, kind foto o audio, path, mime, size, width, height, duration_ms, owner_id, created, modified, deleted, server_ts) con reglas por propietario, y bucket privado de Supabase Storage con una carpeta por usuario (`<owner_id>/<task_id>/<id>.<ext>`) y enlaces firmados de corta duración. Decisiones: (1) fotos reducidas al subir a 2.048 px por lado en JPEG de buena calidad; (2) audio de hasta 10 minutos en calidad de voz (en iOS, m4a o AAC con MediaRecorder); (3) copia local de archivos en el dispositivo de hasta 200 MB, borrando lo más antiguo (Enric); (4) el archivo se borra del almacén 24 horas después de eliminar el adjunto o su tarea, lo hace la función `send-reminders`; hasta entonces Deshacer o restaurar lo recuperan; (5) exportar JSON y copias locales incluyen la lista de adjuntos, no los archivos. El audio grabado y la nota de voz dictada son elementos distintos: con la app instalada iOS no deja grabar y dictar a la vez, y no hay transcripción automática del audio. Sin conexión, lo capturado se guarda en el dispositivo y se sube al volver la red. Implementado en v0.19.0: lista local `DB.attachments` (taskId, kind `photo` o `audio`, path, mime, size, width, height, durationMs), sincronizada después de las tareas y solo cuando el archivo ya está en Storage; base IndexedDB `tareas-files` (archivos, miniaturas y metadatos, tope `FILE_CAP` de 200 MB); funciones `processPhoto`, `attFlush`, `attDownload`, `openViewer`; grabación en m4a (AAC) en todos los navegadores que lo permiten; migración `0003_attachments.sql` con columna `purged` y función `tareas_attachments_to_purge`, que usa `send-reminders`. Añadir o quitar un adjunto actualiza el modificado de la tarea, como las notas de voz.
30. **Orden de proyectos en escritorio (v0.18.0).** Pedido por Enric: en la barra lateral, los proyectos se arrastran arriba y abajo con línea de inserción y Deshacer, o con Alt y las flechas (`reorderProject`, `renumberProjects`); usa el campo `order` y sincroniza. Sin proyecto y los archivados no se mueven. En el iPhone sigue Subir y Bajar. Implementados también los puntos 27 y 28 (`setManualDate`, `addFromList`, `shutOpen`, `deleteSpace`, `confirmDeleteSpace`, `requestCloseSheet`, `macAlert`).
31. **Alta ampliada en escritorio (pedido por Enric el 2 de noviembre).** Al escribir en la barra «Nueva tarea» del escritorio, la barra se despliega con un campo de notas, Fecha, Proyecto, Prioridad, Recordatorio y Nota de voz (dictado con el micrófono del ordenador cuando el navegador lo permite; si no, escribir). Intro añade la tarea con todo lo puesto, incluida la nota de voz; Esc recoge la barra, pidiendo confirmación si hay texto (punto 28). Descartados por ahora: Control e Intro para añadir y abrir, y Notas desde el menú de la fila.
32. **Hora del recordatorio en escritorio (pedido por Enric el 2 de noviembre).** El campo de hora nativo del navegador se ve pobre. Se sustituye en escritorio por un selector propio al estilo de Calendario de Mac: campo de hora escribible (acepta 9, 930, 9:30 o 21.15), lista desplegable de medias horas de 7:00 a 22:00 con la hora actual marcada y desplazada a la vista, atajos de horas habituales (9:00, 12:00, 15:00, 18:00) y flechas arriba y abajo para sumar o restar 15 minutos. En el iPhone se mantiene la rueda nativa de iOS.
33. **16 colores de proyecto (decidido el 2 de noviembre).** La paleta pasa de 8 a 16 colores fijos en dos filas, en iPhone y escritorio: rojo, naranja, amarillo, verde, azul, morado, rosa, marrón; menta, cian, índigo, gris, granate, oliva, azul marino y coral. Cada color con su variante oscura para las etiquetas (contraste por encima de 4,4 a 1 en los dos temas, como en R3). No cambia el modelo: el proyecto sigue guardando un color; los proyectos existentes conservan el suyo.
34. **Borrar copias locales (pedido por Enric el 2 de noviembre).** En Ajustes, sección de copias locales, cada copia se puede borrar: en el iPhone deslizando la fila a la izquierda (botón Eliminar) o desde su menú; en escritorio con clic derecho o un botón al pasar el ratón, con la alerta de Mac. Confirmación previa, sin Deshacer (el borrado es definitivo). Opción «Borrar todas las copias» al pie, también con confirmación. La copia diaria automática se sigue creando al día siguiente. Solo afecta a las copias del dispositivo; nada se borra en Supabase.
35. **Semana laboral por espacio en escritorio (pedido por Enric el 2 de noviembre).** Opción de vista «Solo de lunes a viernes» por espacio, en el menú de vista del calendario: activada de inicio en el espacio Trabajo y desactivada en Personal. Con ella, Semana, Horas y Mes muestran solo lunes a viernes (en «siete días desde hoy», los cinco próximos días laborables). Si hay tareas con fecha en sábado o domingo, aparece una columna estrecha «Fin de semana» con ellas, para no ocultarlas. Preferencia del dispositivo, guardada en `settings` por espacio, sin cambiar el modelo de datos.
36. **Arrastrar entre grupos de la lista en escritorio (pedido por Enric el 2 de noviembre).** En las listas agrupadas por día (Todas, pantalla de un proyecto, Hoy con Aplazadas), arrastrar una tarea, o la selección, sobre otro grupo de día (cabecera o filas) le pone esa fecha: Hoy, Mañana, cada día con nombre y Sin fecha (quita la fecha). Los grupos por mes no aceptan tareas. Lo mismo en la agrupación por proyecto: soltar en otro grupo cambia el proyecto. El grupo de destino se resalta, el recordatorio se mueve con la fecha (punto 25), hay Deshacer, y no se puede soltar en un día pasado. Sigue sin reordenarse dentro de un mismo grupo.
37. **v0.20.0.** Implementados los puntos 31 a 36. Notas: en la alta ampliada, tras añadir solo se conservan la fecha y el proyecto elegidos con los botones (lo escrito en el título vale para esa tarea); colores nuevos granate #9B2242, oliva #7D8A2E, azul marino #1F3A8A y coral #FF7A5C; una copia de hoy borrada a mano no se recrea hasta mañana; la opción de semana laboral se traslada al nuevo identificador de Trabajo tras la primera sincronización. Fotos y audios (punto 29) probados por Enric en iPhone y ordenador.
38. **Tareas que se repiten (aprobado el 2 de noviembre).** Campo nuevo en Tarea `repeat` (texto con la regla; en Supabase `repeat`), nulo si no se repite. (1) La siguiente se crea al completar la tarea, con la primera fecha de la serie posterior a hoy; solo hay una pendiente a la vez; Deshacer al completar borra la siguiente creada. (2) Opciones: Cada día, Cada día laborable, Cada semana, Cada 2 semanas, Cada mes, Cada año y Personalizada (cada N días, semanas o meses; días de la semana; «el primer lunes de cada mes»). (3) La siguiente copia título, proyecto, prioridad, notas de texto y la hora del recordatorio en la nueva fecha; las notas de voz, fotos y audios quedan en la completada. (4) Al eliminar una tarea que se repite se pregunta: «Eliminar solo esta» (pasa a la siguiente fecha) o «Eliminar la serie», con Deshacer. Poner una repetición a una tarea sin fecha le da la primera fecha de la serie.
39. **Zona «Ahora» (aprobado el 2 de noviembre).** Campo nuevo en Tarea `focus` (fecha y hora en que se marcó; en Supabase `focus`), nulo si no está en la zona. Tareas que se van a hacer ya, sin tocar su fecha ni su sitio en la lista. (1) Nombre «Ahora». (2) Hasta 5 tareas; al intentar añadir la sexta, aviso para quitar una antes. (3) Se vacía al cambiar de día: las no completadas vuelven a su sitio normal (rollOver quita la marca de las marcadas antes de hoy). (4) Sin aviso ni temporizador; la insignia no cambia. Se marca desde el menú de pulsación larga del iPhone y el clic derecho del escritorio, una estrella en el detalle, la tecla A en escritorio y arrastrando al bloque «Ahora». Se muestra arriba de Hoy en el iPhone (encima del resumen) y en escritorio como bloque arriba de la lista y entrada «Ahora» en la barra lateral. Completar una tarea de «Ahora» la quita de la zona.
40. **Base del proyecto (v0.21.0).** Pruebas automáticas en `tests/` (`npm test`), ejecutadas por GitHub antes de cada publicación: si fallan, no se publica. El código se divide en `css/app.css` y 14 archivos en `js/` cargados en orden, sin cambios visibles. `APP_VERSION` pasa a `js/core.js`.
41. **Estado «Por confirmar» (aprobado el 2 de noviembre).** Tercer estado de la tarea, entre pendiente y hecha: `status` admite `waiting` (en Supabase se amplía la restricción de `status`). Campo nuevo opcional `waitingFor` (texto libre «Esperando a»; en Supabase `waiting_for`). (1) Nombre «Por confirmar». (2) Las tareas en este estado salen de Hoy y Todas y van a un bloque plegado «Por confirmar (N)» al final de la lista, y a una entrada en la barra lateral del escritorio; vuelven a Hoy el día de revisión, marcadas «Revisar». (3) Al marcarla se puede elegir un día de revisión opcional (Mañana, En 3 días, Próxima semana, Sin fecha), que usa la fecha de la tarea. (4) «Esperando a» se ve en la fila. Se marca desde el menú de pulsación larga, el clic derecho y el detalle; el círculo se ve a medio llenar y tocarlo la da por hecha, con Deshacer. Las tareas por confirmar no pasan a hoy como aplazadas ni cuentan en «para hoy» salvo el día de revisión.
42. **v0.22.0, implementación de 38, 39 y 41.** Regla de repetición en un texto `<regla>@<ancla>#<serie>` (por ejemplo `W2:MO,TH@2026-11-02#k3f9a2c1`): `D<n>`, `WD`, `W<n>:<días>`, `M<n>:<día>` o `M<n>:<k><día de la semana>` (k de 1 a 4 o L), `Y<n>:MM-DD`; un día 29 a 31 cae en el último día de los meses cortos y el 29 de febrero en el 28. Funciones en `js/core.js` (`repNext`, `spawnNext`, `skipOccurrence`), menús en `js/menus.js` (`repeatMenu`, `repeatCustom`). Solo el dispositivo que completa crea la siguiente. «Ahora» (`toggleFocus`, `ahoraHTML`) cuenta 5 por espacio. «Por confirmar» (`setWaiting`, `waitingSheet`, `waitingBlockHTML`): la revisión aparece en Hoy ese día o después; sin fecha propone «Sin fecha», de hoy propone «Mañana». Duplicar no copia la repetición. Migración `supabase/migrations/0004_repeat_focus.sql` (columnas `repeat`, `focus`, `waiting_for` y `status` con `waiting`); sin ella, esos datos se quedan en cada dispositivo y el resto sincroniza.
43. **Fase 2, tareas compartidas entre personas (idea de Enric del 2 de noviembre, solo anotada; diseño sin cerrar).** Compartir tarea a tarea, no espacios enteros: cada persona tiene su cuenta de Google y solo ve las tareas que le has compartido; sus proyectos y el resto de sus tareas siguen privados, y al revés. Cada participante archiva la tarea compartida en su propio proyecto (bandeja «Compartidas conmigo»). Decidido: (1) quien la recibe puede editarla y completarla, y los cambios se ven en los dos lados; (2) se comparte todo el contenido de la tarea: título, fecha, prioridad, estado, notas, notas de voz y adjuntos; (3) botón «Recordar a <persona>» que le envía una notificación, como máximo una vez cada 4 horas por tarea y persona, con una frase opcional; si la persona no usa la app, el recordatorio sale por la hoja de compartir (WhatsApp, Teams o correo) con enlace de invitación. Encaja con «Esperando a» (punto 41) y con el responsable del punto 16. Necesitará tablas de contactos y de participantes por tarea, reglas de acceso por participante (también en Storage) y ampliar `send-reminders`. Cerrado el 2 de noviembre: (4) alta solo con invitación: se comparte escribiendo el correo; si la persona ya usa la app le llega al momento y, si no, la app prepara un enlace para enviarle por WhatsApp, Teams o correo; solo pueden crear cuenta en el Supabase de Enric los correos invitados (se reactiva el alta de usuarios con un filtro de invitación); (5) avisos: solo se notifica cuando el otro completa la tarea o la aplaza (cambia su fecha a más tarde); el resto de cambios no avisa; (6) dejar de compartir: la tarea es de quien la creó; si deja de compartirla, desaparece de la app del otro con un aviso; el otro puede «Salir de la tarea» y desaparece solo de la suya; lo que añadió (notas, adjuntos) se queda en la tarea; si el creador la elimina, desaparece para todos; (7) permiso siempre «editar y completar» y solo quien creó la tarea puede añadir o quitar personas. Diseño cerrado; se construye cuando Enric lo pida. Para probarlo, Enric usará sus dos cuentas de Google como las dos personas (una en el iPhone y otra en el ordenador o en otro navegador); antes hay que pasar la pantalla de consentimiento de Google Cloud de «Prueba» a «Producción» o añadir la segunda cuenta como usuario de prueba.
44. **Outlook de Deloitte (idea de Enric del 2 de noviembre, para el final del roadmap).** Ver el calendario de Outlook corporativo en la app y ver las tareas en Outlook. La conexión directa con Microsoft (Graph) necesita que TI de Deloitte autorice la app y se da por descartada. Antes de nada, Enric revisará la política de Deloitte sobre datos de clientes en herramientas personales. Opciones sin permisos de TI, por orden: (A) botón «Añadir a Outlook» en cada tarea que genera un archivo .ics; (B) suscripción de calendario: enlace privado con las tareas con fecha y hora que Outlook añade con «Suscribirse desde la web», solo lectura; (C) leer las reuniones de Outlook en la app a partir de un calendario publicado, poco probable en Deloitte. Comprobaciones pendientes en Outlook web: si existen «Suscribirse desde la web» y «Publicar un calendario».


## 9. Decisiones pendientes de Enric (revisión del 1 de noviembre)

1. **Atajo de iOS (`?add=`).** Opciones: (a) avisar en Safari de que la tarea no llegará a la app instalada; (b) el Atajo copia el texto y Nueva tarea ofrece "Pegar"; (c) con el bloque 8, el Atajo envía el texto a una bandeja en Supabase que la app recoge al sincronizar. (a) y (b) añaden interfaz.
2. ~~Recordatorio al aplazar.~~ Resuelta el 2 de noviembre: sí, el recordatorio se mueve al nuevo día manteniendo la hora, con Deshacer (punto 25 de la sección 8).
3. ~~Nueva tarea desde Hoy.~~ Resuelta el 2 de noviembre: con Hoy a la vista, el + y «Añadir tarea» proponen la fecha de hoy y el proyecto del filtro activo (punto 27 de la sección 8). Texto original: Si el + y "Añadir tarea" con Hoy a la vista deben proponer la fecha de hoy (como la barra de alta del escritorio) y el proyecto del filtro activo.
4. ~~Eliminar espacios.~~ Resuelta el 2 de noviembre: eliminación en cascada con confirmación (punto 28). Texto original: Un espacio con proyectos archivados o completadas de más de 30 días no se puede eliminar. Opciones: eliminación en cascada con confirmación, o una forma de borrar proyectos y completadas antiguas.
5. ~~Nota de voz sin guardar.~~ Resuelta el 2 de noviembre: pedir confirmación (punto 28). Texto original: Al cerrar la hoja con texto: pedir confirmación o guardar un borrador por tarea. Decidir también si aplica a Nueva tarea.
6. ~~Editar o eliminar notas de voz guardadas.~~ Resuelta en v0.14.4 (punto 19 de la sección 8).
7. ~~Botones de una fila abierta.~~ Resuelta el 2 de noviembre: el primer toque fuera solo cierra la fila, como en iOS (punto 27). Texto original: Con Aplazar y Eliminar a la vista, un toque en otro sitio (filtro, cifra, otra fila) también actúa. En iOS ese primer toque solo cierra la fila. Cambiarlo altera el comportamiento publicado.
8. ~~Punto medio en la línea de la fila del iPhone~~ Resuelta el 2 de noviembre: solo espacio (punto 27). Texto original: («FLC · Aplazada · 9:00»). Lleva desde la v0.1 y la regla de estilo lo evita: dejar solo espacio o usar coma.
9. ~~Columnas vacías en escritorio con el panel abierto.~~ Resuelta en v0.15.1 (punto 22 de la sección 8).
10. ~~Confirmar borrados en escritorio.~~ Resuelta el 2 de noviembre: alerta de Mac (punto 28). Texto original: Sigue siendo la hoja del iPhone centrada; una alerta de Mac sería más nativa.
11. ~~Franja «Todo el día» en la vista por horas.~~ Resuelta el 2 de noviembre: tres tareas y «N más» (punto 28). Texto original: Se desplaza dentro de 96 px sin «N más».

## 10. Roadmap de mejoras (propuestas del 1 de noviembre)

Salen de una revisión de usabilidad, fluidez y diseño sobre la v0.13.1 en móvil, escritorio y el flujo diario de un director de proyecto. Todas implementadas en v0.15.0, salvo dos partes que necesitan un campo nuevo y se preguntan aparte: «aplazada desde» en R9 y la duración de los bloques en R20. Las mejoras nuevas que añadan funciones u opciones se acuerdan antes (regla 6).

| Código | Propuesta | Área | Tipo | Coste | Prioridad |
| --- | --- | --- | --- | --- | --- |
| R1 | Las tareas completadas esperan antes de salir de la lista | móvil | fluidez | bajo | alta |
| R2 | Zona táctil de 44 puntos en el círculo de completar | móvil | usabilidad | bajo | alta |
| R3 | Filas sin datos repetidos y etiquetas de proyecto legibles | ambos | diseño | bajo | alta |
| R4 | Gestos que responden a la velocidad del dedo | móvil | fluidez | bajo | alta |
| R5 | Nueva tarea con barra sobre el teclado | móvil | usabilidad | medio | alta |
| R6 | Pegar varias líneas crea varias tareas | ambos | usabilidad | bajo | alta |
| R7 | Proyecto, prioridad y hora escritos en el título, con vista previa | ambos | usabilidad | medio | alta |
| R8 | Cerrar el día siempre a la vista y con balance | ambos | usabilidad | bajo | alta |
| R9 | Repasar las aplazadas una a una por la mañana | ambos | usabilidad | bajo | alta |
| R10 | Menús anclados al dedo en lugar de hojas inferiores | móvil | diseño | medio | alta |
| R11 | Densidad de escritorio al estilo Mac | escritorio | diseño | bajo | alta |
| R12 | Semana de escritorio legible con mucha carga | escritorio | usabilidad | medio | alta |
| R13 | Botón de opciones de vista y Hoy agrupado por proyecto | ambos | usabilidad | bajo | media |
| R14 | Todas día a día y con cabeceras fijas | ambos | usabilidad | bajo | media |
| R15 | Teclado y fila seleccionada en escritorio | escritorio | usabilidad | medio | media |
| R16 | Selección múltiple y arrastre de filas en escritorio | escritorio | usabilidad | medio | media |
| R17 | Menús, ventanas ancladas e inspector propios de Mac | escritorio | diseño | medio | media |
| R18 | Repintar solo lo que cambia | ambos | fluidez | alto | media |
| R19 | Vista Mes y mini calendario en escritorio | escritorio | usabilidad | medio | media |
| R20 | Bloques de tiempo: vista por horas en Semana y Día | escritorio | usabilidad | alto | media |

- **R1. Las tareas completadas esperan antes de salir de la lista.** Hoy la fila se va a los 240 ms y la lista sube bajo el dedo. Al marcar varias seguidas, el segundo toque cae en otra tarea. Propuesta: al tocar el círculo o deslizar a la derecha, la fila se marca y se queda en su sitio, atenuada, durante 1,5 segundos. Cada nueva marca reinicia el plazo. Al terminar, todas salen a la vez con la animación actual y un solo aviso «3 tareas completadas» con Deshacer. Tocar otra vez una fila marcada la desmarca. El diseño ya pedía que la lista no saltara al marcar varias seguidas.
- **R2. Zona táctil de 44 puntos en el círculo de completar.** El círculo mide 22 por 22 puntos y es la única zona que completa. Un toque que cae 6 puntos fuera abre el detalle, que luego hay que cerrar. Se mantiene el dibujo y la zona activa pasa a 44 por 44, o a toda la columna izquierda de la fila. Lo mismo para la casilla de la selección múltiple, los círculos de «Lo primero» y el botón de plegar el resumen. Es el mínimo que fija la guía de Apple.
- **R3. Filas sin datos repetidos y etiquetas de proyecto legibles.** La fila deja de repetir lo que ya dice la pantalla. En Hoy y en el grupo Hoy de Todas no se escribe «Hoy»; en las aplazadas va «Aplazada» en naranja. Dentro de un proyecto, en la agrupación por proyecto o con un filtro de proyecto activo, no se pinta la cápsula del proyecto. En Completadas por día basta la hora, sin tachado. Los indicadores de notas y de voz pasan a la derecha, junto a la prioridad. Una fila sin más datos queda en una línea de unos 52 puntos en lugar de 60 a 66. La cápsula que queda se hace legible: hoy el amarillo tiene un contraste de 1,4 a 1, y el verde y el naranja no llegan a 2 a 1. En tema claro el texto se oscurece mezclando el color con negro. En tema oscuro se usa la variante oscura del sistema de cada color. Todos quedan por encima de 4,4 a 1. No cambia el modelo: se sigue guardando el color claro.
- **R4. Gestos que responden a la velocidad del dedo.** Hoy solo cuenta la distancia: volver atrás exige recorrer 130 puntos, cerrar una hoja 110 y abrir los botones de una fila 70. Un gesto corto y rápido, que es lo habitual en iOS, rebota y la app parece pesada. Propuesta: volver atrás, cerrar hojas y deslizar filas aceptan también un lanzamiento rápido, como ya hace el cambio de pestaña. Mientras se arrastra una hoja, el oscurecido y la pantalla de detrás siguen al dedo. En el detalle se vuelve deslizando desde cualquier punto, salvo si el gesto empieza en un campo de texto.
- **R5. Nueva tarea con barra sobre el teclado.** Hoy, al elegir proyecto desde el chip se abre una hoja encima y, al volver, el foco no regresa al campo. El teclado se cierra y se corta el alta en serie. La hoja ocupa además unos 390 puntos sin contar el teclado. Propuesta: el campo de título y, pegada al teclado, una fila de iconos de 44 puntos para Fecha, Proyecto, Prioridad y Añadir. Cada icono despliega encima una tira de opciones sin que el campo pierda el foco. Lo elegido queda como ficha que se puede quitar. Se cancela deslizando hacia abajo o tocando fuera. «Añadir y abrir» pasa a una pulsación larga sobre Añadir. Desaparecen el párrafo de ayuda y los botones que duplican gestos.
- **R6. Pegar varias líneas crea varias tareas.** Hoy, al pegar tres líneas en Nueva tarea se crea una sola tarea con las líneas unidas sin separación. Comprobado. Propuesta: si lo pegado trae dos o más líneas, se muestra la lista y el botón «Crear N tareas». Se quitan viñetas y numeración, y en cada línea se reconoce la fecha escrita. Todas heredan el proyecto, la fecha y la prioridad elegidos. Un solo Deshacer las borra todas. Segundo paso: en el detalle, si las notas tienen líneas que empiezan por guion o casilla, el enlace «Convertir N líneas en tareas» las crea en el mismo proyecto. Es una función nueva y se acuerda antes.
- **R7. Proyecto, prioridad y hora escritos en el título, con vista previa.** Hoy asignar proyecto al crear cuesta tres toques y una hoja en el móvil. En escritorio, la barra de alta no lo permite fuera del proyecto. Y no se ve qué fecha se ha entendido hasta pulsar Intro. Propuesta: «#flc» en cualquier posición asigna el proyecto que tenga una palabra que empiece así, sin tener en cuenta acentos. «!!!» o «!!» al final fijan la prioridad, y «a las 9» pone el recordatorio. Todo se quita del título al guardar. Lo reconocido se resalta en azul dentro del campo. En el móvil marca los chips; en escritorio aparece debajo una línea con lo entendido y el Tabulador completa el proyecto. Si coinciden dos proyectos, no se asigna ninguno y se avisa. Vale también para el Atajo de iOS. La sintaxis se acuerda antes con Enric.
- **R8. Cerrar el día siempre a la vista y con balance.** Con más de 20 tareas el resumen se pliega solo y, desde la segunda apertura del día, «Pasar lo pendiente a mañana» queda oculto. Comprobado a las 19:30. Justo los días cargados el cierre no aparece. Propuesta: desde las 19:00, «Cerrar el día» aparece también como celda al final de Hoy y como enlace en el resumen plegado. Abre una hoja con lo hecho hoy, lo que queda y tres acciones: todo a mañana, solo las no prioritarias o decidir una a una. Al pie, con cuántas tareas y cuántas prioritarias empieza mañana. Reutiliza la hoja de cierre actual.
- **R9. Repasar las aplazadas una a una por la mañana.** Con los datos de prueba, Hoy abre con 68 tareas, 25 de ellas aplazadas, y la única ayuda es filtrarlas. Decidir cada una exige deslizar, tocar Aplazar y elegir en una hoja. Propuesta: el grupo Aplazadas lleva el enlace «Repasar (N)», igual que «Planificar (N)» en Sin fecha, y reutiliza ese recorrido. Para cada tarea: Hoy (la confirma y quita la marca de aplazada), Mañana, Viernes, Próxima semana, Sin fecha, Completar, Eliminar, Saltar y Terminar. Al final, un balance de lo decidido con Deshacer. Mostrar «aplazada desde el martes» necesitaría un campo nuevo en Tarea y se pregunta aparte.
- **R10. Menús anclados al dedo en lugar de hojas inferiores.** La pulsación larga abre hoy una hoja inferior con ocho botones sin iconos que tapa la fila. El diseño pedía fondo desenfocado y fila elevada, y no está hecho. Propuesta: la fila se eleva, el resto se desenfoca y junto a ella aparece un menú compacto con un icono en cada opción. Va en grupos: la prioridad en una fila de tres botones; Aplazar, Mover a proyecto y Mover a otro espacio; Duplicar y Seleccionar; Eliminar en rojo. Se puede elegir deslizando sin levantar el dedo. El mismo menú, anclado al botón que lo abre, sustituye a las hojas del selector de espacio, del botón de tres puntos del detalle y de las filas Prioridad y Proyecto del detalle. La hoja inferior queda solo para confirmar borrados.
- **R11. Densidad de escritorio al estilo Mac.** A 1280 por 800 el texto va a 17 px, las filas miden 65 px y en Hoy la primera tarea empieza a 573 px: sin desplazarse se ven tres. Propuesta, solo en escritorio: texto de 13 a 14 px y filas de una línea de 32 a 36 px, con fecha, recordatorio y prioridad en columnas alineadas a la derecha. El resumen del día pasa a una línea de cabecera, con las cifras como filtro y «Lo primero» plegable. Los chips de proyecto pasan a un desplegable «Proyecto: Todos». Barra lateral gris translúcida y contenido en blanco. La lista crece con la ventana hasta unos 900 px y el buscador va en su cabecera. Caben unas 19 filas en lugar de 9.
- **R12. Semana de escritorio legible con mucha carga.** Medido con 150 tareas a 1280 px: columnas de 132 px con títulos partidos a media palabra, la columna de hoy mide 5.110 px y arrastra toda la página, y cinco columnas están vacías porque los días pasados nunca tienen pendientes. Propuesta: por defecto, siete días desde hoy, con opción de lunes a domingo; en esa opción, los días pasados se estrechan. Cada columna hace su propio desplazamiento con la cabecera fija. La cabecera del día muestra el número de tareas, las prioritarias y una barra de carga, naranja con más de 8 y roja con más de 12. Tarjetas de una línea con el título completo al pasar el ratón; si tienen recordatorio, la hora a la derecha y orden por hora. Las aplazadas llevan borde naranja. Sin fecha pasa a una bandeja lateral plegable, sin el corte actual en 40 tarjetas.
- **R13. Botón de opciones de vista y Hoy agrupado por proyecto.** Antes de la primera tarea de Todas se apilan buscador, segmento, chips de proyecto y un segundo segmento. Propuesta: en el lado derecho de la barra de Tareas, hoy vacío, un botón de tres puntos con Seleccionar tareas, Mostrar completadas, Agrupar por fecha o por proyecto y Mostrar resumen del día. Desaparece el segundo segmento y la selección múltiple deja de depender de la pulsación larga. La agrupación por proyecto llega también a Hoy: un grupo por proyecto en el orden de la pestaña Proyectos, con su color y su contador, y las aplazadas marcadas en la fila. Tocar la cabecera de un grupo filtra por ese proyecto. Agrupar Hoy es una opción nueva y se acuerda antes.
- **R14. Todas día a día y con cabeceras fijas.** El sábado 31, Todas muestra solo Hoy, Más adelante (30) y Sin fecha, porque Esta semana termina el domingo. No se ve qué día va cargado. Propuesta: en Todas por fecha, un grupo por día para los próximos 14 días con tareas, después uno por mes y al final Sin fecha. Cada cabecera de día lleva un botón para añadir con esa fecha y, con pulsación larga, «Mover estas N» a otro día con Deshacer. Las cabeceras de grupo quedan fijas arriba al desplazarse, con fondo translúcido y recuento, en Todas, en la pantalla de un proyecto y en Completadas. El calendario de la hoja Fecha marca la carga con uno, dos o tres puntos.
- **R15. Teclado y fila seleccionada en escritorio.** Hoy las flechas, Espacio, Intro, Supr y Comando Z no hacen nada, y las filas no reciben el foco. Propuesta: una fila seleccionada, distinta del resaltado del ratón. Las flechas arriba y abajo, o J y K, la mueven y, con el panel abierto, el panel la sigue como en Mail. Espacio abre o cierra el panel. Intro o doble clic editan el título en la propia fila; Intro guarda y Esc cancela. Atajos de una tecla fuera de los campos: C completa; 1, 2 y 0 fijan la prioridad; H hoy, M mañana, V viernes, S próxima semana; F abre Fecha y P Proyecto; Supr elimina con confirmación. Comando Z deshace la última acción y la tecla de interrogación muestra los atajos. Se evitan los que captura el navegador. Lista y filas con roles de accesibilidad y anillo de foco visible.
- **R16. Selección múltiple y arrastre de filas en escritorio.** En escritorio no hay selección múltiple: Comando y clic abre el detalle, y el menú quita «Seleccionar varias». Solo se arrastran las tarjetas de Semana. Propuesta: Comando y clic añade o quita una fila, Mayúsculas y clic selecciona un tramo, Comando A todas las visibles. Con dos o más, el panel muestra «N tareas seleccionadas» con Completar, Aplazar, Fecha, Proyecto, Prioridad, Mover a espacio y Eliminar, reutilizando las acciones en bloque del móvil. Las filas de cualquier lista se arrastran, solas o en grupo, a un proyecto de la barra lateral, a Sin proyecto, a Hoy o a un día de Semana. El destino se resalta y todo tiene Deshacer. No se reordena dentro de la lista.
- **R17. Menús, ventanas ancladas e inspector propios de Mac.** En escritorio, el clic derecho abre una hoja de iPhone en el centro, lejos del puntero, con «Cancelar». El panel de detalle es la pantalla del iPhone en un lateral: cada dato abre otra hoja y cambiar la prioridad cuesta tres clics. Propuesta: menú contextual en la posición del puntero, con submenús de Fecha, Prioridad y Proyecto, marca en el valor actual y atajo a la derecha. Fecha, Recordatorio, Proyecto y Prioridad se eligen en ventanas pequeñas ancladas al control. El panel pasa a inspector: prioridad en segmento de tres posiciones, proyecto en desplegable, botón de cerrar, ancho ajustable y fechas de creación y cambio al pie. En Semana, clic en una tarjeta abre el detalle en una ventana anclada a ella, para no estrechar las columnas a 75 px. En el iPhone no cambia nada.
- **R18. Repintar solo lo que cambia.** render() reconstruye la pestaña activa y toda la pila de pantallas en cada acción. Medido con 150 tareas y la CPU cuatro veces más lenta: abrir un detalle tarda 129 ms antes de animar, cada tecla en Buscar 115 ms y completar 180 ms. Con 600 tareas, entre 540 y 890 ms. Propuesta por pasos. Primero, entrar y salir de una pantalla pinta solo esa pantalla; es barato y es lo que más se nota. Después, completar, aplazar o cambiar prioridad o proyecto actualizan solo la fila y los contadores, y la búsqueda filtra las filas existentes. En escritorio, barra lateral, columna y panel se repintan por separado, el panel entra deslizando y no se pierden el foco ni la fila seleccionada. Al final, listas virtualizadas desde 200 filas, como pide el diseño.
- **R19. Vista Mes y mini calendario en escritorio.** Solo existe la vista Semana, y el calendario mensual vive dentro de la hoja Fecha sin mostrar tareas. Propuesta: una vista Mes de seis semanas que ocupa toda la columna, con hasta cuatro tareas por día (color del proyecto, prioridad y hora) y «N más» para el resto. Arrastrar una tarea a otro día cambia la fecha, con Deshacer. Doble clic en un día vacío crea una tarea con esa fecha, y clic en el número del día abre su semana. En la barra lateral, bajo Semana, un mes en miniatura con puntos en los días con pendientes; clic en un día abre su semana y soltar una tarea encima le pone esa fecha. Ambos reutilizan el calendario que ya existe y no cambian el modelo.
- **R20. Bloques de tiempo: vista por horas en Semana y Día.** Responde a la petición de bloques de tiempo. Propuesta: en Semana, un control Lista u Horas, y una vista Día con el mismo motor. En modo Horas, arriba una franja «Todo el día» con las tareas con fecha y sin hora; debajo, una rejilla de 7:00 a 21:00 en tramos de media hora y una línea roja en la hora actual. Las tareas con recordatorio aparecen como bloques de media hora. Arrastrar una tarea a un tramo le pone fecha y recordatorio a esa hora, con Deshacer; devolverla a «Todo el día» le quita la hora. En pantallas de más de 1400 px, Hoy muestra a la derecha la agenda del día con el mismo componente. El recordatorio hace de hora de inicio, así que no cambia el modelo. Dar duración a un bloque necesitaría un campo nuevo en Tarea y se pregunta antes.


## 11. Roadmap de mejoras (propuestas del 2 de noviembre)

Orden acordado con Enric: primero Siri y el Atajo de iOS (decisión pendiente 1) y Responsable con «Enviar recordatorio»; después estas mejoras; luego la fase 2 de tareas compartidas (punto 43 de la sección 8) y, al final, Outlook (punto 44). Las que añaden campos u opciones se diseñan y se acuerdan antes de construir (regla 6).

| Código | Mejora | Coste |
| --- | --- | --- |
| M4 | Resumen de estado para compartir: texto por proyecto con lo hecho en la semana, en curso, por confirmar y próximos pasos, para Teams, correo o Claude | bajo |
| M2 | Fecha límite aparte de la fecha de trabajo, en rojo al acercarse aunque la tarea se aplace | bajo o medio, campo nuevo |
| M1 | Plantillas de tareas con fechas relativas (preparar SteerCo, workshop, cierre de mes, go-live) | medio, dato nuevo |
| M5 | Bloqueo con Face ID o Touch ID al abrir la app tras un tiempo sin usarla | bajo o medio |
| M3 | Revisión semanal guiada el viernes: completado, pendiente por proyecto, por confirmar, sin fecha y la semana siguiente | bajo |
| M6 | Filtros guardados («Prioritarias de OCA esta semana», «Esperando al cliente») | medio |
| M7 | Transcribir los audios grabados y proponer tareas a partir de ellos | por definir |

M7, condición de Enric: **sin ningún coste**. Se descartan los servicios de pago. Vía propuesta: transcripción en el propio dispositivo con un modelo Whisper que se ejecuta en el navegador (gratis y sin que el audio salga del equipo, lo que además encaja con la política de datos de clientes), primero en el ordenador y en el iPhone si el rendimiento lo permite; la descarga del modelo pesa entre 40 y 250 MB según la calidad. Se diseña con Enric antes de construir.

---

# Gestor de tareas personal. Diseño funcional v1

31 de octubre de 2026. Enric

## Objetivo y principios

Gestor de tareas personal para el iPhone, con aspecto nativo de iOS, que se trabaja desde una lista única y se sincroniza con una futura versión de escritorio. Referencia de uso: Microsoft To Do y Recordatorios de iOS.

Principios que guían las decisiones de diseño y desarrollo:

1. Sencillez: una tarea se crea en dos toques y se cierra con un gesto. Pocas opciones y ninguna pantalla de configuración compleja.
2. Lista única como lugar de trabajo. Los proyectos clasifican y filtran, no organizan.
3. Aspecto iOS: tipografía del sistema, hojas inferiores, tab bar, gestos de deslizar, colores y espaciados de Human Interface Guidelines.
4. Funciona sin conexión. Los datos se guardan en el dispositivo y se sincronizan con Supabase cuando hay red.
5. Datos propios y exportables en JSON en cualquier momento.
6. Lo accesorio se deja para fases posteriores (ver roadmap).

## Alcance de la fase 1

La fase 1 entrega una app usable a diario en el iPhone con todo lo necesario para capturar, priorizar y cerrar tareas. Todo lo demás queda en el roadmap.

| Entra en fase 1 | Queda fuera |
| --- | --- |
| Espacios Trabajo y Personal, con selector | Compartir cada espacio: equipo en Trabajo, familia en Personal (fase 2) |
| Resumen del día en la cabecera de Tareas | Vista de escritorio (fase 2, mismo backend) |
| Lista única de tareas con filtros Hoy y Todas | Subtareas, etiquetas, repetición |
| Proyectos con color, como etiqueta y como filtro | Adjuntar archivos o imágenes |
| Fecha, prioridad (3 niveles), notas de texto | Ordenación manual, arrastrar y soltar |
| Recordatorios con notificación en el iPhone | Compartir audios y recibir audios desde WhatsApp |
| Notas de voz transcritas a texto | Integraciones de calendario y widgets de iOS |
| Gestos: completar, aplazar a mañana, eliminar | Modo oscuro (se añade en fase 2 si el estilo base lo permite sin coste) |
| Búsqueda por texto |  |
| Compartir una tarea por la hoja de compartir de iOS (Claude, WhatsApp, correo, Teams) |  |
| Inicio de sesión con Google y sincronización con Supabase |  |
| Exportar JSON |  |

## Modelo de datos

Cuatro entidades más la suscripción de notificaciones. Los campos propietario, miembros y asignados existen desde el inicio para no migrar datos en la fase 2, pero no se muestran en la interfaz.

**Espacio**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | uuid |  |
| nombre | texto | Trabajo y Personal se crean al dar de alta la cuenta; no se crean más en fase 1 |
| orden | entero |  |
| propietario | uuid usuario | reservado para fase 2 |
| miembros | lista de uuid | reservado para fase 2: equipo en Trabajo, familia en Personal. El acceso se controla por espacio |
| creado, modificado | fecha y hora |  |

**Proyecto**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | uuid |  |
| espacio_id | uuid | obligatorio; un proyecto pertenece a un solo espacio |
| nombre | texto | obligatorio |
| color | texto | uno de los 8 colores del sistema iOS |
| orden | entero | posición en la pestaña Proyectos |
| archivado | booleano | los proyectos archivados no aparecen en chips ni filtros |
| propietario | uuid usuario | reservado para fase 2 |
| creado, modificado | fecha y hora |  |

**Tarea**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | uuid |  |
| titulo | texto | obligatorio, una línea |
| espacio_id | uuid | obligatorio; se toma del proyecto o, sin proyecto, del espacio activo |
| proyecto_id | uuid | opcional; sin proyecto se muestra en gris sin etiqueta |
| fecha | fecha | opcional; sin hora |
| recordatorio | fecha y hora | opcional; dispara una notificación a esa hora |
| prioridad | enumerado | alta, media, ninguna (valor por defecto) |
| estado | enumerado | pendiente, hecha |
| notas | texto largo | texto libre, sin formato |
| propietario, asignados | uuid, lista de uuid | reservados para fase 2 |
| creado, modificado, completado | fecha y hora | completado se rellena al marcar hecha |

**Nota de voz**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | uuid |  |
| tarea_id | uuid |  |
| transcripcion | texto largo | editable por el usuario tras transcribir |
| creado | fecha y hora |  |
| modificado | fecha y hora | se rellena al editar la nota (v0.14.4) |

**Suscripción de notificaciones**

| Campo | Tipo | Notas |
| --- | --- | --- |
| id | uuid |  |
| usuario_id | uuid |  |
| endpoint, claves | texto | datos de la suscripción Web Push del dispositivo |
| dispositivo | texto | nombre legible, para revocar desde Ajustes |
| creado | fecha y hora |  |

El audio no se guarda en fase 1. Las tareas hechas se muestran en un bloque plegado durante 30 días y después dejan de cargarse en la lista, aunque siguen en la base de datos.

## Navegación y pantallas

Tres pestañas en una tab bar iOS. La app abre siempre en Tareas con el filtro Hoy activo. Botón "+" flotante, abajo a la derecha, en Tareas y en el detalle de un proyecto.

| Pestaña | Qué muestra |
| --- | --- |
| Tareas | Lista única de pendientes del espacio activo. En la cabecera, el selector de espacio (Trabajo o Personal) y el resumen del día; debajo, barra de búsqueda y dos filtros en segmento iOS: Hoy (vencidas y de hoy) y Todas. Es la pantalla de trabajo |
| Proyectos | Proyectos del espacio activo con color y contador de pendientes, más la entrada "Sin proyecto". Al entrar, la misma lista de tareas filtrada por ese proyecto |
| Ajustes | Cuenta (correo, cerrar sesión), Notificaciones (permiso y dispositivos), Exportar JSON, Proyectos archivados, versión |

**Selector de espacio**

El título grande de Tareas es el nombre del espacio activo con un chevron. Tocarlo abre un menú con Trabajo y Personal. El espacio activo se recuerda entre sesiones y condiciona Tareas, Proyectos y el botón "+". No hay vista combinada: lo personal y lo profesional no se mezclan nunca en pantalla, que es la base para que en fase 2 cada espacio se comparta con personas distintas.

**Resumen del día**

Tarjeta en la cabecera de Tareas, visible con el filtro Hoy. Arriba, tres cifras en línea: vencidas, para hoy y prioritarias. Debajo, "Lo primero": las tres tareas de prioridad alta de hoy o, si hay menos, las tres primeras del orden fijo, cada una tocable y completable desde la propia tarjeta. Si hay un recordatorio en las próximas dos horas, aparece como línea adicional con la hora. Se pliega con un chevron y el estado se recuerda. Sin gráficos. No aparece con el filtro Todas ni dentro de un proyecto.

**Pantalla Tareas**

Cada fila: círculo de completar a la izquierda, título en una línea, debajo en gris pequeño la etiqueta de proyecto con su color y la fecha. Las vencidas muestran la fecha en rojo. La prioridad alta se marca con un signo de exclamación rojo a la derecha; la media, en naranja.

Orden fijo: vencidas, hoy, prioridad alta, resto por fecha ascendente y sin fecha al final. Dentro de cada grupo, por fecha de creación. Sin opciones de ordenación manual.

Al pie de la lista, bloque plegado "Completadas" con las hechas de los últimos 30 días.

**Pantalla Proyectos**

Lista simple con el color del proyecto, nombre y contador. Botón "Nuevo proyecto" al final. Pulsación larga sobre un proyecto: renombrar, cambiar color, archivar. Al entrar en un proyecto, el "+" preselecciona ese proyecto.

**Añadir rápido**

Hoja inferior con el teclado ya abierto. Campo de título y tres chips debajo: fecha (Hoy, Mañana, Elegir), proyecto, prioridad. Enter o "Añadir" guarda y cierra. La tarea queda en la lista única aunque no se le asigne proyecto.

**Detalle de tarea**

Se abre al tocar la fila. Pantalla completa con navegación atrás. Contenido de arriba abajo: título editable, fila Proyecto, fila Fecha, fila Recordatorio (fecha y hora, opcional), selector de prioridad en tres segmentos, área de notas de texto, lista de notas de voz con su transcripción y fecha, y dos botones al pie: "Nota de voz" y "Enviar a Claude". Eliminar tarea en el menú de tres puntos.

## Interacciones y gestos

Las acciones frecuentes se resuelven con un gesto sobre la fila, sin abrir el detalle.

| Gesto | Acción | Comportamiento |
| --- | --- | --- |
| Tocar el círculo | Completar | Animación breve de marcado y la fila pasa a Completadas. Tocar de nuevo la devuelve a pendiente |
| Deslizar a la derecha | Completar | Misma acción que el círculo, con fondo verde |
| Deslizar a la izquierda | Mañana, Eliminar | Dos botones. Mañana pone la fecha en el día siguiente. Eliminar pide confirmación |
| Pulsación larga | Cambiar prioridad | Menú contextual iOS con alta, media, ninguna |
| Tocar la fila | Abrir detalle |  |
| Tirar hacia abajo | Sincronizar | Fuerza una sincronización con Supabase y muestra la hora de la última |

Al completar una tarea desde el filtro Hoy, la lista no se reordena hasta que el usuario vuelve a la pestaña, para evitar saltos mientras marca varias seguidas. Todas las acciones ofrecen "Deshacer" durante 4 segundos en una barra inferior.

## Notas de voz con transcripción

El botón "Nota de voz" del detalle graba, transcribe en el momento y guarda solo el texto como nota de voz de la tarea. El audio no se conserva en fase 1.

Flujo:

1. Tocar "Nota de voz". Se abre una hoja inferior con un botón grande de micrófono y el texto apareciendo en tiempo real.
2. Tocar de nuevo para parar. El texto queda editable en la misma hoja.
3. "Guardar" añade la transcripción a la lista de notas de voz de la tarea con fecha y hora. "Descartar" cierra sin guardar.

Tecnología: Web Speech API de Safari (SpeechRecognition) con idioma es-ES por defecto y reconocimiento continuo. Si la API no está disponible o falla en modo PWA instalada, la hoja muestra el área de texto con el foco puesto para usar el dictado nativo del teclado de iOS, que escribe en el campo igual que el teclado. El resultado es el mismo para el usuario y para el modelo de datos.

Punto a validar en desarrollo: comportamiento de SpeechRecognition en Safari con la app instalada en pantalla de inicio. Si no funciona de forma estable, el respaldo pasa a ser la vía principal.

## Enviar a Claude

El botón "Enviar a Claude" del detalle compone un texto con el contexto completo de la tarea y abre la hoja de compartir de iOS (Web Share API). Desde ahí se elige la app de Claude y el texto llega como primer mensaje del chat. La misma hoja permite enviarlo por WhatsApp, Mail o Teams sin código adicional.

Formato del texto compartido:

```markdown
Tarea: Preparar comité de seguimiento
Proyecto: FLC
Fecha: 3 de noviembre de 2026
Prioridad: alta

Notas:
(texto de las notas)

Notas de voz:
- 31/10 09:15: (transcripción)
- 31/10 18:40: (transcripción)
```

Si el dispositivo no soporta Web Share, el botón copia el texto al portapapeles y muestra un aviso. No se usa ningún esquema de URL propio de la app de Claude, porque no hay uno documentado; si en el futuro existe, se añadirá como acceso directo.

## Recordatorios y notificaciones

Una tarea puede llevar un recordatorio con fecha y hora, y a esa hora el iPhone muestra una notificación aunque la app esté cerrada. Es posible en una web app desde iOS 16.4 con dos condiciones: la app instalada en pantalla de inicio y el permiso de notificaciones concedido desde la propia app.

Flujo:

1. En el detalle, la fila Recordatorio abre el selector nativo de fecha y hora con dos atajos: "Mañana a las 9:00" y "Elegir".
2. La primera vez que se pone un recordatorio, la app explica en una frase para qué pide el permiso y lo solicita. Si se deniega, la fila sigue funcionando pero avisa de que no habrá notificación.
3. La notificación muestra el título de la tarea y el proyecto. Tocarla abre el detalle. Completar la tarea cancela el recordatorio.
4. La insignia del icono muestra el número de tareas vencidas o de hoy (navigator.setAppBadge), si el iPhone lo soporta.

Tecnología: Web Push con claves VAPID. La app guarda la suscripción del dispositivo en Supabase. Una Edge Function programada cada minuto (pg_cron) busca recordatorios cuya hora ha llegado y envía la notificación. Un recordatorio se envía una sola vez; se marca como enviado.

Riesgo a validar en su bloque de construcción: permiso y entrega de notificaciones con la app instalada. Si no es estable, el respaldo es mostrar las alertas pendientes al abrir la app y mantener la insignia.

## Arquitectura técnica y sincronización

PWA estática publicada desde GitHub Pages, con Supabase como backend en capa gratuita. Mismo esquema que la app de lectura, cambiando Google Drive por Supabase.

| Capa | Decisión |
| --- | --- |
| Front | React con Vite, TypeScript, una sola página. Instalable en pantalla de inicio (manifest y service worker) |
| Estado local | IndexedDB (Dexie) como copia completa de proyectos, tareas y notas de voz. La interfaz lee siempre de local |
| Backend | Supabase: Postgres con tablas espacio, proyecto, tarea, nota_voz y suscripcion_push; autenticación con Google; Row Level Security por espacio (en fase 1 solo el propietario; en fase 2, los miembros de cada espacio). Edge Function con pg_cron para las notificaciones |
| Sincronización | Al abrir la app, tras cada cambio con red y al tirar hacia abajo. Cola de cambios pendientes cuando no hay red. Conflicto por registro: gana el modificado más reciente |
| Tiempo real | Suscripción a cambios de Supabase para reflejar en el móvil lo que se haga desde escritorio en fase 2 |
| Exportación | Botón en Ajustes que descarga un JSON con las tres entidades |
| Publicación | Repositorio en GitHub, despliegue automático en GitHub Pages; claves de Supabase en variables de entorno de build |

## Diseño visual y comportamiento táctil

La app tiene que pasar por nativa: quien la use no debe notar que es una web. Esto es un requisito de primer nivel, al mismo nivel que la funcionalidad, y se revisa en el iPhone al cerrar cada bloque de construcción.

**Sistema visual**

| Elemento | Decisión |
| --- | --- |
| Tipografía | Fuente del sistema (-apple-system, SF Pro). Título de pantalla 34 px grande y 17 px al compactarse al hacer scroll; cuerpo 17 px; secundario 15 px; etiquetas 13 px. Respetar el tamaño dinámico del sistema |
| Color | Acento azul del sistema (#007AFF). Fondo de pantalla gris agrupado (#F2F2F7), filas blancas, separadores de 0,5 px (#C6C6C8). Texto primario negro, secundario gris (#8E8E93). Prioridad alta en rojo del sistema, media en naranja. Los ocho colores de proyecto son los de Recordatorios |
| Formas | Grupos de filas con esquinas de 10 px, botones de 44 px de alto mínimo, chips con esquinas completas. Sin sombras ni degradados |
| Iconos | Juego de iconos de línea coherente con SF Symbols (por ejemplo Lucide). Peso y tamaño homogéneos, 22 px en la tab bar y 20 px en filas |
| Barras | Barra de navegación translúcida con desenfoque, título grande que se compacta. Tab bar translúcida de 49 px más área segura inferior. Botón "+" flotante de 56 px con sombra suave, única sombra de la app |
| Estados vacíos | Icono grande en gris y una frase corta. Sin ilustraciones |

**Navegación y transiciones**

| Movimiento | Comportamiento |
| --- | --- |
| Entrar en detalle o en un proyecto | Transición de empuje lateral: la pantalla nueva entra desde la derecha y la anterior se desplaza un tercio hacia la izquierda, 350 ms con curva del sistema |
| Volver atrás | Deslizar desde el borde izquierdo con seguimiento del dedo (interactivo, no al soltar) y botón "<" en la barra. Si se suelta antes de un tercio, vuelve a su sitio |
| Cambio de pestaña | Instantáneo, sin animación, como en iOS. Cada pestaña conserva su posición de scroll |
| Hojas inferiores (añadir rápido, nota de voz, fecha) | Suben desde abajo con asa superior, fondo oscurecido, se cierran arrastrando hacia abajo o tocando fuera. La pantalla de detrás se escala ligeramente |
| Menús contextuales (pulsación larga) | Menú con fondo desenfocado y la fila elevada, al estilo iOS. Cerrar tocando fuera |
| Selectores | Segmento iOS para Hoy y Todas y para prioridad; rueda o calendario nativo para la fecha según lo que Safari ofrezca con menos fricción |
| Deslizar fila | Los botones aparecen con el movimiento del dedo. Deslizamiento largo ejecuta la acción principal sin soltar sobre el botón |

**Fluidez y respuesta táctil**

Reglas fijas, aprendidas en las apps de ajedrez y de lectura:

1. Toda animación usa solo transform y opacity, nunca propiedades que fuercen recálculo de layout. Objetivo 60 fps en un iPhone de hace cuatro años.
2. Respuesta inmediata al toque: sin retraso de 300 ms, con touch-action definido y resaltado de fila al pulsar.
3. El cuerpo de la página no hace scroll ni rebota: overscroll-behavior en none, scroll solo dentro de cada lista. El rebote de iOS se mantiene dentro de la lista, que es donde se espera.
4. Sin selección de texto ni menú de copiar en elementos de interfaz; sin zoom por doble toque; sin resaltado gris de Safari al tocar.
5. Área segura respetada en todas las barras (viewport-fit=cover y env(safe-area-inset)). Nunca usar 100vh: la altura se toma de visualViewport para que las hojas se recoloquen al abrir el teclado.
6. Listas virtualizadas a partir de 200 filas. Completar una tarea anima solo esa fila.
7. Toque háptico breve al completar, al cambiar prioridad y al llegar al umbral de un deslizamiento, con la API de vibración donde esté disponible.
8. Con "Reducir movimiento" activado en iOS, las transiciones pasan a fundidos.

**Modo instalado en pantalla de inicio**

Lo que fallaba o había que vigilar en las otras apps y aquí se resuelve desde el inicio: manifest completo con icono y color de fondo, barra de estado integrada, sin barra de direcciones; inicio de sesión de Google probado en modo instalado (en la app de lectura era el primer riesgo); almacenamiento persistente solicitado con navigator.storage.persist() para que Safari no borre la caché local; gestión de la caché de la PWA para que una actualización no deje una versión vieja colgada (aviso de "Nueva versión, toca para actualizar").

## Roadmap

| Fase | Contenido | Puerta de salida |
| --- | --- | --- |
| Fase 1: app móvil | Espacios Trabajo y Personal; resumen del día y lista única; proyectos como etiqueta y filtro; fecha, prioridad y notas; recordatorios con notificación; notas de voz transcritas; gestos, búsqueda y compartir; Supabase, Google y GitHub Pages | App en uso diario sin incidencias durante dos semanas |
| Fase 2: escritorio y equipo | Web de escritorio con el mismo backend; compartir Trabajo con el equipo; compartir Personal con la familia; asignar tareas a personas; modo oscuro | Escritorio y uso en equipo estables durante un mes |
| Fase 3: ampliaciones | Subtareas y etiquetas; repetición de tareas; adjuntos de archivos; ordenación manual; widgets de iOS y calendario; audios a WhatsApp, correo y Teams; recibir audios desde WhatsApp | Según uso real |

Cada fase arranca cuando la anterior supera su puerta. No se fijan fechas: la fase 1 se da por cerrada cuando la app se usa a diario sin incidencias durante dos semanas, y la fase 2 cuando la versión de escritorio y el uso en equipo llevan un mes estables. El orden de las ampliaciones de la fase 3 se decidirá con el uso real.

**Backlog de compartir y audios (fase 3)**

Compartir texto ya queda cubierto en fase 1: el botón Compartir del detalle abre la hoja de iOS y desde ahí se elige Claude, WhatsApp, Mail o Teams. Lo que queda para fase 3 es el audio en los dos sentidos:

1. Compartir audios: conservar el audio de las notas de voz (hoy solo se guarda el texto) en Supabase Storage y poder enviarlo por la misma hoja de compartir.
2. Recibir audios desde WhatsApp: una PWA en iOS no puede aparecer como destino en la hoja de compartir, así que la vía es un Atajo de iOS que recibe el audio desde WhatsApp y lo sube a Supabase. La app lo muestra en una bandeja "Audios recibidos", lo transcribe si es posible y, como mínimo, lo reproduce.
3. Caducidad: cada audio recibido lleva fecha de caducidad a los 2 días. Si no se ha asociado a una tarea antes, se borra solo. Asociarlo a una tarea lo conserva.

## Indicaciones para Claude Code

Este documento es la especificación de la fase 1. Construir en este orden y detenerse al final de cada bloque para revisar en el iPhone antes de seguir.

**Situación de partida (31 de octubre de 2026).** La primera versión (v0.1) se ha construido como página publicada desde el chat, en un solo archivo HTML sin dependencias, con los datos guardados en el propio iPhone (localStorage) y sin GitHub, Supabase ni notificaciones. Cubre los bloques 1 a 7 de la lista siguiente. Actividad prioritaria pendiente: crear el repositorio en GitHub, llevar ese archivo como punto de partida, activar GitHub Pages y continuar desde ahí con Claude Code (bloques 8 a 10, que necesitan servidor).

1. Esqueleto: proyecto Vite con React y TypeScript, PWA instalable, tab bar con las tres pestañas vacías, despliegue en GitHub Pages funcionando.
2. Datos locales: esquema en IndexedDB con Dexie (espacios, proyectos, tareas, notas de voz), selector de espacio, lista única con filtros Hoy y Todas, orden fijo, añadir rápido.
3. Resumen del día: tarjeta en la cabecera de Tareas con cifras y "Lo primero".
4. Detalle y gestos: pantalla de detalle, completar, deslizar, pulsación larga, Deshacer, bloque de Completadas.
5. Proyectos: pestaña, filtro por proyecto, renombrar, color, archivar.
6. Notas de voz: hoja de grabación con Web Speech API, respaldo con dictado del teclado, prueba en PWA instalada.
7. Compartir: composición del texto y Web Share API, con copia al portapapeles como respaldo.
8. Supabase: tablas, Row Level Security por espacio, inicio de sesión con Google, sincronización con cola de cambios y suscripción en tiempo real.
9. Recordatorios y notificaciones: fila Recordatorio, suscripción Web Push, Edge Function con pg_cron, insignia del icono, prueba de entrega con la app instalada.
10. Ajustes: cuenta, notificaciones, exportar JSON, proyectos archivados.

Restricciones: sin librerías de componentes pesadas (el estilo iOS se hace con CSS propio), sin dependencias que no funcionen en Safari iOS, interfaz en español, código y comentarios en inglés. Mantener un archivo CHANGELOG.md con lo entregado en cada bloque. La sección "Diseño visual y comportamiento táctil" es vinculante: cada bloque incluye las transiciones, gestos y reglas de fluidez que le afectan, no se dejan para el final.

Dudas que Claude Code debe resolver preguntando, no asumiendo: cualquier función no descrita aquí, cualquier cambio en el modelo de datos y cualquier opción de configuración nueva.
