// A programmable pi.exec stub. Accepts a queue of responses (or a handler
// function) and returns them in order as each call is made. Captures call
// arguments for later assertions.
//
// Usage:
//   const exec = makeExecStub();
//   exec.enqueue({ stdout: "rtk 0.37.2\n", stderr: "", code: 0, killed: false });
//   const pi = { exec: exec.fn };
//   ...
//   assert.equal(exec.calls.length, 1);
//   assert.deepEqual(exec.calls[0].args, ["--version"]);

export function makeExecStub() {
	const queue = [];
	const calls = [];

	/** @type {(command: string, args: string[], options?: object) => Promise<any>} */
	const fn = async (command, args, options = {}) => {
		calls.push({ command, args: [...args], options });
		if (options.signal?.aborted) {
			return { stdout: "", stderr: "", code: 1, killed: true };
		}
		if (queue.length === 0) {
			throw new Error(
				`execStub: no response programmed for ${command} ${args.join(" ")}`,
			);
		}
		const next = queue.shift();
		if (typeof next === "function") return next(command, args, options);
		if (next instanceof Error) throw next;
		return next;
	};

	return {
		fn,
		calls,
		enqueue(response) {
			queue.push(response);
			return this;
		},
		enqueueError(err) {
			queue.push(err instanceof Error ? err : new Error(String(err)));
			return this;
		},
		enqueueHandler(handler) {
			queue.push(handler);
			return this;
		},
		reset() {
			queue.length = 0;
			calls.length = 0;
		},
	};
}

/**
 * Convenience: construct a canonical ExecResult.
 */
export function execResult(overrides = {}) {
	return {
		stdout: "",
		stderr: "",
		code: 0,
		killed: false,
		...overrides,
	};
}
