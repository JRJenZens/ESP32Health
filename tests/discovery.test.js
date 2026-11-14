import {test} from 'node:test';
import assert from 'node:assert/strict';
if(!globalThis.HTMLElement)globalThis.HTMLElement=class {};
if(!globalThis.customElements)globalThis.customElements={get:()=>false,define:()=>{}};
const core=await import('../esp32health/web/dashboard.js');
const devices=[{id:'bha',name:'ESP32-101',model:'esp32-c6'},{id:'fda',name:'ESP32-102',model:'esp32-c6'},{id:'other',name:'ESP32-103',model:'esp32-c3'},{id:'phone',name:'Phone',model:'Phone'}];
const row=(device_id,entity_id,original_name,platform='esphome')=>({device_id,entity_id,original_name,platform});
const entities=[
  row('bha','binary_sensor.room_presence','Tilstedeværelse'),
  row('bha','sensor.room_heart','Puls'),
  row('bha','sensor.room_breath','Vejrtrækningsfrekvens'),
  row('bha','sensor.room_distance','Afstand til person'),
  row('bha','sensor.room_count','Estimeret personantal'),
  row('bha','sensor.room_light','Belysningsstyrke'),
  row('fda','binary_sensor.hall_presence','Tilstedeværelse'),
  row('fda','binary_sensor.hall_fall','Fald registreret'),
  row('fda','sensor.hall_light','Belysningsstyrke'),
  row('other','sensor.board_wifi','WiFi signal'),
  row('phone','sensor.phone_heart','Heart rate','mobile_app'),
  row('phone','sensor.phone_breath','Respiratory rate','mobile_app'),
  row('phone','binary_sensor.phone_presence','Presence','mobile_app'),
];
test('Generic ESP32 names are recognized from Danish radar sensor signatures',()=>{
  const found=core.discoverDevices(devices,entities);
  assert.deepEqual(found.map(d=>d.model),['MR60BHA2','MR60FDA2']);
  assert.equal(found[0].entities.num_targets,'sensor.room_count');
  assert.equal(found[0].entities.illuminance,'sensor.room_light');
  assert.equal(found[1].entities.presence,'binary_sensor.hall_presence');
  assert.equal(found[1].entities.fall,'binary_sensor.hall_fall');
});
test('Manual device list includes ESPHome boards without a recognized radar',()=>{
  const list=core.espHomeDevices(devices,entities);
  assert.equal(list.length,3);assert.equal(list[2].inferred_model,'');
  assert.equal(list[0].display_name,'ESP32-101');assert.equal(list[0].inferred_model,'MR60BHA2');
});
test('Similar phone measurements cannot be auto-classified as ESPHome radar',()=>{
  assert.equal(core.inferModel(devices[3],entities),'');
});
test('A manual model choice maps only sensors from the selected physical device',()=>{
  const mapped=core.mapDevice(devices[1],'MR60FDA2',entities);
  assert.deepEqual(Object.values(mapped.entities).sort(),['binary_sensor.hall_fall','binary_sensor.hall_presence','sensor.hall_light'].sort());
});
test('Ambiguous or disabled sensor candidates are not guessed',()=>{
  const duplicate=[...entities,row('bha','sensor.other_heart','Puls')];
  assert.equal(core.mapDevice(devices[0],'MR60BHA2',duplicate).entities.heart_rate,undefined);
  const disabled=entities.map(e=>e.entity_id==='sensor.room_breath'?{...e,disabled_by:'user'}:e);
  assert.equal(core.inferModel(devices[0],disabled),'');
});
test('Mixed radar signatures require explicit model choice',()=>{
  assert.equal(core.inferModel(devices[0],[...entities,row('bha','binary_sensor.extra_fall','Fall detected')]),'');
});
test('Manual device selection reuses a mapped row and preserves custom names',()=>{
  const suggested=core.mapDevice(devices[0],'MR60BHA2',entities);
  const config={devices:[{...suggested,id:'old-random-id',name:'My radar'}]};
  const merged=core.mergeDevice(config,suggested,entities);
  assert.equal(merged.devices.length,1);assert.equal(merged.devices[0].name,'My radar');assert.equal(merged.devices[0].id,'old-random-id');
});
test('A matching empty row is reused instead of creating a duplicate',()=>{
  const config={devices:[{id:'blank',model:'MR60BHA2',name:'Puls og vejrtrækning',entities:{}}]};
  const merged=core.mergeDevice(config,core.mapDevice(devices[0],'MR60BHA2',entities),entities);
  assert.equal(merged.devices.length,1);assert.equal(merged.devices[0].name,'ESP32-101');assert.equal(merged.devices[0].id,'blank');
});
test('Settings sensor lists are scoped to the mapped ESPHome device',()=>{
  const d=core.mapDevice(devices[0],'MR60BHA2',entities);d.id='old-random-id';
  const context={_registries:{devices,entities,areas:[]},_registryLoaded:true,_hass:{states:{}}};
  const ids=core.ESP32HealthDashboard.prototype._entityOptions.call(context,d,'heart_rate');
  assert.ok(ids.includes('sensor.room_heart'));assert.ok(!ids.includes('sensor.hall_light'));assert.ok(!ids.includes('sensor.phone_heart'));
});
test('History waits for config persistence before requesting newly selected entities',async()=>{
  let calls=0;
  const context={_config:{devices:[{entities:{heart_rate:'sensor.room_heart'}}]},_connected:true,_hass:{configSaving:true,callWS:async()=>{calls++;return {};}},_historyRequest:0,_hours:1,render:()=>{}};
  await core.ESP32HealthDashboard.prototype.loadHistory.call(context);assert.equal(calls,0);
  context._hass.configSaving=false;
  await core.ESP32HealthDashboard.prototype.loadHistory.call(context);assert.equal(calls,1);assert.equal(context._historyState,'ready');
});
