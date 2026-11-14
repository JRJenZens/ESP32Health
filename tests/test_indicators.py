"""Synthetic LED ownership, fixed payloads, heartbeat and configuration checks."""
import copy
import tempfile
import unittest
from pathlib import Path

import test_app as fixture
from app import validate_config
from ha_bridge import HABridge, sensor_state
from indicators import IndicatorController, LED_OPTIONS, indicator_mode, validate_binding


class IndicatorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.bridge=fixture.FakeBridge()
        self.config=copy.deepcopy(fixture.CONFIG)
        self.device=self.config['devices'][0]
        self.device['indicator']={'enabled':True,'entity_id':'select.test_bha_esphealth_led_status'}
        self.device['alerts']={'enabled':True}
        self.rules=[]
        self.controller=IndicatorController(self.bridge,lambda:self.config,lambda:self.rules)

    async def test_severity_priority_and_pending_states_do_not_start_alarm_colors(self):
        self.assertEqual(indicator_mode(self.device,[]),'Auto')
        row={'device_id':'test-bha','state':'pending','notification_level':'critical'}
        self.assertEqual(indicator_mode(self.device,[row]),'Auto')
        row['state']='active'
        self.assertEqual(indicator_mode(self.device,[row]),'Kritisk')
        ordinary={**row,'notification_level':'normal'}
        self.assertEqual(indicator_mode(self.device,[ordinary]),'Advarsel')
        self.assertEqual(indicator_mode(self.device,[ordinary,row]),'Kritisk')
        self.device['alerts']['enabled']=False
        self.assertEqual(indicator_mode(self.device,[row]),'Auto')
        self.device['indicator']['enabled']=False
        self.assertEqual(indicator_mode(self.device,[row]),'Slukket')

    async def test_heartbeat_updates_without_sensor_changes_and_color_changes_are_immediate(self):
        await self.controller.tick(0)
        self.assertEqual(self.bridge.commands[-1]['mode'],'Auto')
        await self.controller.tick(14)
        self.assertEqual(len(self.bridge.commands),1)
        await self.controller.tick(15)
        self.assertEqual(len(self.bridge.commands),2)
        self.rules=[{'device_id':'test-bha','state':'active','notification_level':'critical'}]
        await self.controller.tick(16)
        self.assertEqual(self.bridge.commands[-1]['mode'],'Kritisk')
        self.rules=[]
        await self.controller.tick(17)
        self.assertEqual(self.bridge.commands[-1]['mode'],'Auto')

    async def test_disable_and_removed_mapping_switch_off_the_previously_bound_led(self):
        await self.controller.tick(0)
        self.device['indicator']['enabled']=False
        await self.controller.tick(1)
        self.assertEqual(self.bridge.commands[-1]['mode'],'Slukket')
        self.config['devices']=[]
        await self.controller.tick(2)
        self.assertEqual(self.controller.previous,{})
        self.assertEqual(self.controller.status,{})

    async def test_connection_failure_leaves_firmware_watchdog_in_control_then_recovers(self):
        await self.controller.tick(0)
        count=len(self.bridge.commands)
        self.bridge.connected=False
        await self.controller.tick(1)
        self.assertEqual(len(self.bridge.commands),count)
        self.assertEqual(self.controller.status['test-bha']['state'],'waiting')
        self.bridge.connected=True
        await self.controller.tick(2)
        self.assertEqual(len(self.bridge.commands),count+1)
        self.assertEqual(self.controller.status['test-bha']['state'],'ok')

    async def test_failed_commands_back_off_and_do_not_stop_other_leds(self):
        self.config['devices'][1]['indicator']={'enabled':True,'entity_id':'select.test_fda_esphealth_led_status'}
        original=self.bridge.set_indicator
        attempts=[]
        async def flaky(device,mode):
            if device['id']=='test-bha':
                attempts.append(mode)
                raise ValueError('Synthetic failure')
            await original(device,mode)
        self.bridge.set_indicator=flaky
        await self.controller.tick(0)
        await self.controller.tick(1)
        self.assertEqual(len(attempts),1)
        self.assertEqual(self.controller.status['test-fda']['state'],'ok')
        await self.controller.tick(15)
        self.assertEqual(len(attempts),2)

    async def test_cross_device_calibration_and_arbitrary_selects_are_rejected(self):
        self.assertEqual(validate_binding(self.device,self.bridge.registries,self.bridge.states),'select.test_bha_esphealth_led_status')
        for target in ['select.test_fda_esphealth_led_status','select.radar_sensitivity','light.test_led']:
            self.device['indicator']['entity_id']=target
            with self.assertRaises(ValueError):validate_binding(self.device,self.bridge.registries,self.bridge.states)
        self.device['indicator']['entity_id']='select.test_bha_esphealth_led_status'
        self.bridge.states[self.device['indicator']['entity_id']]['attributes']['options']=['1','2','3']
        with self.assertRaises(ValueError):validate_binding(self.device,self.bridge.registries,self.bridge.states)

    async def test_bridge_builds_only_a_fixed_led_select_call(self):
        bridge=HABridge('synthetic')
        bridge.registries=self.bridge.registries
        bridge.states=self.bridge.states
        async def refresh():pass
        calls=[]
        async def request(command):calls.append(command)
        bridge.refresh_registries=refresh
        bridge._request=request
        await bridge.set_indicator(self.device,'Kritisk')
        self.assertEqual(calls,[{'type':'call_service','domain':'select','service':'select_option',
                         'target':{'entity_id':'select.test_bha_esphealth_led_status'},'service_data':{'option':'Kritisk'}}])
        with self.assertRaises(ValueError):await bridge.set_indicator(self.device,'arbitrary')
        with self.assertRaises(ValueError):await bridge.call({'type':'call_service','domain':'select'})

    async def test_metadata_retains_only_compatible_status_selects_and_validates_duplicate_bindings(self):
        entity=self.bridge.states['select.test_bha_esphealth_led_status']
        self.assertEqual(sensor_state(entity)['attributes']['options'],list(LED_OPTIONS))
        self.assertIsNone(sensor_state({'entity_id':'select.calibration','state':'1','attributes':{'options':['1','2']}}))
        bridge=HABridge('synthetic')
        self.assertFalse(bridge._apply({'entity_id':'light.led','new_state':{'entity_id':'light.led','state':'on'}}))
        self.assertEqual(bridge.states,{})  # Physical blinking must not flood app updates.
        self.assertTrue(bridge._apply({'entity_id':entity['entity_id'],'new_state':entity}))
        other=copy.deepcopy(self.device);other['id']='duplicate'
        with self.assertRaises(ValueError):validate_config({'devices':[self.device,other]})


class IndicatorApiTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp=fixture.AppTests.asyncSetUp
    asyncTearDown=fixture.AppTests.asyncTearDown
    save=fixture.AppTests.save

    async def test_config_accepts_same_device_status_led_and_rejects_other_devices(self):
        cfg=copy.deepcopy(fixture.CONFIG)
        cfg['devices'][0]['indicator']={'enabled':True,'entity_id':'select.test_bha_esphealth_led_status'}
        self.assertEqual((await self.save(cfg)).status,200)
        cfg['devices'][0]['indicator']['entity_id']='select.test_fda_esphealth_led_status'
        self.assertEqual((await self.save(cfg,revision=1)).status,400)
        document=await (await self.client.get('/api/config')).json()
        self.assertEqual(document['config']['devices'][0]['indicator']['entity_id'],'select.test_bha_esphealth_led_status')
        self.assertEqual(document['revision'],1)
