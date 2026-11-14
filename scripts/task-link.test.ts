import test from 'node:test';
import assert from 'node:assert/strict';
import { engineTaskId, parseTaskSearch, taskLink, taskSearch, urlTaskId } from '../src/lib/task-link.ts';

const id = '74f5659b-2b16-4015-912c-d90ceba49dc5';

test('taskLink names the task, and the tab unless it is Work', () => {
  assert.equal(taskLink(id), `/?task=${id}`);
  assert.equal(taskLink(id, 'chat'), `/?task=${id}&tab=chat`);
  assert.equal(taskLink(id, 'brief'), `/?task=${id}&tab=brief`);
  assert.equal(taskLink(id, 'work'), `/?task=${id}`);
  assert.equal(taskLink('a b&c'), '/?task=a%20b%26c');
});

test('an action card is linked by its card id', () => {
  assert.equal(taskLink('card:ac_1a2b3c4d'), '/?task=ac_1a2b3c4d');
  assert.equal(taskLink('ac_1a2b3c4d'), '/?task=ac_1a2b3c4d');
  assert.equal(engineTaskId('ac_1a2b3c4d'), 'card:ac_1a2b3c4d');
  assert.equal(engineTaskId(id), id);
  assert.equal(urlTaskId('card:ac_1a2b3c4d'), 'ac_1a2b3c4d');
  assert.equal(urlTaskId(id), id);
});

test('parseTaskSearch reads the task and a known tab', () => {
  assert.deepEqual(parseTaskSearch(''), { task: null, tab: null });
  assert.deepEqual(parseTaskSearch('?hero=dawn'), { task: null, tab: null });
  assert.deepEqual(parseTaskSearch(`?task=${id}`), { task: id, tab: null });
  assert.deepEqual(parseTaskSearch(`task=${id}&tab=chat`), { task: id, tab: 'chat' });
  assert.deepEqual(parseTaskSearch(`?tab=brief&hero=dawn&task=${id}`), { task: id, tab: 'brief' });
  assert.deepEqual(parseTaskSearch(`?task=${id}&tab=work`), { task: id, tab: null });
  assert.deepEqual(parseTaskSearch(`?task=${id}&tab=nonsense`), { task: id, tab: null });
  assert.deepEqual(parseTaskSearch('?task=&tab=chat'), { task: null, tab: null });
  assert.deepEqual(parseTaskSearch('?task=a%20b%26c'), { task: 'a b&c', tab: null });
});

test('taskSearch sets and clears the task, keeping every other parameter as written', () => {
  assert.equal(taskSearch('', id), `?task=${id}`);
  assert.equal(taskSearch('?hero=dawn', id), `?hero=dawn&task=${id}`);
  assert.equal(taskSearch('?hero=dawn', id, 'chat'), `?hero=dawn&task=${id}&tab=chat`);
  assert.equal(taskSearch(`?hero=dawn&task=${id}&tab=chat`, null), '?hero=dawn');
  assert.equal(taskSearch(`?task=${id}&tab=chat`, null), '');
  assert.equal(taskSearch(`?task=${id}&tab=chat`, id, 'work'), `?task=${id}`);
  assert.equal(taskSearch(`?task=old&x=a%20b+c&tab=brief`, id, 'brief'), `?x=a%20b+c&task=${id}&tab=brief`);
  assert.equal(taskSearch('?flag&task=old', null), '?flag');
  assert.equal(taskSearch('?', null), '');
});

test('what taskSearch writes, parseTaskSearch reads back', () => {
  for (const [task, tab] of [[id, null], [id, 'chat'], ['ac_1a2b3c4d', 'brief'], ['a b&c=d', null]] as const) {
    assert.deepEqual(parseTaskSearch(taskSearch('?hero=dawn', task, tab)), { task, tab });
  }
});
