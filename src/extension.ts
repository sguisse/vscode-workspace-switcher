import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface OpenWorkspaceWindow {
    pid: number;
    title: string;
    folderPath?: string;
    workspacePath?: string;
    timestamp: number;
}

const REGISTRY_FILE = path.join(os.tmpdir(), 'vscode_opened_workspaces_registry.json');
const RECENT_WORKSPACES_KEY = 'recentWorkspaces';
let extensionContext: vscode.ExtensionContext | undefined;

type TreeNode = WorkspaceGroupItem | WorkspaceTreeItem;

class WorkspaceTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void | null>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeNode): Thenable<TreeNode[]> {
        if (element instanceof WorkspaceGroupItem) {
            return Promise.resolve(element.children);
        }
        if (element) {
            return Promise.resolve([]);
        }

        const currentPid = process.pid;
        const openWorkspaceWindows = getOpenWorkspaceWindows();
        const otherWorkspaceWindows = openWorkspaceWindows
            .filter(workspaceWindow => workspaceWindow.pid !== currentPid)
            .sort((a, b) => b.timestamp - a.timestamp);

        const openedWorkspaceItems = otherWorkspaceWindows.map(workspaceWindow => {
            const item = new WorkspaceTreeItem(workspaceWindow.title, workspaceWindow.folderPath, workspaceWindow, {
                command: 'workspaceSwitcher.switchWorkspace',
                title: 'Switch to Workspace',
                arguments: [workspaceWindow]
            });
            const workspacePath = workspaceWindow.workspacePath || workspaceWindow.folderPath;
            if (workspacePath) {
                item.resourceUri = vscode.Uri.file(workspacePath);
            }
            return item;
        });

        const recentWorkspaceLimit = Math.max(0, vscode.workspace
            .getConfiguration('workspaceSwitcher')
            .get<number>('recentWorkspacesLimit', 10));
        const recentWorkspaceItems = getRecentWorkspaces(this.context.globalState)
            .filter(workspacePath => !openWorkspaceWindows.some(workspaceWindow =>
                samePath(workspaceWindow.workspacePath, workspacePath) ||
                samePath(workspaceWindow.folderPath, workspacePath)
            ))
            .slice(0, recentWorkspaceLimit)
            .map(workspacePath => {
                const label = path.basename(workspacePath, path.extname(workspacePath)) || workspacePath;
                const item = new WorkspaceTreeItem(label, workspacePath, undefined, {
                    command: 'workspaceSwitcher.openRecentWorkspace',
                    title: 'Open Recent Workspace',
                    arguments: [workspacePath]
                }, true);
                item.resourceUri = vscode.Uri.file(workspacePath);
                return item;
            });

        return Promise.resolve([
            new WorkspaceGroupItem('opened', 'openedWorkspaceGroup', openedWorkspaceItems),
            new WorkspaceGroupItem('recent', 'recentWorkspaceGroup', recentWorkspaceItems)
        ]);
    }

    constructor(private readonly context: vscode.ExtensionContext) {}
}

class WorkspaceGroupItem extends vscode.TreeItem {
    constructor(
        label: string,
        kind: 'openedWorkspaceGroup' | 'recentWorkspaceGroup',
        public readonly children: WorkspaceTreeItem[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = kind;
        this.iconPath = new vscode.ThemeIcon(
            kind === 'openedWorkspaceGroup' ? 'folder-opened' : 'history',
            kind === 'openedWorkspaceGroup' ? new vscode.ThemeColor('charts.blue') : undefined
        );
    }
}

class WorkspaceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly folderPath: string | undefined,
        public readonly workspaceWindow: OpenWorkspaceWindow | undefined,
        command?: vscode.Command,
        isRecentWorkspace = false
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = folderPath || label;
        this.iconPath = new vscode.ThemeIcon(isRecentWorkspace ? 'folder' : 'folder-opened');
        this.contextValue = isRecentWorkspace ? 'recentWorkspaceItem' : 'openedWorkspaceItem';
        this.command = command;
    }
}

