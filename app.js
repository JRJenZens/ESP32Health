import './dist/ESP32Health.js';
import {validateConfig} from './dist/ESP32Health.js';
import {HAClient} from './ha-client.js';
import {createDemo} from './demo.js';
const card=document.querySelector('#dashboard');
const dialog=document.querySelector('#connect-dialog');
const status=document.querySelector('#connection-status');
const connect=document.querySelector('#connect-button');
const disconnect=document.querySelector('#disconnect-button');
let demo=null;
const empty={type:'custom:esp32health-card',devices:[]};
let liveConfig=empty;
try{const saved=JSON.parse(localStorage.getItem('esp32health.config.v1'));if(saved)liveConfig=validateConfig(saved);}catch(_){/* A damaged or obsolete local config must not stop startup. */}
const client=new HAClient({onState:hass=>{if(!demo)card.hass=hass;},onStatus:message=>{if(!demo)status.textContent=message;}});
card.setConfig(liveConfig);card.hass=client.hass;
card.addEventListener('esp32health-config-changed',event=>{
  if(demo)return;
  liveConfig=event.detail.config;
  try{localStorage.setItem('esp32health.config.v1',JSON.stringify(liveConfig));}catch(_){status.textContent='Browseren kunne ikke gemme enhedsopsætningen.';}
});
connect.addEventListener('click',()=>{
  document.querySelector('#connect-error').textContent='';
  try{document.querySelector('#ha-url').value=localStorage.getItem('esp32health.url') || '';}catch(_){}
  dialog.showModal();
});
document.querySelector('#close-dialog').addEventListener('click',()=>{dialog.close();document.querySelector('#ha-token').value='';});
dialog.addEventListener('cancel',()=>{document.querySelector('#ha-token').value='';});
document.querySelector('#connect-form').addEventListener('submit',event=>{
  event.preventDefault();
  const url=document.querySelector('#ha-url').value.trim();
  const token=document.querySelector('#ha-token').value;
  try{
    const parsed=new URL(url);
    if(location.protocol==='https:' && parsed.protocol!=='https:')throw new Error('Denne side bruger HTTPS. Brug en HTTPS-adresse til Home Assistant, eller åbn ESP32Health lokalt over HTTP.');
    // Validate before discarding an existing connection/demo.
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('Brug en almindelig http:// eller https:// adresse.');
    if(demo){demo.close();demo=null;}card.setConfig(liveConfig);
    client.connect(url,token);
    try{localStorage.setItem('esp32health.url',url);}catch(_){}
    document.querySelector('#ha-token').value='';dialog.close();disconnect.hidden=false;
    connect.textContent='Skift forbindelse';
  }catch(error){document.querySelector('#connect-error').textContent=error.message;}
});
disconnect.addEventListener('click',()=>{
  if(demo){demo.close();demo=null;}client.close();card.setConfig(liveConfig);card.hass=client.hass;
  disconnect.hidden=true;connect.textContent='Tilslut Home Assistant';status.textContent='Ingen forbindelse';
});
document.querySelector('#demo-button').addEventListener('click',()=>{
  if(demo)demo.close();client.close();
  demo=createDemo();card.setConfig(demo.config);card.hass=demo.hass;
  status.textContent='Demotilstand · syntetiske data';disconnect.hidden=false;
});
window.addEventListener('pagehide',()=>{client.close();demo?.close();});
