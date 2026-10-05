import Docker from "dockerode";

/** TCP proxy by default. `unix:///path` is the fallback when the proxy cannot stream logs. */
export function createDocker(dockerHost = process.env.DOCKER_HOST?.trim() || "tcp://docker-socket-proxy:2375"): Docker {
  if (dockerHost.startsWith("unix://")) {
    return new Docker({ socketPath: dockerHost.slice("unix://".length) });
  }
  const url = new URL(dockerHost.replace(/^tcp:\/\//, "http://"));
  const protocol = url.protocol === "https:" ? "https" : "http";
  return new Docker({
    protocol,
    host: url.hostname,
    port: Number(url.port || (protocol === "https" ? 443 : 2375)),
  });
}

export interface ListedContainer {
  Id: string;
  State: string;
  service: string;
  name: string;
}

export function toListed(raw: {
  Id: string;
  State?: string;
  Names?: string[];
  Labels?: Record<string, string> | undefined;
}): ListedContainer {
  const name = (raw.Names?.[0] ?? raw.Id).replace(/^\//, "");
  return {
    Id: raw.Id,
    State: raw.State ?? "",
    service: raw.Labels?.["com.docker.compose.service"] ?? name,
    name,
  };
}
