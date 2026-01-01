import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { GeneratedFileDecorationProvider } from '../../generatedFileDecorationProvider';

vi.mock('vscode', () => {
	class EventEmitter {
		event = vi.fn();
		fire = vi.fn();
	}
	class ThemeColor {
		constructor(public color: string) {}
	}
	class FileDecoration {
		constructor(
			public badge: string,
			public tooltip: string,
			public color: any,
		) {}
	}
	return {
		EventEmitter,
		ThemeColor,
		FileDecoration,
		workspace: {
			getConfiguration: vi.fn(),
			getWorkspaceFolder: vi.fn(),
			fs: {
				readFile: vi.fn(),
			},
		},
		Uri: {
			file: (path: string) => ({
				fsPath: path,
				path: path,
				scheme: 'file',
				toString: () => `file://${path}`,
			}),
			parse: (uri: string) => ({
				fsPath: uri.replace('file://', ''),
				path: uri.replace('file://', ''),
				scheme: uri.split(':')[0],
				toString: () => uri,
			}),
		},
	};
});

vi.mock('child_process', () => ({
	execFile: vi.fn(),
}));

vi.mock('fs', () => ({
	promises: {
		open: vi.fn(),
	},
}));

describe('GeneratedFileDecorationProvider', () => {
	let provider: GeneratedFileDecorationProvider;
	let mockConfig: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockConfig = {
			get: vi.fn((key: string) => {
				if (key === 'regexPatterns') return ['@generated'];
				if (key === 'gitAttributes') return ['generated'];
				if (key === 'badge') return 'G';
				if (key === 'color') return 'charts.yellow';
				return undefined;
			}),
		};
		(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig);
		provider = new GeneratedFileDecorationProvider();
	});

	it('should be initialized with default config', () => {
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('autodetectGenerated');
	});

	it('should handle invalid regex patterns', () => {
		mockConfig.get.mockImplementation((key: string) => {
			if (key === 'regexPatterns') return ['[invalid'];
			return undefined;
		});
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		provider.refresh();
		expect(consoleSpy).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	describe('provideFileDecoration', () => {
		it('should return undefined for non-file schemes', async () => {
			const uri = vscode.Uri.parse('http://example.com');
			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeUndefined();
		});

		it('should return decoration for generated files (cached)', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			// First call to populate cache
			mockConfig.get.mockReturnValue(['generated']);
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: set');
			});

			const dec1 = await provider.provideFileDecoration(uri as any);
			expect(dec1).toBeDefined();

			// Second call should use cache
			const dec2 = await provider.provideFileDecoration(uri as any);
			expect(dec2).toBeDefined();
			expect(cp.execFile).toHaveBeenCalledTimes(1);
		});

		it('should return undefined for non-generated files (cached)', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: unset');
			});
			(fs.promises.open as any).mockRejectedValue(new Error('File not found'));

			const dec1 = await provider.provideFileDecoration(uri as any);
			expect(dec1).toBeUndefined();

			const dec2 = await provider.provideFileDecoration(uri as any);
			expect(dec2).toBeUndefined();
			expect(cp.execFile).toHaveBeenCalledTimes(1);
		});
	});

	describe('checkGitAttributes', () => {
		it('should detect generated file via git attributes (set)', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: '/test' } });
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: set');
			});

			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeDefined();
			expect(decoration?.badge).toBe('G');
		});

		it('should detect generated file via git attributes (true)', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: true');
			});

			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeDefined();
		});

		it('should handle git command failure', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(new Error('Git not found'), '');
			});
			(fs.promises.open as any).mockRejectedValue(new Error('File not found'));

			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeUndefined();
		});

		it('should return false if no git attributes are configured', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'gitAttributes') return [];
				return undefined;
			});
			provider.refresh();
			const uri = vscode.Uri.file('/test/file.ts');
			(fs.promises.open as any).mockRejectedValue(new Error('File not found'));

			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeUndefined();
			expect(cp.execFile).not.toHaveBeenCalled();
		});

		it('should use file directory if no workspace folder', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined);
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				expect(opts.cwd).toBe('/test');
				cb(null, '');
			});
			await provider.provideFileDecoration(uri as any);
		});
	});

	describe('checkContent', () => {
		it('should detect generated file via regex in content', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, ''); // Not in git
			});

			const mockFd = {
				read: vi.fn().mockResolvedValue({ bytesRead: 20 }),
				close: vi.fn().mockResolvedValue(undefined),
			};
			(fs.promises.open as any).mockResolvedValue(mockFd);

			// Mocking Buffer to return content with @generated
			const originalAlloc = Buffer.alloc;
			Buffer.alloc = vi.fn().mockReturnValue({
				slice: vi.fn().mockReturnValue({
					toString: () => '// @generated\nconst x = 1;',
				}),
			}) as any;

			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeDefined();

			Buffer.alloc = originalAlloc;
		});

		it('should handle files from non-file schemes in checkContent', async () => {
			// We use the internal checkContent by calling provideFileDecoration
			// but we need to bypass the early return.
			// We'll use a trick: call it directly via (provider as any).checkContent
			const uri = vscode.Uri.parse('vscode-test:/test/file.ts');
			const mockContent = new TextEncoder().encode('// @generated\nconst x = 1;');
			(vscode.workspace.fs.readFile as any).mockResolvedValue(mockContent);

			const isGenerated = await (provider as any).checkContent(uri);
			expect(isGenerated).toBe(true);
			expect(vscode.workspace.fs.readFile).toHaveBeenCalledWith(uri);
		});

		it('should return false if no regex patterns are configured', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return [];
				if (key === 'gitAttributes') return [];
				return undefined;
			});
			provider.refresh();
			const uri = vscode.Uri.file('/test/file.ts');
			const decoration = await provider.provideFileDecoration(uri as any);
			expect(decoration).toBeUndefined();
		});

		it('should handle errors in checkContent', async () => {
			const uri = vscode.Uri.file('/test/error.ts');
			(fs.promises.open as any).mockRejectedValue(new Error('Unexpected error'));
			const isGenerated = await (provider as any).checkContent(uri);
			expect(isGenerated).toBe(false);
		});
	});

	describe('lifecycle and updates', () => {
		it('refresh should clear cache and fire event', () => {
			const fireSpy = vi.fn();
			(provider as any)._onDidChangeFileDecorations.fire = fireSpy;
			provider.refresh();
			expect(fireSpy).toHaveBeenCalledWith(undefined);
		});

		it('update should clear specific cache entry and fire event', () => {
			const uri = vscode.Uri.file('/test/file.ts');
			const fireSpy = vi.fn();
			(provider as any)._onDidChangeFileDecorations.fire = fireSpy;
			provider.update(uri as any);
			expect(fireSpy).toHaveBeenCalledWith(uri);
		});
	});
});