class OpenWorkspaceDecorationProvider implements vscode.FileDecorationProvider {
    private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
    readonly onDidChangeFileDecorations = this.emitter.event;

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const isOpen = getOpenWorkspaceWindows().some(workspaceWindow =>
            samePath(workspaceWindow.workspacePath, uri.fsPath) ||
            samePath(workspaceWindow.folderPath, uri.fsPath)
        );
        if (!isOpen) {
            return undefined;
        }

        return {
            color: new vscode.ThemeColor('charts.blue'),
            tooltip: 'Currently open'
        };
    }

    refresh(): void {
        this.emitter.fire(undefined);
    }

    dispose(): void {
        this.emitter.dispose();
    }
}

function registerCurrentWorkspaceWindow(): void {
    const currentPid = process.pid;
    const folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const workspacePath = vscode.workspace.workspaceFile?.fsPath || folderPath;
    const title = vscode.workspace.name || (folderPath ? path.basename(folderPath) : 'Untitled Workspace');

    let workspaceWindows = readWorkspaceRegistry();
    const previousWorkspaceWindow = workspaceWindows.find(workspaceWindow => workspaceWindow.pid === currentPid);
    const previousWorkspacePath = previousWorkspaceWindow?.workspacePath || previousWorkspaceWindow?.folderPath;
    const timestamp = previousWorkspaceWindow &&
        ((!previousWorkspacePath && !workspacePath) || samePath(previousWorkspacePath, workspacePath))
        ? previousWorkspaceWindow.timestamp
        : Date.now();
    workspaceWindows = workspaceWindows.filter(workspaceWindow =>
        workspaceWindow.pid !== currentPid && isProcessAlive(workspaceWindow.pid)
    );
    workspaceWindows.push({
        pid: currentPid,
        title,
        folderPath,
        workspacePath,
        timestamp
    });
    writeWorkspaceRegistry(workspaceWindows);
}

function unregisterWorkspaceWindowByPid(pid: number): void {
    let workspaceWindows = readWorkspaceRegistry();
    workspaceWindows = workspaceWindows.filter(workspaceWindow =>
        workspaceWindow.pid !== pid && isProcessAlive(workspaceWindow.pid)
    );
    writeWorkspaceRegistry(workspaceWindows);
}

function unregisterCurrentWorkspaceWindow(): void {
    unregisterWorkspaceWindowByPid(process.pid);
}

