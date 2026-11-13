"""Developer-only, synthetic Ingress fixture. Never connects to a real HA."""
import asyncio
import math
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from aiohttp import web

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_app import CONFIG, ConfigStore, FakeBridge, create_app


class PreviewBridge(FakeBridge):
    async def start(self):
        await super().start()
        self.task = asyncio.create_task(self.refresh())

    async def refresh(self):
        while True:
            await asyncio.sleep(10)
            for value in self.states.values():
                value['last_updated'] = value['last_reported'] = datetime.now(timezone.utc).isoformat()
            self.on_change()

    async def close(self):
        self.task.cancel()
        try:
            await self.task
        except asyncio.CancelledError:
            pass

    async def call(self, command):
        start = datetime.fromisoformat(command['start_time']).timestamp()
        end = datetime.fromisoformat(command['end_time']).timestamp()
        result = {}
        for entity_id in command['entity_ids']:
            result[entity_id] = [{'s': str(round(68 + math.sin(i*.2)*5)) if 'heart_rate' in entity_id
                                 else str(round(14+math.sin(i*.1)*2)) if 'breath_rate' in entity_id
                                 else self.states[entity_id]['state'], 'lu': start+(end-start)*i/99}
                                for i in range(100)]
        return result


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='esp32health-preview-') as folder:
        path = Path(folder)/'config.json'
        ConfigStore(path).save(CONFIG, 0)
        root = web.Application()
        root.add_subapp('/api/hassio_ingress/synthetic/', create_app(config_path=path, bridge=PreviewBridge(), local=True))
        web.run_app(root, host='127.0.0.1', port=8320, access_log=None, shutdown_timeout=2)
