# Registro de cambios

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
