import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { io, type Socket } from "socket.io-client";
import { KUMA_WEBHOOK_BODY } from "./kuma-body.js";
import { MANAGED_PREFIX, managedHash, type MonitorDesired } from "./spec.js";
import { pushToken } from "./push-token.js";
import { webhookFromProcess, type ResolvedWebhook } from "./webhook.js";

const NOTIFICATION_NAME = "kodama-alert-webhook";
const DOCKER_HOST_NAME = "kodama-docker";
const MAINTENANCE_TITLE = "kodama-deploy";

interface Named {
  id: number;
  name: string;
  description: string;
}

interface MaintenanceRow {
  id: number;
  title: string;
}

export interface KumaSession {
  socket: Socket;
  monitors: Named[];
  notifications: Named[];
  dockerHosts: Named[];
  maintenances: MaintenanceRow[];
}

export async function connectKuma(): Promise<KumaSession> {
  const url = process.env.KUMA_URL?.trim() || "http://uptime-kuma:3001";
  const username = requiredEnv("UPTIME_KUMA_USERNAME");
  const password = requiredEnv("UPTIME_KUMA_PASSWORD");
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    // 2.5.3 rejects a bare websocket upgrade (the request is answered with the
    // SPA HTML). Polling is the handshake the UI uses; the upgrade can follow.
    const socket = io(url, {
      transports: ["polling", "websocket"],
      reconnection: false,
      timeout: 8000,
    });
    try {
      await waitConnect(socket);
      const needSetup = await ack<boolean>(socket, "needSetup");
      if (needSetup) await ack(socket, "setup", username, password);
      // 2.5.3 emits monitorList, notificationList, dockerHostList and
      // maintenanceList from afterLogin, before the login ack returns.
      const lists = captureLoginLists(socket);
      const login = await ack<{ tokenRequired?: boolean }>(socket, "login", { username, password });
      if (login.tokenRequired) {
        throw new Error("Uptime Kuma 2FA is enabled on this user; the provisioner cannot log in");
      }
      return { socket, ...(await lists) };
    } catch (error) {
      lastError = error;
      socket.close();
      await sleep(2000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("could not log in to Uptime Kuma");
}

export async function provisionMonitors(session: KumaSession, monitors: MonitorDesired[]): Promise<boolean> {
  const notificationId = await upsertNotification(session);
  const notificationIDList: Record<string, boolean> = notificationId
    ? { [String(notificationId)]: true }
    : {};
  const secret = process.env.KUMA_PUSH_TOKEN_SECRET?.trim() ?? "";
  const dockerHostId = await upsertDockerHost(session);
  const byName = new Map(session.monitors.map((monitor) => [monitor.name, monitor]));
  const desiredNames = new Set<string>();
  const tokenMismatches: Record<string, string> = {};

  for (const desired of monitors) {
    if (desired.type === "docker" && dockerHostId === null) continue;
    if (desired.type === "docker") desired.docker_host = dockerHostId;
    if (desired.type === "push") {
      if (!secret) throw new Error("KUMA_PUSH_TOKEN_SECRET is required to provision push monitors");
      desired.pushToken = pushToken(secret, desired.name);
    }
    const description = `managed:${managedHash(desired)}`;
    const payload = kumaMonitorPayload(desired, description, notificationIDList);
    desiredNames.add(desired.name);
    const found = byName.get(desired.name);

    let monitorId: number;
    if (!found) {
      const added = await ack<{ monitorID: number }>(session.socket, "add", payload);
      monitorId = added.monitorID;
      console.log(`[provision] added ${desired.name}`);
    } else if (found.description === description) {
      console.log(`[provision] unchanged ${desired.name}`);
      continue;
    } else {
      await ack(session.socket, "editMonitor", { ...payload, id: found.id });
      monitorId = found.id;
      console.log(`[provision] updated ${desired.name}`);
    }

    if (!desired.pushToken) continue;
    const actual = await readPushToken(session.socket, monitorId);
    if (actual && actual !== desired.pushToken) tokenMismatches[desired.name] = actual;
  }

  for (const monitor of session.monitors) {
    if (!monitor.name.startsWith(MANAGED_PREFIX) || desiredNames.has(monitor.name)) continue;
    await ack(session.socket, "deleteMonitor", monitor.id, true);
    console.log(`[provision] removed ${monitor.name}`);
  }

  await writeTokenOverrides(tokenMismatches);
  return dockerHostId !== null || !monitors.some((monitor) => monitor.type === "docker");
}

export async function startMaintenance(session: KumaSession, minutes: number): Promise<void> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new Error("minutes must be an integer from 1 to 1440");
  }
  const monitors = session.monitors.filter((monitor) => monitor.name.startsWith(MANAGED_PREFIX));
  const now = new Date();
  const end = new Date(now.getTime() + minutes * 60_000);
  const body = {
    title: MAINTENANCE_TITLE,
    description: "Opened by maintenance.js around a deploy.",
    strategy: "single",
    active: true,
    intervalDay: 1,
    timezoneOption: "UTC",
    dateRange: [now.toISOString(), end.toISOString()],
    timeRange: [
      { hours: 0, minutes: 0 },
      { hours: 0, minutes: 0 },
    ],
    weekdays: [],
    daysOfMonth: [],
  };
  const found = session.maintenances.find((item) => item.title === MAINTENANCE_TITLE);
  let id = found?.id;
  if (id === undefined) {
    const added = await ack<{ maintenanceID: number }>(session.socket, "addMaintenance", body);
    id = added.maintenanceID;
  } else {
    await ack(session.socket, "editMaintenance", { ...body, id });
  }
  await ack(
    session.socket,
    "addMonitorMaintenance",
    id,
    monitors.map((monitor) => ({ id: monitor.id })),
  );
  console.log(`[maintenance] ${MAINTENANCE_TITLE} active for ${minutes} minutes (${monitors.length} monitors)`);
}

