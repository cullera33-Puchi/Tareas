# CLAUDE.md. Gestor de tareas personal (Tareas)

Instrucciones de trabajo para Claude Code. Léelo entero antes de tocar código. Debajo de la línea va el diseño funcional completo, que es la especificación vinculante.

## 1. Qué es esto

App web personal de gestión de tareas para iPhone (PWA instalada en pantalla de inicio), con aspecto y comportamiento de app nativa de iOS. Un solo usuario de momento (Enric). Más adelante, versión de escritorio y uso compartido por espacios.

## 2. Estado actual (31 de octubre de 2026)

- Existe una **v0.1 funcional** en un solo archivo, `tareas.html`, construida desde el chat de Claude y publicada como artefacto. Sin dependencias, sin build, datos en `localStorage` del dispositivo.
- Cubre los bloques 1 a 7 del plan de construcción: espacios Trabajo y Personal, resumen del día, lista única con filtros Hoy y Todas, búsqueda, añadir rápido, detalle (proyecto, fecha, recordatorio, prioridad, notas), gestos de fila, Deshacer, proyectos con color, notas de voz por dictado (Web Speech API con respaldo de teclado), Compartir por Web Share, exportar e importar JSON, tema automático, claro u oscuro.
- No existe todavía: repositorio, Supabase, inicio de sesión, sincronización, notificaciones push.
- Ese archivo `tareas.html` es el punto de partida. Conserva su comportamiento y su aspecto; no lo reescribas desde cero.

## 3. Primer encargo (actividad prioritaria)

1. Crear el repositorio en GitHub (`tareas`) y activar GitHub Pages desde la rama principal.
2. Subir `tareas.html` como `index.html` en la raíz, añadir `manifest.webmanifest` (nombre "Tareas", `display: standalone`, iconos 192 y 512, `background_color` #F2F2F7, `theme_color` #F9F9F9) y un `sw.js` mínimo con caché de la app y aviso de nueva versión.
3. Comprobar en el iPhone, instalada en pantalla de inicio: arranque, gestos, dictado, Compartir, insignia.
4. Solo cuando lo anterior funcione, continuar con el bloque 8 (Supabase) del plan de construcción.

Decisión sobre la migración a Vite y React que menciona el diseño: **no es obligatoria**. Si la app crece y el único archivo se vuelve difícil de mantener, migrar en un bloque propio, manteniendo el CSS y los gestos actuales. Mientras tanto, seguir en HTML, CSS y JavaScript sin build es aceptable y más rápido de desplegar.

## 4. Estructura propuesta del repositorio

```
tareas/
├── index.html          app completa (v0.1 parte de tareas.html)
├── manifest.webmanifest
├── sw.js               service worker: caché y aviso de actualización
├── icons/              192 y 512 px
├── supabase/           migraciones SQL y Edge Functions (bloques 8 y 9)
├── CLAUDE.md           este archivo
└── CHANGELOG.md        lo entregado en cada bloque
```

Si se migra a Vite: `src/` con `app`, `data`, `ui` y `sync`, y `public/` para manifest e iconos. GitHub Pages pasa a desplegar `dist/` con una acción.

## 5. Reglas fijas

1. Interfaz en español. Código, nombres y comentarios en inglés.
2. Sin librerías de componentes. El aspecto iOS se hace con CSS propio. Sin dependencias que no funcionen en Safari iOS.
3. Toda animación con `transform` y `opacity`. El cuerpo no hace scroll; cada lista hace el suyo. Área segura respetada. Nunca `100vh`.
4. Las claves de Supabase van en variables de entorno o en un `config.js` excluido del repositorio con `.gitignore`. Nunca en commits.
5. Cada bloque se cierra probando en el iPhone instalado en pantalla de inicio, y se anota en `CHANGELOG.md`.
6. Cualquier función no descrita en el diseño, cualquier cambio en el modelo de datos y cualquier opción de configuración nueva se pregunta antes de implementar.
7. Los datos locales son la verdad para la interfaz. Supabase sincroniza; nunca bloquea la pantalla.
8. Cada versión publicada sube `APP_VERSION` en `index.html` y la constante `CACHE` en `sw.js`; sin ese cambio los iPhone instalados no reciben el aviso de nueva versión.

## 6. Plan de construcción (resumen)

| Bloque | Contenido | Estado |
| --- | --- | --- |
| 1 a 7 | Esqueleto, datos locales, resumen del día, detalle y gestos, proyectos, notas de voz, compartir | Hecho en v0.1 (localStorage, sin PWA completa) |
| 0 bis | Repositorio, GitHub Pages, manifest, service worker | Pendiente, prioritario |
| 8 | Supabase: tablas, RLS por espacio, Google, sincronización con cola y tiempo real | Pendiente |
| 9 | Recordatorios con Web Push, Edge Function con pg_cron, insignia | Pendiente |
| 10 | Ajustes: cuenta, notificaciones, exportar, archivados | Parcial (sin cuenta ni notificaciones) |

## 7. Mapa del código de v0.1 (`tareas.html`)

- CSS: tokens en `:root` (claro) con variantes oscuras por `prefers-color-scheme` y `data-theme`.
- `DB`: objeto único en `localStorage` bajo la clave `tareas-v1` con `spaces`, `projects`, `tasks`, `voiceNotes` y `settings`.
- `render()`: pinta la pestaña activa (`viewTareas`, `viewProyectos`, `viewAjustes`) y la pila de pantallas (`viewDetail`, `viewProject`). Cada pestaña conserva su scroll.
- Navegación: `push`, `pop`, `bindBackSwipe` (volver deslizando desde el borde con seguimiento del dedo).
- Gestos de fila: `bindRowGestures` (derecha completa, izquierda Mañana y Eliminar, pulsación larga prioridad).
- Hojas: `openSheet`, `actionSheet`, `addSheet`, `projectSheet`, `dateSheet`, `reminderSheet`, `voiceSheet`, `importSheet`.
- `shareTask` compone el texto y usa `navigator.share`; `exportJSON` e `importSheet` cubren la portabilidad.
- `badge()` actualiza la insignia del icono con `navigator.setAppBadge` cuando existe.

Al migrar a Supabase, cada entidad conserva sus campos y añade `owner_id`; `spaceId`, `projectId` y `taskId` pasan a `space_id`, `project_id` y `task_id` en las tablas.


## 8. Decisiones tomadas tras la v0.1

Cambios acordados con Enric sobre el diseño de abajo. Mandan sobre el texto del diseño donde difieran.

1. **Notas de voz (v0.2.1).** La Web Speech API no transcribe en Safari con la app instalada. El dictado del teclado de iOS es la vía principal: la hoja abre con el área de texto enfocada. El micrófono propio solo se ofrece en una pestaña normal de Safari.
2. **Navegación entre pestañas (v0.3.0).** Además de tocar la tab bar, se cambia de pestaña deslizando lateralmente con seguimiento del dedo. Las filas de tareas conservan sus gestos y no participan en el deslizamiento de pestaña.
3. **Cabeceras (v0.3.2).** Sin título grande de 34 px. Una sola fila de 44 puntos con el título a 22 px a la izquierda en las pestañas; en las pantallas apiladas, Atrás y título centrado a 17 px.
4. **Foco en hojas.** Los campos de las hojas se enfocan de forma síncrona dentro del toque; con `setTimeout` iOS no abre el teclado.


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
