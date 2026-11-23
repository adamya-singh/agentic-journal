import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExperimentError, addDirection, addExperiment, readStore, removeExperiment, setDirectionActive, updateExperiment } from '../src/lib/experiments/store.ts';
import { activeDirections, experimentsView, skyRings } from '../src/lib/experiments/sunrise.ts';
import { experimentBrief, experimentIdOf, experimentRef } from '../src/lib/experiments/brief.ts';

let dir: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'experiments-test-'));
  process.env.BACKEND_DATA_DIR = dir;
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});
const file = () => path.join(dir, 'experiments', 'experiments.json');

test('a machine with no record starts from the seed and writes nothing until something changes', () => {
  const store = readStore();
  assert.equal(store.experiments.length, 54);
  assert.equal(store.directions.length, 8);
  assert.equal(fs.existsSync(file()), false);
  updateExperiment('36', { notes: 'Check the step-180 chunk.' });
  assert.equal(readStore().experiments.find((e) => e.id === '36')?.notes, 'Check the step-180 chunk.');
  assert.equal(fs.existsSync(file()), true);
});

test('the sky holds what is in play: running nearest the sun, then flagged, then each active direction\'s latest', () => {
  updateExperiment('36', { flagged: true });   // an inactive direction: a flag alone does not put it on the sky
  updateExperiment('47', { flagged: true });
  const store = readStore();
  const active = activeDirections(store);
  assert.deepEqual([...active].sort(), ['calib', 'main', 'probes', 'robust']);
  const rings = skyRings(store);
  assert.equal(rings['51'], 0);
  assert.equal(rings['53'], 0);
  assert.equal(rings['47'], 1);
  assert.equal(rings['36'], undefined);
  assert.equal(rings['48'], 2);   // main's latest result
  assert.equal(rings['52'], 2);   // probes' latest that is not running
  assert.ok(Object.keys(rings).length <= 16);
});

test('the view gives Sunrise one item per experiment on the sky, in its direction\'s slice, and a form for every experiment', () => {
  const view = experimentsView(readStore(), new Date('2026-11-22T12:00:00Z'));
  assert.equal(view.sunrise.horizon.items.length, Object.keys(view.sky).length);
  const running = view.sunrise.horizon.items.find((item) => item.id === 'exp-53')!;
  assert.equal(running.zone, 'ignition');
  assert.equal(running.group, 'What did it learn?');
  assert.equal(Object.keys(view.sunrise.forms).length, 54);
  assert.equal(view.sunrise.forms['exp-53']!.filling, true);
  // Every form leads with its 3D picture, so on the sky it is drawn as a tile around it.
  assert.equal(view.sunrise.forms['exp-36']!.shape, 'tile');
  assert.deepEqual(view.sunrise.forms['exp-36']!.parts[0], { kind: 'media', look: 'scene:bullseye', from: 0 });
  assert.deepEqual(view.sunrise.horizon.holds, []);
  // Nearer the sun is sooner: every ring-0 item is before every ring-1 item, and so on.
  const hoursByRing = [0, 1, 2, 3].map((ring) => view.sunrise.horizon.items.filter((item) => view.sky[item.id.slice(4)] === ring).map((item) => item.hours));
  for (let ring = 0; ring < 3; ring++) {
    if (hoursByRing[ring]!.length > 0 && hoursByRing[ring + 1]!.length > 0) assert.ok(Math.max(...hoursByRing[ring]!) < Math.min(...hoursByRing[ring + 1]!));
  }
});

test('taking a direction off the sky removes its experiments from it; null goes back to "while it has recent work"', () => {
  setDirectionActive('probes', false);
  assert.equal(skyRings(readStore())['53'], undefined);
  setDirectionActive('probes', null);
  assert.equal(skyRings(readStore())['53'], 0);
  setDirectionActive('vla', true);
  assert.equal(skyRings(readStore())['40'], 2);
});

test('a new experiment takes the next number and the last direction; removing one drops it from what others build on', () => {
  const created = addExperiment({ question: 'Does a slower release fix the limiter frames?', buildsOn: ['48'] }, '2026-11-23');
  assert.equal(created.id, '54');
  assert.equal(created.direction, 'probes');
  assert.equal(created.day, 'Nov 23');
  assert.equal(created.status, 'running');
  removeExperiment('48');
  assert.deepEqual(readStore().experiments.find((e) => e.id === '54')?.buildsOn, []);
});

test('changes that make no sense are refused and leave the record alone', () => {
  assert.throws(() => updateExperiment('99', { flagged: true }), (e: unknown) => e instanceof ExperimentError && e.status === 404);
  assert.throws(() => updateExperiment('10', { direction: 'nowhere' }), ExperimentError);
  assert.throws(() => updateExperiment('10', { buildsOn: ['10'] }), ExperimentError);
  assert.throws(() => updateExperiment('10', { status: 'done' }), ExperimentError);
  assert.throws(() => updateExperiment('10', { surprise: 1 }), ExperimentError);
  assert.throws(() => addDirection({ name: 'Main policy' }), ExperimentError);
  assert.equal(fs.existsSync(file()), false);
  assert.equal(addDirection({ name: 'Real arm geometry' }).id, 'real-arm-geometry');
});

test('moving an experiment to another day shows the new day unless he wrote how it should show', () => {
  assert.equal(updateExperiment('10', { when: '2026-08-05' }).day, 'Aug 5');
  assert.equal(updateExperiment('10', { when: '2026-08-06', day: 'Aug 6–7' }).day, 'Aug 6–7');
});

test('the workspace is told an experiment is there: a ref and a brief under "exp-<number>", and nothing for a task\'s id', () => {
  updateExperiment('36', { flagged: true, notes: 'Check the step-180 chunk.' });
  assert.equal(experimentIdOf('exp-36'), '36');
  assert.equal(experimentIdOf('a1b2c3'), null);
  assert.equal(experimentRef('a1b2c3'), null);
  assert.equal(experimentRef('exp-99'), null);
  assert.equal(experimentRef('exp-36')?.task.text, 'Why does a policy that looks fine on paper still miss?');
  const brief = experimentBrief('exp-36', new Date('2026-11-22T12:00:00Z'))!;
  assert.equal(brief.title, 'Why does a policy that looks fine on paper still miss?');
  assert.equal(brief.group, 'Cube anywhere');
  assert.equal(brief.when.zone, 'undated');
  assert.equal(brief.hook, null);
  assert.equal(brief.notesMarkdown, 'Check the step-180 chunk.');
  assert.equal(brief.flags.length, 1);
  assert.deepEqual(brief.related.filter((r) => r.rel === 'builds on').map((r) => r.taskId), ['exp-35', 'exp-34']);
  assert.deepEqual(brief.related.filter((r) => r.rel === 'led to').map((r) => r.taskId), ['exp-37', 'exp-41', 'exp-42']);
});
