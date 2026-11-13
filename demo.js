// Synthetic examples only. No real people, addresses, credentials or sensor data.
export function createDemo() {
  const now=Date.now();
  const config={type:'custom:esp32health-card',title:'Dit hjem, i overblik',devices:[
    {id:'demo-bha2',name:'Soveværelset',model:'MR60BHA2',area:'1. sal',entities:{presence:'binary_sensor.demo_bha2_presence',heart_rate:'sensor.demo_heart_rate',breath_rate:'sensor.demo_breath_rate',distance:'sensor.demo_distance',num_targets:'sensor.demo_num_targets',illuminance:'sensor.demo_bha2_illuminance'}},
    {id:'demo-fda2',name:'Opholdsrummet',model:'MR60FDA2',area:'Stueetagen',entities:{presence:'binary_sensor.demo_fda2_presence',fall:'binary_sensor.demo_fall',illuminance:'sensor.demo_fda2_illuminance'}},
  ]};
  const states={};
  const values={presence:'on',heart_rate:'68',breath_rate:'14',distance:'112',num_targets:'1',illuminance:'124',fall:'off'};
  const units={distance:'cm',heart_rate:'bpm',breath_rate:'breaths/min',illuminance:'lx'};
  for(const d of config.devices)for(const [role,id]of Object.entries(d.entities))states[id]={entity_id:id,state:values[role],last_changed:new Date(now-900000).toISOString(),last_updated:new Date(now).toISOString(),last_reported:new Date(now).toISOString(),attributes:{friendly_name:d.name+' '+role,unit_of_measurement:units[role]}};
  states['sensor.demo_bha2_illuminance'].state='8';
  const hass={states,connected:true,demo:true,callWS:async command=>{
    if(command.type==='config/device_registry/list')return config.devices.map(d=>({...d,area_id:d.area}));
    if(command.type==='config/area_registry/list')return config.devices.map(d=>({area_id:d.area,name:d.area}));
    if(command.type==='config/entity_registry/list')return config.devices.flatMap(d=>Object.entries(d.entities).map(([role,id])=>({entity_id:id,device_id:d.id,original_name:role==='fall'?'fall_detected':role==='presence'?'presence':role})));
    if(command.type==='history/history_during_period'){
      const start=Date.parse(command.start_time);const end=Date.parse(command.end_time);const result={};
      for(const id of command.entity_ids) {
        result[id]=Array.from({length:100},(_,i)=>{
          const t=start+(end-start)*i/99;const heart=id==='sensor.demo_heart_rate';const breath=id==='sensor.demo_breath_rate';
          const state=heart?String(Math.round(66+Math.sin(i*.19)*5+Math.cos(i*.7)*2)):breath?String(Math.round(14+Math.sin(i*.13)*2)):states[id]?.state || 'unknown';
          return {s:state,lu:t/1000};
        });
      }
      return result;
    }
    throw new Error('Denne kommando understøttes ikke i demoen.');
  }};
  const timer=setInterval(()=>{for(const s of Object.values(states)){s.last_updated=new Date().toISOString();s.last_reported=s.last_updated;}},10000);
  return {config,hass,close:()=>clearInterval(timer)};
}
