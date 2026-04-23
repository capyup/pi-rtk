// Fake ExtensionContext / ExtensionCommandContext. Captures calls into the
// TUI surface so tests can assert on them, and provides a controllable
// `confirm()` answer.

export function createFakeCtx({ hasUI = true, confirmAnswer = true, signal } = {}) {
	const ui = {
		notifications: [],
		statuses: new Map(),
		widgets: new Map(),
		confirmCalls: [],
		editorText: undefined,
		title: undefined,

		notify(message, type = "info") {
			ui.notifications.push({ message, type });
		},
		async confirm(title, message) {
			ui.confirmCalls.push({ title, message });
			return confirmAnswer;
		},
		async select(_message, _options) {
			return undefined;
		},
		async input(_message) {
			return "";
		},
		async editor(_contents) {
			return "";
		},
		setStatus(key, text) {
			if (text === undefined) ui.statuses.delete(key);
			else ui.statuses.set(key, text);
		},
		setWidget(key, content) {
			if (content === undefined) ui.widgets.delete(key);
			else ui.widgets.set(key, content);
		},
		setTitle(text) {
			ui.title = text;
		},
		setEditorText(text) {
			ui.editorText = text;
		},
	};

	const ctx = {
		ui,
		hasUI,
		cwd: process.cwd(),
		signal,
		sessionManager: {
			getEntries: () => [],
			getBranch: () => [],
			getLeafId: () => undefined,
			getSessionFile: () => undefined,
			getLabel: () => undefined,
		},
		modelRegistry: undefined,
		model: undefined,
		isIdle() {
			return true;
		},
		abort() {},
		hasPendingMessages() {
			return false;
		},
		shutdown() {},
		getContextUsage() {
			return undefined;
		},
		compact() {},
		getSystemPrompt() {
			return "";
		},
	};

	return ctx;
}
