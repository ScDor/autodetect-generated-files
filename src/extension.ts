import * as vscode from 'vscode';
import { GeneratedFileDecorationProvider } from './generatedFileDecorationProvider.js';

export function activate(context: vscode.ExtensionContext) {
	const provider = new GeneratedFileDecorationProvider();

	// Listen for configuration changes to clear cache/update
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('autodetectGenerated')) {
				provider.refresh();
				updateReadOnlySettings(provider);
			}
		}),
	);

	// Watch for all file changes to trigger re-detection and read-only sync
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	watcher.onDidChange((uri) => {
		provider.update(uri);
		provider.checkAndCache(uri);
	});
	watcher.onDidCreate((uri) => {
		provider.update(uri);
		provider.checkAndCache(uri);
	});
	watcher.onDidDelete((uri) => {
		provider.update(uri);
		updateReadOnlySettings(provider);
	});
	context.subscriptions.push(watcher);

	// Watch for active editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (editor) {
				provider.checkAndCache(editor.document.uri);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('autodetect-generated.syncReadOnly', () => {
			updateReadOnlySettings(provider);
		}),
	);

	// Initial update
	updateReadOnlySettings(provider);

	// Also trigger check for visible editors
	vscode.window.visibleTextEditors.forEach((editor) => {
		provider.checkAndCache(editor.document.uri);
	});
}

async function updateReadOnlySettings(provider: GeneratedFileDecorationProvider) {
	const generatedFiles = provider.getGeneratedFiles();
	const config = vscode.workspace.getConfiguration('files');
	const readonlyInclude: Record<string, boolean> = {};

	for (const file of generatedFiles) {
		readonlyInclude[file] = true;
	}

	await config.update('readonlyInclude', readonlyInclude, vscode.ConfigurationTarget.Workspace);
}

export function deactivate() {}
