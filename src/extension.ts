/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { join, relative } from 'path';
import { readFile, lstat } from 'fs';

import { ExtensionContext, SnippetString, commands, workspace, Uri, window, languages, TextDocument, Position, CompletionItem, WorkspaceFolder } from 'vscode';

const userHome = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE;
const userConfig = userHome && join(userHome, '.ssh/config');

const snippets: CompletionItem[] = [(() => {
    const item = new CompletionItem('Configure tunnel');
    item.documentation = 'Insert a template for configuring a tunnel connection.'
    item.insertText = new SnippetString('Host ${1:alias}\n    HostName ${2:fqn}\n    LocalForward ${4:port} ${5:localhost}:${4:port}\n    User ${6:user}');
    return item;
})()];

export function activate(context: ExtensionContext) {
    context.subscriptions.push(commands.registerCommand('ssh.launch', () => launch().catch(console.error)));
    context.subscriptions.push(commands.registerCommand('ssh.openUserConfig', () => openUserConfig()));
    context.subscriptions.push(commands.registerCommand('ssh.openWorkspaceConfig', () => openWorkspaceConfig().catch(console.error)));
    context.subscriptions.push(languages.registerCompletionItemProvider('ssh_config', { provideCompletionItems }, ' '));
}

interface Option {
    label: string;
    documentation: string;
}

interface ConfigLocation {
    folder?: WorkspaceFolder;
    file: string;
}

interface Host {
    label: string;
    description: string;
    config: ConfigLocation;
}

let options: Promise<Option[]>
function getOptions() {
    return options || (options = new Promise((resolve, reject) => {
        readFile(join(__dirname, '../../thirdparty/options.json'), { encoding: 'utf8' }, (err, content) => {
            err ? reject(err) : resolve(JSON.parse(content));
        });
    }));
}

function provideCompletionItems(document: TextDocument, position: Position): Promise<CompletionItem[]> | undefined {
    const prefix = document.lineAt(position).text.substr(0, position.character);
    if (/^\s*[^\s]*$/.test(prefix)) {
        return getOptions().then(options => options.map(option => {
            const item = new CompletionItem(option.label);
            item.documentation = option.documentation;
            return item;
        }).concat(snippets));
    }
}

function launch() {
    const configLocations: ConfigLocation[] = [];
    if (userConfig) {
        configLocations.push({ file: userConfig });
    }
    if (workspace.workspaceFolders) {
        for (const folder of workspace.workspaceFolders) {
            configLocations.push({
                folder,
                file: workspaceConfigPath(folder.uri.fsPath)
            });
        }
    }
    return Promise.all(configLocations.map(loadHosts))
        .then(hostsArray => {
            const hosts = hostsArray.reduce((all, hosts) => all.concat(hosts), []);
            return window.showQuickPick(hosts.sort((a, b) => a.label.localeCompare(b.label)), { placeHolder: 'Choose which configuration to launch' })
                .then(host => {
                    if (host) {
                        const folder = host.config.folder;
                        const terminal = window.createTerminal({
                            cwd: folder && folder.uri.fsPath
                        });
                        terminal.show();
                        terminal.sendText(folder ? `ssh -F ${workspaceConfigPath('.')} ${host.label}` : `ssh ${host.label}`, false);
                    }
                });
        });
}

function loadHosts(config: ConfigLocation) {
    const { file } = config;
    return fileExists(file)
        .then(exists => {
            return exists ? workspace.openTextDocument(Uri.file(file))
                .then(content => {
                    const text = content.getText();
                    const r = /^Host\s+([^\s]+)/gm;
                    const hosts: Host[] = [];
                    let host;
                    while (host = (r.exec(text) || [])[1]) {
                        hosts.push({
                            label: host,
                            description: shortPath(file),
                            config: config
                        });
                    }
                    return hosts;
                }) : [];
        });
}

function shortPath(path: string) {
    const options = [path];
    if (process.env.HOME) {
        options.push('~/' + relative(process.env.HOME, path));
    }
    if (workspace.workspaceFolders) {
        for (const folder of workspace.workspaceFolders) {
            options.push(join(folder.name, relative(folder.uri.fsPath, path)));
        }
    }
    return options.reduce((min, path) => min.length <= path.length ? min : path);
}

function openUserConfig() {
    if (!userConfig) {
        return window.showInformationMessage('HOME environment variable not set');
    }
    return openConfig(userConfig);
}

async function openWorkspaceConfig() {
    const folders = workspace.workspaceFolders;
    if (!folders || !folders.length) {
        return window.showInformationMessage('No folder opened');
    }
    const folder = folders.length > 1 ? await window.showWorkspaceFolderPick() : folders[0];
    if (folder) {
        return openConfig(workspaceConfigPath(folder.uri.fsPath));
    }
}

function workspaceConfigPath(folderPath: string) {
    return join(folderPath, '.vscode/ssh.config');
}

function openConfig(path: string) {
    return fileExists(path)
        .then(exists => {
            return workspace.openTextDocument(exists ? Uri.file(path) : Uri.file(path).with({ scheme: 'untitled' }))
                .then(document => {
                    return window.showTextDocument(document);
                });
        });
}

function fileExists(path: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        lstat(path, (err, stats) => {
            if (!err) {
                resolve(true);
            } else if (err.code === 'ENOENT') {
                resolve(false);
            } else {
                reject(err);
            }
        });
    });
}

export function deactivate() {
}