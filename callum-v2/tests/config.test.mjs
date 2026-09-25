import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, validateConfig } from '../packages/linkedin-config/index.mjs';

test('declarative config is bounded and rejects executable-like fields',()=>{
  assert.deepEqual(validateConfig(DEFAULT_CONFIG),DEFAULT_CONFIG);
  assert.throws(()=>validateConfig({...DEFAULT_CONFIG,script:'alert(1)'}),/CONFIG_INVALID/);
  assert.throws(()=>validateConfig({...DEFAULT_CONFIG,connect:['div:has(script)']}),/CONFIG_INVALID/);
  assert.throws(()=>validateConfig({...DEFAULT_CONFIG,waitMs:1000000}),/CONFIG_INVALID/);
  assert.throws(()=>validateConfig({...DEFAULT_CONFIG,labels:{...DEFAULT_CONFIG.labels,send:['<script>']}}),/CONFIG_INVALID/);
  assert.throws(()=>validateConfig({...DEFAULT_CONFIG,contactEmail:['iframe[src]']}),/CONFIG_INVALID/);
});
test('selector hotfix is data and can replace candidates without code change',()=>{
  const newer=validateConfig({...DEFAULT_CONFIG,connect:['button[data-control-name="connect"]']});
  assert.notDeepEqual(newer.connect,DEFAULT_CONFIG.connect);
  assert.deepEqual(DEFAULT_CONFIG.connect[0],'button[aria-label*="Invite"][aria-label*="connect"]');
});
