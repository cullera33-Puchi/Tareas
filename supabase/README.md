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

Antes de invitar a nadie:
- En `check.sql`, la fila 36 dice «Equipo: el administrador es <correo>»: ese correo tiene que ser el tuyo.
- Authentication, **Sign In / Providers**: solo Google activado. **Email**, **Phone** y **Anonymous sign-ins** desactivados (si alguna vez activas Email, deja «Confirm email» activado): así nadie entra con un correo que no es suyo.
- Google Cloud, **Google Auth Platform**, **Público**: pasar la app de «Prueba» a «En producción» (sin coste).

La función `send-reminders` también avisa de las tareas enviadas con «Avisar a…» y de las sugerencias, y borra los datos de quien perdió el acceso hace más de 30 días: hay que volver a pegarla y pulsar **Deploy** (paso 3). La función `add-task` (paso 4) también cambia: ya no acepta frases de quien perdió el acceso; vuelve a pegarla y pulsa **Deploy**.

## 6. El seguimiento de las tareas enviadas
Desde la 0014, quien envía una tarea con «Avisar a…» ve si la otra persona la ha añadido, para qué día la tiene prevista y cuándo la ha completado, y recibe el aviso «Víctor ha completado una tarea que le enviaste» (sin nada de la tarea). Hace falta ejecutar `all.sql` (paso 2) y volver a pegar `send-reminders` y pulsar **Deploy** (paso 3). En `check.sql`, las filas 44 a 46 dicen OK.

## 7. Algún día
Desde la 0015, las tareas que pasas a «Algún día» guardan ese dato en Supabase y se ven así en todos los dispositivos. Basta con ejecutar `all.sql` (paso 2); las funciones no cambian. En `check.sql`, la fila 47 dice OK.

## 8. Tareas compartidas
Desde la 0016, una tarea se puede compartir con miembros del Equipo: es la misma para todos, cada uno la edita y la completa, y cada uno la guarda en su proyecto y con su recordatorio. Hace falta ejecutar `all.sql` (paso 2) y volver a pegar `send-reminders` y pulsar **Deploy** (paso 3): avisa de las tareas compartidas, de los recordatorios de cada persona y de cuando alguien completa o aplaza una tarea compartida. En `check.sql`, las filas 48 a 52 dicen OK. La 0017 (v0.39.1) corrige el aviso al compartir y hace que «Por confirmar» sea de cada persona. La 0018 (v0.40.0) añade los comentarios, los recordatorios por la app y el día de revisión propio.

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
| `migrations/0014_notice_follow.sql` | Seguimiento de las tareas enviadas con Avisar a: fecha prevista y completada, y aviso a quien la envió | v0.37.0 |
| `migrations/0015_someday.sql` | «Algún día»: día en que una tarea se apartó allí | v0.38.0 |
| `migrations/0016_shared.sql` | Tareas compartidas entre miembros del Equipo: parte común cifrada con la clave de la tarea, participantes, parte de cada persona y avisos | v0.39.0 |
| `migrations/0017_shared_fix.sql` | Tareas compartidas: el aviso «te ha compartido una tarea» sale, y «Por confirmar» pasa a ser de cada persona | v0.39.1 |
| `migrations/0018_shared_comments.sql` | Tareas compartidas: comentarios, recordatorios por la app y día de revisión propio de «Por confirmar» | v0.40.0 |
| `migrations/0019_shared_delete_fix.sql` | Tareas compartidas: marcar como eliminada una fila de las tablas compartidas sin que falle la sincronización | v0.40.1 |
| `migrations/0020_shared_comment_upsert.sql` | Tareas compartidas: marcar como visto un recordatorio por la app sin que falle la sincronización | v0.40.1 |

`all.sql` es la suma de las veinte en orden. Las claves de la app (URL y clave pública) no van aquí: están en los secretos del repositorio de GitHub.