export async function clearMaintenance(session: KumaSession): Promise<void> {
  const found = session.maintenances.find((item) => item.title === MAINTENANCE_TITLE);
  if (!found) {
    console.log(`[maintenance] ${MAINTENANCE_TITLE} is not set`);
    return;
  }
  await ack(session.socket, "pauseMaintenance", found.id);
  console.log(`[maintenance] paused ${MAINTENANCE_TITLE}`);
}

async function upsertNotification(session: KumaSession): Promise<number | null> {
  const webhook = webhookFromProcess();
  const found = session.notifications.find((item) => item.name === NOTIFICATION_NAME);
  if (!webhook) {
    if (found) {
      await ack(session.socket, "deleteNotification", found.id);
      console.log("[provision] webhook URL unset; removed notification");
    } else {
      console.log("[provision] webhook URL unset; monitors will not notify");
    }
    return null;
  }
  const payload = notificationPayload(webhook);
  if (!found) {
    const added = await ack<{ id: number }>(session.socket, "addNotification", payload, null);
    console.log("[provision] created webhook notification");
    return added.id;
  }
  await ack(session.socket, "addNotification", payload, found.id);
  console.log("[provision] updated webhook notification");
  return found.id;
}

function notificationPayload(webhook: ResolvedWebhook): Record<string, unknown> {
  return {
    name: NOTIFICATION_NAME,
    type: "webhook",
    isDefault: true,
    applyExisting: true,
    webhookURL: webhook.url,
    webhookContentType: "custom",
    webhookCustomBody: KUMA_WEBHOOK_BODY,
    webhookAdditionalHeaders: JSON.stringify(webhook.headers),
    httpMethod: "post",
  };
}

