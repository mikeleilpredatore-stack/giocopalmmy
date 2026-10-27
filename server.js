const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true }));

// Each private room contains at most two players. The server relays positions
// and input state; the browser runs the simple platform physics.
const rooms = new Map();
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function roomFor(code) {
  if (!rooms.has(code)) rooms.set(code, { players: new Map(), started: false });
  return rooms.get(code);
}
function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, role: p.role, x: p.x, y: p.y,
    vx: p.vx, vy: p.vy, facing: p.facing, onGround: p.onGround
  }));
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}, reply = () => {}) => {
    let code = makeCode();
    while (rooms.has(code)) code = makeCode();
    const room = roomFor(code);
    const player = {
      id: socket.id, name: String(name || "Palma").slice(0, 18),
      role: "palma", x: 80, y: 380, vx: 0, vy: 0, facing: 1, onGround: false
    };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.room = code;
    socket.data.role = "palma";
    reply({ ok: true, code, role: "palma", players: publicPlayers(room) });
    io.to(code).emit("roomState", { code, players: publicPlayers(room), started: room.started });
  });

  socket.on("joinRoom", ({ code, name } = {}, reply = () => {}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: "Questa stanza non esiste. Controlla il codice." });
    if (room.players.size >= 2) return reply({ ok: false, error: "La stanza è già piena (2 giocatori)." });
    if (socket.data.room) leaveRoom(socket);
    const player = {
      id: socket.id, name: String(name || "Michele").slice(0, 18),
      role: "michele", x: 125, y: 380, vx: 0, vy: 0, facing: 1, onGround: false
    };
    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.room = code;
    socket.data.role = "michele";
    room.started = true;
    reply({ ok: true, code, role: "michele", players: publicPlayers(room) });
    io.to(code).emit("roomState", { code, players: publicPlayers(room), started: room.started });
  });

  socket.on("playerUpdate", data => {
    const code = socket.data.room;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    const p = room.players.get(socket.id);
    if (!p || !data) return;
    // Basic validation prevents absurd coordinates being broadcast.
    p.x = Math.max(0, Math.min(5000, Number(data.x) || 0));
    p.y = Math.max(-500, Math.min(1000, Number(data.y) || 0));
    p.vx = Math.max(-20, Math.min(20, Number(data.vx) || 0));
    p.vy = Math.max(-25, Math.min(25, Number(data.vy) || 0));
    p.facing = data.facing < 0 ? -1 : 1;
    p.onGround = !!data.onGround;
    socket.to(code).emit("remoteUpdate", {
      id: socket.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy,
      facing: p.facing, onGround: p.onGround
    });
  });

  socket.on("gameEvent", event => {
    const code = socket.data.room;
    if (code && rooms.has(code)) socket.to(code).emit("gameEvent", event);
  });

  socket.on("disconnect", () => leaveRoom(socket));
});

function leaveRoom(socket) {
  const code = socket.data.room;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  room.players.delete(socket.id);
  socket.leave(code);
  socket.data.room = null;
  if (room.players.size === 0) rooms.delete(code);
  else {
    room.started = false;
    io.to(code).emit("roomState", { code, players: publicPlayers(room), started: false, notice: "L'altro giocatore si è disconnesso." });
  }
}

server.listen(PORT, () => console.log(`Palma & Michele online su http://localhost:${PORT}`));
