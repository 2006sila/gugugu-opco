#!/usr/bin/env node
/**
 * port-check.mjs — who is using my ports, and which one can I have?
 *
 * Usage:
 *   node scripts/port-check.mjs            # explain 8790..8799 and the blacklist
 *   node scripts/port-check.mjs 9000 9010  # explain an explicit range
 */
import net from "node:net";

const BLACKLIST = new Map([[8788, "reserved by another local tool"]]);
const HOST = "127.0.0.1";

const isFree = (port) =>
  new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => tester.close(() => resolve(true)));
    tester.listen(port, HOST);
  });

const main = async () => {
  const args = process.argv.slice(2).map(Number).filter((value) => Number.isFinite(value));
  const from = args.length >= 1 ? args[0] : 8790;
  const to = args.length >= 2 ? args[1] : from + 9;

  let firstFree = 0;
  for (let port = from; port <= to; port += 1) {
    const reserve = BLACKLIST.get(port);
    if (reserve) {
      console.log(String(port).padStart(5) + "  RESERVED  " + reserve);
      continue;
    }
    const free = await isFree(port);
    if (free && firstFree === 0) firstFree = port;
    console.log(String(port).padStart(5) + "  " + (free ? "free" : "IN USE"));
  }
  console.log("");
  console.log(firstFree ? "first free port: " + firstFree : "no free port in range " + from + "-" + to);
  process.exitCode = firstFree ? 0 : 1;
};

await main();
