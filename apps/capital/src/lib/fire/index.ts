/**
 * FIRE calculation engine — pure, dependency-free.
 *
 * The Capital adapter (`../fire/adapter`) is the only code that imports both
 * the app domain and this barrel. Everything here can be copied verbatim into a
 * standalone FIRE app.
 */
export * from './types';
export * from './rates';
export * from './fire-number';
export * from './phases';
export * from './solve';
export * from './profiles';
export * from './coast';
export * from './projection';
export * from './scenarios';
export * from './tiers';
export * from './savings';
export * from './result';
export * from './target';
export * from './dates';
export * from './lifecycle';
export * from './monte-carlo';
export * from './depletion-plan';
export * from './milestones';
