# Registro de cambios

## v0.30.0. Carga en horas, tareas olvidadas, posponer recordatorios y cerrar el día (3 de noviembre de 2026)

- Carga del día en horas: Hoy suma el tiempo estimado de lo que muestra («5 h 45»), en gris, naranja desde las horas de trabajo y rojo desde 1,5 veces. Las horas de trabajo se ajustan por espacio en Ajustes (6 h de inicio). En Semana y Día, la barra de carga mide horas.
- Tareas olvidadas: las tareas sin fecha que llevan 30 días sin cambios se repasan con «Repasar N olvidadas» en Sin fecha: darles fecha, completarlas o eliminarlas, con Deshacer.
- Posponer recordatorio: 10 minutos, 1 hora, esta tarde a las 17:00 (hasta las 16:30), mañana a las 9:00 o elegir, con Deshacer. En una barra al abrir la tarea desde el aviso y en el menú de la tarea; en el ordenador, también con botones en el propio aviso cuando el navegador lo permite.
- Desde las 18:30, las tareas nuevas de Hoy se proponen para mañana y aparece «Cerrar el día».
- Cerrar el día deja el día cerrado en todos los dispositivos: Hoy pasa a mostrar las tareas de mañana, con «Reabrir hoy». A medianoche vuelve solo.
- Hoy sin tareas: una sola línea, «Todo hecho por hoy, N completadas», sin icono ni enlaces.
- Supabase: columna `closed_day` en `spaces` (`0009_closed_day.sql`), ya aplicada. Prueba nueva `rm-LH`.

## v0.29.3. Iconos de las filas alineados en el ordenador (3 de noviembre de 2026)

- La estrella de «Ahora», el icono de notas, el clip y el de repetición tienen cada uno su propia columna fija en las filas del ordenador: ya no se desplazan según los demás iconos de la fila. Una columna que ninguna fila usa no ocupa sitio.
- Prueba `rm-COL` ampliada.

## v0.29.2. Nueva tarea con el proyecto del filtro (3 de noviembre de 2026)

- Con un filtro de proyecto activo, Nueva tarea propone ese proyecto también en Todas (antes solo en Hoy), en iPhone y ordenador.
- Lo mismo con el + de la cabecera de cada día en una lista filtrada y con el doble clic en un día del Mes.
- Dentro de la pantalla de un proyecto ya se proponía su proyecto; no cambia. Una búsqueda no propone nada.
- Prueba nueva `rm-PF`.

## v0.29.1. Notas de proyecto sin duplicar en el ordenador (3 de noviembre de 2026)

- Con la columna de notas a la vista, desaparece el segmento Tareas y Notas de la cabecera del proyecto: la columna es el acceso a las notas.
- El título «Notas (N)» de la columna abre la vista completa de notas, que lleva «Volver a tareas» en la cabecera.
- Con la ventana estrecha o el detalle de una tarea abierto, el segmento sigue como antes. En el iPhone no cambia nada.
- Prueba `rm-PIT` ampliada.

## v0.29.0. Escritorio: lista a todo el ancho, columnas ajustables y notas al lado (3 de noviembre de 2026)

- Las listas del ordenador ocupan todo el ancho de la ventana; el título se queda con el espacio libre, en una línea, con el título completo al pasar el ratón.
- Cabecera de columnas (Proyecto, Tarea, Fecha, Entrega, Recordatorio, Tiempo): cada separador se arrastra para cambiar el ancho; doble clic lo devuelve al de origen. Los anchos se guardan en ese ordenador.
- Dentro de un proyecto, con la ventana ancha, columna «Notas» a la derecha con las notas como post-it: las que caben y «Ver todas», una tarjeta para escribir una nota nueva con Intro, edición en el sitio, casillas que se marcan con un clic y menú con el botón derecho. Se pliega y se oculta al abrir el detalle de una tarea.
- Pruebas nuevas `rm-COL` y `rm-PIT`.

## v0.28.2. Personas por confirmar legibles en el ordenador (3 de noviembre de 2026)

- En las filas del escritorio, la etiqueta «Esperando a» se ve entera; si falta sitio, se acorta el título de la tarea.

## v0.28.1. «Hoy» como día de revisión en «Por confirmar» (3 de noviembre de 2026)

- Al pasar una tarea a «Por confirmar», los días de revisión empiezan por «Hoy»: la tarea queda esperando a la persona, pero se mantiene en «Revisar hoy», arriba de la lista, para cerrarla en el día. Una tarea de hoy sigue proponiendo «Mañana» por defecto.

## v0.28.0. Tiempo estimado, tareas arrastradas y «¿Qué hago ahora?» (3 de noviembre de 2026)

- Tiempo estimado por tarea: 15 min, 30 min, 1 h o medio día, desde el detalle, la pulsación larga, el clic derecho y el alta, o escribiendo «15m», «30m», «1h» o «medio día» al final del título. Se ve en gris en la fila y va en compartir y CSV.
- Tareas arrastradas: la app cuenta cada vez que una tarea que ya tocaba pasa a otro día (al empezar el día, Aplazar, Cerrar el día, el repaso o arrastrándola). Con 3 veces o 7 días, la fila lo dice en naranja: «Aplazada 4 veces» o «Desde el martes 27». En el repaso de aplazadas, «Partir en pasos» abre la tarea lista para escribir el primer paso.
- «¿Qué hago ahora?»: desde «Sugerir» en el bloque Ahora o el menú de tres puntos de Hoy. Eliges el tiempo que tienes y propone tres tareas que caben: primero las que vencen, luego prioritarias, arrastradas y rápidas. Avisa si un recordatorio cae dentro de ese tiempo, y un toque pasa la tarea a Ahora.
- Supabase: migración `0008_estimate_postponed.sql` (ya aplicada). Prueba nueva `rm-EP`.

## v0.27.1. Tareas de «Ahora» que no llegaban al ordenador (3 de noviembre de 2026)

- Un dispositivo que sincronizó con una versión antigua (en el ordenador, la v0.21.0 esta mañana) recibió las tareas sin los datos que esa versión no conocía, como «Ahora», y ya no volvía a pedirlas. Ahora, cuando una versión sincroniza datos nuevos, vuelve a pedir una vez todas las filas de esa tabla y los recupera, sin enviar nada de vuelta.
- Prueba nueva `rm-RP`.

