import type { Server } from "node:http";

/**
 * Resolve only after Node confirms the listening socket is bound.
 * A bind error (for example EADDRINUSE) rejects before the caller may start
 * any background worker that can mutate the Runtime Store.
 */
export function listenOrThrow(server: Server, port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
