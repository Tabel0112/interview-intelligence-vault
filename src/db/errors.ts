export class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class DuplicateContentError extends DatabaseError {}
export class NotFoundError extends DatabaseError {}
export class ValidationError extends DatabaseError {}
export class EvidenceRequiredError extends ValidationError {}
export class InvalidEvidenceError extends ValidationError {}
export class ImmutableRawSourceError extends ValidationError {}
