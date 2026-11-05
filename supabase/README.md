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

## 5. El equipo: altas solo por invitación
Desde la 0013, solo entran las cuentas invitadas en Ajustes, Equipo. Las reglas de la base de datos ya lo garantizan; además, conviene que Supabase no deje ni crear la cuenta a quien no está invitado:
1. Authentication, **Hooks**, **Before User Created**, **Add hook**.
2. Tipo **Postgres**, esquema `public`, función `tareas_before_user_created`. Guardar.
3. Comprobar con una cuenta de Google no invitada: al entrar, la app dice «Esta cuenta no tiene acceso».

Antes de invitar a nadie, Google Cloud, **Google Auth Platform**, **Público**: pasar la app de «Prueba» a «En producción» (sin coste).

La función `send-reminders` también avisa de las tareas enviadas con «Avisar a…» y de las sugerencias, y borra los datos de quien perdió el acceso hace más de 30 días: hay que volver a pegarla y pulsar **Deploy** (paso 3).

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
| `migrations/0011_contacts.sql` | Responsable de una tarea y lista de contactos | v0.32.0 |
| `migrations/0012_encryption.sql` | Cifrado de extremo a extremo: clave de la cuenta y regla que rechaza texto sin cifrar | v0.34.0 |
| `migrations/0013_team.sql` | Equipo: miembros y administrador, acceso solo para miembros en todas las tablas, Avisar a, sugerencias e incidencias, cupo de almacenamiento, filtro de altas y borrado a los 30 días | v0.36.0 |

`all.sql` es la suma de las trece en orden. Las claves de la app (URL y clave pública) no van aquí: están en los secretos del repositorio de GitHub.
