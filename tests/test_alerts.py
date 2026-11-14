"""Advisory alarm transitions and delivery use synthetic measurements only."""
import copy
import tempfile
import time
import unittest
from pathlib import Path
from datetime import datetime, timezone

import test_app as fixture
from test_app import CONFIG, states, HABridge, HAUnavailable
from alerts import AlertEngine, DEFAULT_ALERTS, conditions, quality, validate_alerts


class ValidationTests(unittest.TestCase):
    def test_off_by_default_and_no_medical_thresholds(self):
        a = validate_alerts({}, 'MR60BHA2')
        self.assertFalse(a['enabled'])
        self.assertIsNone(a['heart_low'])
        self.assertIsNone(a['breath_low'])

    def test_invalid_or_unrelated_notification_actions_rejected(self):
        for edit in ({'notify_service': 'light.turn_on'}, {'notify_service': 'notify.email'},
                     {'delay': 0}, {'delay': True}, {'delay': 1.5}, {'heart_high': float('nan')},
                     {'heart_low': True}, {'heart_low': 100, 'heart_high': 90},
                     {'breath_low': 0}, {'enabled': 'yes'}, {'enabled': True}, {'unknown': 3}):
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                validate_alerts(edit, 'MR60BHA2')
        with self.assertRaises(ValueError):
            validate_alerts({'heart_high': 90}, 'MR60FDA2')
        with self.assertRaises(ValueError):
            validate_alerts({'fall': True}, 'MR60BHA2')


class EngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name)/'alerts.json'
        self.sent = []
        async def notify(*args):
            self.sent.append(args)
        self.notify = notify
        self.engine = AlertEngine(self.path, notify)
        self.config = copy.deepcopy(CONFIG)
        self.config['devices'][0]['alerts'] = {**DEFAULT_ALERTS, 'enabled': True, 'heart_high': 90, 'delay': 5}
        self.now = time.time()
        self.values = states()
        self.values['sensor.test_heart_rate']['state'] = '110'

    async def asyncTearDown(self):
        self.folder.cleanup()

    async def tick(self, delta=0, connected=True):
        return await self.engine.tick(self.config, self.values, connected, self.now+delta)

    async def test_sustained_high_pulse_sends_once_and_survives_restart(self):
        await self.tick()
        await self.tick(4)
        self.assertEqual(self.sent, [])
        await self.tick(5)
        await self.tick(6)
        self.assertEqual(len(self.sent), 1)
        self.assertIn('Puls over din grænse', self.sent[0][1])
        self.assertEqual(self.engine.snapshot()['events'][0]['delivery'], 'sent')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.engine = AlertEngine(self.path, self.notify)
        await self.tick(7, connected=False)  # Reconnecting does not re-arm an unresolved alert.
        await self.tick(8)
        await self.tick(20)
        self.assertEqual(len(self.sent), 1)

    async def test_interruption_restarts_delay_and_normal_reading_rearms_with_cooldown(self):
        await self.tick()
        await self.tick(4, connected=False)
        await self.tick(5)
        await self.tick(9)
        self.assertEqual(len(self.sent), 0)
        await self.tick(10)
        self.values['sensor.test_heart_rate']['state'] = '68'
        await self.tick(11)
        self.assertIn('ended_at', self.engine.snapshot()['events'][0])
        self.values['sensor.test_heart_rate']['state'] = '110'
        await self.tick(12)
        await self.tick(17)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.engine.snapshot()['events'][0]['delivery'], 'cooldown')

    async def test_invalid_spatial_conditions_never_trigger_thresholds(self):
        for entity, value in [('binary_sensor.test_presence','off'), ('sensor.test_targets','2'),
                              ('sensor.test_distance','224'), ('sensor.test_distance','unknown'),
                              ('sensor.test_heart_rate','0'), ('sensor.test_heart_rate','unavailable')]:
            self.values = states()
            self.values['sensor.test_heart_rate']['state'] = '110'
            self.values[entity]['state'] = value
            self.engine = AlertEngine(self.path, self.notify)
            await self.tick()
            await self.tick(10)
        self.assertEqual(self.sent, [])

    async def test_low_and_breathing_thresholds_use_independent_valid_samples(self):
        device = self.config['devices'][0]
        for key, value in [('heart_low',120), ('breath_low',20), ('breath_high',10)]:
            device['alerts'] = {**DEFAULT_ALERTS,'enabled':True,key:value}
            self.assertIsNotNone(conditions(device,self.values,True,self.now,180)[key][0])
        self.values['sensor.test_breath_rate']['state'] = '0'
        q = quality(device,self.values,True,self.now,180)
        self.assertEqual(q['heart_rate'],110)
        self.assertIsNone(q['breath_rate'])

    async def test_zero_breathing_creates_signal_advisory_not_apnea_or_low_rate(self):
        self.config['devices'][0]['alerts'].update(signal_loss=True, breath_low=8)
        self.values['sensor.test_breath_rate']['state'] = '0'
        await self.tick()
        await self.tick(5)
        self.assertEqual({e['rule'] for e in self.engine.snapshot()['events']}, {'heart_high','signal_loss'})
        self.assertTrue(any('dokumenterer ikke vejrtrækningsstop' in s[2] for s in self.sent))
        self.assertEqual(len({s[3] for s in self.sent}), 2)  # No tag collisions between rules.

    async def test_stale_values_do_not_alert_as_low_or_high(self):
        for s in self.values.values():
            s['last_updated'] = s['last_reported'] = datetime.fromtimestamp(self.now-181,timezone.utc).isoformat()
        await self.tick()
        await self.tick(5)
        self.assertEqual(self.sent, [])

    async def test_delivery_failure_is_persisted_and_does_not_loop(self):
        async def fail(*args):
            self.sent.append(args)
            raise HAUnavailable()
        self.engine.notify = fail
        await self.tick()
        await self.tick(5)
        await self.tick(6)
        self.assertEqual(len(self.sent),1)
        self.assertEqual(self.engine.snapshot()['events'][0]['delivery'],'failed')
        self.assertIn('failed', self.path.read_text())

    async def test_disabling_rules_cancels_pending_and_closes_active(self):
        await self.tick()
        self.config['devices'][0]['alerts']['enabled'] = False
        await self.tick(5)
        self.assertEqual(self.sent, [])
        self.assertEqual(self.engine.pending,{})
        self.config['devices'][0]['alerts']['enabled'] = True
        await self.tick(6)
        await self.tick(11)
        self.config['devices'] = []
        await self.tick(12)
        self.assertEqual(self.engine.document['active'],{})

    async def test_fall_rule_uses_its_own_delay(self):
        self.config['devices'][1]['alerts'] = {**DEFAULT_ALERTS,'enabled':True,'fall':True,'delay':5}
        self.values['sensor.test_heart_rate']['state'] = '68'
        self.values['binary_sensor.test_fall']['state'] = 'on'
        await self.tick()
        await self.tick(5)
        self.assertEqual(len(self.sent),1)
        self.assertIn('Muligt fald',self.sent[0][1])


class NotificationBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_fixed_notification_targets_and_payloads_reach_ha(self):
        bridge = HABridge('synthetic')
        bridge.connected = True
        commands = []
        async def request(command):
            commands.append(command)
            return {'notify': {'mobile_app_test': {'name':'Test phone'}, 'email': {}}}
        bridge._request = request
        targets = await bridge.notification_targets()
        self.assertEqual({x['id'] for x in targets},{'persistent_notification.create','notify.mobile_app_test'})
        await bridge.notify('notify.mobile_app_test','Test','Synthetic message','test-tag')
        self.assertEqual(commands[-1], {'type':'call_service','domain':'notify','service':'mobile_app_test',
                         'service_data':{'title':'Test','message':'Synthetic message','data':{'tag':'esp32health_test-tag'}}})
        await bridge.notify('persistent_notification.create','Test','Synthetic message','tag')
        self.assertEqual(commands[-1]['service_data']['notification_id'],'esp32health_tag')
        for service in ('light.turn_on','notify.mobile_app_unknown','notify.email'):
            with self.assertRaises(ValueError):
                await bridge.notify(service,'Test','Test','tag')
        with self.assertRaises(ValueError):
            await bridge.call({'type':'call_service','domain':'notify','service':'mobile_app_test'})


class AlertApiTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = fixture.AppTests.asyncSetUp
    asyncTearDown = fixture.AppTests.asyncTearDown
    save = fixture.AppTests.save

    async def test_alert_config_round_trip_and_target_validation(self):
        config = copy.deepcopy(CONFIG)
        config['devices'][0]['alerts'] = {'enabled':True,'heart_high':90}
        self.assertEqual((await self.save(config)).status,200)
        document = await (await self.client.get('/api/config')).json()
        self.assertEqual(document['config']['devices'][0]['alerts']['heart_high'],90)
        config['devices'][0]['alerts']['notify_service'] = 'notify.mobile_app_missing'
        self.assertEqual((await self.save(config,revision=1)).status,400)
        targets = await (await self.client.get('/api/notification-targets')).json()
        self.assertEqual(targets[0]['id'],'persistent_notification.create')
