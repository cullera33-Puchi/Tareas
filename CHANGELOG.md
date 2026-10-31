# Registro de cambios

## v0.7.1. Deslizar a la derecha (31 de octubre de 2026)

- Corregido: al deslizar a la derecha aparecía el fondo rojo de Eliminar en lugar del verde de completar, porque ambos fondos ocupaban la fila entera. Ahora solo se muestra el del lado hacia el que se desliza.
- El tick del fondo verde acompaña al borde de la fila y crece con el recorrido; al cruzar el umbral da un pequeño rebote y el verde se aviva. Hay un tope elástico pasado el umbral.
- Al soltar, la fila vuelve a su sitio mientras el círculo se rellena, y a continuación se desvanece y la lista se cierra. Antes salía volando por la derecha y la lista se repintaba de golpe.

## v0.7.0. Lotes 3 y 4: estética iOS y usabilidad (31 de octubre de 2026)

Estética
- Detalle al estilo Recordatorios: título y notas en el primer grupo de celdas; Proyecto, Fecha, Recordatorio y Prioridad como filas con valor y chevron; Compartir y el menú (Marcar completada, Eliminar) en la barra superior; "Añadir nota de voz" como fila del grupo de notas de voz. Desaparecen los dos botones grandes y el desplegable.
- Círculo de completar: al tocarlo se encoge, se rellena con el color del proyecto (azul si no tiene) y el tick entra con rebote.
- Resumen sin cajas: tres cifras grandes en línea; la cifra activa como filtro se marca con fondo gris.
- Barras, hojas, menús y avisos con material translúcido (desenfoque) en lugar de color sólido.
- Etiqueta de proyecto como cápsula tintada con el color del proyecto.
- Pies de Ajustes y del detalle recortados a una línea.
- Interletrado ligeramente negativo en el título y en las cifras, como SF Pro Display.

Usabilidad
- Hoy en dos bloques cuando hay aplazadas: "Aplazadas" y "Hoy".
- El resumen aparece plegado por defecto con más de 20 tareas en Hoy; al tocar el chevron la elección se recuerda (`summaryState`: auto, open, closed).
- Búsqueda sin acentos y también por nombre de proyecto.
- El botón del deslizamiento pasa de "Mañana" a "Aplazar", con hoja de opciones: Mañana, Fin de semana, Próxima semana, Elegir fecha. El menú de pulsación larga usa la misma hoja.
- Nueva tarea con chips Viernes y Próx. semana además de Hoy y Mañana; los chips se disponen en dos filas.
- Si la app lleva más de dos horas en segundo plano, al volver se coloca en Tareas, filtro Hoy, arriba del todo.

## v0.6.3 (31 de octubre de 2026)

- El campo de búsqueda ya no se desborda sobre el botón Cancelar.

## v0.6.2 (31 de octubre de 2026)

- Búsqueda: el botón Cancelar queda fuera del campo, como en iOS; antes se cortaba.
- Filas completadas: muestran proyecto y "Hecha" con fecha y hora, sin la fecha original ni la marca de prioridad tachada; la línea de datos se recorta con puntos suspensivos en lugar de desbordar.
- El aviso inferior deja libre el botón +.

## v0.6.1 (31 de octubre de 2026)

- La cifra "para hoy" del resumen ya no aparece resaltada cuando no hay filtro activo.

## v0.6.0. Lote de estética y usabilidad (31 de octubre de 2026)

Estética
- Al completar, aplazar o eliminar, la fila se desvanece y las demás se deslizan a su sitio (FLIP con `transform` y `opacity`). Las filas nuevas aparecen con fundido.
- Icono relleno en la pestaña activa de la tab bar.
- Separadores de fila con sangría a la altura del texto, como en iOS.
- Prioridad como en Recordatorios: "!!!" rojo para alta, "!!" naranja para media.
- Contador de pendientes de cada proyecto en una píldora gris.
- Al abrir una hoja (nueva tarea, fecha, nota de voz, menús), la pantalla de detrás se encoge ligeramente y se oscurece.
- Estados vacíos con acción: "Ver todas" y "Añadir tarea" en Hoy, "Borrar búsqueda" en la búsqueda, "Quitar filtro" en los filtros del resumen.
- Tamaño de texto del sistema (Dynamic Type): los tamaños pasan a `rem` sobre `font: -apple-system-body`; los campos de texto no bajan de 16 px para que Safari no haga zoom.
- Queda fuera, a propósito, la barra de estado integrada (E7).

