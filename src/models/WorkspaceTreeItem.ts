import * as vscode from 'vscode';
import { ItemType } from '../types/workspace';

export class WorkspaceTreeItem extends vscode.TreeItem {
  constructor(
    public override readonly label: string,
    public readonly itemType: ItemType,
    public readonly workspacePath?: string,
    public readonly pid?: number,
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
    this.contextValue = itemType;

    if (itemType === 'group') {
      this.iconPath = label === 'opened'
        ? new vscode.ThemeIcon('folder-opened')
        : new vscode.ThemeIcon('history');
      return;
    }

    if (workspacePath) {
      this.tooltip = workspacePath;
      this.resourceUri = vscode.Uri.file(workspacePath);
    }

    if (itemType === 'opened') {
      this.iconPath = new vscode.ThemeIcon('folder-opened', new vscode.ThemeColor('charts.blue'));
      this.command = {
        command: 'workspaceSwitcher.switchOpenedWorkspace',
        title: 'Switch Workspace',
        arguments: [this]
      };
    } else {
      this.iconPath = new vscode.ThemeIcon('folder');
      this.command = {
        command: 'workspaceSwitcher.openRecentWorkspace',
        title: 'Open Recent Workspace',
        arguments: [this]
      };
    }
  }
}