## v0.27.0. Resumen de estado para compartir (3 de noviembre de 2026)

- «Compartir estado» en el menú de cada proyecto (pantalla del proyecto, pulsación larga en Proyectos y clic derecho en la barra lateral) y «Compartir estado de la semana» en el menú de tres puntos de Tareas, para todos los proyectos del espacio.
- Prepara un texto listo para Teams, correo o Claude: Hecho, En curso, Por confirmar (con «esperando a» y el día de revisión) y Próximos pasos (14 días y hasta cinco sin fecha), con las entregas, los pasos y las prioritarias. Sin secciones vacías y con las fechas en palabras.
- Periodo «Esta semana» o «Últimos 7 días». El texto se puede retocar antes de compartir o copiar.
- Prueba nueva `rm-M4`.

## v0.26.1. Sin resumen del día (3 de noviembre de 2026)

- Desaparece el resumen del día en el iPhone y en el ordenador: las cifras (para hoy, aplazadas, prioritarias), sus filtros y «Lo primero». La lista de Hoy empieza directamente.
- Se mantienen el número del segmento Hoy, el bloque «Ahora» cuando hay tareas marcadas, «Revisar hoy», Aplazadas con «Repasar», «Mañana: N» y, desde las 19:00, la celda «Cerrar el día» al final de Hoy.
- Con todo lo de hoy hecho, Hoy muestra «Todo hecho por hoy» con las tareas completadas.
- Prueba nueva `rm-NS`.

## v0.26.0. Dictar en Notas y «Nota de voz» para el audio (3 de noviembre de 2026)

- Desaparece la nota de voz dictada: se dicta con el micrófono del teclado directamente en Notas. En el ordenador, el micrófono de la alta ampliada («Dictar») escribe en el campo de notas.
- Las notas de voz que ya había se añaden al final de las notas de su tarea, una línea por nota con su fecha y hora («2/11 18:40: texto»). Se hace solo, una vez, al abrir la app, al sincronizar, al importar y al restaurar una copia, sin duplicar líneas aunque lo hagan dos dispositivos.
- «Grabar audio» pasa a llamarse «Nota de voz» en el iPhone y en el ordenador.
- Compartir y CSV dejan la sección de notas de voz: su texto ya va en Notas.
- Sin cambios en Supabase.

## v0.25.1. «Revisar hoy» y «Por confirmar más adelante» (3 de noviembre de 2026)

- En Hoy, las tareas por confirmar cuyo día de revisión ha llegado (o con la entrega hoy) van en un grupo propio «Revisar hoy» al principio de la lista, con «Esperando a» en cada fila. Siguen contando en «para hoy».
- El bloque de abajo pasa a llamarse «Por confirmar más adelante» y solo lleva las que aún no toca revisar, con su día. El enlace «Mostrar las que esperan» u «Ocultar las que esperan» lo pliega.
- En Todas y en la pantalla de cada proyecto, el bloque «Por confirmar» reúne todas las tareas por confirmar, primero las de hoy; ya no se repiten en los grupos de días. El contador de Todas deja de contarlas.
- En el escritorio, igual en la columna; el grupo «Revisar hoy» no acepta tareas arrastradas.
- Prueba nueva `rm-RH`.

## v0.25.0. Fecha límite y «Volver a pendiente» más a mano (2 de noviembre de 2026)

- Fecha límite aparte de la fecha de trabajo, en el detalle, el inspector, la pulsación larga y el clic derecho. En la fila se lee «Entrega jueves»: en gris, en naranja desde 2 días antes y en rojo el día de entrega y después. En las tarjetas del calendario, una banderita del mismo color.
- El día de entrega la tarea entra en Hoy aunque esté aplazada, tenga otra fecha o esté por confirmar, cuenta en «para hoy» y en la insignia, y no se marca como aplazada. Sin notificación propia.
- «Cerrar el día» deja en Hoy las tareas con entrega hoy o vencida y lo indica al pie.
- Una tarea que se repite lleva la fecha límite a la siguiente con la misma distancia a su fecha, también si se había aplazado. Duplicar la copia; compartir y CSV la incluyen.
- «Por confirmar»: la hoja «Cambiar Por confirmar» lleva al pie «Volver a pendiente», y en el iPhone deslizar a la izquierda una tarea por confirmar muestra «Pendiente» en lugar de «Aplazar». Las dos con Deshacer.
- Supabase: migración `0007_deadline.sql`, incluida en `supabase/all.sql`, y una fila nueva en `check.sql`. Sin ella, la fecha límite se queda en cada dispositivo y el resto sincroniza. La función `send-reminders` no cambia.

## v0.24.1. Borrar el registro (2 de noviembre de 2026)

- En Ajustes, sección Registro, «Borrar registro» vacía el registro de este dispositivo para empezar de cero, tras confirmar y con Deshacer. Lo que se registre mientras tanto se conserva al deshacer. El botón Borrar de «Ver registro» también tiene Deshacer.
- Prueba nueva `rm-LOG`.

## v0.24.0. Notas de proyecto (2 de noviembre de 2026)

- Cada proyecto tiene ahora dos pestañas, «Tareas» y «Notas», en el iPhone y en el ordenador. Varias notas por proyecto, con título y fecha: primero las fijadas y después la más reciente.
- Texto libre que se guarda solo al escribir. Las líneas con guion se ven como lista y las de «[ ]» como casillas que se marcan con un toque. Los enlaces y teléfonos se pueden tocar. Intro continúa la lista.
- «Crear tareas» convierte líneas de la nota en tareas del proyecto, reconociendo la fecha escrita al final, con un solo Deshacer. En el ordenador también se crean a partir de las líneas seleccionadas.
- En el iPhone: deslizar a la izquierda para eliminar y pulsación larga para Fijar, Compartir, Crear tareas o Eliminar. En el ordenador: lista a la izquierda y nota abierta al lado, tecla N para una nota nueva, flechas para moverse, Intro para editar, Supr para eliminar (con confirmación) y clic derecho para el menú.
- La búsqueda encuentra las notas. Exportar, importar y las copias locales las incluyen. Eliminar un espacio borra también las notas de sus proyectos, con Deshacer. Archivar un proyecto conserva sus notas.
- Supabase: migración `0006_project_notes.sql`, incluida en `supabase/all.sql`, y una fila nueva en `check.sql`. Sin ella, las notas se quedan en cada dispositivo y el resto sincroniza.