async function upsertDockerHost(session: KumaSession): Promise<number | null> {
  const dockerType = process.env.DOCKER_TYPE?.trim() || "tcp";
  const dockerDaemon = process.env.DOCKER_DAEMON?.trim() || "tcp://docker-socket-proxy:2375";
  const payload = { name: DOCKER_HOST_NAME, dockerType, dockerDaemon };
  try {
    await ack(session.socket, "testDockerHost", payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[provision] docker host check failed: ${message}`);
    console.error(
      "[provision] Docker monitors were not saved. Socket fallback is in infrastructure/monitoring/README.md.",
    );
    return null;
  }
  const found = session.dockerHosts.find((item) => item.name === DOCKER_HOST_NAME);
  const saved = await ack<{ id?: number }>(session.socket, "addDockerHost", payload, found?.id ?? null);
  const id = saved.id ?? found?.id;
  if (id === undefined) throw new Error("docker host save did not return an id");
  return id;
}

async function readPushToken(socket: Socket, monitorID: number): Promise<string | null> {
  const result = await ack<{ monitor?: { pushToken?: string | null } }>(socket, "getMonitor", monitorID);
  const token = result.monitor?.pushToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

async function writeTokenOverrides(mismatches: Record<string, string>): Promise<void> {
  const file = process.env.PUSH_TOKEN_FILE?.trim();
  if (!file) {
    if (Object.keys(mismatches).length > 0) {
      throw new Error("Kuma ignored client push tokens and PUSH_TOKEN_FILE is unset");
    }
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  if (Object.keys(mismatches).length === 0) {
    await unlink(file).catch(() => undefined);
    return;
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(mismatches, null, 2)}\n`);
  await rename(tmp, file);
  console.error(
    `[provision] Kuma stored different push tokens for ${Object.keys(mismatches).length} monitors; wrote ${file}`,
  );
}

function kumaMonitorPayload(
  monitor: MonitorDesired,
  description: string,
  notificationIDList: Record<string, boolean>,
): Record<string, unknown> {
  return {
    name: monitor.name,
    description,
    parent: null,
    type: monitor.type,
    subtype: null,
    url: monitor.url ?? null,
    method: monitor.method ?? "GET",
    body: null,
    headers: null,
    timeout: 20,
    interval: monitor.interval,
    retryInterval: monitor.retryInterval,
    resendInterval: monitor.resendInterval,
    hostname: null,
    maxretries: monitor.maxretries,
    port: null,
    keyword: null,
    invertKeyword: false,
    ignoreTls: false,
    expiryNotification: false,
    domainExpiryNotification: false,
    upsideDown: false,
    packetSize: 56,
    maxredirects: monitor.maxredirects ?? 10,
    accepted_statuscodes: monitor.accepted_statuscodes,
    pushToken: monitor.pushToken ?? null,
    docker_container: monitor.docker_container ?? "",
    docker_host: monitor.docker_host ?? null,
    databaseConnectionString: monitor.databaseConnectionString ?? null,
    databaseQuery: monitor.databaseQuery ?? null,
    conditions: [],
    kafkaProducerBrokers: [],
    kafkaProducerSaslOptions: {},
    rabbitmqNodes: [],
    notificationIDList,
    active: true,
    basic_auth_user: null,
    basic_auth_pass: null,
    authMethod: null,
    proxyId: null,
  };
}

function captureLoginLists(socket: Socket): Promise<Omit<KumaSession, "socket">> {
  const monitors = onceEvent<unknown>(socket, "monitorList");
  const notifications = onceEvent<unknown>(socket, "notificationList");
  const dockerHosts = onceEvent<unknown>(socket, "dockerHostList");
  const maintenances = onceEvent<unknown>(socket, "maintenanceList");
  return Promise.all([
    withTimeout(monitors, "monitorList"),
    withTimeout(notifications, "notificationList"),
    withTimeout(dockerHosts, "dockerHostList"),
    withTimeout(maintenances, "maintenanceList"),
  ]).then(([monitorRaw, notificationRaw, dockerRaw, maintenanceRaw]) => ({
    monitors: asRecords(monitorRaw).map((item) => ({
      id: numberField(item, "id"),
      name: stringField(item, "name"),
      description: typeof item.description === "string" ? item.description : "",
    })),
    notifications: asRecords(notificationRaw).map(notificationName),
    dockerHosts: asRecords(dockerRaw).map((item) => ({
      id: numberField(item, "id"),
      name: stringField(item, "name"),
      description: "",
    })),
    maintenances: asRecords(maintenanceRaw).map((item) => ({
      id: numberField(item, "id"),
      title: stringField(item, "title"),
    })),
  }));
}

function notificationName(item: Record<string, unknown>): Named {
  let name = typeof item.name === "string" ? item.name : "";
  if (!name && typeof item.config === "string") {
    try {
      const config = JSON.parse(item.config) as { name?: string };
      name = config.name ?? "";
    } catch {
      name = "";
    }
  }
  return { id: numberField(item, "id"), name, description: "" };
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value)) return Object.values(value).filter(isRecord);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`missing numeric ${key}`);
  return parsed;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function waitConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 8000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function onceEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (data: T) => resolve(data));
  });
}

function withTimeout<T>(pending: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    pending,
    sleep(15_000).then(() => {
      throw new Error(`timeout waiting for ${label}`);
    }),
  ]);
}

function ack<T>(socket: Socket, event: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${event}`)), 20_000);
    socket.emit(event, ...args, (result: T) => {
      clearTimeout(timer);
      if (isRecord(result) && result.ok === false) {
        const msg = typeof result.msg === "string" ? result.msg : event;
        reject(new Error(`${event}: ${msg}`));
        return;
      }
      resolve(result);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
