import { createApp } from "./lib/create-app";

const app = createApp();

export type AppType = typeof app;

export default app;