## v0.23.1. Borrar pasos (2 de noviembre de 2026)

- Al borrar un paso deslizando, el paso desaparecía de los datos pero la fila se quedaba en pantalla si el foco seguía en ella (su botón Eliminar o su texto), y los siguientes borrados parecían no hacer nada. Ahora la fila sale siempre de la pantalla.
- Deslizar un paso mientras se edita su texto abre Eliminar en lugar de mover el cursor, y la pulsación larga no lo levanta mientras se escribe.
- Prueba nueva en `rm-ST`: tres borrados seguidos, uno de ellos con el texto del paso en edición.

## v0.23.0. Pasos dentro de una tarea (2 de noviembre de 2026)

- Grupo «Pasos» en el detalle, en el iPhone y en el ordenador: lista de casillas con «3 de 4». Intro añade el siguiente sin cerrar el teclado; pegar varias líneas crea varios pasos. Se reordenan arrastrando y se borran deslizando a la izquierda o con Supr, con Deshacer.
- Al marcar el último paso aparece «Todos los pasos hechos» con «Completar tarea»; la tarea no se completa sola. Si se completa con pasos sin marcar, se quedan como están.
- En la lista y en las tarjetas del calendario, «3/4» con un pequeño círculo de progreso.
- Una tarea que se repite, o una duplicada, llega con los pasos sin marcar. La búsqueda encuentra el texto de los pasos; compartir y exportar a CSV los incluyen.
- Supabase: migración `0005_subtasks.sql` y, para no perder nada, `supabase/all.sql` (todas las migraciones), `check.sql` (comprueba que está todo) y una guía en `supabase/README.md`.

## v0.22.1. Tareas que se repiten, «Ahora», «Por confirmar» y ajustes (2 de noviembre de 2026)

- Incluye todo lo de la v0.22.0, que no llegó a publicarse: las pruebas de GitHub pararon la publicación por una comprobación demasiado ajustada al tiempo, no por un fallo de la app.
- Los recordatorios de las tareas «Por confirmar» avisan (hay que volver a desplegar `send-reminders`). La insignia cuenta también las por confirmar cuyo día de revisión ha llegado.
- Escritorio: las «Por confirmar» se ven en Semana, Día, Horas, Mes y la agenda en su día de revisión, con el círculo a medio llenar; arrastrarlas cambia el día de revisión.
- Si la misma tarea repetida se completa a la vez en dos dispositivos sin conexión, al sincronizar queda una sola siguiente.

## v0.22.0. Tareas que se repiten, zona «Ahora» y «Por confirmar» (2 de noviembre de 2026)

- Repetir: fila nueva en el detalle con Cada día, Cada día laborable, Cada semana, Cada 2 semanas, Cada mes, Cada año y Personalizada (cada N días, semanas o meses, días de la semana, o «el primer lunes de cada mes»). Al completarla se crea la siguiente con título, proyecto, prioridad, notas y hora del recordatorio; Deshacer la quita. Al eliminar pregunta «solo esta» o «la serie». Icono de repetición en la fila.
- Ahora: hasta 5 tareas para trabajar ya, marcadas desde el menú, la estrella del detalle, la tecla A o arrastrándolas en el ordenador. Bloque arriba de Hoy en el iPhone, bloque arriba de la lista y entrada en la barra lateral en el ordenador. Se vacía al cambiar de día; la tarea conserva su fecha y su sitio.
- Por confirmar: tercer estado para lo ya hecho que espera confirmación, con «Esperando a» y un día de revisión opcional. Círculo a medio llenar, bloque plegado al final de las listas y entrada en la barra lateral del ordenador. El día de revisión vuelve a Hoy marcada «Revisar». Tocar el círculo la cierra.
- Supabase: migración `0004_repeat_focus.sql` con los campos nuevos.

## v0.21.0. Base más sólida (2 de noviembre de 2026)

- Sin cambios visibles en la app.
- Las pruebas automáticas (37 baterías) pasan a estar dentro del repositorio y GitHub las ejecuta antes de cada publicación. Si alguna falla, la versión no se publica y la app instalada sigue con la anterior.
- El código se divide en una hoja de estilos y 14 archivos por áreas (datos, listas, gestos, hojas, adjuntos, sincronización, notificaciones, escritorio, calendario), lo que reduce el riesgo de que un cambio rompa otra parte.
- La publicación solo sube los archivos de la app, no las pruebas ni la documentación.
- CLAUDE.md al día: estado actual, estructura del repositorio, mapa del código por archivo y cómo probar.

## v0.20.1. Recordatorio en escritorio: elegir día y hora (2 de noviembre de 2026)

- En el ordenador, al elegir el día en la ventana de Recordatorio, la ventana se cerraba antes de poder poner la hora. El calendario se redibuja para marcar el día y el clic se tomaba como hecho fuera. Ahora el día queda marcado, la ventana sigue abierta y Guardar aplica día y hora. Lo mismo para cualquier ventana anclada que se redibuje al hacer clic.

## v0.20.0. Escritorio más completo, 16 colores y copias que se pueden borrar (2 de noviembre de 2026)

Escritorio
- Alta ampliada: al escribir en «Nueva tarea» se despliega un panel con Notas, Fecha, Proyecto, Prioridad, Recordatorio y Nota de voz. Intro añade con todo; Esc con texto pregunta antes de descartar. Tras añadir, el panel queda listo para la siguiente.
- Selector de hora propio en Recordatorio: se escribe 9, 930, 9:30 o 21.15, lista de medias horas de 7:00 a 22:00, atajos 9:00, 12:00, 15:00 y 18:00, flechas para sumar o restar 15 minutos.
- Calendario: opción «Solo de lunes a viernes» por espacio, activada en Trabajo. Las tareas de fin de semana siguen visibles en una columna estrecha «Fin de semana».
- Arrastrar tareas entre los grupos de la lista: a otro día (o a Sin fecha), o a otro proyecto en la agrupación por proyecto, con Deshacer. El recordatorio se va con la fecha.
- Adjuntos: «Añadir foto» y «Grabar audio» quedan alineados.

