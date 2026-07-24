export class TerminalLotUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'TerminalLotUnavailableError';
  }
}
