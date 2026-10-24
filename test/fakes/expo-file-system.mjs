// Fake 'expo-file-system' (the SDK 54+ File / Paths API): an in-memory disk, with the same
// errors as the real one for missing files and existing destinations, and injectable failures.

import { Buffer } from 'node:buffer';

/** uri -> text. */
const files = new Map();

/** Every operation, in order: { op, uri, to? }. */
export const log = [];

/** Pending failures: { op, name, error, times }. See disk.fail. */
const failures = [];

const DOCUMENT = 'file:///data/user/0/com.chesd.quackbreak/files';

const nameOf = (uri) => uri.slice(uri.lastIndexOf('/') + 1);

function check(op, uri) {
  const i = failures.findIndex((f) => f.op === op && (f.name === undefined || f.name === nameOf(uri)));
  if (i < 0) return;
  const f = failures[i];
  if (--f.times <= 0) failures.splice(i, 1);
  throw f.error;
}

function join(parts) {
  return parts
    .map((p) => (typeof p === 'string' ? p : p.uri))
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .join('/');
}

export class Directory {
  constructor(...uris) {
    this.uri = join(uris);
  }
  get exists() {
    return true;
  }
}

export class File {
  constructor(...uris) {
    this.uri = join(uris);
  }

  get name() {
    return nameOf(this.uri);
  }

  get exists() {
    return files.has(this.uri);
  }

  get size() {
    return files.has(this.uri) ? Buffer.byteLength(files.get(this.uri)) : 0;
  }

  textSync() {
    log.push({ op: 'textSync', uri: this.uri });
    check('textSync', this.uri);
    if (!files.has(this.uri)) throw new Error(`File '${this.uri}' does not exist`);
    return files.get(this.uri);
  }

  async text() {
    return this.textSync();
  }

  writeSync(content) {
    log.push({ op: 'writeSync', uri: this.uri });
    check('writeSync', this.uri);
    files.set(this.uri, typeof content === 'string' ? content : Buffer.from(content).toString('utf8'));
  }

  create() {
    log.push({ op: 'create', uri: this.uri });
    check('create', this.uri);
    if (files.has(this.uri)) throw new Error(`File '${this.uri}' already exists`);
    files.set(this.uri, '');
  }

  delete() {
    log.push({ op: 'delete', uri: this.uri });
    check('delete', this.uri);
    if (!files.has(this.uri)) throw new Error(`File '${this.uri}' does not exist`);
    files.delete(this.uri);
  }

  copySync(destination, options = {}) {
    log.push({ op: 'copySync', uri: this.uri, to: destination.uri });
    check('copySync', this.uri);
    if (!files.has(this.uri)) throw new Error(`File '${this.uri}' does not exist`);
    if (files.has(destination.uri) && !options.overwrite) throw new Error(`Destination '${destination.uri}' already exists`);
    files.set(destination.uri, files.get(this.uri));
  }

  moveSync(destination, options = {}) {
    log.push({ op: 'moveSync', uri: this.uri, to: destination.uri });
    check('moveSync', this.uri);
    if (!files.has(this.uri)) throw new Error(`File '${this.uri}' does not exist`);
    if (files.has(destination.uri) && !options.overwrite) throw new Error(`Destination '${destination.uri}' already exists`);
    const text = files.get(this.uri);
    files.delete(this.uri);
    files.set(destination.uri, text);
    // Like the real one, the File now points at its new place.
    this.uri = destination.uri;
  }
}

export const Paths = {
  document: new Directory(DOCUMENT),
  cache: new Directory('file:///data/user/0/com.chesd.quackbreak/cache'),
};

/** Test helpers, by file name in the document directory. */
export const disk = {
  uri: (name) => `${DOCUMENT}/${name}`,
  read: (name) => files.get(`${DOCUMENT}/${name}`),
  write: (name, text) => void files.set(`${DOCUMENT}/${name}`, text),
  has: (name) => files.has(`${DOCUMENT}/${name}`),
  remove: (name) => void files.delete(`${DOCUMENT}/${name}`),
  names: () => [...files.keys()].map(nameOf).sort(),
  /** Parsed JSON of a file, or undefined if missing. */
  json: (name) => {
    const t = files.get(`${DOCUMENT}/${name}`);
    return t === undefined ? undefined : JSON.parse(t);
  },
  /**
   * Make the next `times` calls of `op` (textSync, writeSync, copySync, moveSync, delete) on the
   * file called `name` (any file if omitted) throw `error`.
   */
  fail: (op, name, { error = new Error(`Injected ${op} failure`), times = 1 } = {}) => {
    failures.push({ op, name, error, times });
  },
  /** Operations since the last call, as "op name" or "op name -> name". */
  takeLog: () => {
    const out = log.map((e) => (e.to ? `${e.op} ${nameOf(e.uri)} -> ${nameOf(e.to)}` : `${e.op} ${nameOf(e.uri)}`));
    log.length = 0;
    return out;
  },
};
