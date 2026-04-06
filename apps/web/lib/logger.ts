import pino from "pino";

export const logger = pino({
  name: "slideforge-web",
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
});
