import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class GeneratedFileDecorationProvider implements vscode.FileDecorationProvider {
	private _onDidChangeFileDecorations: vscode.EventEmitter<vscode.Uri | undefined> = new vscode.EventEmitter<
		vscode.Uri | undefined
	>();
	readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri | undefined> = this._onDidChangeFileDecorations.event;

	private regexPatterns: RegExp[] = [];
	private gitAttributes: string[] = [];
	private badge: string = 'G';
	private color: string = 'charts.yellow';

	// Simple cache: Uri.toString() -> boolean (isGenerated)
	private cache: Map<string, boolean> = new Map();

	constructor() {
		this.loadConfig();
	}

	private loadConfig() {
		const config = vscode.workspace.getConfiguration('autodetectGenerated');
		this.regexPatterns = (config.get<string[]>('regexPatterns') || []).reduce((acc, p) => {
			try {
				acc.push(new RegExp(p));
			} catch (e) {
				console.error(`Invalid regex pattern: ${p}`, e);
			}
			return acc;
		}, [] as RegExp[]);
		this.gitAttributes = config.get<string[]>('gitAttributes') || [];
		this.badge = config.get<string>('badge') || 'G';
		this.color = config.get<string>('color') || 'charts.yellow';
		this.cache.clear();
	}

	refresh() {
		this.loadConfig();
		this._onDidChangeFileDecorations.fire(undefined);
	}

	update(uri: vscode.Uri) {
		this.cache.delete(uri.toString());
		this._onDidChangeFileDecorations.fire(uri);
	}

	async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
		if (uri.scheme !== 'file') {
			return undefined;
		}

		const key = uri.toString();
		if (this.cache.has(key)) {
			if (this.cache.get(key)) {
				return this.getDecoration();
			}
			return undefined;
		}

		// Determine if generated
		const isGenerated = await this.checkFile(uri);
		this.cache.set(key, isGenerated);

		if (isGenerated) {
			return this.getDecoration();
		}
		return undefined;
	}

	private getDecoration(): vscode.FileDecoration {
		return new vscode.FileDecoration(this.badge, 'Generated File', new vscode.ThemeColor(this.color));
	}

	private async checkFile(uri: vscode.Uri): Promise<boolean> {
		// 1. Check Git Attributes
		if (await this.checkGitAttributes(uri)) {
			return true;
		}

		// 2. Check Content
		if (await this.checkContent(uri)) {
			return true;
		}

		return false;
	}

	private async checkGitAttributes(uri: vscode.Uri): Promise<boolean> {
		if (this.gitAttributes.length === 0) {
			return false;
		}

		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		const cwd = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(uri.fsPath);

		return new Promise((resolve) => {
			const args = ['check-attr', ...this.gitAttributes, '--', uri.fsPath];

			cp.execFile('git', args, { cwd: cwd, timeout: 1000 }, (err, stdout) => {
				if (err) {
					resolve(false);
					return;
				}

				const lines = stdout.toString().split('\n');
				for (const line of lines) {
					const parts = line.split(': ');
					if (parts.length >= 3) {
						const attrName = parts[1].trim();
						const attrValue = parts[2].trim();

						if (this.gitAttributes.includes(attrName) && (attrValue === 'set' || attrValue === 'true')) {
							resolve(true);
							return;
						}
					}
				}
				resolve(false);
			});
		});
	}

	private async checkContent(uri: vscode.Uri): Promise<boolean> {
		if (this.regexPatterns.length === 0) {
			return false;
		}

		try {
			let text = '';
			if (uri.scheme === 'file') {
				const fd = await fs.promises.open(uri.fsPath, 'r');
				const buffer = Buffer.alloc(2048);
				const { bytesRead } = await fd.read(buffer, 0, 2048, 0);
				await fd.close();
				text = buffer.slice(0, bytesRead).toString('utf-8');
			} else {
				const uint8Array = await vscode.workspace.fs.readFile(uri);
				text = new TextDecoder('utf-8').decode(uint8Array.slice(0, 2048));
			}

			for (const regex of this.regexPatterns) {
				if (regex.test(text)) {
					return true;
				}
			}
		} catch (e) {
			// Ignore errors
		}
		return false;
	}
}
