import { createServer } from "node:http";
import handler from "../api/trips.js";
createServer((req, res) => {
  if (!req.url?.startsWith("/projects/park-in-paris/api/trips") && !req.url?.startsWith("/api/trips")) { res.writeHead(404).end(); return; }
  void handler(req, res);
}).listen(3001, "127.0.0.1", () => console.log("Trip API ready at http://127.0.0.1:3001"));
