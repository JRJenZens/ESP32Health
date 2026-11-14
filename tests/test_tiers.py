"""Independent durations, severity escalation and migration; no clinical thresholds."""
import copy
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

from test_app import CONFIG, states
from alerts import AlertEngine, validate_alerts


class TierValidationTests(unittest.TestCase):
    def test_legacy_normal_and_critical_settings_migrate_without_changing_intent(self):
        for level in ('normal','critical'):
            old = {'enabled': True,'heart_low':50,'heart_high':100,'delay':47,
                   'notification_level':level,'notify_service':'notify.mobile_app_test'}
            clean = validate_alerts(old,'MR60BHA2')
            prefix = 'critical_' if level == 'critical' else ''
            self.assertEqual(clean[prefix+'heart_high'],100)
            self.assertEqual(clean[prefix+'heart_low'],50)
            self.assertEqual(clean[prefix+'heart_high_delay'],47)
            self.assertEqual(clean['enabled'],True)
            self.assertEqual(clean['notify_service'],old['notify_service'])
            self.assertEqual(clean['critical_heart_high'] if level=='normal' else clean['heart_high'],None)
            self.assertEqual(validate_alerts(clean,'MR60BHA2'),clean)

    def test_nested_ranges_and_durations_are_validated_without_defaults_for_limits(self):
        valid = {'threshold_version':2,'notify_service':'notify.mobile_app_test','enabled':True,
                 'heart_low':50,'critical_heart_low':40,'heart_high':100,'critical_heart_high':120,
                 'heart_low_delay':1,'critical_heart_low_delay':3600,'heart_high_delay':30,'critical_heart_high_delay':5}
        self.assertEqual(validate_alerts(valid,'MR60BHA2')['critical_heart_high_delay'],5)
        for edit in ({'critical_heart_low':60},{'critical_heart_high':90},{'heart_high_delay':0},
                     {'heart_high_delay':None},{'critical_heart_high_delay':True},
                     {'critical_heart_high_delay':3601},{'threshold_version':1},
                     {'notify_service':'persistent_notification.create'}):
            with self.subTest(edit=edit), self.assertRaises(ValueError):
                validate_alerts({**valid,**edit},'MR60BHA2')
        # The same boundary can use different durations for escalation.
        same = validate_alerts({**valid,'critical_heart_high':100,'critical_heart_high_delay':60},'MR60BHA2')
        self.assertEqual(same['critical_heart_high_delay'],60)


class TierEngineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.sent = []
        async def notify(*args): self.sent.append(args)
        self.engine = AlertEngine(Path(self.folder.name)/'alerts.json',notify)
        self.config = copy.deepcopy(CONFIG)
        self.a = {'threshold_version':2,'enabled':True,'notify_service':'notify.mobile_app_test',
                  'heart_high':90,'heart_high_delay':5,'critical_heart_high':120,'critical_heart_high_delay':3}
        self.config['devices'][0]['alerts'] = self.a
        self.values = states()
        self.now = time.time()

    async def asyncTearDown(self): self.folder.cleanup()

    async def tick(self, at, pulse, breath=14, connected=True):
        for state in self.values.values():
            state['last_reported'] = datetime.fromtimestamp(self.now+at,timezone.utc).isoformat()
        self.values['sensor.test_heart_rate']['state'] = str(pulse)
        self.values['sensor.test_breath_rate']['state'] = str(breath)
        await self.engine.tick(self.config,self.values,connected,self.now+at)

    async def test_ordinary_then_critical_escalation_has_its_own_timer_and_cooldown(self):
        await self.tick(0,100)
        await self.tick(4,100)
        self.assertEqual(self.sent,[])
        await self.tick(5,100)
        self.assertEqual([s[4] for s in self.sent],['normal'])
        await self.tick(6,130)
        await self.tick(8,130)
        self.assertEqual(len(self.sent),1)
        await self.tick(9,130)
        self.assertEqual([s[4] for s in self.sent],['normal','critical'])
        row = next(r for r in self.engine.rules if r['rule']=='heart_high')
        self.assertEqual(row['state'],'covered')
        self.assertEqual(self.engine.snapshot()['events'][0]['duration'],3)
        await self.tick(10,130)
        self.assertEqual(len(self.sent),2)

    async def test_critical_wins_if_both_durations_expire_together(self):
        self.a['critical_heart_high_delay'] = 5
        await self.tick(0,130)
        await self.tick(5,130)
        self.assertEqual([s[4] for s in self.sent],['critical'])
        await self.tick(30,130)
        self.assertEqual(len(self.sent),1)

    async def test_critical_timer_resets_independently_of_ordinary_violation(self):
        self.a['heart_high_delay'] = 20
        await self.tick(0,130)
        await self.tick(2,100)  # Still an ordinary violation; critical boundary is no longer exceeded.
        await self.tick(4,130)
        await self.tick(6,130)
        self.assertEqual(self.sent,[])
        await self.tick(7,130)
        self.assertEqual([s[4] for s in self.sent],['critical'])
        self.assertEqual(next(r for r in self.engine.rules if r['rule']=='heart_high')['since'],self.now)

    async def test_unavailable_and_normal_samples_reset_pending_durations(self):
        await self.tick(0,130)
        await self.tick(2,'unavailable')
        await self.tick(3,130)
        await self.tick(5,130)
        self.assertEqual(self.sent,[])
        await self.tick(6,80)
        await self.tick(7,130)
        await self.tick(9,130)
        self.assertEqual(self.sent,[])
        await self.tick(10,130)
        self.assertEqual([s[4] for s in self.sent],['critical'])

    async def test_each_metric_and_direction_has_an_independent_duration(self):
        self.a.update(heart_high=None,critical_heart_high=None,heart_low=50,heart_low_delay=8,
                      critical_heart_low=40,critical_heart_low_delay=2,breath_high=20,breath_high_delay=4)
        await self.tick(0,45,25)
        await self.tick(4,45,25)
        self.assertIn('Vejrtrækning',self.sent[0][1])
        await self.tick(5,35,25)
        await self.tick(7,35,25)
        self.assertEqual(self.sent[1][4],'critical')
        self.assertIn('puls under',self.sent[1][1])
        self.assertFalse(any(s[4]=='normal' and 'Puls' in s[1] for s in self.sent))

    async def test_restart_requires_a_new_pending_window_and_deduplicates_active_critical(self):
        await self.tick(0,130)
        await self.tick(2,130)
        self.engine = AlertEngine(self.engine.path,self.engine.notify)
        await self.tick(3,130)
        await self.tick(5,130)
        self.assertEqual(self.sent,[])
        await self.tick(6,130)
        self.assertEqual(len(self.sent),1)
        self.engine = AlertEngine(self.engine.path,self.engine.notify)
        await self.tick(10,130)
        self.assertEqual(len(self.sent),1)

    async def test_legacy_critical_event_respects_cooldown_after_migration(self):
        self.a.update(heart_high=None)
        self.engine.document['events'].append({'id':'legacy','device_id':'test-bha','name':'Synthetic',
            'rule':'heart_high','notification_level':'critical','at':self.now-10,'delivery':'sent'})
        await self.tick(0,130)
        await self.tick(3,130)
        self.assertEqual(self.sent,[])
        self.assertEqual(self.engine.snapshot()['events'][0]['delivery'],'cooldown')
