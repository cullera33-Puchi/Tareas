// A realistic desktop Hoy (owner's screenshot of 5 November, v0.33.0): Ahora with two tasks, Revisar hoy with long waiting names and steps,
// Hoy with long titles, a responsible, priorities, estimates, a reminder and completed tasks. Thursday 5 November 2026, 10:10 local.
const T0='2026-11-01T08:00:00.000Z', NOW=new Date(2026,10,5,10,10,0);
const C=n=>new Date(Date.UTC(2026,10,1,8,n)).toISOString();
const L=(h,m)=>new Date(2026,10,5,h,m,0).toISOString();
const tk=(id,o)=>Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-05', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const P=(id,name,color,order)=>({id, spaceId:'trabajo', name, color, order, archived:false, created:T0, modified:T0});
function seed(){ return { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[P('oca','OCA','#FFCC00',0), P('ths','THS','#007AFF',1), P('pam','PAM','#AF52DE',2), P('okm','OKM','#34C759',3), P('chr','CHR-Aprovisionamiento','#FF7A5C',4)],
  tasks:[
    tk('a1',{title:'Documento KickOff - Lunes 9 mañana - revisar con el equipo antes de enviar', projectId:'oca', priority:'mid', estimate:60, focus:L(9,0), created:C(1)}),
    tk('a2',{title:'Confirmar que MM está preparado', projectId:'oca', estimate:15, focus:L(9,5), created:C(2)}),
    tk('w1',{title:'Pagar Zoi Calsina las facturas de octubre', projectId:'ths', status:'waiting', waitingFor:'Negocio BCN', priority:'high', estimate:30, reminder:L(17,0), created:C(3)}),
    tk('w2',{title:'Revisar sesiones OCA de la semana que viene', projectId:'oca', status:'waiting', waitingFor:'Arnau', priority:'high', estimate:30, notes:'Pendiente de la agenda', created:C(4)}),
    tk('w3',{title:'Preparar SteerCo de diciembre', projectId:'pam', status:'waiting', waitingFor:'Victor Carrasco', priority:'high', created:C(5)}),
    tk('w4',{title:'Reclamar factura del proveedor', projectId:'okm', status:'waiting', waitingFor:'Jorge Martínez de la Fuente', estimate:15, created:C(6)}),
    tk('h1',{title:'Portaviones - Evolucion inventario no stock y plan de choque', projectId:'ths', priority:'high', estimate:15, created:C(7)}),
    tk('h2',{title:'Revisar con Susana el seguimiento', projectId:'chr', priority:'high', estimate:30, created:C(8)}),
    tk('h3',{title:'PowerApps & Integraciones - Confirmar alcance con el cliente y cerrar presupuesto de la fase dos', projectId:'chr', priority:'mid', estimate:30, created:C(9)}),
    tk('h4',{title:'Actualizar PM Tool con los cambios del comité', projectId:'ths', priority:'mid', estimate:30, created:C(10)}),
    tk('h5',{title:'Consolidar un Excel t2', projectId:'chr', responsible:'Susana Sirvent', created:C(11)}),
    tk('d1',{title:'Enviar acta del comité', projectId:'oca', status:'done', completed:L(9,30), modified:L(9,30), created:C(12)}),
  ],
  subtasks:[{id:'s1',taskId:'w1',title:'Pedir factura',done:false,order:0,created:T0,modified:T0},{id:'s2',taskId:'w1',title:'Pagar',done:false,order:1,created:T0,modified:T0}],
  voiceNotes:[], attachments:[], projectNotes:[], contacts:[{id:'c1',name:'Susana Sirvent',email:'susana@example.com',created:T0,modified:T0},{id:'c2',name:'Arnau',phone:'+34600000000',created:T0,modified:T0},{id:'c3',name:'Negocio BCN',created:T0,modified:T0},{id:'c4',name:'Victor Carrasco',created:T0,modified:T0},{id:'c5',name:'Jorge Martínez de la Fuente',created:T0,modified:T0}],
  settings:{tipsSeen:true, doneOpen:true, summaryDay:'2026-11-05'} }; }
module.exports={seed, NOW};
