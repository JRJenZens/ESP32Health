import assert from 'node:assert/strict';
if(!globalThis.HTMLElement)globalThis.HTMLElement=class {};
if(!globalThis.customElements)globalThis.customElements={get:()=>false,define:()=>{}};
const core=await import('../esp32health/web/dashboard.js');
const now=1800000000000;
const state=(v,unit,age=0)=>({state:String(v),attributes:{unit_of_measurement:unit},last_updated:new Date(now-age*1000).toISOString()});
const device={id:'test',model:'MR60BHA2',name:'Test',entities:{presence:'binary_sensor.presence',heart_rate:'sensor.heart',breath_rate:'sensor.breath',distance:'sensor.distance',num_targets:'sensor.targets'}};
const fresh=()=>({'binary_sensor.presence':state('on',null,7200),'sensor.heart':state(68),'sensor.breath':state(14),'sensor.distance':state(112,'cm'),'sensor.targets':state(1)});
export const scenarios=[
  ['Unknown, unavailable, whitespace and NaN never become zero',()=>{
    for(const s of [undefined,state('unknown'),state('unavailable'),state(''),state('  '),state('NaN'),state('Infinity')])assert.equal(core.numberState(s),null);
    assert.equal(core.numberState(state(0)),0);assert.equal(core.binaryState(state('unknown')),null);assert.equal(core.binaryState(state('off')),false);
  }],
  ['Distance units are explicit, including ESPHome default centimetres',()=>{
    assert.equal(core.distanceMetres(state(112,'cm')),1.12);assert.equal(core.distanceMetres(state(1.12,'m')),1.12);
    assert.equal(core.distanceMetres(state(112)),null);assert.equal(core.distanceMetres(state('unknown','cm')),null);
  }],
  ['One present target in range with fresh positive values is displayed',()=>{assert.equal(core.evaluateBHA(device,fresh(),true,now).usable,true);}],
  ['Unchanging binary presence does not expire as a measurement',()=>{assert.equal(core.evaluateBHA(device,fresh(),true,now).usable,true);}],
  ['No presence suppresses ghost heartbeats',()=>{const s=fresh();s['binary_sensor.presence']=state('off');assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}],
  ['Missing presence, target count and units suppress vital estimates',()=>{
    for(const id of ['binary_sensor.presence','sensor.targets','sensor.distance']){const s=fresh();delete s[id];assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
  }],
  ['Multiple targets suppress vital estimates',()=>{const s=fresh();s['sensor.targets']=state(2);assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}],
  ['Out-of-range values are never presented as current vitals',()=>{
    for(const cm of [0,49,151,500]){const s=fresh();s['sensor.distance']=state(cm,'cm');assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
  }],
  ['Both core-zone boundaries are accepted',()=>{for(const cm of [50,150]){const s=fresh();s['sensor.distance']=state(cm,'cm');assert.equal(core.evaluateBHA(device,s,true,now).usable,true);}}],
  ['Expired or timestamp-free numeric values are suppressed',()=>{
    for(const id of ['sensor.heart','sensor.breath','sensor.distance','sensor.targets']){const s=fresh();s[id].last_updated=new Date(now-181000).toISOString();assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
    const s=fresh();delete s['sensor.heart'].last_updated;assert.equal(core.evaluateBHA(device,s,true,now).usable,false);
  }],
  ['last_reported can verify a repeated unchanged numeric sample',()=>{const s=fresh();s['sensor.heart'].last_updated=new Date(now-999000).toISOString();s['sensor.heart'].last_reported=new Date(now).toISOString();assert.equal(core.evaluateBHA(device,s,true,now).usable,true);}],
  ['Zero vitals and offline connections are suppressed',()=>{
    for(const id of ['sensor.heart','sensor.breath']){const s=fresh();s[id]=state(0);assert.equal(core.evaluateBHA(device,s,true,now).usable,false);}
    assert.equal(core.evaluateBHA(device,fresh(),false,now).usable,false);
  }],
  ['Configuration rejects wrong domains, duplicate ids and unknown models',()=>{
    assert.doesNotThrow(()=>core.validateConfig({devices:[device]}));
    assert.throws(()=>core.validateConfig({devices:[device,device]}));
    assert.throws(()=>core.validateConfig({devices:[{...device,model:'other'}]}));
    assert.throws(()=>core.validateConfig({devices:[{...device,entities:{fall:'sensor.fall'}}]}));
    assert.throws(()=>core.validateConfig({devices:[{...device,entities:{heart_rate:'binary_sensor.heart'}}]}));
    assert.throws(()=>core.validateConfig({devices:[],stale_after:0}));
  }],
  ['Discovery maps only unique candidates on the matching device',()=>{
    const devices=[{id:'1',model:'MR60BHA2',name:'Radar'},{id:'2',model:'other'}];
    const entities=[{device_id:'1',entity_id:'sensor.heart_rate'},{device_id:'2',entity_id:'sensor.heart_rate_other'},{device_id:'1',entity_id:'binary_sensor.has_target'},{device_id:'1',entity_id:'sensor.distance_1'},{device_id:'1',entity_id:'sensor.distance_2'},{device_id:'1',entity_id:'sensor.breath_rate',disabled_by:'user'}];
    const found=core.discoverDevices(devices,entities);
    assert.equal(found.length,1);assert.equal(found[0].entities.heart_rate,'sensor.heart_rate');assert.equal(found[0].entities.presence,'binary_sensor.has_target');assert.equal(found[0].entities.distance,undefined);assert.equal(found[0].entities.breath_rate,undefined);
  }],
  ['Compressed and full history preserve unknown values and sort by time',()=>{
    const h=core.normalizeHistory({'sensor.heart':[{s:'unknown',lu:20},{state:'68',last_updated:'1970-01-01T00:00:10Z'},{s:'1',lu:'bad'}]});
    assert.deepEqual(h['sensor.heart'],[{state:'68',at:10000},{state:'unknown',at:20000}]);
  }],
  ['CSV escapes names and prevents spreadsheet formula injection',()=>{
    const csv=core.toCSV({'sensor.heart':[{state:'=HYPERLINK(1)',at:now}]},[{...device,name:'=SUM(1,2) "test"'}]);
    assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes(`'=SUM(1,2) ""test""`));
    assert.equal(core.escapeHTML('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
  }],

];
export async function runScenarios(){const passed=[];for(const [name,fn]of scenarios){await fn();passed.push(name);}return {passed:passed.length,scenarios:passed};}
