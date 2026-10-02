import * as vscode from 'vscode';

export class WorkspaceDecorationProvider implements vscode.FileDecorationProvider {
  private readonly onDidChangeFileDecorationsEmitter =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.onDidChangeFileDecorationsEmitter.event;

  constructor(private readonly getOpenPathsSet: () => Set<string>) {}

  public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const openPaths = this.getOpenPathsSet();
    if (openPaths.has(uri.fsPath)) {
      return {
        badge: '●',
        tooltip: 'Currently open',
        color: new vscode.ThemeColor('charts.blue')
      };
    }
    return undefined;
  }

  public refresh(): void {
    this.onDidChangeFileDecorationsEmitter.fire(undefined);
  }
}
