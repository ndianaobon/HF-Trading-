import "server-only";

export const actorOf = (session, ip, userAgent) => ({
  id: session.user.id,
  email: session.user.email,
  ip,
  userAgent,
});