Usabilidad
- "Todas" agrupada por tramos: Hoy, Mañana, Esta semana, Más adelante y Sin fecha.
- Contadores en el segmento Hoy y Todas.
- Las tres cifras del resumen filtran la lista al tocarlas (aplazadas, prioritarias); "para hoy" quita el filtro.
- Nueva tarea en serie: Enter guarda y deja la hoja abierta con los mismos chips; "Añadir" guarda y cierra; Enter con el campo vacío cierra. Aviso con el recuento.
- Fecha escrita en el título: "mañana", "pasado mañana", "hoy", un día de la semana, "el 12", "12/11" o "12 de noviembre" al final del título marcan el chip de fecha y se quitan del título al guardar. Si eliges una fecha a mano, deja de interpretarse.
- Menú de pulsación larga completo: Prioridad, Mañana, Elegir fecha, Mover a proyecto, Completar o Marcar pendiente, Eliminar.
- Subir y Bajar en el menú de un proyecto.
- Búsqueda con botón Cancelar y recuento de resultados; el segmento se oculta mientras buscas.
- Hoja Fecha con "Este viernes" (de lunes a jueves) y "Próxima semana".
- Títulos de fila a dos líneas.
- El área de notas del detalle crece con el texto.
- Eliminar desde la fila pide confirmación, como fijaba el diseño; Deshacer se mantiene después.

Otros
- La primera instalación del service worker ya no recarga la página (solo lo hace al aplicar una actualización).

## v0.5.1. Sin destellos de color al hacer scroll rápido (31 de octubre de 2026)

- Los fondos de los botones de acción (verde, naranja, rojo) que hay detrás de cada fila solo existen mientras la fila se está deslizando o queda abierta. Antes estaban siempre debajo y, con scroll rápido, Safari los dejaba ver antes de pintar la fila.
- Las filas dejan de ser capas de composición en reposo (sin `transform` fijo), lo que además alivia el scroll con muchas tareas.

## v0.5.0. Herramientas de prueba en Ajustes (31 de octubre de 2026)

- Datos: "Exportar a archivo" genera `tareas-AAAA-MM-DD.json` con espacios, proyectos, tareas y notas de voz (por la hoja de compartir de iOS, para guardarlo en Archivos o enviarlo; descarga directa como respaldo). "Importar desde archivo" lee ese JSON; lo nuevo se añade y lo existente se actualiza si la copia es más reciente. Se mantiene "Importar pegando texto".
- Pruebas: "Generar datos de prueba" crea 150 tareas en seis proyectos inventados dentro del espacio activo, con fechas pasadas, de hoy, futuras y sin fecha, prioridades, un 20 % completadas, notas, recordatorios y algunas notas de voz. "Eliminar datos de prueba" los quita sin tocar el resto (van marcados por el identificador `demo-`).
- Registro: la app guarda errores (excepciones, promesas rechazadas, `console.error`, fallos al guardar) y eventos (inicio, versión, actualizaciones, traspaso de vencidas, importaciones, datos de prueba), con cabecera de versión, modo y dispositivo. "Ver registro" lo muestra con Copiar, Compartir y Borrar; "Copiar registro" lo copia directamente. Últimas 400 entradas.

## v0.4.0. Espacios editables (31 de octubre de 2026)

- Los espacios dejan de ser fijos. En Ajustes, sección "Espacios": tocar uno permite renombrarlo; "Nuevo espacio" crea otro. El selector del título también ofrece "Nuevo espacio". El espacio recién creado queda activo.
- Eliminar un espacio solo es posible si está vacío (sin proyectos ni tareas) y no es el único; la hoja lo explica cuando no se puede. Pide confirmación.
- Modelo: el espacio incorpora `modified`. Trabajo y Personal se mantienen como espacios iniciales.

## v0.3.5. Tab bar pegada abajo (31 de octubre de 2026)

- El área segura inferior se contaba dos veces (la página y la tab bar), lo que dejaba la barra flotando sobre un relleno vacío y una banda negra. Ahora la tab bar llega al borde inferior y cubre ella sola la zona del indicador de inicio.
- Barra más baja: 48 puntos de contenido, iconos de 24 px. El botón + y los avisos se recolocan justo encima.

## v0.3.4. Vencidas a hoy y tope del deslizamiento (31 de octubre de 2026)

- Al abrir la app, y cada vez que vuelve a primer plano, toda tarea pendiente con fecha anterior a hoy pasa a hoy y queda marcada como aplazada (campo nuevo `carried`). Ya no hay tareas vencidas ni fechas en rojo. Cambiar la fecha a mano (Mañana, selector de fecha) quita la marca.
- Resumen del día: las tres cifras pasan a ser "para hoy", "aplazadas" (en naranja si hay) y "prioritarias" (en rojo si hay).
- Deslizar una fila a la izquierda se detiene en los botones Mañana y Eliminar, con un pequeño tope elástico. Desaparece el deslizamiento largo que ejecutaba Mañana, y el fondo verde ya no asoma por detrás.

## v0.3.3. Resumen del día más bajo (31 de octubre de 2026)

