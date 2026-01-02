import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class GeneratedFileDecorationProvider {
	private regexPatterns: RegExp[] = [];
	private gitAttributes: string[] = [];
	private excludePatterns: string[] = [];
	private maxSearchLines: number = 5;
	private maxSearchChars: number = 1024;

	// Simple cache: Uri.toString() -> boolean (isGenerated)
	private cache: Map<string, boolean> = new Map();

	getGeneratedFiles(): string[] {
		const generated: string[] = [];
		for (const [uriStr, isGenerated] of this.cache.entries()) {
			if (isGenerated) {
				try {
					const uri = vscode.Uri.parse(uriStr);
					const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
					if (workspaceFolder) {
						const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
						generated.push(relativePath);
					} else {
						generated.push(uri.fsPath);
					}
				} catch (e) {
					// skip
				}
			}
		}
		return generated;
	}

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
		this.excludePatterns = config.get<string[]>('excludePatterns') || [];
		this.maxSearchLines = config.get<number>('maxSearchLines') ?? 5;
		this.maxSearchChars = config.get<number>('maxSearchChars') ?? 1024;
		this.cache.clear();
	}

	refresh() {
		this.loadConfig();
	}

	update(uri: vscode.Uri) {
		this.cache.delete(uri.toString());
	}

	async checkAndCache(uri: vscode.Uri): Promise<boolean> {
		if (uri.scheme !== 'file') {
			return false;
		}

		const key = uri.toString();
		if (this.cache.has(key)) {
			return this.cache.get(key) || false;
		}

		const isGenerated = await this.checkFile(uri);
		this.cache.set(key, isGenerated);

		if (isGenerated) {
			vscode.commands.executeCommand('autodetect-generated.syncReadOnly');
		}
		return isGenerated;
	}

	private async checkFile(uri: vscode.Uri): Promise<boolean> {
		if (this.excludePatterns.length > 0) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
			const relativePath = workspaceFolder
				? path.relative(workspaceFolder.uri.fsPath, uri.fsPath)
				: uri.fsPath;

			for (const pattern of this.excludePatterns) {
				const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
				if (regex.test(relativePath)) {
					return false;
				}
			}
		}

		if (await this.checkGitAttributes(uri)) {
			return true;
		}
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
				if (this.maxSearchChars <= 0) {
					text = await fs.promises.readFile(uri.fsPath, 'utf-8');
				} else {
					const fd = await fs.promises.open(uri.fsPath, 'r');
					const buffer = Buffer.alloc(this.maxSearchChars);
					const { bytesRead } = await fd.read(buffer, 0, this.maxSearchChars, 0);
					await fd.close();
					text = buffer.slice(0, bytesRead).toString('utf-8');
				}
			} else {
				const uint8Array = await vscode.workspace.fs.readFile(uri);
				if (this.maxSearchChars <= 0) {
					text = new TextDecoder('utf-8').decode(uint8Array);
				} else {
					text = new TextDecoder('utf-8').decode(uint8Array.slice(0, this.maxSearchChars));
				}
			}

			if (this.maxSearchLines > 0) {
				const lines = text.split('\n');
				text = lines.slice(0, this.maxSearchLines).join('\n');
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
