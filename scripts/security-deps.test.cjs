const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const imageSizePath = require.resolve('image-size');

// Run potentially hanging parsers in a child process so regressions fail within two seconds.
for (const [name, hex] of Object.entries({
  icns: '69636e73000000106963703000000000',
  jxl: '000000004a584c200000000000000000',
  heif: '00000000667479706865696300000000',
})) {
  test(`image-size rejects a zero-length ${name} entry`, () => {
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        'try { require(process.argv[1])(Buffer.from(process.argv[2], "hex")); process.exit(2); } catch { process.exit(0); }',
        imageSizePath,
        hex,
      ],
      { timeout: 2000 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
  });
}

test('image-size still measures a normal PNG', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD2kAAAAASUVORK5CYII=',
    'base64',
  );
  assert.deepEqual(require('image-size')(png), { width: 1, height: 1, type: 'png' });
});
