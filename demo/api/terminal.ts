import { createServer } from "node:http";
import { attachTerminalProxy } from "../terminalProxy.js";

const server = createServer((_request, response) => {
  response.statusCode = 426;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end("WebSocket upgrade required");
});

attachTerminalProxy(server, process.env.FREESTYLE_API_KEY, null);

export default server;
