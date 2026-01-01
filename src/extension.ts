import * as vscode from 'vscode';
import { GeneratedFileDecorationProvider } from './generatedFileDecorationProvider.js';

export function activate(context: vscode.ExtensionContext) {
	const provider = new GeneratedFileDecorationProvider();
	context.subscriptions.push(vscode.window.registerFileDecorationProvider(provider));

	// Listen for configuration changes to clear cache/update
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('autodetectGenerated')) {
				provider.refresh();
			}
		}),
	);

	// Listen for .gitattributes changes to refresh
	const gitAttributesWatcher = vscode.workspace.createFileSystemWatcher('**/.gitattributes');
	gitAttributesWatcher.onDidChange(() => provider.refresh());
	gitAttributesWatcher.onDidCreate(() => provider.refresh());
	gitAttributesWatcher.onDidDelete(() => provider.refresh());
	context.subscriptions.push(gitAttributesWatcher);

	// Listen for file saves to re-check content
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			provider.update(doc.uri);
		}),
	);
}

export function deactivate() {}
