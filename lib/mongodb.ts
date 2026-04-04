import mongoose from "mongoose";

function getRequiredEnv(name: "MONGODB_URI" | "MONGODB_DB") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

const mongodbUri = getRequiredEnv("MONGODB_URI");
const mongodbDb = getRequiredEnv("MONGODB_DB");

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var __vissMongooseCache: MongooseCache | undefined;
}

const globalForMongoose = globalThis as typeof globalThis & {
  __vissMongooseCache?: MongooseCache;
};

const cached = globalForMongoose.__vissMongooseCache ?? {
  conn: null,
  promise: null,
};

globalForMongoose.__vissMongooseCache = cached;

export async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongodbUri, {
      dbName: mongodbDb,
      bufferCommands: false,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}