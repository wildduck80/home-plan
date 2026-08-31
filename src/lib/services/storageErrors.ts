/**
 * Storage failure types.
 *
 * These exist so the data layer can report *why* a save failed without reaching for
 * `alert()`. Deciding what the user sees is the UI's job; the store's job is to be honest
 * and to leave existing data alone.
 */

/**
 * Browsers signal a full origin quota with a `DOMException` whose `name` is
 * `QuotaExceededError`. Older engines used numeric codes: 22 (Chrome/Safari) and
 * 1014 (`NS_ERROR_DOM_QUOTA_REACHED`, Firefox).
 */
export function isQuotaExceededError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;

	const candidate = error as { name?: unknown; code?: unknown };

	return (
		candidate.name === 'QuotaExceededError' ||
		candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		candidate.code === 22 ||
		candidate.code === 1014
	);
}

/**
 * Raised when a project could not be persisted because storage is full.
 *
 * Thrown only after every non-destructive avenue has been tried. Crucially, the baseline
 * behaviour this replaces deleted the user's *other* projects to make room; nothing in the
 * storage layer may do that. The project stays in memory, so exporting a backup is a real
 * recovery path — which is what `message` tells the user to do.
 */
export class StorageQuotaError extends Error {
	readonly projectId: string;
	/** Size of the write that could not be completed, in characters. */
	readonly bytesAttempted: number;

	constructor(projectId: string, bytesAttempted: number) {
		super(
			'Browser storage is full, so this project could not be saved. ' +
				'Your work is still open — export a JSON backup now to avoid losing it, ' +
				'then delete projects you no longer need. No existing project has been modified.'
		);
		this.name = 'StorageQuotaError';
		this.projectId = projectId;
		this.bytesAttempted = bytesAttempted;
	}
}
