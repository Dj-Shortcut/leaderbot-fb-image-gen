import type http from "node:http";

export async function bindTestHttpServer(server: http.Server): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  port: number;
}> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Unable to get test server address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
    port: address.port,
  };
}
