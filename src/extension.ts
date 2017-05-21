/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { join, relative } from 'path';
import { readFile, lstat } from 'fs';

import { ExtensionContext, commands, workspace, Uri, window, languages, TextDocument, Position, CompletionItem } from 'vscode';

const userConfig = process.env.HOME && join(process.env.HOME, '.ssh/config');
const workspaceConfig = workspace.rootPath && join(workspace.rootPath, '.vscode/ssh.config');

export function activate(context: ExtensionContext) {
    context.subscriptions.push(commands.registerCommand('ssh.launch', () => launch()));
    context.subscriptions.push(commands.registerCommand('ssh.openUserConfig', () => openUserConfig()));
    context.subscriptions.push(commands.registerCommand('ssh.openWorkspaceConfig', () => openWorkspaceConfig()));
    context.subscriptions.push(languages.registerCompletionItemProvider('ssh_config', { provideCompletionItems }, ' '));
}

interface Option {
    label: string;
    documentation: string;
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
        }));
    }
}

function launch() {
    const configFiles: string[] = [];
    if (userConfig) {
        configFiles.push(userConfig);
    }
    if (workspaceConfig) {
        configFiles.push(workspaceConfig);
    }
    Promise.all(configFiles.map(loadHosts))
        .then(hostsArray => {
            const hosts = hostsArray.reduce((all, hosts) => all.concat(hosts), []);
            return window.showQuickPick(hosts.sort((a, b) => a.label.localeCompare(b.label)), { placeHolder: 'Choose which configuration to launch' })
                .then(host => {
                    if (host) {
                        const terminal = window.createTerminal();
                        terminal.sendText(host.configFile !== userConfig ? `ssh -F ${relativize(host.configFile)} ${host.label}` : `ssh ${host.label}`, false);
                        terminal.show();
                    }
                });
        });
}

function loadHosts(configFile: string) {
    return workspace.openTextDocument(Uri.file(configFile))
        .then(config => {
            const text = config.getText();
            const r = /^Host\s+([^\s]+)/gm;
            const hosts = [];
            let host;
            while (host = (r.exec(text) || [])[1]) {
                hosts.push({
                    label: host,
                    description: relativize(configFile),
                    configFile
                });
            }
            return hosts;
        }, err => {
            // Ignore, file might not exist.
            return [];
        });
}

function relativize(path: string) {
    const options = [path];
    if (process.env.HOME) {
        options.push('~/' + relative(process.env.HOME, path));
    }
    if (workspace.rootPath) {
        options.push(relative(workspace.rootPath, path));
    }
    return options.reduce((min, path) => min.length <= path.length ? min : path);
}

function openUserConfig() {
    if (!userConfig) {
        return window.showInformationMessage('HOME environment variable not set');
    }
    return openConfig(userConfig);
}

function openWorkspaceConfig() {
    if (!workspaceConfig) {
        return window.showInformationMessage('No workspace opened');
    }
    return openConfig(workspaceConfig);
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