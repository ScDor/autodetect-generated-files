import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../../extension';
import { GeneratedFileDecorationProvider } from '../../generatedFileDecorationProvider';

vi.mock('vscode', () => {
	const mockConfig = {
		get: vi.fn(),
		update: vi.fn().mockResolvedValue(undefined),
	};
	return {
		window: {
			onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
			visibleTextEditors: [],
		},
		workspace: {
			getConfiguration: vi.fn(() => mockConfig),
			onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
			onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			createFileSystemWatcher: vi.fn(() => ({
				dispose: vi.fn(),
				onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
				onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
				onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			})),
		},
		commands: {
			registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
		},
		ConfigurationTarget: {
			Workspace: 1,
		},
	};
});

vi.mock('../../generatedFileDecorationProvider', () => {
	return {
		GeneratedFileDecorationProvider: vi.fn().mockImplementation(function () {
			return {
				refresh: vi.fn(),
				update: vi.fn(),
				getGeneratedFiles: vi.fn(() => []),
				checkAndCache: vi.fn(),
			};
		}),
	};
});

describe('Extension Lifecycle', () => {
	let context: vscode.ExtensionContext;
	let mockProvider: any;

	beforeEach(() => {
		vi.clearAllMocks();
		context = {
			subscriptions: [],
		} as any;

		mockProvider = {
			refresh: vi.fn(),
			update: vi.fn(),
			getGeneratedFiles: vi.fn(() => []),
			checkAndCache: vi.fn(),
		};
		(GeneratedFileDecorationProvider as any).mockImplementation(function () {
			return mockProvider;
		});
	});

	it('should register listeners on activation', () => {
		activate(context);

		expect(GeneratedFileDecorationProvider).toHaveBeenCalled();
		expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith('**/*');
		expect(vscode.window.onDidChangeActiveTextEditor).toHaveBeenCalled();
		expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
			'autodetect-generated.syncReadOnly',
			expect.any(Function),
		);

		// Check subscriptions
		expect(context.subscriptions.length).toBeGreaterThan(0);
	});

	it('should have a deactivate function', () => {
		expect(deactivate).toBeDefined();
		expect(() => deactivate()).not.toThrow();
	});
});
