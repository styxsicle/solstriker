import { describe, expect, it } from 'vitest';
import { detectFormat, parseWalletImport, syntheticAddress } from '../src/index.js';

// Invented addresses only — never real wallet data.
const A1 = syntheticAddress(11);
const A2 = syntheticAddress(12);
const A3 = syntheticAddress(13);

describe('detectFormat', () => {
  it('detects JSON by leading bracket', () => {
    expect(detectFormat('  [{"trackedWalletAddress":"x"}]')).toBe('json');
  });
  it('detects CSV by header comma or filename', () => {
    expect(detectFormat('address,label\nabc,def')).toBe('csv');
    expect(detectFormat('whatever', 'wallets.csv')).toBe('csv');
  });
  it('falls back to plain text', () => {
    expect(detectFormat(`${A1}\n${A2}`)).toBe('text');
  });
});

describe('plain-text parsing', () => {
  it('parses one address per line, skipping blanks and comments', () => {
    const content = `\n${A1}\n\n# a comment\n${A2}\n`;
    const result = parseWalletImport(content, { format: 'text' });
    expect(result.entries.map((e) => e.address)).toEqual([A1, A2]);
    expect(result.invalid).toHaveLength(0);
    expect(result.skipped).toBe(3); // two blanks + one comment
  });

  it('flags invalid addresses with line numbers', () => {
    const result = parseWalletImport(`${A1}\nnot-an-address\n`, { format: 'text' });
    expect(result.entries).toHaveLength(1);
    expect(result.invalid).toEqual([
      { line: 2, value: 'not-an-address', reason: 'invalid_address' },
    ]);
  });
});

describe('CSV parsing', () => {
  it('parses with a header row and optional columns', () => {
    const content = `address,label,group\n${A1},Alpha,Main\n${A2},,\n`;
    const result = parseWalletImport(content, { format: 'csv' });
    expect(result.entries).toEqual([
      { address: A1, label: 'Alpha', groups: ['Main'], notes: undefined },
      { address: A2, label: undefined, groups: undefined, notes: undefined },
    ]);
  });

  it('parses header columns in any order', () => {
    const content = `label,address,notes\nMy Wallet,${A1},hello\n`;
    const result = parseWalletImport(content, { format: 'csv' });
    expect(result.entries[0]).toMatchObject({ address: A1, label: 'My Wallet', notes: 'hello' });
  });

  it('parses headerless positional CSV', () => {
    const content = `${A1},Alpha,Main,note here\n${A2},Beta\n`;
    const result = parseWalletImport(content, { format: 'csv' });
    expect(result.entries[0]).toMatchObject({
      address: A1,
      label: 'Alpha',
      groups: ['Main'],
      notes: 'note here',
    });
    expect(result.entries[1]).toMatchObject({ address: A2, label: 'Beta' });
  });

  it('supports quoted fields containing commas', () => {
    const content = `address,label,notes\n${A1},"Big, Bad Wallet","watch, closely"\n`;
    const result = parseWalletImport(content, { format: 'csv' });
    expect(result.entries[0]).toMatchObject({
      address: A1,
      label: 'Big, Bad Wallet',
      notes: 'watch, closely',
    });
  });

  it('counts invalid rows and skipped blanks', () => {
    const content = `address,label\n\nbogus,Nope\n${A3},Ok\n`;
    const result = parseWalletImport(content, { format: 'csv' });
    expect(result.entries).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});

describe('JSON export parsing', () => {
  it('maps the tracker export shape and preserves metadata', () => {
    const content = JSON.stringify([
      {
        trackedWalletAddress: A1,
        name: 'Fake Trader One',
        emoji: '🦊',
        alertsOnToast: true,
        alertsOnBubble: false,
        alertsOnFeed: true,
        groups: ['Main', 'Snipers'],
        sound: 'ding',
      },
      {
        trackedWalletAddress: A2,
        name: '',
        groups: [],
      },
    ]);
    const result = parseWalletImport(content, { format: 'json' });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({
      address: A1,
      label: 'Fake Trader One',
      emoji: '🦊',
      groups: ['Main', 'Snipers'],
      meta: { alertsOnToast: true, alertsOnBubble: false, alertsOnFeed: true, sound: 'ding' },
    });
    expect(result.entries[1]).toEqual({
      address: A2,
      label: undefined,
      emoji: undefined,
      groups: undefined,
      meta: undefined,
    });
  });

  it('auto-detects the JSON format', () => {
    const content = JSON.stringify([{ trackedWalletAddress: A3, name: 'Auto' }]);
    const result = parseWalletImport(content);
    expect(result.format).toBe('json');
    expect(result.entries[0]).toMatchObject({ address: A3, label: 'Auto' });
  });

  it('reports invalid entries by index', () => {
    const content = JSON.stringify([
      { trackedWalletAddress: 'garbage' },
      { name: 'missing address' },
      { trackedWalletAddress: A1 },
    ]);
    const result = parseWalletImport(content, { format: 'json' });
    expect(result.entries).toHaveLength(1);
    expect(result.invalid.map((i) => i.reason)).toEqual(['invalid_address', 'missing_address']);
  });

  it('handles malformed JSON and non-array JSON', () => {
    expect(parseWalletImport('{oops', { format: 'json' }).invalid[0].reason).toBe('invalid_json');
    expect(parseWalletImport('{"a":1}', { format: 'json' }).invalid[0].reason).toBe(
      'expected_json_array',
    );
  });
});