iPhone y escritorio
- 16 colores de proyecto en dos filas; los proyectos actuales conservan el suyo y todas las etiquetas se leen bien en los dos temas.
- Las copias locales de Ajustes se pueden borrar una a una (deslizando en el iPhone, con clic derecho o la papelera en el escritorio) o todas a la vez, siempre con confirmación.
- Fotos y notas de audio probadas por Enric en iPhone y ordenador.

## v0.19.0. Fotos y notas de audio en las tareas (2 de noviembre de 2026)

- El detalle de cada tarea tiene un grupo Adjuntos, en el iPhone y en el panel del escritorio.
- «Añadir foto» abre la cámara o la biblioteca del iPhone, con varias fotos a la vez. En el ordenador se elige un archivo o se arrastra la imagen al panel.
- Las fotos se reducen a 2.048 píxeles por lado, se enderezan según la orientación de la cámara y pierden los datos de ubicación.
- Visor a pantalla completa: pasar de una foto a otra, pellizcar para ampliar, doble toque, arrastrar hacia abajo para cerrar, Compartir y Eliminar con Deshacer. En el ordenador también funciona con las flechas, Esc y Supr.
- «Grabar audio» abre una hoja con botón grande, contador, parada automática a los 10 minutos, escucha previa y Guardar o Descartar. Los audios se reproducen con barra de progreso y se eliminan deslizando a la izquierda, con Deshacer. Se graban en m4a para que el iPhone reproduzca también lo grabado en el ordenador.
- Un clip en la fila indica que la tarea tiene adjuntos. Al eliminar la tarea se eliminan sus adjuntos, y Deshacer los devuelve.
- Sin conexión o sin sesión, lo capturado se guarda en el dispositivo y se sube después. Cada dispositivo guarda una copia de hasta 200 MB y borra lo más antiguo; lo pendiente de subir nunca se borra.
- Supabase: tabla `attachments`, carpeta privada de archivos por usuario y borrado definitivo de los archivos a las 24 horas, a cargo de la función `send-reminders`.

## v0.18.0. Decisiones del 2 de noviembre y orden de proyectos en escritorio (2 de noviembre de 2026)

Ajustes rápidos
- Cambiar la fecha a mano desde la fila Fecha también mueve el recordatorio al nuevo día a la misma hora, con Deshacer.
- Con Hoy a la vista, el + y «Añadir tarea» proponen la fecha de hoy y el proyecto del filtro activo; se pueden quitar con un toque. La barra de alta del escritorio también recoge el filtro.
- iPhone: con los botones de una fila a la vista, el primer toque en otro sitio solo cierra la fila, como en iOS. Igual con las notas de voz.
- iPhone: la línea gris de cada fila separa sus datos con espacio, sin punto medio.

Decisiones menores
- Eliminar un espacio borra también sus proyectos, tareas y notas de voz, tras una confirmación que dice cuánto se borra. Antes se hace una copia local y hay Deshacer. El único espacio que quede no se puede eliminar.
- Cerrar la hoja de nota de voz o la de Nueva tarea con texto sin guardar pregunta «Descartar» o «Seguir editando».
- Escritorio: las confirmaciones de borrado son una alerta de Mac centrada; Intro confirma y Esc cancela.
- Vista por horas: la franja «Todo el día» muestra hasta tres tareas y «N más», que abre la vista Día.

Escritorio
- Los proyectos de la barra lateral se ordenan arrastrándolos arriba o abajo, con una línea que marca dónde caen y Deshacer. También con Alt y las flechas. El orden se sincroniza y se ve igual en el iPhone.

## v0.17.0. Bloque 9: recordatorios con notificación en el iPhone (2 de noviembre de 2026)

- A la hora del recordatorio llega una notificación con el título de la tarea y el proyecto, aunque la app esté cerrada. Tocarla abre la tarea. Las tareas completadas o eliminadas no avisan.
- La primera vez que se pone un recordatorio, una hoja explica en una frase para qué se pide el permiso. Ajustes tiene la sección Notificaciones: estado del permiso, «Activar notificaciones», «Probar notificación» y los dispositivos de la cuenta con «Revocar».
- Bajo Recordatorio, el detalle avisa cuando ese dispositivo no recibirá la notificación (permiso denegado, app no instalada, sin sesión).
- Recordatorio al aplazar (decisión de Enric): si la tarea cambia de día al pasar a hoy, al aplazar, al pasar lo pendiente a mañana, al repasar, al planificar o al arrastrarla en el calendario, el recordatorio se va con ella a la misma hora, con Deshacer. Si esa hora ya ha pasado, se conserva sin avisar.
- Supabase: tabla de dispositivos, marca de recordatorio enviado, tarea programada cada minuto y la función `send-reminders`, que envía cada recordatorio una sola vez. Un recordatorio que llega con más de una hora de retraso no avisa.

## v0.16.3. Escritorio: «Lo primero» sin tareas repetidas (2 de noviembre de 2026)

- En Hoy, en escritorio, «Lo primero» repetía las tareas prioritarias justo encima de la lista y con el mismo aspecto, así que parecían duplicadas. Con 8 tareas o menos para hoy ya no se muestra, porque todas se ven a la primera. Con más, va en un bloque gris con su título «Lo primero», separado de la lista.
- Sincronización probada por Enric entre iPhone y ordenador, también en modo avión: bloque 8 cerrado.

## v0.16.2. Configuración de Supabase que se corrige sin nueva versión (2 de noviembre de 2026)

- El archivo de configuración con la dirección y la clave pública de Supabase se pide siempre a la red y solo se usa la copia guardada sin conexión. Si se corrigen los secretos en GitHub, basta con volver a publicar; los iPhone instalados lo recogen sin esperar a otra versión.
- La publicación detecta los secretos guardados al revés (la clave en la dirección y la dirección en la clave) y los corrige, nunca publica una clave secreta y anota en su registro la forma de cada secreto, sin mostrarlos.

