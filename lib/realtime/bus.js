import "server-only";
import { EventEmitter } from "node:events";

const g = globalThis;
const emitter = (g.__hfBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(10_000);
  return e;
})());

export function publish(userId, event) {
  emitter.emit(`user:${userId}`, event);
}

export function subscribe(userId, listener) {
  const channel = `user:${userId}`;
  emitter.on(channel, listener);
  return () => emitter.off(channel, listener);
}
