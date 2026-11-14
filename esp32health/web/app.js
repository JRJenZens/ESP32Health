import './dashboard.js';
const dashboard=document.querySelector('#dashboard');
const connectionStatus=document.querySelector('#connection-status');
const saveStatus=document.querySelector('#save-status');
const errorBox=document.querySelector('#app-error');
let revision=0;
let latest={connected:false,states:{}};
let saveQueue=Promise.resolve();
let generation=0;
let pendingSaves=0;
const showError=message=>{errorBox.textContent=message;errorBox.hidden=!message;};
async function api(path,options={}) {
  const response=await fetch(path,{...options,credentials:'same-origin',headers:{'X-ESP32Health':'1',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
  if(!response.ok){const error=new Error(response.status===409?'Opsætningen blev ændret i en anden fane. Den gemte opsætning er genindlæst.':response.status===503?'Home Assistant kunne ikke levere data. Kontrollér forbindelse og Recorder.':'Forespørgslen mislykkedes. Prøv at genindlæse appen.');error.status=response.status;throw error;}
  return response.json();
}
async function callWS(command) {
  const kind={'config/device_registry/list':'device','config/entity_registry/list':'entity','config/area_registry/list':'area'}[command.type];
  if(kind)return api('api/registry/'+kind);
  if(command.type==='history/history_during_period')return api('api/history',{method:'POST',body:JSON.stringify(command)});
  throw new Error('Denne læseforespørgsel understøttes ikke.');
}
function updateHass(){dashboard.hass={...latest,configSaving:pendingSaves>0,callWS};}
async function loadConfig(){const document=await api('api/config');revision=document.revision;dashboard.setConfig(document.config);updateHass();}
dashboard.addEventListener('esp32health-config-changed',event=>{
  const config=structuredClone(event.detail.config);
  const currentGeneration=generation;
  pendingSaves++;
  saveStatus.textContent='Gemmer opsætning…';
  updateHass();
  saveQueue=saveQueue.then(async()=>{
    if(currentGeneration!==generation){pendingSaves--;updateHass();return;}
    try{
      const result=await api('api/config',{method:'PUT',body:JSON.stringify({revision,config})});
      revision=result.revision;saveStatus.textContent=pendingSaves>1?'Gemmer opsætning…':'Opsætning gemt';showError('');
    }catch(error){
      generation++;
      saveStatus.textContent='Ændringen blev ikke gemt';showError(error.message);
      try{await loadConfig();}catch(_){/* Retain the error and never claim that an unsaved edit was stored. */}
    } finally {pendingSaves=Math.max(0,pendingSaves-1);updateHass();}
  });
});
try {
  await loadConfig();
  const stream=new EventSource('api/events');
  stream.onmessage=event=>{
    try{latest=JSON.parse(event.data);updateHass();connectionStatus.textContent=latest.connected?'Home Assistant · automatisk forbindelse':'Home Assistant afbrudt · prøver igen…';}
    catch(_){connectionStatus.textContent='Data kunne ikke læses';latest={connected:false,states:{}};updateHass();}
  };
  stream.onerror=()=>{latest={connected:false,states:{}};updateHass();connectionStatus.textContent='Appforbindelsen er afbrudt · prøver igen…';};
  window.addEventListener('pagehide',()=>stream.close());
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
} catch(error) {
  connectionStatus.textContent='Appen kunne ikke indlæses';showError(error.message);dashboard.setConfig({devices:[]});updateHass();
}
