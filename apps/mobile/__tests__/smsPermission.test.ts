import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKAGE_SOURCE, restrictedByOs, smsPermissionState, type InstallInfo } from '../src/services/smsPermissionCore';

const info = (sdk: number, packageSource: number): InstallInfo => ({
  sdk,
  packageSource,
  installer: null,
  sideloaded: packageSource === PACKAGE_SOURCE.LOCAL_FILE || packageSource === PACKAGE_SOURCE.DOWNLOADED_FILE,
});

test('granted wins over everything', () => {
  assert.equal(smsPermissionState(true, 'never_ask_again', info(35, PACKAGE_SOURCE.DOWNLOADED_FILE)), 'granted');
});

test('Android 15+ APK / browser install is restricted (needs "Allow restricted settings")', () => {
  assert.equal(smsPermissionState(false, null, info(35, PACKAGE_SOURCE.DOWNLOADED_FILE)), 'restricted');
  assert.equal(smsPermissionState(false, 'never_ask_again', info(36, PACKAGE_SOURCE.LOCAL_FILE)), 'restricted');
  assert.ok(restrictedByOs(info(35, PACKAGE_SOURCE.LOCAL_FILE)));
});

test('store installs and older Android are not restricted', () => {
  assert.equal(smsPermissionState(false, null, info(35, PACKAGE_SOURCE.STORE)), 'askable');
  assert.equal(smsPermissionState(false, null, info(34, PACKAGE_SOURCE.DOWNLOADED_FILE)), 'askable');
  assert.equal(restrictedByOs(null), false);
});

test('"don\'t ask again" means Settings only', () => {
  assert.equal(smsPermissionState(false, 'never_ask_again', info(33, PACKAGE_SOURCE.STORE)), 'blocked');
  assert.equal(smsPermissionState(false, 'denied', info(33, PACKAGE_SOURCE.STORE)), 'askable');
});

test('no telephony → unsupported', () => {
  assert.equal(smsPermissionState(false, null, null, false), 'unsupported');
});
