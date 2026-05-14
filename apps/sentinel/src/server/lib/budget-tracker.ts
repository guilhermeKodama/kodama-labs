export class BudgetTracker {
  private readonly startedAt: number;

  constructor(private readonly budgetMs: number) {
    this.startedAt = Date.now();
  }

  exceeded(): boolean {
    return Date.now() - this.startedAt > this.budgetMs;
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  remainingMs(): number {
    return Math.max(0, this.budgetMs - this.elapsedMs());
  }
}

export class YieldSignal extends Error {
  constructor(message = "Budget exhausted, yielding") {
    super(message);
    this.name = "YieldSignal";
  }
}
