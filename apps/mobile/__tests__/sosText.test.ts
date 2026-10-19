import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSosText, mapsLink, smsSegments } from '../src/services/sosText';
import { translate, type TFunction } from '../src/i18n/core';

const en: TFunction = (k, v) => translate('en', k, v);
const bn: TFunction = (k, v) => translate('bn', k, v);
const DHAKA = { latitude: 23.8103123, longitude: 90.4125456 };

test('maps link uses 5 decimals', () => {
  assert.equal(mapsLink(DHAKA), 'https://maps.google.com/?q=23.81031,90.41255');
});

test('English SOS keeps the name and the link and fits one SMS part', () => {
  const text = buildSosText(en, 'Nusrat Jahan Chowdhury', DHAKA);
  assert.match(text, /Nusrat Jahan Chowdhury/);
  assert.match(text, /maps\.google\.com\/\?q=23\.81031,90\.41255/);
  const seg = smsSegments(text);
  assert.equal(seg.encoding, 'GSM-7');
  assert.equal(seg.segments, 1);
});

test('Bangla SOS is UCS-2 and stays within 2 parts', () => {
  const text = buildSosText(bn, 'নুসরাত জাহান', DHAKA);
  assert.match(text, /নুসরাত জাহান/);
  assert.match(text, /23\.81031,90\.41255/, 'link digits stay ASCII');
  const seg = smsSegments(text);
  assert.equal(seg.encoding, 'UCS-2');
  assert.ok(seg.segments <= 2, `${seg.segments} parts`);
});

test('no name and no location still produce a usable text', () => {
  assert.equal(buildSosText(en, '  ', null), 'SOS! I need help. Location unknown, please call me.');
  assert.match(buildSosText(en, undefined, DHAKA), /^SOS! I need help\. Location: https/);
  assert.notEqual(buildSosText(bn, 'Rina', null), buildSosText(en, 'Rina', null));
});

test('segment arithmetic matches Android divideMessage limits', () => {
  assert.deepEqual(smsSegments('a'.repeat(160)), { encoding: 'GSM-7', units: 160, segments: 1 });
  assert.equal(smsSegments('a'.repeat(161)).segments, 2);
  assert.equal(smsSegments('a'.repeat(306)).segments, 2);
  assert.equal(smsSegments('a'.repeat(307)).segments, 3);
  // Extension characters cost two septets.
  assert.equal(smsSegments('€'.repeat(80)).units, 160);
  assert.equal(smsSegments('€'.repeat(81)).segments, 2);
  // Any non-GSM character switches the whole text to UCS-2.
  assert.equal(smsSegments('ক'.repeat(70)).segments, 1);
  assert.equal(smsSegments('ক'.repeat(71)).segments, 2);
  assert.equal(smsSegments('ক'.repeat(134)).segments, 2);
  assert.equal(smsSegments('ক'.repeat(135)).segments, 3);
});

test('the old long SOS text needed several parts — the reason it was dropped', () => {
  const old =
    'SOS EMERGENCY! Nusrat Jahan is in danger and offline. Location: https://maps.google.com/?q=23.8103123,90.4125456 (lat 23.81031, lng 90.41255). Please send help / call 999.';
  assert.ok(smsSegments(old).segments > 1);
});

test('SIM SOS text is always a single plain SMS part', async () => {
  const { simSosText, firstLink } = await import('../src/services/sosText');
  const one = (s: string) => {
    const seg = smsSegments(s);
    assert.equal(seg.encoding, 'GSM-7', s);
    assert.equal(seg.segments, 1, s);
  };
  one(simSosText('রহিমা খাতুন', DHAKA));
  one(simSosText('Rahima Khatun', DHAKA, 'https://api.mystrix-soft.com/t/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'));
  one(simSosText('A very very long name that goes on and on and on and on and on', DHAKA, 'https://x.example/' + 'z'.repeat(120)));
  one(simSosText(undefined, null));
  assert.match(simSosText('Rahima', DHAKA), /^SOS! Rahima needs help\. Location: https:\/\/maps\.google\.com/);
  assert.equal(firstLink('নাম SOS. Live: https://api.x.com/t/abc. Map: https://maps.google.com/?q=1,2'), 'https://api.x.com/t/abc');
});
