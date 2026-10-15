// A TCP proxy that can cut every connection, to drop the web app's link to the throwaway daemon:
// node cut-proxy.cjs <listen port> <daemon port> <control file>. Write "cut" to the control file to drop
// every connection and refuse new ones, "open" to accept them again, "slow-up" or "slow-down" to hold
// what the app sends, or what the daemon answers, for 3 s (so a send is still on its way when cut).
const net = require("node:net");
const fs = require("node:fs");
const [, , listenPort, targetPort, control] = process.argv;
const sockets = new Set();
let mode = "open";
const open = () => mode !== "cut";
fs.writeFileSync(control, "open");
setInterval(() => {
  const wanted = fs.readFileSync(control, "utf8").trim() || "open";
  if (wanted === mode) return;
  mode = wanted;
  if (mode === "cut") sockets.forEach((socket) => socket.destroy());
  console.log(`${new Date().toISOString()} ${mode}`);
}, 50);
/** Copies one way, holding each chunk 3 s while the mode says so. */
function relay(from, to, slowMode) {
  from.on("data", (chunk) => {
    if (mode === slowMode) setTimeout(() => to.destroyed || to.write(chunk), 3000);
    else to.write(chunk);
  });
}
net
  .createServer((client) => {
    if (!open()) return client.destroy();
    const upstream = net.connect(Number(targetPort), "127.0.0.1");
    [client, upstream].forEach((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
    });
    relay(client, upstream, "slow-up");
    relay(upstream, client, "slow-down");
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => client.destroy());
  })
  .listen(Number(listenPort), "127.0.0.1");
