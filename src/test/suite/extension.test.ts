import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { activate, deactivate } from '../../extension';
import { GeneratedFileDecorationProvider } from '../../generatedFileDecorationProvider';

vi.mock('vscode', () => {
	return {
		window: {
			registerFileDecorationProvider: vi.fn(),
		},
		workspace: {
			onDidChangeConfiguration: vi.fn(),
			onDidSaveTextDocument: vi.fn(),
			createFileSystemWatcher: vi.fn(() => ({
				onDidChange: vi.fn(),
				onDidCreate: vi.fn(),
				onDidDelete: vi.fn(),
			})),
		},
	};
});

vi.mock('../../generatedFileDecorationProvider', () => {
	return {
		GeneratedFileDecorationProvider: vi.fn().mockImplementation(function () {
			return {
				refresh: vi.fn(),
				update: vi.fn(),
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

		// The mock implementation of the constructor will return this object
		mockProvider = {
			refresh: vi.fn(),
			update: vi.fn(),
		};
		(GeneratedFileDecorationProvider as any).mockImplementation(function () {
			return mockProvider;
		});
	});

	it('should register decoration provider and other listeners on activation', () => {
		activate(context);

		expect(GeneratedFileDecorationProvider).toHaveBeenCalled();
		expect(vscode.window.registerFileDecorationProvider).toHaveBeenCalledWith(mockProvider);
		expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
		expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith('**/.gitattributes');
		expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalled();

		// Check subscriptions
		expect(context.subscriptions.length).toBeGreaterThan(0);
	});

	it('should trigger provider refresh when configuration changes', () => {
		let configChangeCallback: (e: any) => void;
		(vscode.workspace.onDidChangeConfiguration as any).mockImplementation((cb: any) => {
			configChangeCallback = cb;
			return { dispose: vi.fn() };
		});

		activate(context);

		// Simulate config change
		configChangeCallback!({ affectsConfiguration: (section: string) => section === 'autodetectGenerated' });
		expect(mockProvider.refresh).toHaveBeenCalled();
	});

	it('should NOT trigger provider refresh when unrelated configuration changes', () => {
		let configChangeCallback: (e: any) => void;
		(vscode.workspace.onDidChangeConfiguration as any).mockImplementation((cb: any) => {
			configChangeCallback = cb;
			return { dispose: vi.fn() };
		});

		activate(context);

		// Simulate config change
		configChangeCallback!({ affectsConfiguration: (section: string) => section === 'other' });
		expect(mockProvider.refresh).not.toHaveBeenCalled();
	});

	it('should trigger provider refresh when .gitattributes changes', () => {
		let changeCb: any, createCb: any, deleteCb: any;
		(vscode.workspace.createFileSystemWatcher as any).mockReturnValue({
			onDidChange: vi.fn((cb) => (changeCb = cb)),
			onDidCreate: vi.fn((cb) => (createCb = cb)),
			onDidDelete: vi.fn((cb) => (deleteCb = cb)),
		});

		activate(context);

		changeCb();
		expect(mockProvider.refresh).toHaveBeenCalledTimes(1);
		createCb();
		expect(mockProvider.refresh).toHaveBeenCalledTimes(2);
		deleteCb();
		expect(mockProvider.refresh).toHaveBeenCalledTimes(3);
	});

	it('should trigger provider update when document is saved', () => {
		let saveCb: (doc: any) => void;
		(vscode.workspace.onDidSaveTextDocument as any).mockImplementation((cb: any) => {
			saveCb = cb;
			return { dispose: vi.fn() };
		});

		activate(context);

		const mockDoc = { uri: 'mock-uri' };
		saveCb!(mockDoc);
		expect(mockProvider.update).toHaveBeenCalledWith('mock-uri');
	});

	it('should have a deactivate function', () => {
		expect(deactivate).toBeDefined();
		expect(() => deactivate()).not.toThrow();
	});
});
