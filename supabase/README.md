# Supabase de Tareas: guía rápida

Todo lo que necesita el proyecto `tareas` de Supabase para que la app funcione. Si alguna vez dudas de si falta algo, sigue los pasos 1 y 2.

## 1. Comprobar
SQL Editor, **+ New query**, pega `check.sql` y pulsa **Run**. Sale una fila por pieza con **OK** o **FALTA**.

## 2. Poner al día
Si alguna fila dice FALTA: SQL Editor, **+ New query**, pega `all.sql` entero y pulsa **Run**. Se puede ejecutar todas las veces que haga falta sin romper nada. Después vuelve a ejecutar `check.sql`.

## 3. La función de notificaciones
Edge Functions, `send-reminders` (el nombre exacto). Pega `functions/send-reminders/index.ts`, pulsa **Deploy** y comprueba que **Verify JWT** está desactivado. Hay que repetirlo cada vez que cambie ese archivo (lo indica el CHANGELOG).

## 4. La función del Atajo de iOS
Edge Functions, `add-task` (el nombre exacto). Pega `functions/add-task/index.ts`, pulsa **Deploy** y comprueba que **Verify JWT** está desactivado: el Atajo no lleva sesión, se identifica con la clave que crea Ajustes, Atajo de iOS. No necesita secretos.

## Qué hay en cada migración

| Archivo | Qué crea | Versión |
| --- | --- | --- |
| `migrations/0001_init.sql` | Espacios, proyectos, tareas y notas de voz, con reglas de acceso por propietario | v0.16.0 |
| `migrations/0002_push.sql` | Dispositivos de notificaciones, claves, aviso enviado y tarea cada minuto | v0.17.0 |
| `migrations/0003_attachments.sql` | Adjuntos, carpeta privada de archivos y borrado a las 24 horas | v0.19.0 |
| `migrations/0004_repeat_focus.sql` | Repetir, «Ahora» y «Por confirmar» | v0.22.1 |
| `migrations/0005_subtasks.sql` | Pasos dentro de una tarea | v0.23.0 |
| `migrations/0006_project_notes.sql` | Notas de proyecto | v0.24.0 |
| `migrations/0007_deadline.sql` | Fecha límite de una tarea | v0.25.0 |
| `migrations/0008_estimate_postponed.sql` | Tiempo estimado y veces que se aplaza una tarea | v0.28.0 |
| `migrations/0009_closed_day.sql` | Día cerrado en todos los dispositivos (Cerrar el día) | v0.30.0 |
| `migrations/0010_inbox.sql` | Siri y el Atajo de iOS: bandeja de entrada y clave personal del atajo | v0.31.0 |

`all.sql` es la suma de las diez en orden. Las claves de la app (URL y clave pública) no van aquí: están en los secretos del repositorio de GitHub.
