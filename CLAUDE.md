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
16. **Backlog añadido por Enric (31 de octubre, tarde).** Pendiente de diseño detallado; no implementar sin acordar modelo y orden.
    - **Fotos en notas.** Hacer una foto con el móvil (o elegirla) y adjuntarla a una tarea; verla en el detalle y en escritorio. Necesita almacenamiento de archivos (Supabase Storage) para que viaje entre dispositivos; en local cabría en IndexedDB como paso previo. Nueva entidad `attachment` (id, task_id, kind foto|audio, path, mime, size, created). Se borra con la tarea.
    - **Notas de voz grabadas.** Además del dictado, grabar el audio (MediaRecorder, en iOS sale m4a/aac) y guardarlo como adjunto reproducible en móvil y escritorio; se borra con la tarea. Misma entidad `attachment`. Adelanta el punto 1 del backlog de fase 3.
    - **Responsables y recordatorios a personas.** Dentro de un proyecto, asignar tareas a personas (jefe, equipo); enviar un recordatorio desde una tarea o desde un grupo de tareas: si la persona usa la app, que le aparezca priorizado en su escritorio; si no, por Teams o WhatsApp. Necesita cuentas y espacios compartidos (fase 2, campo `assignees` ya reservado) y notificaciones (bloque 9). Paso previo posible sin cuentas: campo "Responsable" de texto libre y "Enviar recordatorio" por la hoja de compartir con el texto de una o varias tareas.
17. **Revisión de 1 de noviembre (v0.14.0).** Comportamientos fijados al corregir errores: la app abre siempre en Hoy; modo escritorio con al menos 900 px de ancho y 500 de alto (`wideMQ`), para que un iPhone grande en horizontal siga en móvil; varias pestañas o ventanas se sincronizan con el evento `storage` sin cerrar hojas ni perder lo escrito (`reloadFromStorage`); con la app abierta, el cambio de día ejecuta `rollOver`, redibuja y hace la copia diaria (`checkDay`); `rollOver` no toca `modified`; escribir en título y notas guarda con 400 ms de espera (`saveEdit`, `flushEdits`); acciones en bloque con un solo guardado (`batch`); listas de más de 200 filas con filas diferidas (`lazyRows`, `armRows`, `fillRows`); el detalle usa `detailTaskId()` en móvil y escritorio; el service worker solo borra cachés `tareas-*`; no se pueden elegir fechas ni recordatorios pasados. Detalle completo en el CHANGELOG. En v0.14.1 y v0.14.2: una hoja recién abierta ignora durante 450 ms los toques en el fondo, en el calendario o en el menú (`sheetFresh`), y si iOS no informa del teclado al enfocar un campo de una hoja, esta pasa a la parte superior de la pantalla (`kbFallback`, clase `.sheet.top`).
18. **Foco en hojas.** Los campos de las hojas se enfocan de forma síncrona dentro del toque; con `setTimeout` iOS no abre el teclado. Las hojas con campo de texto llevan las acciones en la cabecera (`sheadHTML`), porque en iOS 26 la barra flotante del teclado tapa el pie de la hoja (v0.14.3).
19. **Notas de voz editables (v0.14.4).** En el detalle, deslizar una nota a la izquierda muestra Eliminar (con Deshacer, sin confirmación); a la derecha, Editar, y el deslizamiento largo la abre. La hoja de edición permite corregir el texto o «Volver a dictar». Nota de voz gana el campo `modified` (en Supabase, `modified`), que se rellena solo al editar. En escritorio, clic en la nota abre Editar y Eliminar. Código: `vnHTML`, `bindVnGestures`, `editVoiceNote`, `deleteVoiceNote`, `voiceSheet(id, editId)`. En la rama del roadmap, el deslizamiento atrás desde cualquier punto del detalle (R4) debe excluir las notas de voz.


## 9. Decisiones pendientes de Enric (revisión del 1 de noviembre)

1. **Atajo de iOS (`?add=`).** Opciones: (a) avisar en Safari de que la tarea no llegará a la app instalada; (b) el Atajo copia el texto y Nueva tarea ofrece "Pegar"; (c) con el bloque 8, el Atajo envía el texto a una bandeja en Supabase que la app recoge al sincronizar. (a) y (b) añaden interfaz.
2. **Recordatorio al aplazar.** Si `rollOver`, Aplazar y "Pasar lo pendiente a mañana" deben mover también el recordatorio al nuevo día manteniendo la hora, con Deshacer. Conviene decidirlo antes del bloque 9.
3. **Nueva tarea desde Hoy.** Si el + y "Añadir tarea" con Hoy a la vista deben proponer la fecha de hoy (como la barra de alta del escritorio) y el proyecto del filtro activo.
4. **Eliminar espacios.** Un espacio con proyectos archivados o completadas de más de 30 días no se puede eliminar. Opciones: eliminación en cascada con confirmación, o una forma de borrar proyectos y completadas antiguas.
5. **Nota de voz sin guardar.** Al cerrar la hoja con texto: pedir confirmación o guardar un borrador por tarea. Decidir también si aplica a Nueva tarea.
6. ~~Editar o eliminar notas de voz guardadas.~~ Resuelta en v0.14.4 (punto 19 de la sección 8).

## 10. Roadmap de mejoras (propuestas del 1 de noviembre)

Salen de una revisión de usabilidad, fluidez y diseño sobre la v0.13.1 en móvil, escritorio y el flujo diario de un director de proyecto. Ninguna está implementada. Las que añaden funciones u opciones se acuerdan antes (regla 6).

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
