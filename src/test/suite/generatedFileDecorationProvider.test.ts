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

			const result = await (provider as any).checkContent(uri as any);
			expect(result).toBe(true);

			Buffer.alloc = originalAlloc;
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
	});
});
