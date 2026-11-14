// © 2026 Lumen. Все права защищены. Копирование, изменение и распространение этого кода запрещены без разрешения автора (см. LICENSE).
// JSON-файл с настройками/состоянием: значения по умолчанию, отложенная атомарная запись.
import fs from 'node:fs';
import path from 'node:path';

export function merge(def, v) {
  if (Array.isArray(def)) return Array.isArray(v) ? v : def;
  if (!def || typeof def !== 'object') return v === undefined ? def : v;
  const out = { ...def };
  if (v && typeof v === 'object') for (const k of Object.keys(v)) out[k] = k in def ? merge(def[k], v[k]) : v[k];
  return out;
}

export class Store {
  constructor(file, defaults = {}) {
    this.file = file;
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    this.data = merge(structuredClone(defaults), raw);
    this.timer = null;
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
