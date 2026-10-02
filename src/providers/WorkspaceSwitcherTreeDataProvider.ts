import * as path from 'path';
import * as vscode from 'vscode';
import { WorkspaceTreeItem } from '../models/WorkspaceTreeItem';
import { ProcessMonitorService } from '../services/ProcessMonitorService';
import { WorkspaceStateService } from '../services/WorkspaceStateService';
import { resolveWorkspaceLabel } from '../utils/workspace';

export class WorkspaceSwitcherTreeDataProvider implements vscode.TreeDataProvider<WorkspaceTreeItem> {
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<WorkspaceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(
    private readonly stateService: WorkspaceStateService,
    private readonly processMonitor: ProcessMonitorService
  ) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getTreeItem(element: WorkspaceTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: WorkspaceTreeItem): Promise<WorkspaceTreeItem[]> {
    if (!element) {
      return [
        new WorkspaceTreeItem('opened', 'group', undefined, undefined, vscode.TreeItemCollapsibleState.Expanded),
        new WorkspaceTreeItem('recent', 'group', undefined, undefined, vscode.TreeItemCollapsibleState.Expanded)
      ];
    }

    if (element.label === 'opened') {
      const openRecords = this.processMonitor.getOpenedWorkspaces();
      return openRecords.map(record => {
        const label = record.name || resolveWorkspaceLabel(record.path);
        return new WorkspaceTreeItem(label, 'opened', record.path, record.pid);
      });
    }

    if (element.label === 'recent') {
      const limit = vscode.workspace
        .getConfiguration('workbench.workspaceSwitcher')
        .get<number>('maxRecentWorkspaces', 10);

      const openPaths = this.processMonitor.getOpenPathsSet();
      const recentPaths = this.stateService.getRecentWorkspaces(openPaths, limit);

      return recentPaths.map(workspacePath => {
        const label = path.basename(workspacePath);
        return new WorkspaceTreeItem(label, 'recent', workspacePath);
      });
    }

    return [];
  }
}
