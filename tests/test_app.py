"""Ingress, storage and live bridge contracts with synthetic Home Assistant data."""
import asyncio
import copy
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'esp32health'))
from app import ConfigStore, SnapshotHub, STORE_KEY, create_app, history_command, validate_config
from ha_bridge import HABridge, HAUnavailable, registry_rows, sensor_state
from indicators import LED_OPTIONS, validate_binding, validate_brightness_binding

CONFIG = {'title': 'Syntetiske testdata', 'devices': [
    {'id': 'test-bha', 'name': 'TEST · Soveværelse', 'area': 'Testområde', 'model': 'MR60BHA2', 'entities': {
        'presence': 'binary_sensor.test_presence', 'heart_rate': 'sensor.test_heart_rate',
        'breath_rate': 'sensor.test_breath_rate', 'distance': 'sensor.test_distance',
        'num_targets': 'sensor.test_targets'}},
    {'id': 'test-fda', 'name': 'TEST · Opholdsrum', 'area': 'Testområde', 'model': 'MR60FDA2',
     'entities': {'presence': 'binary_sensor.test_fda_presence', 'fall': 'binary_sensor.test_fall'}},
]}


def states():
    now = datetime.now(timezone.utc).isoformat()
    values = {'binary_sensor.test_presence': ('on', None), 'sensor.test_heart_rate': ('68', 'bpm'),
              'sensor.test_breath_rate': ('14', None), 'sensor.test_distance': ('112', 'cm'),
              'sensor.test_targets': ('1', None), 'binary_sensor.test_fda_presence': ('on', None),
              'binary_sensor.test_fall': ('off', None), 'sensor.unrelated_private': ('999', None)}
    return {entity_id: {'entity_id': entity_id, 'state': value, 'last_updated': now, 'last_reported': now,
                        'last_changed': now, 'attributes': {'friendly_name': entity_id.split('.')[1], 'unit_of_measurement': unit}}
            for entity_id, (value, unit) in values.items()}


class FakeBridge:
    def __init__(self):
        self.connected = True
        self.states = states()
        self.on_change = lambda: None
        self.commands = []
        self.registries = {
            'device': [{'id': d['id'], 'model': 'esp32-c6', 'name': d['name']} for d in CONFIG['devices']],
            'entity': [{'entity_id': entity_id, 'device_id': d['id'], 'original_name': role, 'platform': 'esphome'}
                       for d in CONFIG['devices'] for role, entity_id in d['entities'].items()],
            'area': [],
        }
        for d in CONFIG['devices']:
            entity_id = 'select.' + d['id'].replace('-', '_') + '_esphealth_led_status'
            self.registries['entity'].append({'entity_id':entity_id,'device_id':d['id'],'platform':'esphome','original_name':'ESPHealth LED status'})
            self.states[entity_id] = {'entity_id':entity_id,'state':'Slukket','attributes':{'friendly_name':'ESPHealth LED status','options':list(LED_OPTIONS)}}
            brightness_id = 'number.' + d['id'].replace('-', '_') + '_esphealth_led_lysstyrke'
            self.registries['entity'].append({'entity_id':brightness_id,'device_id':d['id'],'platform':'esphome','original_name':'ESPHealth LED lysstyrke'})
            self.states[brightness_id] = {'entity_id':brightness_id,'state':'100','attributes':{'friendly_name':'ESPHealth LED lysstyrke','min':0,'max':100,'step':1}}

    async def start(self):
        self.on_change()

    async def close(self):
        pass

    async def notify(self, service, title, message, tag, notification_level='normal'):
        if not self.connected:
            raise HAUnavailable()
        if service not in {x['id'] for x in await self.notification_targets()}:
            raise ValueError('Unknown notification target.')
        self.commands.append({'type': 'notification', 'service': service, 'message': message,
                              'notification_level': notification_level})

    async def notification_targets(self):
        if not self.connected:
            raise HAUnavailable()
        return [{'id': 'persistent_notification.create', 'name': 'Home Assistant'},
                {'id': 'notify.mobile_app_test', 'name': 'Synthetic phone'}]

    async def set_indicator(self, device, mode):
        if not self.connected:
            raise HAUnavailable()
        target = validate_binding(device,self.registries,self.states)
        if mode not in LED_OPTIONS:
            raise ValueError('Invalid LED mode')
        self.commands.append({'type':'indicator','entity_id':target,'mode':mode})
        self.states[target]['state'] = mode

    async def refresh_registries(self):
        if not self.connected:
            raise HAUnavailable()

    async def set_indicator_brightness(self, device):
        target = validate_brightness_binding(device, self.registries, self.states)
        self.commands.append({'type':'brightness','entity_id':target,'value':device['indicator']['brightness']})
        self.states[target]['state'] = str(device['indicator']['brightness'])

    async def call(self, command):
        if not self.connected:
            raise HAUnavailable()
        self.commands.append(command)
        return {entity_id: [{'s': self.states[entity_id]['state'], 'lu': datetime.now(timezone.utc).timestamp()}]
                for entity_id in command['entity_ids']}


