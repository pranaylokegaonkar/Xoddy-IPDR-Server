import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import { pool } from "@workspace/db";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind nginx/Replit's proxy; needed for correct client IPs and secure cookies.
app.set("trust proxy", 1);

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set in production. Refusing to start with an insecure fallback secret.",
    );
  }
  logger.warn(
    "SESSION_SECRET is not set — using an insecure development fallback. Set SESSION_SECRET in production.",
  );
}

const PgSession = connectPgSimple(session);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "xoddy.sid",
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: false,
    }),
    secret: sessionSecret ?? "xoddy-dev-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

app.use("/api", router);

export default app;
