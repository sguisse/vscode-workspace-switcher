import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceRecord } from '../types/workspace';
import { resolveWorkspaceLabel as getWorkspaceLabel } from '../utils/workspace';

export class ProcessMonitorService {
  private readonly lockDir: string;
  private readonly lockFilePath: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly windowStartTime: number;

  constructor(private readonly currentWindowPath?: string) {
    this.lockDir = path.join(os.tmpdir(), '.vscode-workspace-switcher');
    this.lockFilePath = path.join(this.lockDir, 'running-windows.json');
    this.windowStartTime = Date.now();

    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  public startHeartbeat(): void {
    this.updateHeartbeat();
    this.heartbeatTimer = setInterval(() => this.updateHeartbeat(), 5000);
  }

  public stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.removeCurrentWindowRecord();
  }

  public getOpenedWorkspaces(): WorkspaceRecord[] {
    const records = this.readLockFile();
    const activeRecords: WorkspaceRecord[] = [];
    const currentPath = this.currentWindowPath;

    for (const record of records) {
      if (record.pid !== process.pid && this.isProcessAlive(record.pid)) {
        if (!currentPath || record.path !== currentPath) {
          activeRecords.push(record);
        }
      }
    }

    return activeRecords.sort((a, b) => b.lastActiveTimestamp - a.lastActiveTimestamp);
  }

  public getOpenPathsSet(): Set<string> {
    const records = this.getOpenedWorkspaces();
    const openPaths = new Set<string>();
    if (this.currentWindowPath) {
      openPaths.add(this.currentWindowPath);
    }
    for (const record of records) {
      openPaths.add(record.path);
    }
    return openPaths;
  }

  public forceCloseWorkspace(pid: number): boolean {
    try {
      process.kill(pid, 'SIGKILL');
      this.removeRecordByPid(pid);
      return true;
    } catch {
      return false;
    }
  }

  public resolveWorkspaceLabel(fullPath: string): string {
    return getWorkspaceLabel(fullPath);
  }

  private updateHeartbeat(): void {
    if (!this.currentWindowPath) {
      return;
    }

    const existingRecords = this.readLockFile();
    const records = existingRecords.filter(
      record => record.pid !== process.pid && this.isProcessAlive(record.pid)
    );
    const existingRecord = existingRecords.find(record => record.pid === process.pid);
    const startTimestamp = existingRecord ? existingRecord.lastActiveTimestamp : this.windowStartTime;

    records.push({
      path: this.currentWindowPath,
      name: this.resolveWorkspaceLabel(this.currentWindowPath),
      pid: process.pid,
      lastActiveTimestamp: startTimestamp
    });

    this.writeLockFile(records);
  }

  private removeCurrentWindowRecord(): void {
    const records = this.readLockFile().filter(record => record.pid !== process.pid);
    this.writeLockFile(records);
  }

  private removeRecordByPid(pid: number): void {
    const records = this.readLockFile().filter(record => record.pid !== pid);
    this.writeLockFile(records);
  }

  private readLockFile(): WorkspaceRecord[] {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        const data = fs.readFileSync(this.lockFilePath, 'utf8');
        return JSON.parse(data) as WorkspaceRecord[];
      }
    } catch {
      // Keep monitoring available if the shared process file is temporarily unreadable.
    }
    return [];
  }

  private writeLockFile(records: WorkspaceRecord[]): void {
    try {
      fs.writeFileSync(this.lockFilePath, JSON.stringify(records, null, 2), 'utf8');
    } catch {
      // Keep the extension usable if the shared process file cannot be written.
    }
  }

  private isProcessAlive(pid?: number): boolean {
    if (!pid) {
      return false;
    }
    try {
      return process.kill(pid, 0);
    } catch {
      return false;
    }
  }
}
