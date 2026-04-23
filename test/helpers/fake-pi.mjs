// Fake ExtensionAPI. Captures handler registrations, command registrations,
// and forwards pi.exec to a provided stub. Only implements the subset of the
// ExtensionAPI surface that pi-rtk actually uses.

import { makeExecStub } from "./fake-exec.mjs";

export function createFakePi({ exec } = {}) {
	const execStub = exec ?? makeExecStub();
	const handlers = new Map(); // eventName -> Array<handler>
	const commands = new Map(); // name -> options
	const userMessages = []; // { content, options }
	const customMessages = []; // { message, options }

	const pi = {
		exec: execStub.fn,

		on(eventName, handler) {
			const list = handlers.get(eventName) ?? [];
			list.push(handler);
			handlers.set(eventName, list);
		},

		registerTool(_definition) {
			// Not used by pi-rtk.
		},

		registerCommand(name, options) {
			commands.set(name, options);
		},

		registerShortcut(_key, _options) {
			// Not used.
		},

		registerFlag(_name, _options) {
			// Not used.
		},

		registerMessageRenderer(_customType, _renderer) {
			// Not used.
		},

		registerProvider(_id, _config) {
			// Not used.
		},

		sendUserMessage(content, options) {
			userMessages.push({ content, options });
		},

		sendMessage(message, options) {
			customMessages.push({ message, options });
		},

		appendEntry(_customType, _data) {
			// Not used.
		},

		setSessionName(_name) {},
		getSessionName() {
			return undefined;
		},
		setLabel(_entryId, _label) {},

		getAllTools() {
			return [];
		},
		getActiveTools() {
			return [];
		},
		setActiveTools(_names) {},
		getCommands() {
			return [];
		},

		async setModel(_model) {
			return true;
		},
	};

	return {
		pi,
		execStub,
		handlers,
		commands,
		userMessages,
		customMessages,
		/** Invoke every registered handler for an event with `(event, ctx)`. */
		async fire(eventName, event, ctx) {
			const list = handlers.get(eventName) ?? [];
			const results = [];
			for (const handler of list) {
				results.push(await handler(event, ctx));
			}
			return results;
		},
		/** Invoke a registered /command handler with `(args, ctx)`. */
		async runCommand(name, args, ctx) {
			const entry = commands.get(name);
			if (!entry) throw new Error(`no command registered: /${name}`);
			return entry.handler(args, ctx);
		},
	};
}