## v0.16.1. Dirección de Supabase escrita de cualquier forma (2 de noviembre de 2026)

- El inicio de sesión fallaba con «Cliente de Supabase no cargado»: la dirección guardada en los secretos de GitHub no tenía la forma completa (`https://xxxx.supabase.co`). La app y la publicación aceptan ahora la dirección sin `https://`, con una ruta detrás (como `/auth/v1/callback`), entre comillas o solo el identificador del proyecto.
- La publicación anota en su registro si la dirección guardada es válida, sin mostrarla.

## v0.16.0. Bloque 8: cuenta y sincronización con Supabase (2 de noviembre de 2026)

- Ajustes tiene una sección Cuenta: «Iniciar sesión con Google», el correo, cuándo se sincronizó por última vez, los cambios pendientes, «Sincronizar ahora» y «Cerrar sesión». Cerrar sesión deja los datos en el dispositivo y deja de sincronizar.
- La sincronización va en segundo plano y nunca bloquea la pantalla: al abrir la app, poco después de cada cambio, al recuperar la conexión, al volver a la app y al tirar hacia abajo de la lista en el iPhone. Los cambios de otro dispositivo llegan casi al momento, sin cerrar hojas ni perder lo que se está escribiendo.
- Sin conexión todo funciona igual; los cambios se guardan y se suben al volver. Si una misma tarea cambia en dos sitios, gana la modificación más reciente.
- Lo eliminado se elimina también en los otros dispositivos, y Deshacer lo recupera en todos.
- Primera conexión: copia local de seguridad, después los espacios Trabajo y Personal se emparejan por nombre con los de la cuenta, para que no se dupliquen, y se suben los datos. Los datos de prueba y los ajustes no se suben.
- Con la sesión iniciada, restaurar una copia local se aplica en todos los dispositivos, con aviso previo.
- Supabase: tablas de espacios, proyectos, tareas y notas de voz con reglas de acceso por usuario (`supabase/migrations/0001_init.sql`). Las claves llegan desde los secretos del repositorio al publicar, nunca en el código.

## v0.15.1. Escritorio: proyecto a la izquierda y más sitio para el título (1 de noviembre de 2026)

- La etiqueta del proyecto pasa a una columna fija a la izquierda, justo después del círculo. Todos los títulos empiezan a la misma altura. Dentro de un proyecto o con un filtro de proyecto no se muestra la columna.
- Las columnas de fecha, recordatorio e indicadores solo ocupan sitio si alguna tarea de la lista las usa. En Hoy, sin fechas que mostrar, el título gana unos 85 px.
- Con el panel de detalle abierto, la columna de fecha se estrecha y el recordatorio se muestra solo con la campana: la hora está en el aviso al pasar el ratón y en el panel. A 1280 px, el título pasa de unos 15 caracteres visibles a unos 35.
- Al pasar el ratón sobre una tarea se ve el título completo.

## v0.15.0. Roadmap R1 a R20 (1 de noviembre de 2026)

Aplicadas las veinte mejoras de la revisión de usabilidad, fluidez y diseño. Dos partes quedan fuera porque necesitan campos nuevos sin acordar: «aplazada desde» en R9 y la duración de los bloques en R20.

iPhone
- R1. Al completar, la fila se queda atenuada 1,5 segundos; si se marcan varias seguidas, salen juntas con un solo aviso y Deshacer. Tocarla otra vez la desmarca.
- R2. El círculo de completar, la casilla de selección y los botones pequeños responden en una zona de 44 puntos.
- R3. Las filas no repiten lo que ya dice la pantalla («Hoy», el proyecto dentro de su propio filtro); las aplazadas llevan «Aplazada» en naranja; notas y voz pasan a la derecha. Las cápsulas de proyecto son legibles en los dos temas.
- R4. Volver atrás, cerrar hojas y deslizar filas aceptan un gesto corto y rápido. En el detalle se vuelve deslizando desde cualquier punto, salvo en campos de texto y notas de voz.
- R5. Nueva tarea con una barra de iconos sobre el teclado (Fecha, Proyecto, Prioridad, Añadir) que no quita el foco al campo. Pulsación larga en Añadir: añadir y abrir.
- R10. La pulsación larga eleva la fila y abre un menú compacto junto a ella, con iconos; se puede elegir sin levantar el dedo. El mismo menú sustituye a las hojas del selector de espacio, del botón de tres puntos y de Proyecto y Prioridad en el detalle.

Los dos
- R6. Pegar varias líneas en Nueva tarea crea varias tareas, con un solo Deshacer. En el detalle, «Convertir N líneas en tareas» para las notas con guiones o casillas.
- R7. En el título: «#flc» asigna el proyecto, «!!!» o «!!» la prioridad y «a las 9» el recordatorio, con vista previa de lo entendido.
- R8. Desde las 19:00, «Cerrar el día» aparece al final de Hoy y en el resumen plegado, con balance y tres opciones.
- R9. «Repasar (N)» en las aplazadas: decidir una a una, con balance final y Deshacer.
- R13. Botón de opciones de vista en Tareas: seleccionar, mostrar completadas, agrupar por fecha o por proyecto (también en Hoy) y mostrar el resumen.
- R14. Todas agrupada día a día los próximos 14 días y después por meses, con cabeceras fijas, añadir en un día y mover las tareas de un día a otro. El calendario de Fecha marca la carga con puntos.
- R18. La app redibuja solo lo que cambia. Cambiar prioridad, aplazar o mover a proyecto tarda la mitad; en escritorio, moverse con las flechas pasa de unos 200 ms a 50 ms.

