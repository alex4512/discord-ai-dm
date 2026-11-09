/**
 * An expected failure whose message is safe to show to the Discord user
 * (e.g. "No checkpoint draft exists."). Anything else is treated as an
 * internal error and only logged.
 */
export class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
  }
}
