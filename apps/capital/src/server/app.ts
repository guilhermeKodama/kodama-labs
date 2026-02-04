import { createApp } from "./lib/create-app";

const { app, router } = createApp();

export type AppType = (typeof router)[number];

export default app;