function getOpenWorkspaceWindows(): OpenWorkspaceWindow[] {
    return readWorkspaceRegistry().filter(workspaceWindow => isProcessAlive(workspaceWindow.pid));
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readWorkspaceRegistry(): OpenWorkspaceWindow[] {
    try {
        if (fs.existsSync(REGISTRY_FILE)) {
            const data = fs.readFileSync(REGISTRY_FILE, 'utf8');
            return JSON.parse(data) as OpenWorkspaceWindow[];
        }
    } catch {
        // Return empty on parse or lock errors
    }
    return [];
}

function writeWorkspaceRegistry(workspaceWindows: OpenWorkspaceWindow[]): void {
    try {
        fs.writeFileSync(REGISTRY_FILE, JSON.stringify(workspaceWindows, null, 2), 'utf8');
    } catch {
        // Ignore file lock collisions
    }
}

function getRecentWorkspaces(state: vscode.Memento): string[] {
    const recentWorkspaces = state.get<string[]>(RECENT_WORKSPACES_KEY, []);
    return recentWorkspaces.filter((workspacePath, index) =>
        recentWorkspaces.findIndex(candidate => samePath(candidate, workspacePath)) === index
    );
}

async function addRecentWorkspace(state: vscode.Memento, workspacePath: string | undefined): Promise<void> {
    if (!workspacePath) {
        return;
    }

    const recentWorkspaces = getRecentWorkspaces(state).filter(entry => !samePath(entry, workspacePath));
    recentWorkspaces.unshift(workspacePath);
    await state.update(RECENT_WORKSPACES_KEY, recentWorkspaces);
}

function samePath(first: string | undefined, second: string | undefined): boolean {
    return Boolean(first && second && path.resolve(first) === path.resolve(second));
}

export async function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    registerCurrentWorkspaceWindow();
    await addRecentWorkspace(
        context.globalState,
        vscode.workspace.workspaceFile?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    );

    const treeProvider = new WorkspaceTreeProvider(context);
    const treeViewRegistration = vscode.window.registerTreeDataProvider('workspaceSwitcherView', treeProvider);
    const decorationProvider = new OpenWorkspaceDecorationProvider();
    context.subscriptions.push(
        vscode.window.registerFileDecorationProvider(decorationProvider),
        decorationProvider
    );

    const refreshCommand = vscode.commands.registerCommand('workspaceSwitcher.refresh', () => {
        registerCurrentWorkspaceWindow();
        treeProvider.refresh();
        decorationProvider.refresh();
    });

    const switchCommand = vscode.commands.registerCommand(
        'workspaceSwitcher.switchWorkspace',
        (entry: OpenWorkspaceWindow) => {
        const workspacePath = entry.workspacePath || entry.folderPath;
        if (workspacePath) {
            const uri = vscode.Uri.file(workspacePath);
            vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
        } else {
            vscode.commands.executeCommand('workbench.action.switchWindow');
        }
    });

    const closeCommand = vscode.commands.registerCommand(
        'workspaceSwitcher.closeWorkspace',
        (item: WorkspaceTreeItem | OpenWorkspaceWindow) => {
        const entry = item instanceof WorkspaceTreeItem ? item.workspaceWindow : item;
        if (entry && entry.pid) {
            try {
                process.kill(entry.pid, 'SIGKILL');
            } catch {
                try {
                    process.kill(entry.pid);
                } catch {
                    // Process is already closed
                }
            }
            unregisterWorkspaceWindowByPid(entry.pid);
            treeProvider.refresh();
            decorationProvider.refresh();
        }
    });

    const openRecentWorkspaceCommand = vscode.commands.registerCommand(
        'workspaceSwitcher.openRecentWorkspace',
        (workspacePath: string) => {
            const openWorkspaceWindow = getOpenWorkspaceWindows().find(workspaceWindow =>
                samePath(workspaceWindow.workspacePath, workspacePath) ||
                samePath(workspaceWindow.folderPath, workspacePath)
            );
            if (openWorkspaceWindow) {
                if (openWorkspaceWindow.pid !== process.pid) {
                    return vscode.commands.executeCommand('workspaceSwitcher.switchWorkspace', openWorkspaceWindow);
                }
                return;
            }
            return vscode.commands.executeCommand(
                'vscode.openFolder',
                vscode.Uri.file(workspacePath),
                { forceNewWindow: true }
            );
        }
    );

    const removeRecentWorkspaceCommand = vscode.commands.registerCommand(
        'workspaceSwitcher.removeRecentWorkspace',
        async (workspace: WorkspaceTreeItem | string) => {
            const workspacePath = workspace instanceof WorkspaceTreeItem ? workspace.folderPath : workspace;
            if (!workspacePath) {
                return;
            }
            const recentWorkspaces = getRecentWorkspaces(context.globalState)
                .filter(entry => !samePath(entry, workspacePath));
            await context.globalState.update(RECENT_WORKSPACES_KEY, recentWorkspaces);
            treeProvider.refresh();
            decorationProvider.refresh();
        }
    );

    const workspaceFoldersChanged = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        const workspacePath = vscode.workspace.workspaceFile?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        await addRecentWorkspace(context.globalState, workspacePath);
        registerCurrentWorkspaceWindow();
        treeProvider.refresh();
        decorationProvider.refresh();
    });

    const configurationChanged = vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('workspaceSwitcher.recentWorkspacesLimit')) {
            treeProvider.refresh();
        }
    });

    const interval = setInterval(() => {
        registerCurrentWorkspaceWindow();
        treeProvider.refresh();
        decorationProvider.refresh();
    }, 3000);

    context.subscriptions.push(
        treeViewRegistration,
        refreshCommand,
        switchCommand,
        closeCommand,
        openRecentWorkspaceCommand,
        removeRecentWorkspaceCommand,
        workspaceFoldersChanged,
        configurationChanged,
        {
            dispose: () => {
                clearInterval(interval);
                unregisterCurrentWorkspaceWindow();
            }
        }
    );
}

export async function deactivate() {
    if (extensionContext) {
        const workspacePath = vscode.workspace.workspaceFile?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        await addRecentWorkspace(extensionContext.globalState, workspacePath);
        extensionContext = undefined;
    }
    unregisterCurrentWorkspaceWindow();
}