Escritorio
- R11. Densidad de Mac: texto de 14 px, filas de una línea con fecha, recordatorio y prioridad en columnas, resumen en una línea y desplegable «Proyecto: Todos».
- R12. Semana desde hoy (opción de lunes a domingo), columnas con desplazamiento propio, carga del día, tarjetas de una línea y bandeja lateral Sin fecha.
- R15. Fila seleccionada, flechas o J y K, Espacio para el panel, Intro o doble clic para renombrar y atajos de una tecla (C, 1, 2, 0, H, M, V, S, F, P, Supr, Comando Z, ?).
- R16. Selección múltiple con Comando y Mayúsculas, panel «N tareas seleccionadas» con acciones en bloque y arrastre de tareas a proyectos, a Hoy y a días del calendario.
- R17. Menú contextual junto al puntero con submenús, ventanas pequeñas ancladas para Fecha, Recordatorio y Proyecto, inspector con prioridad en segmento y ancho ajustable.
- R19. Vista Mes y mes en miniatura en la barra lateral, con arrastre para cambiar la fecha.
- R20. Vista por horas en Semana y Día, de 7:00 a 21:00, con bloques de media hora; arrastrar a una hora pone el recordatorio. Con más de 1400 px, Hoy muestra la agenda del día.

Revisión final
- Incluye los arreglos v0.14.1 a v0.14.5. Corregidos además: la pantalla de debajo asomaba por el borde con una hoja abierta, el contador del segmento en tema oscuro y el singular en el resumen de importar. 31 pruebas automáticas en verde.

## v0.14.5. Animaciones con el ritmo de iOS (1 de noviembre de 2026)

- Las animaciones iban demasiado rápidas. Ahora usan las duraciones de iOS con la misma curva de frenado:
  - Hojas inferiores, como Fecha, Recordatorio o Nota de voz, y entrar en una pantalla o volver atrás: medio segundo, antes 0,35.
  - Menús inferiores: 0,45 segundos, antes 0,3.
  - Oscurecido del fondo: 0,45 segundos.
  - Cambio de pestaña al deslizar, filas que vuelven a su sitio y reordenación de la lista: 0,4 segundos.
  - Aviso de Deshacer: 0,4 segundos.
- La pantalla de detrás se encoge al mismo ritmo que sube la hoja.
- Con «Reducir movimiento» activado siguen siendo fundidos cortos.

## v0.14.4. Editar y eliminar notas de voz (1 de noviembre de 2026)

- En el detalle de una tarea, cada nota de voz se desliza como una fila. A la izquierda aparece Eliminar y se queda ahí; al tocarlo, la nota se borra con Deshacer durante 4 segundos.
- A la derecha aparece Editar; un deslizamiento largo la abre directamente. La hoja «Editar nota» trae el texto para corregirlo, y «Volver a dictar» lo borra y deja el campo listo para dictar otra vez con el micrófono del teclado. Guardar ofrece Deshacer.
- En escritorio, un clic sobre la nota ofrece Editar nota y Eliminar nota.
- Modelo de datos: la nota de voz añade el campo `modified`, que se rellena al editarla. La nota muestra «editada» junto a la hora, y al importar una copia gana la versión editada más reciente. Acordado con Enric.

## v0.14.3. Botones de las hojas visibles con el teclado (1 de noviembre de 2026)

- En el iPhone, con el teclado abierto, la barra flotante del teclado tapaba Descartar y Guardar en la nota de voz. Las hojas con campo de texto (nota de voz, nueva tarea, proyecto, espacio e importar texto) llevan ahora las acciones en la cabecera, como en iOS: Cancelar o Descartar a la izquierda, el título en el centro y Guardar, Crear o Añadir a la derecha.
- Con el teclado abierto, la hoja deja sitio abajo para la barra del teclado, así el texto escrito no queda debajo.
- El registro mostró que el iPhone reduce toda la ventana al abrir el teclado y avisa tarde. La hoja ya no sube a la parte superior en ese caso, y la decisión se toma 1,2 segundos después de enfocar el campo, cuando el teclado ya está colocado. El registro anota las medidas en las cuatro primeras aperturas.

## v0.14.2. Hojas tapadas por el teclado (1 de noviembre de 2026)

- En el iPhone, al escribir en una hoja (nota de voz, nueva tarea, nombre de proyecto), la hoja podía quedarse detrás del teclado: el sistema no informaba a la app instalada de que el teclado había salido. Si medio segundo después de enfocar el campo no se ha detectado el teclado, la hoja pasa a la parte superior de la pantalla. Si el teclado se detecta, todo sigue igual.
- El registro anota una vez por arranque las medidas de pantalla al abrir el teclado, para afinarlo con datos del dispositivo.

## v0.14.1. Hojas que se cerraban solas en el iPhone (1 de noviembre de 2026)

- En el detalle de una tarea, la hoja de Fecha podía abrirse y cerrarse al instante y el menú de Proyecto aparecía de golpe. Durante el primer medio segundo tras abrir una hoja o un menú, un toque en el fondo, en un día del calendario o en una opción del menú ya no cuenta: así un toque repetido no cierra la hoja ni elige algo por error.
- Diagnóstico: si una hoja se cierra en menos de 0,8 segundos, el registro de Ajustes anota desde dónde se cerró.

## v0.14.0. Revisión completa de móvil y escritorio (1 de noviembre de 2026)

Revisión con 107 hallazgos: 83 confirmados por dos verificadores independientes y 24 confirmados al corregirlos. Corregidos 98, dos ya quedaban resueltos por otra corrección, tres son parciales y cuatro esperan decisión de Enric (al final). Cada corrección se reprodujo antes y después, y la batería de 18 pruebas pasa entera.

Errores graves
- Con el tema Claro u Oscuro casi ningún toque funcionaba: la app confundía cualquier clic con un cambio de tema.
- Escritorio: los controles del panel de detalle (Proyecto, Fecha, Recordatorio, Prioridad, Compartir, menú, nota de voz) no hacían nada; ahora actúan sobre la tarea del panel.
- Escritorio: no se podía desplazar la lista por debajo de la primera pantalla; la barra lateral, la lista y el panel tienen ahora su propio desplazamiento.
- Escritorio: las hojas cerradas seguían recibiendo clics invisibles en el centro de la pantalla.
- Dos pestañas o ventanas abiertas se pisaban los datos. Ahora cada una recoge lo que guarda la otra sin cerrar la hoja que tengas abierta ni perder lo que escribes.
- El service worker borraba las cachés de otras apps publicadas en github.io; ahora solo toca las suyas.
- Volver deslizando desde el borde cerraba varias pantallas a la vez tras unos cuantos cambios en el detalle.

