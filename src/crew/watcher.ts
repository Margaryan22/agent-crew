// Watches .crew/** and publishes a fresh snapshot after every burst of changes.

import * as vscode from 'vscode';
import type { Logger } from '../redact';
import { type CrewSnapshot, EMPTY_SNAPSHOT } from './model';
import { type CrewReader, loadSnapshot } from './snapshot';

const DEBOUNCE_MS = 150;

export function workspaceReader(root: vscode.Uri): CrewReader {
  const uri = (rel: string) => vscode.Uri.joinPath(root, ...rel.split('/'));
  const decoder = new TextDecoder('utf-8');
  return {
    async list(dir) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(uri(dir));
        return entries.filter(([, type]) => (type & vscode.FileType.File) !== 0).map(([name]) => name);
      } catch {
        return [];
      }
    },
    async read(path) {
      try {
        return decoder.decode(await vscode.workspace.fs.readFile(uri(path)));
      } catch {
        return undefined;
      }
    },
    async exists(path) {
      try {
        await vscode.workspace.fs.stat(uri(path));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export class CrewWatcher implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<CrewSnapshot>();
  readonly onDidChange = this.emitter.event;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly reader: CrewReader;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: CrewSnapshot = EMPTY_SNAPSHOT;
  private loading: Promise<CrewSnapshot> | undefined;
  private dirty = false;

  constructor(
    root: vscode.Uri,
    private readonly log: Logger,
  ) {
    this.reader = workspaceReader(root);
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '.crew/**'));
    const schedule = () => this.schedule();
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidChange(schedule);
    this.watcher.onDidDelete(schedule);
  }

  get snapshot(): CrewSnapshot {
    return this.current;
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, DEBOUNCE_MS);
  }

  /** Re-reads .crew/ now. Concurrent calls coalesce into one extra reload. */
  async refresh(): Promise<CrewSnapshot> {
    if (this.loading) {
      this.dirty = true;
      return this.loading;
    }
    this.loading = (async () => {
      try {
        do {
          this.dirty = false;
          this.current = await loadSnapshot(this.reader);
        } while (this.dirty);
        this.emitter.fire(this.current);
      } catch (err) {
        this.log.error(`Could not read .crew/: ${String(err)}`);
      }
      return this.current;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = undefined;
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher.dispose();
    this.emitter.dispose();
  }
}