- "Lo primero" muestra solo las tareas de prioridad alta de hoy (hasta tres). Si no hay ninguna, la sección desaparece y la tarjeta se queda en las tres cifras; el recordatorio próximo sigue apareciendo cuando lo hay.
- Menos relleno interno en la tarjeta. Con el filtro Hoy, las tareas no prioritarias ya no se repiten entre la tarjeta y la lista.

## v0.3.2. Cabeceras compactas (31 de octubre de 2026)

- Las cabeceras pasan a una sola fila de 44 puntos: título a 22 px a la izquierda (en Tareas, el espacio con su chevron) y sin la fila superior vacía ni el botón duplicado a la derecha. Ahorra unos 50 puntos de alto en cada pestaña.
- La pantalla de proyecto y la de detalle llevan la barra estándar: Atrás a la izquierda y el título centrado a 17 px, con el punto de color del proyecto.
- Sustituye el título grande de 34 px que fijaba el diseño original; decisión apuntada en el CLAUDE.md.

## v0.3.1. Aviso de actualización insistente (31 de octubre de 2026)

- El aviso "Nueva versión disponible" se vuelve a ofrecer cada vez que se vuelve a la app mientras la actualización siga pendiente, no solo una vez. En Ajustes aparece además una fila "Nueva versión disponible, Actualizar" mientras haya una esperando.
- El service worker descarga los archivos nuevos saltándose la caché HTTP de GitHub Pages, para no instalar nunca una copia vieja.
- Motivo: el iPhone seguía en la v0.2.x sin enterarse de la v0.3.0.

## v0.3.0. Deslizar entre pestañas (31 de octubre de 2026)

- Deslizar lateralmente pasa de Tareas a Proyectos y a Ajustes, con la pantalla siguiendo el dedo y la curva de iOS al soltar. Si se suelta antes de un tercio del ancho (y sin impulso), vuelve a su sitio. Tocar la tab bar sigue siendo instantáneo.
- Las filas de tareas conservan sus gestos: un deslizamiento que empieza sobre una fila completa o abre Mañana y Eliminar, no cambia de pestaña. Para cambiar de pestaña se desliza sobre cualquier otra zona (cabecera, resumen, buscador, filtros o el espacio libre bajo la lista).
- La tab bar pasa a ser única y fija para toda la app; antes iba dentro de cada pantalla. El detalle y la vista de proyecto siguen tapándola al entrar.

## v0.2.1. Notas de voz con dictado del teclado (31 de octubre de 2026)

- Probado en el iPhone instalado: la Web Speech API de Safari no transcribe en modo pantalla de inicio. Según prevé el diseño, el dictado del teclado de iOS pasa a ser la vía principal: la hoja Nota de voz abre con el área de texto enfocada y el teclado desplegado; el micrófono de la app solo se ofrece en una pestaña normal de Safari y, si falla, cede al teclado.
- El foco de los campos de las hojas (nueva tarea, proyecto, nota de voz) se pone de forma síncrona dentro del toque, que es la única manera de que iOS abra el teclado solo.
- Guardar una nota vacía ya no cierra la hoja: devuelve el foco al texto.

## v0.2.0. Bloque 0 bis: repositorio y PWA (31 de octubre de 2026)

- `index.html` a partir de la v0.1 (`tareas.html`), sin cambios de comportamiento ni de aspecto.
- `manifest.webmanifest`: nombre Tareas, `display: standalone`, iconos 192 y 512, `background_color` #F2F2F7, `theme_color` #F9F9F9.
- `sw.js`: caché de la app para abrir sin conexión y aviso "Nueva versión disponible" con botón Actualizar. La nueva versión no se activa sola; se activa al tocar el aviso y la app se recarga.
- Iconos 192 y 512 px en `icons/`.
- Versión visible en Ajustes (`APP_VERSION`).
- `.gitignore` para `config.js` y `.env` (claves de Supabase).
- Dos correcciones sobre la v0.1 detectadas al probar en navegador: la pantalla raíz llevaba `data-tab` y el manejador de clics la confundía con la tab bar (ningún toque dentro de la pestaña llegaba a su destino); y las pantallas apiladas no recibían la clase `detail`, por lo que el título y las notas se mostraban con borde de formulario.
- Pendiente de comprobar en el iPhone instalado en pantalla de inicio: arranque, gestos, dictado, Compartir, insignia y aviso de actualización.

## v0.1. Bloques 1 a 7 (artefacto de chat)

- Espacios Trabajo y Personal, resumen del día, lista única con Hoy y Todas, búsqueda, añadir rápido, detalle, gestos de fila, Deshacer, proyectos con color, notas de voz por dictado, Compartir, exportar e importar JSON, tema automático, claro u oscuro. Datos en `localStorage`.