Móvil
- Gestos: el deslizamiento hacia atrás que empieza sobre una fila ya no completa la tarea; los chips de proyecto se pueden desplazar sin cambiar de pestaña; un gesto interrumpido por el sistema se cancela en lugar de ejecutarse; pulsación larga en proyectos con tolerancia normal al movimiento.
- Navegación: no se pueden encadenar dos aperturas o dos vueltas atrás durante la transición; la barra de selección múltiple ya no queda tapada dentro de un proyecto; volver a la app tras dos horas no descarta lo que estabas escribiendo en una hoja.
- Nueva tarea: cancelar el menú de Proyecto o Prioridad ya no cierra la hoja; los atajos de fecha no se duplican en jueves ni domingo.
- Detalle: salir del título ya no repinta la pantalla ni pierde el siguiente toque; las notas largas no vuelven arriba al escribir; un título vacío no se guarda; la franja de enlaces se actualiza al escribir.
- Fechas pasadas: el calendario ya no deja elegir días pasados y reabrir una tarea antigua la pasa a hoy como aplazada.
- Deshacer tras Aplazar conserva la marca de aplazada.
- El área segura en horizontal se respeta en los iPhone con isla dinámica.

Escritorio
- Clic en una tarea de "Lo primero" abre el detalle.
- Cambiar de espacio cierra el proyecto y el panel del otro espacio; la barra de alta ya no guarda en el espacio anterior.
- El texto a medio escribir en la barra de alta y en la búsqueda sobrevive a los repintados.
- Clic derecho sobre un proyecto de la barra lateral: renombrar, cambiar color, subir, bajar o archivar.
- Semana: siempre hay zona "Sin fecha" para soltar, no se aplica un filtro de proyecto invisible, un arrastre cancelado no mueve otra tarea después y la búsqueda filtra también la semana.
- Escape cierra primero el menú abierto; los atajos N y / no se disparan con un menú encima.
- Al cambiar de vista la lista empieza arriba; el panel conserva su posición al editar.
- Los consejos de la primera vez y los textos de Ajustes hablan del ordenador, no del iPhone.
- El modo escritorio pide al menos 900 px de ancho y 500 de alto, así un iPhone grande en horizontal sigue en modo móvil.

Datos y fechas
- La app abre siempre en Hoy, como pide el diseño.
- Con la app abierta a medianoche, las tareas pasan a hoy, se redibuja y se hace la copia diaria, también al volver a la app otro día.
- Pasar las tareas a hoy ya no cambia su fecha de modificación, así una importación no descarta cambios hechos en otro dispositivo; archivar y restaurar proyectos sí la cambian.
- Si el almacenamiento está lleno, el aviso dice "No se pudo guardar en el dispositivo" en lugar de confirmar algo que no se guardó, y se recorta el registro para hacer sitio.
- Datos guardados con otra forma se reparan en lugar de descartarse; si no se pueden leer, se apartan en una copia y se anota en el registro.
- Un recordatorio en el pasado no se guarda y se avisa en la hoja.
- El aviso de nueva versión ya no sustituye a un Deshacer pendiente, y Actualizar funciona también en la primera sesión.
- La barra del sistema toma el color del tema oscuro.

Voz, enlaces y compartir
- Dictado: un silencio ya no oculta el micrófono, escribir a mano pausa el dictado sin que se sobrescriba, y no se duplica el texto al reanudar.
- Los saltos de línea de las notas de voz se respetan.
- Detección de enlaces y teléfonos más fiable: no convierte fechas ni números de factura en teléfonos y no se come la puntuación final.
- El texto compartido usa el formato de fecha del diseño ("31/10 09:15") y el espacio de la propia tarea.
- Copiar al portapapeles avisa si falla.
- El CSV protege las celdas que empiezan por =, +, - o @ para que Excel no las ejecute como fórmulas.

Rendimiento y fluidez
- Las acciones en bloque guardan una sola vez; seleccionar todas y completar ya no congela la app.
- Las listas de más de 200 filas solo pintan lo visible y el resto se completa al desplazarse.
- La animación al completar mide antes de mover y solo anima las filas visibles.
- Escribir en el título o las notas guarda 400 ms después de la última tecla, no en cada pulsación.
- La búsqueda filtra sin sustituir el campo, de modo que los acentos y las teclas muertas funcionan.
- Abrir un detalle o cambiar de pestaña ya no repinta pantallas ocultas; el escritorio no pinta antes la versión móvil.
- Con "Reducir movimiento" activado, los movimientos pasan a fundidos.

Pendiente de decisión de Enric
- Atajo de iOS: abre Safari, cuyo almacenamiento es distinto del de la app instalada, así que la tarea no llega a la app. Opciones en el CLAUDE.md.
- Recordatorio al aplazar: si debe moverse con la tarea manteniendo la hora.
- Nueva tarea desde Hoy: si debe proponer la fecha de hoy y el proyecto del filtro activo.
- Eliminar un espacio con proyectos archivados o completadas antiguas.
- Cerrar la hoja de nota de voz con texto: pedir confirmación o guardar borrador.
- Editar o eliminar una nota de voz ya guardada.

## v0.13.1 (31 de octubre de 2026)

- Escritorio: la vista Semana usa todo el ancho de la columna central; las tarjetas recortan el título a tres líneas y llevan la prioridad delante del texto; los nombres largos de proyecto no se parten en la barra lateral.

## v0.13.0. Versión de escritorio (31 de octubre de 2026)

A partir de 900 px de ancho la misma app cambia de disposición; en el iPhone no cambia nada.

