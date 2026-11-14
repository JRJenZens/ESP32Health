"""Portable migration across Supervisor repository identities, using synthetic data."""
import copy
import json
import math
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp.test_utils import TestClient, TestServer

from test_app import CONFIG, FakeBridge
from app import ALERTS_KEY, STORE_KEY, create_app, validate_backup

HEADERS = {'X-ESP32Health': '1'}


class BackupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.clients = []

    async def asyncTearDown(self):
        for client in reversed(self.clients):
            await client.close()
        self.folder.cleanup()

    async def installation(self, name):
        bridge = FakeBridge()
        app = create_app(config_path=Path(self.folder.name)/name/'config.json', bridge=bridge, local=True)
        client = TestClient(TestServer(app))
        self.clients.append(client)
        await client.start_server()
        await app[ALERTS_KEY].close()
        return app, client, bridge

    async def archive(self):
        app, client, bridge = await self.installation('old')
        config = copy.deepcopy(CONFIG)
        config['devices'][0]['alerts'] = {'enabled': True, 'heart_high': 60, 'delay': 1}
        config['devices'][0]['indicator'] = {'enabled': True, 'entity_id': 'select.test_bha_esphealth_led_status'}
        result = await client.put('/api/config', json={'revision': 0, 'config': config}, headers=HEADERS)
        self.assertEqual(result.status, 200)
        clean = (await result.json())['config']
        now = time.time()
        await app[ALERTS_KEY].tick(clean, bridge.states, True, now)
        await app[ALERTS_KEY].tick(clean, bridge.states, True, now + 2)
        self.assertEqual(len(app[ALERTS_KEY].document['active']), 1)
        response = await client.get('/api/backup')
        self.assertIn('attachment', response.headers['Content-Disposition'])
        value = await response.json()
        self.assertNotIn('token', json.dumps(value))
        return value

    async def test_round_trip_keeps_mapping_led_thresholds_log_and_active_deduplication(self):
        value = await self.archive()
        app, client, bridge = await self.installation('new')
        response = await client.post('/api/backup/import', json=value, headers=HEADERS)
        self.assertEqual(response.status, 200)
        self.assertEqual((await response.json())['config'], value['config'])
        self.assertEqual(app[ALERTS_KEY].document, value['alerts'])
        await app[ALERTS_KEY].tick(app[STORE_KEY].config, bridge.states, True, time.time() + 5)
        self.assertFalse(any(c['type'] == 'notification' for c in bridge.commands))
        self.assertEqual(len(app[ALERTS_KEY].document['events']), 1)
        self.assertEqual((app[STORE_KEY].path.stat().st_mode & 0o777), 0o600)
        # A normal restart reads both files with the same identifiers/cooldowns.
        await client.close()
        restarted = create_app(config_path=app[STORE_KEY].path, bridge=FakeBridge(), local=True)
        self.assertEqual(restarted[STORE_KEY].config, value['config'])
        self.assertEqual(restarted[ALERTS_KEY].document, app[ALERTS_KEY].document)

    async def test_import_rejects_existing_installation_and_missing_csrf(self):
        value = await self.archive()
        app, client, _ = await self.installation('new')
        self.assertEqual((await client.post('/api/backup/import', json=value)).status, 403)
        self.assertEqual(app[STORE_KEY].revision, 0)
        self.assertEqual((await client.post('/api/backup/import', json=value, headers=HEADERS)).status, 200)
        before = app[STORE_KEY].path.read_bytes()
        self.assertEqual((await client.post('/api/backup/import', json=value, headers=HEADERS)).status, 409)
        self.assertEqual(app[STORE_KEY].path.read_bytes(), before)

    async def test_import_validates_live_indicator_ownership_before_writing(self):
        value = await self.archive()
        app, client, bridge = await self.installation('new')
        value['config']['devices'][0]['indicator']['entity_id'] = 'select.test_fda_esphealth_led_status'
        response = await client.post('/api/backup/import', json=value, headers=HEADERS)
        self.assertEqual(response.status, 400)
        self.assertEqual(app[STORE_KEY].revision, 0)
        self.assertFalse(app[STORE_KEY].path.exists())
        self.assertEqual(app[ALERTS_KEY].document['events'], [])

    async def test_invalid_archive_data_is_rejected_without_writes(self):
        value = await self.archive()
        app, client, _ = await self.installation('new')
        edits = [lambda x: x.update(version=True),
                 lambda x: x.update(token='forbidden'),
                 lambda x: x['alerts']['events'][0].update(at=math.nan),
                 lambda x: x['alerts']['sent'].update(arbitrary=123),
                 lambda x: x['alerts']['events'][0].update(notify_service='lock.unlock'),
                 lambda x: x['config']['devices'][0]['entities'].update(heart_rate='lock.private')]
        for edit in edits:
            bad = copy.deepcopy(value)
            edit(bad)
            response = await client.post('/api/backup/import', json=bad, headers=HEADERS)
            self.assertEqual(response.status, 400)
            self.assertEqual(app[STORE_KEY].revision, 0)
            self.assertFalse(app[STORE_KEY].path.exists())
        self.assertEqual(app[ALERTS_KEY].document['events'], [])

    async def test_failed_config_write_restores_previous_log(self):
        value = await self.archive()
        app, client, _ = await self.installation('new')
        with patch.object(app[STORE_KEY], 'save', side_effect=OSError('synthetic disk failure')):
            response = await client.post('/api/backup/import', json=value, headers=HEADERS)
        self.assertEqual(response.status, 500)
        self.assertEqual(app[STORE_KEY].revision, 0)
        self.assertEqual(app[ALERTS_KEY].document, {'events': [], 'active': {}, 'sent': {}})
        self.assertEqual(json.loads(app[ALERTS_KEY].path.read_text()), app[ALERTS_KEY].document)
