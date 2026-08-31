/**
 * Minimal `Storage` implementation with a byte budget, for exercising quota handling.
 *
 * Real browsers throw `QuotaExceededError` (a `DOMException`) once the origin's storage is
 * full. Node has no such global, so this fake reproduces the shape the code branches on:
 * `name === 'QuotaExceededError'`.
 */
export class QuotaExceededErrorStub extends Error {
	constructor() {
		super('The quota has been exceeded.');
		this.name = 'QuotaExceededError';
	}
}

export class FakeLocalStorage implements Storage {
	private store = new Map<string, string>();

	/** Byte budget across all keys and values. `Infinity` disables the limit. */
	constructor(private byteLimit = Infinity) {}

	get length(): number {
		return this.store.size;
	}

	/** Total bytes currently used, counting keys and values. */
	usedBytes(): number {
		let total = 0;
		for (const [key, value] of this.store) {
			total += key.length + value.length;
		}
		return total;
	}

	setByteLimit(limit: number): void {
		this.byteLimit = limit;
	}

	key(index: number): string | null {
		return [...this.store.keys()][index] ?? null;
	}

	getItem(key: string): string | null {
		return this.store.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		const previous = this.store.get(key);
		const delta =
			key.length + value.length - (previous === undefined ? 0 : key.length + previous.length);

		if (this.usedBytes() + delta > this.byteLimit) {
			throw new QuotaExceededErrorStub();
		}

		this.store.set(key, value);
	}

	removeItem(key: string): void {
		this.store.delete(key);
	}

	clear(): void {
		this.store.clear();
	}

	/** Test helper: every key currently present. */
	keys(): string[] {
		return [...this.store.keys()];
	}
}

/** Install a fresh fake as the global `localStorage`. Returns it for assertions. */
export function installFakeLocalStorage(byteLimit = Infinity): FakeLocalStorage {
	const fake = new FakeLocalStorage(byteLimit);
	Object.defineProperty(globalThis, 'localStorage', {
		value: fake,
		configurable: true,
		writable: true
	});
	return fake;
}