- Barra lateral fija: espacio activo (tocar para cambiar), Hoy, Todas, Semana, proyectos con color y contador, Nuevo proyecto y Ajustes.
- Columna central con barra de alta siempre visible ("Nueva tarea… escribe la fecha al final"); Enter añade y, en Hoy, pone la fecha de hoy si no se escribe otra. Resumen, chips de proyecto, agrupaciones y búsqueda como en el móvil.
- Panel de detalle a la derecha al abrir una tarea; "Cerrar" o Escape lo cierran.
- Vista Semana: siete columnas de lunes a domingo, hoy destacado, tarjetas con color de proyecto y prioridad, flechas y botón Hoy, "+" por día para añadir con esa fecha, y arrastrar una tarjeta a otro día (o a "Sin fecha") para cambiarle la fecha, con Deshacer. Respeta el filtro por proyecto.
- Ratón: resaltado de fila, botón "•••" por fila y clic derecho abren el menú de la tarea. Las hojas y menús pasan a ser ventanas centradas.
- Teclado: N enfoca la barra de alta, / la búsqueda, Escape cierra hoja, panel o búsqueda.
- Los datos siguen siendo locales de cada navegador hasta la sincronización (bloque 8): para probar en el ordenador, exportar JSON en el iPhone e importarlo.

## v0.12.1 (31 de octubre de 2026)

- "Pasar lo pendiente a mañana" aparece a partir de las 19:00 en lugar de las 18:00.

## v0.12.0. Filtro por proyecto, cerrar el día, planificar sin fecha y CSV (31 de octubre de 2026)

- Filtro por proyecto: fila de chips bajo el segmento con los proyectos del espacio y "Sin proyecto". Tocar uno filtra Hoy o Todas; volver a tocarlo quita el filtro. Se pierde al cambiar de espacio.
- Cerrar el día: a partir de las 18:00, si quedan pendientes en Hoy, el resumen ofrece "Pasar lo pendiente a mañana (N)" con la opción de dejar fuera las prioritarias. Con Deshacer.
- Planificar sin fecha: en Todas, el grupo "Sin fecha" lleva el enlace "Planificar (N)". Recorre las tareas una a una con atajos y calendario, "Saltar" y "Terminar"; al final, "N planificadas, M saltadas". Respeta el filtro por proyecto.
- Exportar a Excel: en Ajustes, "Exportar a Excel (CSV)" genera un CSV separado por punto y coma con BOM UTF-8 y una fila por tarea (espacio, proyecto, título, fecha, prioridad, estado, completada, recordatorio, aplazada, notas, notas de voz, creada), por la hoja de compartir.

## v0.11.0. Calendario propio, Completadas por día, selección múltiple y Todas por proyecto (31 de octubre de 2026)

- Fecha: hoja con atajos (Hoy, Mañana, Este viernes, Próxima semana, Sin fecha) y calendario mensual propio, lunes primero, hoy en azul, punto bajo los días con tareas pendientes, navegación por meses. Tocar un día guarda y cierra.
- Recordatorio: mismo calendario más la hora con el selector nativo de iOS, atajos "Hoy a las 18:00", "Mañana a las 9:00", "En una hora" y Quitar.
- Completadas al estilo Recordatorios: enlace "Mostrar completadas (N, M hoy)" y, abiertas, agrupadas por Hoy, Ayer y fecha.
- Selección múltiple: "Seleccionar varias" en la pulsación larga. La barra superior pasa a "Todas / N seleccionadas / OK" y la tab bar se sustituye por Completar, Aplazar, Mover y Eliminar. Tocar filas las marca; Aplazar y Mover abren sus opciones; Eliminar pide confirmación; todo con Deshacer. Funciona en Tareas y dentro de un proyecto; salir del proyecto o cambiar de pestaña termina la selección.
- Todas: control "Por fecha / Por proyecto" bajo el segmento. Por proyecto agrupa en el orden de la pestaña Proyectos con "Sin proyecto" al final; se recuerda (`allGroup`).
- Los menús de acción se desplazan si no caben en pantalla.

## v0.9.0. Lote 6 (31 de octubre de 2026)

- Copias de seguridad locales: una instantánea diaria en IndexedDB (fuera de `localStorage`), se conservan las últimas siete. En Ajustes, "Copias de seguridad": lista con fecha y número de tareas, "Crear copia ahora" y restaurar tocando una (con confirmación y Deshacer).
- Título del detalle a varias líneas: crece con el texto; Enter cierra el teclado.
- Recordatorio con atajos "Hoy a las 18:00" (hasta las 17:00), "Mañana a las 9:00" y "En una hora".
- "Completadas (22), 3 hoy" en el pie de la lista; cuando no queda nada en Hoy, el resumen muestra "Todo hecho por hoy".
- Al final de la lista Hoy, "Mañana: N tareas" lleva a Todas.
- Primera apertura: hoja "Tres gestos" (deslizar, mantener pulsado, fecha en el título). Se muestra una vez.
- Entrada por URL: `?add=texto` abre Nueva tarea con el texto y la fecha interpretada. Pensado para un Atajo de iOS "Añadir a Tareas".
- Agitar para deshacer: interruptor en Ajustes, sección Gestos, apagado por defecto. Pide permiso de movimiento al activarlo; deshace la acción cuyo aviso esté visible.

## v0.8.0. Lote 5 (31 de octubre de 2026)

Estética
- Icono nuevo: degradado azul del sistema con círculo de verificación y dos líneas de lista. Incluye `apple-touch-icon` de 180 px.
- Proyectos como listas de Recordatorios: círculo de color con icono blanco; "Sin proyecto" en gris.
- Fechas de los próximos siete días con el nombre completo del día (Martes, Viernes).
- Indicadores de notas y de notas de voz en la línea gris de la fila.
- Toque háptico experimental en iOS: interruptor nativo oculto (`input type=checkbox switch`) que iOS 17.4 y posteriores acompañan de un toque al cambiar; se activa al completar, cambiar prioridad y cruzar el umbral del deslizamiento. Si tu iOS no lo soporta, no pasa nada.

Usabilidad
- Mover a otro espacio desde la pulsación larga y desde el menú del detalle (el proyecto se vacía). Con Deshacer.
- Enlaces y teléfonos de las notas en una franja tocable bajo el texto; en las notas de voz, tocables dentro del propio texto.
- Duplicar tarea (misma copia sin fecha) y abrir su detalle.
- "Añadir y abrir" en Nueva tarea.
- Buscar: enlace "Incluir N completadas" cuando hay completadas que coinciden.
- El resumen se muestra abierto la primera vez de cada día aunque esté plegado por volumen.
- Deshacer también al cambiar prioridad y al mover a proyecto.

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
