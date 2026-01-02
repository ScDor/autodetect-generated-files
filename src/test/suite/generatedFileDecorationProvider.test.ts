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
	return {
		EventEmitter,
		workspace: {
			getConfiguration: vi.fn(),
			getWorkspaceFolder: vi.fn(),
			fs: {
				readFile: vi.fn(),
			},
		},
		commands: {
			executeCommand: vi.fn(),
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
				if (key === 'excludePatterns') return [];
				if (key === 'maxSearchLines') return 5;
				if (key === 'maxSearchChars') return 1024;
				return undefined;
			}),
		};
		(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig);
		provider = new GeneratedFileDecorationProvider();
	});

	it('should be initialized with default config', () => {
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('autodetectGenerated');
	});

	describe('checkAndCache', () => {
		it('should return false for non-file schemes', async () => {
			const uri = vscode.Uri.parse('http://example.com');
			const result = await provider.checkAndCache(uri as any);
			expect(result).toBe(false);
		});

		it('should detect and cache generated files', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: set');
			});

			const result1 = await provider.checkAndCache(uri as any);
			expect(result1).toBe(true);
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith('autodetect-generated.syncReadOnly');

			// Second call should use cache
			vi.clearAllMocks();
			const result2 = await provider.checkAndCache(uri as any);
			expect(result2).toBe(true);
			expect(cp.execFile).not.toHaveBeenCalled();
			expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
		});

		it('should return false for non-generated files', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: unset');
			});
			(fs.promises.open as any).mockRejectedValue(new Error('File not found'));

			const result = await provider.checkAndCache(uri as any);
			expect(result).toBe(false);
		});
	});

	describe('checkGitAttributes', () => {
		it('should detect generated file via git attributes (set)', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: '/test' } });
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/test/file.ts: generated: set');
			});

			const result = await (provider as any).checkGitAttributes(uri as any);
			expect(result).toBe(true);
		});
	});

	describe('checkContent', () => {
		it('should detect generated file via regex in content', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			const mockFd = {
				read: vi.fn().mockImplementation((buf, offset, length, pos) => {
					buf.write('// @generated\nconst x = 1;');
					return Promise.resolve({ bytesRead: 20 });
				}),
				close: vi.fn().mockResolvedValue(undefined),
			};
			(fs.promises.open as any).mockResolvedValue(mockFd);

			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return ['@generated'];
				if (key === 'maxSearchChars') return 2048;
				if (key === 'maxSearchLines') return 5;
				return undefined;
			});
			provider.refresh();

			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(true);
		});
	});

	describe('getGeneratedFiles', () => {
		it('should return relative paths for generated files in workspace', async () => {
			const uri = vscode.Uri.file('/work/gen.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: '/work' } });
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/work/gen.ts: generated: set');
			});

			await provider.checkAndCache(uri as any);
			const generated = provider.getGeneratedFiles();
			expect(generated).toContain('gen.ts');
		});

		it('should return absolute paths for generated files outside workspace', async () => {
			const uri = vscode.Uri.file('/outside/gen.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined);
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/outside/gen.ts: generated: set');
			});

			await provider.checkAndCache(uri as any);
			const generated = provider.getGeneratedFiles();
			expect(generated).toContain('/outside/gen.ts');
		});
	});

	describe('edge cases and error handling', () => {
		it('should handle invalid regex patterns gracefully', () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return ['[invalid'];
				return [];
			});
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			provider.refresh();
			expect(consoleSpy).toHaveBeenCalled();
			consoleSpy.mockRestore();
		});

		it('should handle git check-attr errors', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(new Error('git error'));
			});
			const result = await (provider as any).checkGitAttributes(uri as any);
			expect(result).toBe(false);
		});

		it('should handle missing git attributes values', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, 'only: two: parts'); // Should have at least 3 parts when split by ': '
			});
			const result = await (provider as any).checkGitAttributes(uri as any);
			expect(result).toBe(false);
		});

		it('should handle non-file scheme in checkContent via workspace.fs', async () => {
			const uri = vscode.Uri.parse('vscode-test://test/file.ts');
			(vscode.workspace.fs.readFile as any).mockResolvedValue(new TextEncoder().encode('@generated content'));

			// We need to trigger checkContent directly or via checkFile with a non-file URI
			// but checkAndCache filters by scheme.
			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(true);
		});

		it('should handle errors in checkContent', async () => {
			const uri = vscode.Uri.file('/test/error.ts');
			(fs.promises.open as any).mockRejectedValue(new Error('read error'));
			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(false);
		});

		it('should handle exclusion without workspace folder', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'excludePatterns') return ['/outside/gen.ts'];
				return [];
			});
			provider.refresh();

			const uri = vscode.Uri.file('/outside/gen.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined);

			const result = await provider.checkAndCache(uri as any);
			expect(result).toBe(false);
		});

		it('should call update and refresh', () => {
			const uri = vscode.Uri.file('/test/file.ts');
			provider.update(uri as any);
			provider.refresh();
		});

		it('should handle git check-attr with multiple lines', async () => {
			const uri = vscode.Uri.file('/test/file.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: '/test' } });
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, 'other: attr: unset\n/test/file.ts: generated: set');
			});

			const result = await (provider as any).checkGitAttributes(uri as any);
			expect(result).toBe(true);
		});
	});

	describe('search limits', () => {
		it('should respect maxSearchLines', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return ['@generated'];
				if (key === 'maxSearchLines') return 2;
				if (key === 'maxSearchChars') return 2048;
				return undefined;
			});
			provider.refresh();

			const uri = vscode.Uri.file('/test/file.ts');
			const mockFd = {
				read: vi.fn().mockResolvedValue({ bytesRead: 100 }),
				close: vi.fn().mockResolvedValue(undefined),
			};
			(fs.promises.open as any).mockResolvedValue(mockFd);

			const originalAlloc = Buffer.alloc;
			Buffer.alloc = vi.fn().mockReturnValue({
				slice: vi.fn().mockReturnValue({
					toString: () => 'line1\nline2\n@generated on line 3',
				}),
			}) as any;

			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(false);

			Buffer.alloc = originalAlloc;
		});

		it('should respect maxSearchChars', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return ['@generated'];
				if (key === 'maxSearchChars') return 10;
				if (key === 'maxSearchLines') return 0;
				return undefined;
			});
			provider.refresh();

			const uri = vscode.Uri.file('/test/file.ts');
			const mockFd = {
				read: vi.fn().mockImplementation((buf, offset, length, pos) => {
					return Promise.resolve({ bytesRead: 10 });
				}),
				close: vi.fn().mockResolvedValue(undefined),
			};
			(fs.promises.open as any).mockResolvedValue(mockFd);

			const originalAlloc = Buffer.alloc;
			Buffer.alloc = vi.fn().mockImplementation((size) => {
				return {
					slice: vi.fn().mockReturnValue({
						toString: () => 'too short',
					}),
				};
			}) as any;

			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(false);

			Buffer.alloc = originalAlloc;
		});

		it('should read entire file when maxSearchChars is 0', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return ['@generated'];
				if (key === 'maxSearchChars') return 0;
				if (key === 'maxSearchLines') return 0;
				return undefined;
			});
			provider.refresh();

			const uri = vscode.Uri.file('/test/file.ts');
			(fs.promises as any).readFile = vi.fn().mockResolvedValue('line 100: @generated');

			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(true);
			expect(fs.promises.readFile).toHaveBeenCalledWith(uri.fsPath, 'utf-8');
		});
	});

	describe('exclusion patterns', () => {
		it('should exclude files matching glob patterns', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'regexPatterns') return ['@generated'];
				if (key === 'gitAttributes') return ['generated'];
				if (key === 'excludePatterns') return ['*.test.ts'];
				return undefined;
			});
			provider.refresh();

			const uri = vscode.Uri.file('/work/gen.test.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: '/work' } });
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/work/gen.test.ts: generated: set');
			});

			const result = await provider.checkAndCache(uri as any);
			expect(result).toBe(false);
		});

		it('should exclude files matching complex glob patterns', async () => {
			mockConfig.get.mockImplementation((key: string) => {
				if (key === 'excludePatterns') return ['**/temp/*'];
				return [];
			});
			provider.refresh();

			const uri = vscode.Uri.file('/work/src/temp/file.ts');
			(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({ uri: { fsPath: '/work' } });
			(cp.execFile as any).mockImplementation((cmd: string, args: any, opts: any, cb: any) => {
				cb(null, '/work/src/temp/file.ts: generated: set');
			});

			const result = await provider.checkAndCache(uri as any);
			expect(result).toBe(false);
		});
	});
});
