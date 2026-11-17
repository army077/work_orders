import XLSX from 'xlsx';
import {HEADERS} from '../../importers/import_entregas_logistica_legacy.js';
import {sha256} from '../../migrations/prod/logistica_prod_support.js';
export function snapshotFixture({sheet='Entregas',rows=null}={}) {
  const defaults=[
    [1,'fixture@example.invalid','FIXTURE',45658,'1:02:03 p.m.',0,'EQUIPO','CHOFER',831,
      null,19.5,-99,17,'https://drive.google.com/drive/folders/TEST_ONLY_A','undefined',null,null,true,false,null],
    [2,'fixture@example.invalid','FIXTURE',45659,0.5,1,'EQUIPO','CHOFER',null,
      null,19.5,-99,1,'https://drive.google.com/drive/folders/TEST_ONLY_B','https://maps.google.com/maps/search/0,+0',null,null,null,null,null],
    [3,null,null,null,null,'123456789012345678901234567890',null,null,null,
      null,null,null,null,null,null,null,null,null,null,null],
  ];
  const ws=XLSX.utils.aoa_to_sheet([HEADERS,...(rows??defaults)]);
  ws.D2.z='dd/mm/yyyy';ws.E3.z='h:mm:ss';
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,sheet);
  const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  return {bytes,approval:{sha256:sha256(bytes),sheet:'Entregas',count:(rows??defaults).length}};
}
