# Registro de cambios

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