class StorageTests(unittest.TestCase):
    def test_validation_rejects_wrong_domains_and_duplicate_ids(self):
        for modify in (lambda c: c['devices'].append(c['devices'][0]),
                       lambda c: c['devices'][0]['entities'].update(heart_rate='switch.private'),
                       lambda c: c['devices'][0].update(model='__proto__'),
                       lambda c: c.update(stale_after=float('nan'))):
            value = copy.deepcopy(CONFIG)
            modify(value)
            with self.assertRaises(ValueError):
                validate_config(value)

    def test_atomic_storage_survives_restart_without_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'config.json'
            store = ConfigStore(path)
            result = store.save(CONFIG, 0)
            self.assertEqual(result['revision'], 1)
            self.assertEqual(ConfigStore(path).document(), result)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('token', path.read_text())
            self.assertFalse(path.with_suffix('.tmp').exists())

    def test_stale_tab_cannot_overwrite_new_configuration(self):
        with tempfile.TemporaryDirectory() as folder:
            store = ConfigStore(Path(folder) / 'config.json')
            store.save(CONFIG, 0)
            before = store.path.read_bytes()
            with self.assertRaises(web.HTTPConflict):
                store.save({'devices': []}, 0)
            self.assertEqual(store.path.read_bytes(), before)

    def test_corrupt_storage_is_not_silently_reset(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'config.json'
            path.write_text('broken')
            with self.assertRaises(ValueError):
                ConfigStore(path)
            self.assertEqual(path.read_text(), 'broken')

    def test_history_is_limited_to_selected_entities_and_24_hours(self):
        now = datetime.now(timezone.utc)
        valid = {'entity_ids': ['sensor.test'], 'start_time': (now-timedelta(hours=6)).isoformat(), 'end_time': now.isoformat()}
        self.assertEqual(history_command(valid, {'sensor.test'})['type'], 'history/history_during_period')
        for modify in (lambda c: c.update(entity_ids=['sensor.private']),
                       lambda c: c.update(entity_ids=[]),
                       lambda c: c.update(start_time=(now-timedelta(days=2)).isoformat()),
                       lambda c: c.update(end_time=(now+timedelta(hours=1)).isoformat()),
                       lambda c: c.update(start_time='not-a-time')):
            value = copy.deepcopy(valid)
            modify(value)
            with self.assertRaises(ValueError):
                history_command(value, {'sensor.test'})

    def test_sensor_and_registry_sanitization(self):
        value = {'entity_id': 'sensor.test', 'state': '1', 'attributes': {'friendly_name': 'Sensor', 'secret': 'private'}}
        self.assertNotIn('secret', sensor_state(value)['attributes'])
        self.assertIsNone(sensor_state({'entity_id': 'lock.front', 'state': 'locked'}))
        self.assertEqual(registry_rows('entity', [{'entity_id': 'lock.front'}, {'entity_id': 'sensor.test', 'secret': 'private', 'platform': 'esphome'}]), [{'entity_id': 'sensor.test', 'platform': 'esphome'}])


class AppTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.bridge = FakeBridge()
        self.application = create_app(config_path=Path(self.folder.name)/'config.json', bridge=self.bridge, local=True)
        self.client = TestClient(TestServer(self.application))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.folder.cleanup()

    async def save(self, config=CONFIG, revision=0):
        return await self.client.put('/api/config', json={'config': config, 'revision': revision}, headers={'X-ESP32Health': '1'})

    async def test_no_authentication_or_external_asset_needed(self):
        response = await self.client.get('/')
        html = await response.text()
        self.assertEqual(response.status, 200)
        self.assertNotIn('ha-token', html)
        self.assertIn('src="app.js"', html)
        self.assertNotIn('src="/', html)
        self.assertIn("connect-src 'self'", response.headers['Content-Security-Policy'])
        self.assertIn("frame-ancestors 'self'", response.headers['Content-Security-Policy'])
        self.assertEqual((await self.client.get('/ha_bridge.py')).status, 404)

    async def test_ingress_protection_does_not_trust_forwarded_address(self):
        app = create_app(config_path=Path(self.folder.name)/'protected.json', bridge=FakeBridge())
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            response = await client.get('/api/config', headers={'X-Forwarded-For': '172.30.32.2'})
            self.assertEqual(response.status, 403)
            self.assertEqual((await client.get('/health')).status, 200)
        finally:
            await client.close()

    async def test_config_save_and_conflict_over_http(self):
        self.assertEqual((await self.save()).status, 200)
        self.assertEqual((await self.save(revision=0)).status, 409)
        result = await (await self.client.get('/api/config')).json()
        self.assertEqual(result['revision'], 1)
        self.assertEqual(result['config']['devices'], CONFIG['devices'])

    async def test_csrf_and_bad_input_do_not_change_config(self):
        response = await self.client.put('/api/config', json={'revision': 0, 'config': CONFIG})
        self.assertEqual(response.status, 403)
        bad = copy.deepcopy(CONFIG)
        bad['devices'][0]['entities']['heart_rate'] = 'lock.front'
        self.assertEqual((await self.save(bad)).status, 400)
        self.assertEqual(self.application[STORE_KEY].revision, 0)

    async def test_sse_redacts_unselected_sensor_values(self):
        await self.save()
        response = await self.client.get('/api/events')
        value = json.loads((await response.content.readline()).decode()[6:])
        self.assertEqual(value['states']['sensor.test_heart_rate']['state'], '68')
        self.assertEqual(value['states']['sensor.unrelated_private']['state'], 'unknown')
        self.assertNotIn('token', json.dumps(value))
        response.close()

    async def test_history_uses_only_allowlisted_read_command(self):
        await self.save()
        now = datetime.now(timezone.utc)
        value = {'entity_ids': ['sensor.test_heart_rate'], 'start_time': (now-timedelta(hours=1)).isoformat(), 'end_time': now.isoformat()}
        response = await self.client.post('/api/history', json=value, headers={'X-ESP32Health': '1'})
        self.assertEqual(response.status, 200)
        self.assertEqual(self.bridge.commands[-1]['type'], 'history/history_during_period')
        value['entity_ids'] = ['sensor.unrelated_private']
        self.assertEqual((await self.client.post('/api/history', json=value, headers={'X-ESP32Health': '1'})).status, 400)
        self.assertEqual((await self.client.post('/api/call_service', json={})).status, 403)

    async def test_history_disconnect_returns_controlled_error(self):
        await self.save()
        self.bridge.connected = False
        now = datetime.now(timezone.utc)
        value = {'entity_ids': ['sensor.test_heart_rate'], 'start_time': (now-timedelta(hours=1)).isoformat(), 'end_time': now.isoformat()}
        response = await self.client.post('/api/history', json=value, headers={'X-ESP32Health': '1'})
        self.assertEqual(response.status, 503)
        self.assertNotIn('Traceback', await response.text())

    async def test_snapshot_queue_drops_old_samples(self):
        hub = SnapshotHub()
        queue = asyncio.Queue(maxsize=1)
        hub.queues.add(queue)
        hub.publish({'value': 1})
        hub.publish({'value': 2})
        self.assertEqual(await queue.get(), {'value': 2})


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_websocket_protocol_and_removal_without_exposing_token(self):
        socket_ready = asyncio.Event()
        changed = asyncio.Event()
        sockets = []
        commands = []
        async def handler(request):
            self.assertEqual(request.headers.get('Authorization'), 'Bearer synthetic-supervisor-token')
            ws = web.WebSocketResponse()
            await ws.prepare(request)
            await ws.send_json({'type': 'auth_required'})
            auth = await ws.receive_json()
            self.assertEqual(auth, {'type': 'auth', 'access_token': 'synthetic-supervisor-token'})
            await ws.send_json({'type': 'auth_ok'})
            sockets.append(ws)
            socket_ready.set()
            async for message in ws:
                command = message.json()
                commands.append(command['type'])
                result = []
                if command['type'] == 'get_states':
                    result = list(states().values()) + [{'entity_id': 'lock.private', 'state': 'locked'}]
                await ws.send_json({'id': command['id'], 'type': 'result', 'success': True, 'result': result})
            return ws
        mock = web.Application()
        mock.router.add_get('/core/websocket', handler)
        server = TestServer(mock)
        await server.start_server()
        url = str(server.make_url('/core/websocket')).replace('http:', 'ws:')
        bridge = HABridge('synthetic-supervisor-token', url=url, on_change=changed.set)
        await bridge.start()
        try:
            for _ in range(100):
                if bridge.connected:
                    break
                await asyncio.sleep(.01)
            self.assertTrue(bridge.connected)
            self.assertNotIn('lock.private', bridge.states)
            self.assertEqual(bridge.states['sensor.test_heart_rate']['state'], '68')
            changed.clear()
            await sockets[-1].send_json({'type': 'event', 'event': {'event_type': 'state_changed', 'data': {'entity_id': 'sensor.test_heart_rate', 'new_state': None}}})
            for _ in range(100):
                if 'sensor.test_heart_rate' not in bridge.states:
                    break
                await asyncio.sleep(.01)
            self.assertNotIn('sensor.test_heart_rate', bridge.states)
            with self.assertRaises(ValueError):
                await bridge.call({'type': 'call_service', 'domain': 'light'})
            self.assertNotIn('call_service', commands)
            await sockets[-1].close()
            for _ in range(100):
                if not bridge.connected:
                    break
                await asyncio.sleep(.01)
            self.assertFalse(bridge.connected)
            self.assertEqual(bridge.states, {})
            for _ in range(300):
                if bridge.connected:
                    break
                await asyncio.sleep(.01)
            self.assertTrue(bridge.connected)
            self.assertEqual(bridge.states['sensor.test_heart_rate']['state'], '68')
            self.assertGreaterEqual(commands.count('subscribe_events'), 2)
        finally:
            await bridge.close()
            await server.close()
        self.assertEqual(bridge._token, '')


if __name__ == '__main__':
    unittest.main()
